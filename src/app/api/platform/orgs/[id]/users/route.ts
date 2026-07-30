import { isDBEnabled } from "@/lib/db";
import {
  audit,
  createOrgUser,
  deleteOrgUser,
  generatePassword,
  getOrg,
  listOrgUsers,
  requireAdmin,
  setOrgUserActive,
  setOrgUserPassword,
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
  return Response.json({ users: await listOrgUsers(id) });
}

/** Creează un cont de firmă (owner/manager) cu parolă generată. */
export async function POST(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  let body: { email?: string; name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return Response.json({ error: "Email invalid" }, { status: 400 });
  }
  const role = body.role === "manager" ? "manager" : "owner";

  try {
    if (!(await getOrg(id))) {
      return Response.json({ error: "Organizația nu există" }, { status: 404 });
    }
    const password = generatePassword();
    const user = await createOrgUser(
      id,
      email,
      password,
      String(body.name ?? "").slice(0, 120),
      role,
    );
    await audit(auth.session.email, "orguser.create", user.id, { orgId: id, email });
    return Response.json({ user, password });
  } catch (e) {
    console.error("[orgusers POST]", e);
    const msg =
      e instanceof Error && /unique|duplicate/i.test(e.message)
        ? "Emailul e deja folosit"
        : "Eroare la creare cont";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/** Resetare parolă / activare / dezactivare cont. */
export async function PATCH(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;

  let body: { userId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = String(body.userId ?? "");
  if (!userId) return Response.json({ error: "userId lipsește" }, { status: 400 });

  try {
    if (body.action === "reset-password") {
      const password = generatePassword();
      await setOrgUserPassword(userId, password);
      await audit(auth.session.email, "orguser.reset", userId, { orgId: id });
      return Response.json({ ok: true, password });
    }
    if (body.action === "activate" || body.action === "deactivate") {
      await setOrgUserActive(userId, body.action === "activate");
      await audit(auth.session.email, `orguser.${body.action}`, userId, { orgId: id });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    console.error("[orgusers PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId) return Response.json({ error: "userId lipsește" }, { status: 400 });

  try {
    await deleteOrgUser(userId);
    await audit(auth.session.email, "orguser.delete", userId, { orgId: id });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[orgusers DELETE]", e);
    return Response.json({ error: "Eroare la ștergere" }, { status: 500 });
  }
}
