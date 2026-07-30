import { isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import {
  audit,
  getOrgUserForLogin,
  ORG_SESSION_TTL_SECONDS,
  setOrgSessionCookie,
  touchOrgUserLogin,
  verifyPassword,
} from "@/modules/platform";

export const runtime = "nodejs";

/** Login pentru panoul agenției (owner/manager, email + parolă). */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "Baza de date nu e configurată" }, { status: 503 });
  }
  const rl = rateLimit(`org-login:${clientIP(req)}`, {
    max: 10,
    windowMs: 300_000,
  });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe încercări. Reîncearcă în câteva minute." },
      { status: 429 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return Response.json({ error: "Email și parolă obligatorii" }, { status: 400 });
  }

  try {
    const user = await getOrgUserForLogin(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return Response.json({ error: "Email sau parolă incorecte" }, { status: 401 });
    }
    if (!user.active) {
      return Response.json({ error: "Contul e dezactivat" }, { status: 403 });
    }
    if (user.orgStatus === "suspendat" || user.orgStatus === "anulat") {
      return Response.json(
        {
          error:
            "Abonamentul firmei e suspendat. Contactează administratorul platformei.",
        },
        { status: 403 },
      );
    }

    await setOrgSessionCookie({
      userId: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + ORG_SESSION_TTL_SECONDS,
    });
    await touchOrgUserLogin(user.id);
    await audit(user.email, "orguser.login", user.orgId);

    return Response.json({
      ok: true,
      user: { email: user.email, name: user.name, role: user.role, orgName: user.orgName },
    });
  } catch (e) {
    console.error("[agentie login]", e);
    return Response.json({ error: "Eroare la autentificare" }, { status: 500 });
  }
}
