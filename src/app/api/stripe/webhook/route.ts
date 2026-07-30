import {
  constructWebhookEvent,
  handleWebhookEvent,
  markStripeEvent,
  stripeEnabled,
  unmarkStripeEvent,
  webhookConfigured,
} from "@/modules/platform";

export const runtime = "nodejs";
// Semnătura se verifică pe corpul brut — fără parsare/cache intermediar.
export const dynamic = "force-dynamic";

/**
 * Webhook Stripe. În Stripe → Developers → Webhooks adaugă endpointul
 *   https://<domeniu>/api/stripe/webhook
 * cu evenimentele: checkout.session.completed, customer.subscription.*,
 * invoice.* — și pune semnătura în STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  if (!stripeEnabled() || !webhookConfigured()) {
    return Response.json({ error: "Stripe neconfigurat" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Semnătură lipsă" }, { status: 400 });
  }

  const payload = await req.text();
  let event;
  try {
    event = await constructWebhookEvent(payload, signature);
  } catch (e) {
    console.error("[stripe webhook] semnătură invalidă", e);
    return Response.json({ error: "Semnătură invalidă" }, { status: 400 });
  }

  try {
    // Stripe repetă livrarea la eroare — procesăm fiecare eveniment o dată.
    const fresh = await markStripeEvent(event.id, event.type);
    if (!fresh) return Response.json({ received: true, duplicate: true });
    await handleWebhookEvent(event);
    return Response.json({ received: true });
  } catch (e) {
    console.error("[stripe webhook]", event.type, e);
    // Marcajul de idempotență se retrage, altfel retry-ul ar fi ignorat.
    await unmarkStripeEvent(event.id);
    // 500 → Stripe reîncearcă livrarea.
    return Response.json({ error: "Eroare la procesare" }, { status: 500 });
  }
}
