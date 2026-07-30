import { isDBEnabled } from "@/lib/db";
import {
  audit,
  deleteOrg,
  getOrg,
  isOrgStatus,
  listInvoices,
  listOrgAgents,
  listOrgUsers,
  requireAdmin,
  updateOrg,
} from "@/modules/platform";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  try {
    const org = await getOrg(id);
    if (!org) return Response.json({ error: "Inexistent" }, { status: 404 });
    const [users, agents, invoices] = await Promise.all([
      listOrgUsers(id),
      listOrgAgents(id),
      listInvoices({ orgId: id, limit: 50 }),
    ]);
    return Response.json({
      org,
      users,
      agents,
      invoices: invoices.invoices,
    });
  } catch (e) {
    console.error("[org GET]", e);
    return Response.json({ error: "Eroare la citire" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Parameters<typeof updateOrg>[1] = {};
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 200);
  if (typeof body.cui === "string")
    patch.cui = body.cui.replace(/\D/g, "").slice(0, 12);
  if (typeof body.email === "string") {
    const em = body.email.trim().toLowerCase();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) {
      return Response.json({ error: "Email invalid" }, { status: 400 });
    }
    patch.email = em;
  }
  if (typeof body.telefon === "string") patch.telefon = body.telefon.slice(0, 40);
  if (body.planId === null || typeof body.planId === "string")
    patch.planId = (body.planId as string) || null;
  if (body.status !== undefined) {
    if (!isOrgStatus(body.status)) {
      return Response.json({ error: "Status invalid" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.trialEndsAt === null || typeof body.trialEndsAt === "string")
    patch.trialEndsAt = (body.trialEndsAt as string) || null;
  if (body.agentLimit !== undefined)
    patch.agentLimit = Math.min(500, Math.max(1, Number(body.agentLimit) || 5));
  if (typeof body.note === "string") patch.note = body.note.slice(0, 2000);

  try {
    const org = await updateOrg(id, patch);
    if (!org) return Response.json({ error: "Inexistent" }, { status: 404 });
    await audit(auth.session.email, "org.update", id, patch as Record<string, unknown>);
    return Response.json({ org });
  } catch (e) {
    console.error("[org PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  try {
    const org = await getOrg(id);
    if (!org) return Response.json({ error: "Inexistent" }, { status: 404 });
    await deleteOrg(id);
    await audit(auth.session.email, "org.delete", id, { name: org.name });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[org DELETE]", e);
    return Response.json({ error: "Eroare la ștergere" }, { status: 500 });
  }
}
