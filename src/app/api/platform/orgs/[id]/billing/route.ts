import { isDBEnabled } from "@/lib/db";
import {
  audit,
  createCheckoutSession,
  createPortalSession,
  getOrg,
  requireAdmin,
  stripeEnabled,
  syncOrgInvoices,
} from "@/modules/platform";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Acțiuni de facturare pentru o organizație:
 *   checkout      → link de plată abonament (îl trimiți firmei)
 *   portal        → portalul Stripe (card, facturi, anulare)
 *   sync-invoices → trage facturile din Stripe în baza noastră
 */
export async function POST(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  if (!stripeEnabled()) {
    return Response.json(
      {
        error:
          "Stripe nu e configurat. Adaugă STRIPE_SECRET_KEY în variabilele de mediu.",
      },
      { status: 503 },
    );
  }
  const { id } = await ctx.params;

  let body: { action?: string; planId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;

  try {
    const org = await getOrg(id);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });

    if (body.action === "checkout") {
      const planId = String(body.planId ?? org.planId ?? "");
      if (!planId) {
        return Response.json({ error: "Alege un plan" }, { status: 400 });
      }
      const { url } = await createCheckoutSession({
        orgId: id,
        planId,
        successUrl: `${origin}/platform/organizatii/${id}?plata=ok`,
        cancelUrl: `${origin}/platform/organizatii/${id}?plata=anulat`,
      });
      await audit(auth.session.email, "billing.checkout", id, { planId });
      return Response.json({ url });
    }

    if (body.action === "portal") {
      const { url } = await createPortalSession(
        id,
        `${origin}/platform/organizatii/${id}`,
      );
      await audit(auth.session.email, "billing.portal", id);
      return Response.json({ url });
    }

    if (body.action === "sync-invoices") {
      const count = await syncOrgInvoices(id);
      await audit(auth.session.email, "billing.sync", id, { count });
      return Response.json({ ok: true, count });
    }

    return Response.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    console.error("[billing POST]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Eroare Stripe" },
      { status: 500 },
    );
  }
}
