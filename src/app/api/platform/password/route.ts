import { isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import {
  audit,
  changeAdminPassword,
  getAdminByEmail,
  requireAdmin,
  verifyPassword,
} from "@/modules/platform";

export const runtime = "nodejs";

/** Schimbarea parolei de super-admin (cere parola curentă). */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const rl = rateLimit(`platform-pass:${clientIP(req)}`, {
    max: 10,
    windowMs: 300_000,
  });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe încercări" }, { status: 429 });
  }

  let body: { current?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const next = String(body.next ?? "");
  if (next.length < 10) {
    return Response.json(
      { error: "Parola nouă trebuie să aibă minim 10 caractere" },
      { status: 400 },
    );
  }

  try {
    const admin = await getAdminByEmail(auth.session.email);
    if (!admin || !(await verifyPassword(String(body.current ?? ""), admin.passwordHash))) {
      return Response.json({ error: "Parola curentă e greșită" }, { status: 401 });
    }
    await changeAdminPassword(admin.id, next);
    await audit(admin.email, "admin.password", admin.email);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[platform password]", e);
    return Response.json({ error: "Eroare la schimbarea parolei" }, { status: 500 });
  }
}
