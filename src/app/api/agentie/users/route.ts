import { isDBEnabled } from "@/lib/db";
import {
  audit,
  createOrgUser,
  deleteOrgUser,
  generatePassword,
  listOrgUsers,
  requireOrgUser,
  setOrgUserActive,
  setOrgUserPassword,
} from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Echipa firmei (conturile owner/manager). Doar OWNER-ul poate crea,
 * reseta sau șterge conturi — managerii doar văd lista.
 */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  return Response.json({
    users: await listOrgUsers(auth.session.orgId),
    myRole: auth.session.role,
  });
}

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser(true);
  if ("response" in auth) return auth.response;

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
  const role = body.role === "owner" ? "owner" : "manager";

  try {
    const password = generatePassword();
    const user = await createOrgUser(
      auth.session.orgId,
      email,
      password,
      String(body.name ?? "").slice(0, 120),
      role,
    );
    await audit(auth.session.email, "orguser.create", user.id, {
      orgId: auth.session.orgId,
      email,
      role,
    });
    return Response.json({ user, password });
  } catch (e) {
    console.error("[agentie users POST]", e);
    const msg =
      e instanceof Error && /unique|duplicate/i.test(e.message)
        ? "Emailul e deja folosit"
        : "Eroare la creare cont";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser(true);
  if ("response" in auth) return auth.response;

  let body: { userId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = String(body.userId ?? "");
  if (!userId) return Response.json({ error: "userId lipsește" }, { status: 400 });

  // Doar peste conturile propriei organizații.
  const users = await listOrgUsers(auth.session.orgId);
  if (!users.some((u) => u.id === userId)) {
    return Response.json({ error: "Contul nu e din firma ta" }, { status: 403 });
  }
  if (userId === auth.session.userId && body.action === "deactivate") {
    return Response.json(
      { error: "Nu îți poți dezactiva propriul cont" },
      { status: 400 },
    );
  }

  try {
    if (body.action === "reset-password") {
      const password = generatePassword();
      await setOrgUserPassword(userId, password);
      await audit(auth.session.email, "orguser.reset", userId);
      return Response.json({ ok: true, password });
    }
    if (body.action === "activate" || body.action === "deactivate") {
      await setOrgUserActive(userId, body.action === "activate");
      await audit(auth.session.email, `orguser.${body.action}`, userId);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    console.error("[agentie users PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser(true);
  if ("response" in auth) return auth.response;
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId) return Response.json({ error: "userId lipsește" }, { status: 400 });
  if (userId === auth.session.userId) {
    return Response.json({ error: "Nu îți poți șterge propriul cont" }, { status: 400 });
  }
  const users = await listOrgUsers(auth.session.orgId);
  if (!users.some((u) => u.id === userId)) {
    return Response.json({ error: "Contul nu e din firma ta" }, { status: 403 });
  }
  try {
    await deleteOrgUser(userId);
    await audit(auth.session.email, "orguser.delete", userId);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie users DELETE]", e);
    return Response.json({ error: "Eroare la ștergere" }, { status: 500 });
  }
}
