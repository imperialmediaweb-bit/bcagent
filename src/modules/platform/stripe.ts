import Stripe from "stripe";
import type { Organization, Plan } from "./types";
import {
  getOrg,
  getOrgByStripeCustomer,
  listPlans,
  updateOrg,
  upsertInvoice,
} from "./repo";

/**
 * Integrarea Stripe — abonamente + facturi.
 *
 * Totul degradează elegant: fără STRIPE_SECRET_KEY aplicația merge normal,
 * doar butoanele de plată sunt dezactivate cu mesaj explicit. Așa poți rula
 * platforma și pe facturare manuală (transfer bancar) până conectezi Stripe.
 *
 * Variabile de mediu:
 *   STRIPE_SECRET_KEY      sk_live_... / sk_test_...
 *   STRIPE_WEBHOOK_SECRET  whsec_...  (din Stripe → Developers → Webhooks)
 */

let client: Stripe | null = null;

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function webhookConfigured(): boolean {
  return !!process.env.STRIPE_WEBHOOK_SECRET;
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY lipsește");
  if (!client) {
    client = new Stripe(key, { typescript: true, maxNetworkRetries: 2 });
  }
  return client;
}

/** Citește un câmp imbricat fără să depindă de versiunea API a obiectului. */
function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  const id = pick(v, "id");
  return typeof id === "string" ? id : null;
}

function tsToIso(v: unknown): string | null {
  return typeof v === "number" && v > 0
    ? new Date(v * 1000).toISOString()
    : null;
}

/* ─────────────────────────── clienți & checkout ───────────────────── */

/** Creează (sau refolosește) clientul Stripe al organizației. */
export async function ensureCustomer(org: Organization): Promise<string> {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: org.name,
    email: org.email || undefined,
    phone: org.telefon || undefined,
    metadata: { orgId: org.id, cui: org.cui },
    ...(org.cui
      ? { tax_id_data: [{ type: "eu_vat" as const, value: `RO${org.cui.replace(/\D/g, "")}` }] }
      : {}),
  });
  await updateOrg(org.id, { stripeCustomerId: customer.id });
  return customer.id;
}

export interface CheckoutInput {
  orgId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

/** Sesiune de checkout pentru abonamentul unei organizații. */
export async function createCheckoutSession(
  input: CheckoutInput,
): Promise<{ url: string }> {
  const org = await getOrg(input.orgId);
  if (!org) throw new Error("Organizația nu există");
  const plans = await listPlans();
  const plan = plans.find((p) => p.id === input.planId);
  if (!plan) throw new Error("Planul nu există");
  if (!plan.stripePriceId) {
    throw new Error(
      `Planul „${plan.name}" nu are Price ID Stripe. Setează-l în Planuri.`,
    );
  }

  const stripe = getStripe();
  const customerId = await ensureCustomer(org);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: "required",
    // Facturile se emit automat pentru abonamente; le sincronizăm din webhook.
    subscription_data: { metadata: { orgId: org.id, planId: plan.id } },
    metadata: { orgId: org.id, planId: plan.id },
  });
  if (!session.url) throw new Error("Stripe nu a returnat URL de checkout");
  return { url: session.url };
}

/** Portalul de facturare (client își schimbă cardul, vede facturile). */
export async function createPortalSession(
  orgId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const org = await getOrg(orgId);
  if (!org) throw new Error("Organizația nu există");
  const stripe = getStripe();
  const customerId = await ensureCustomer(org);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

/* ──────────────────────────── sincronizare ────────────────────────── */

/** Mapare status abonament Stripe → statusul organizației din platformă. */
function statusFromSubscription(s: string): Organization["status"] {
  switch (s) {
    case "active":
    case "past_due":
      return "activ";
    case "trialing":
      return "trial";
    case "canceled":
    case "incomplete_expired":
      return "anulat";
    case "unpaid":
    case "incomplete":
    case "paused":
      return "suspendat";
    default:
      return "suspendat";
  }
}

async function planIdForPrice(priceId: string | null): Promise<string | null> {
  if (!priceId) return null;
  const plans = await listPlans();
  return plans.find((p) => p.stripePriceId === priceId)?.id ?? null;
}

/** Aplică pe organizație starea unui abonament Stripe. */
export async function applySubscription(
  sub: Stripe.Subscription,
): Promise<void> {
  const customerId = idOf(sub.customer);
  let org = customerId ? await getOrgByStripeCustomer(customerId) : null;
  const metaOrgId = sub.metadata?.orgId;
  if (!org && metaOrgId) org = await getOrg(metaOrgId);
  if (!org) return;

  const item = sub.items?.data?.[0];
  const priceId = idOf(item?.price);
  const planId =
    (await planIdForPrice(priceId)) ?? sub.metadata?.planId ?? org.planId;

  // `current_period_end` a migrat de pe subscription pe item în API-urile noi.
  const periodEnd =
    tsToIso(pick(sub, "current_period_end")) ??
    tsToIso(pick(item, "current_period_end"));

  const plans = await listPlans();
  const plan = plans.find((p) => p.id === planId);

  await updateOrg(org.id, {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId ?? org.stripeCustomerId,
    status: statusFromSubscription(sub.status),
    currentPeriodEnd: periodEnd,
    planId: planId ?? null,
    ...(plan ? { agentLimit: plan.agentLimit } : {}),
  });
}

/** Salvează o factură Stripe în baza noastră (cu link către PDF). */
export async function applyInvoice(inv: Stripe.Invoice): Promise<void> {
  const customerId = idOf(inv.customer);
  let org = customerId ? await getOrgByStripeCustomer(customerId) : null;
  const metaOrgId =
    (inv.metadata?.orgId as string | undefined) ??
    (pick(inv, "subscription_details", "metadata", "orgId") as
      | string
      | undefined);
  if (!org && metaOrgId) org = await getOrg(metaOrgId);
  if (!org) return;

  const paidAt =
    inv.status === "paid"
      ? tsToIso(pick(inv, "status_transitions", "paid_at")) ??
        new Date().toISOString()
      : null;

  await upsertInvoice({
    orgId: org.id,
    stripeInvoiceId: inv.id,
    number: inv.number ?? inv.id ?? "",
    amountCents: inv.total ?? inv.amount_due ?? 0,
    currency: (inv.currency ?? "ron").toUpperCase(),
    status: (inv.status ?? "draft") as never,
    hostedUrl: inv.hosted_invoice_url ?? null,
    pdfUrl: inv.invoice_pdf ?? null,
    periodStart: tsToIso(inv.period_start),
    periodEnd: tsToIso(inv.period_end),
    issuedAt: tsToIso(inv.created) ?? new Date().toISOString(),
    paidAt,
  });
}

/** Verifică semnătura webhook-ului și întoarce evenimentul. */
export async function constructWebhookEvent(
  payload: string,
  signature: string,
): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET lipsește");
  return getStripe().webhooks.constructEventAsync(payload, signature, secret);
}

/** Tratează un eveniment Stripe deja verificat. */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = idOf(pick(session, "subscription"));
      const orgId = session.metadata?.orgId;
      const customerId = idOf(session.customer);
      if (orgId && customerId) {
        await updateOrg(orgId, { stripeCustomerId: customerId });
      }
      if (subId) {
        const sub = await getStripe().subscriptions.retrieve(subId);
        await applySubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.updated":
    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
    case "invoice.voided":
    case "invoice.marked_uncollectible":
      await applyInvoice(event.data.object as Stripe.Invoice);
      break;
    default:
      // Restul evenimentelor nu ne interesează (dar le confirmăm cu 200).
      break;
  }
}

/** Trage manual ultimele facturi ale unei organizații din Stripe. */
export async function syncOrgInvoices(orgId: string): Promise<number> {
  const org = await getOrg(orgId);
  if (!org?.stripeCustomerId) return 0;
  const list = await getStripe().invoices.list({
    customer: org.stripeCustomerId,
    limit: 50,
  });
  for (const inv of list.data) await applyInvoice(inv);
  return list.data.length;
}

/** Sincronizează planurile locale cu prețurile din Stripe (după stripePriceId). */
export async function verifyPlanPrices(
  plans: Plan[],
): Promise<Record<string, { ok: boolean; message: string }>> {
  const out: Record<string, { ok: boolean; message: string }> = {};
  const stripe = getStripe();
  for (const p of plans) {
    if (!p.stripePriceId) {
      out[p.id] = { ok: false, message: "fără Price ID" };
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(p.stripePriceId);
      const amount = price.unit_amount ?? 0;
      out[p.id] =
        amount === p.priceCents
          ? { ok: true, message: "sincronizat" }
          : {
              ok: false,
              message: `Stripe are ${(amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`,
            };
    } catch (e) {
      out[p.id] = {
        ok: false,
        message: e instanceof Error ? e.message : "eroare Stripe",
      };
    }
  }
  return out;
}
