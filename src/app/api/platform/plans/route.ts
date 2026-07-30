import { isDBEnabled } from "@/lib/db";
import {
  audit,
  deletePlan,
  listPlans,
  requireAdmin,
  stripeEnabled,
  upsertPlan,
  verifyPlanPrices,
} from "@/modules/platform";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  try {
    const plans = await listPlans();
    // Verificarea prețurilor Stripe e opțională (o cerere de rețea per plan).
    let stripeCheck: Record<string, { ok: boolean; message: string }> | null = null;
    if (
      stripeEnabled() &&
      new URL(req.url).searchParams.get("verify") === "1"
    ) {
      try {
        stripeCheck = await verifyPlanPrices(plans);
      } catch (e) {
        console.error("[plans verify]", e);
      }
    }
    return Response.json({ plans, stripe: stripeEnabled(), stripeCheck });
  } catch (e) {
    console.error("[plans GET]", e);
    return Response.json({ error: "Eroare la listare planuri" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: {
    id?: string;
    name?: string;
    priceCents?: number;
    currency?: string;
    interval?: string;
    agentLimit?: number;
    features?: Record<string, unknown>;
    stripePriceId?: string;
    active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name || name.length > 80) {
    return Response.json({ error: "Nume plan invalid" }, { status: 400 });
  }
  const priceCents = Math.max(0, Math.round(Number(body.priceCents) || 0));
  const agentLimit = Math.min(1000, Math.max(1, Number(body.agentLimit) || 5));
  const stripePriceId = String(body.stripePriceId ?? "").trim();
  if (stripePriceId && !/^price_[A-Za-z0-9_]+$/.test(stripePriceId)) {
    return Response.json(
      { error: "Price ID Stripe invalid (începe cu price_)" },
      { status: 400 },
    );
  }

  try {
    const plan = await upsertPlan({
      id: body.id,
      name,
      priceCents,
      currency: (String(body.currency ?? "RON").toUpperCase()).slice(0, 3),
      interval: body.interval === "year" ? "year" : "month",
      agentLimit,
      features: {
        prospects: !!body.features?.prospects,
        export: !!body.features?.export,
        aiInsights: !!body.features?.aiInsights,
        aiCoach: !!body.features?.aiCoach,
        aiVision: !!body.features?.aiVision,
        support: String(body.features?.support ?? "email").slice(0, 40),
      },
      stripePriceId: stripePriceId || null,
      active: body.active !== false,
    });
    await audit(auth.session.email, "plan.upsert", plan.id, { name, priceCents });
    return Response.json({ plan });
  } catch (e) {
    console.error("[plans POST]", e);
    return Response.json({ error: "Eroare la salvarea planului" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id lipsește" }, { status: 400 });

  try {
    await deletePlan(id);
    await audit(auth.session.email, "plan.delete", id);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[plans DELETE]", e);
    return Response.json(
      { error: "Planul e folosit de organizații — dezactivează-l în loc să-l ștergi" },
      { status: 409 },
    );
  }
}
