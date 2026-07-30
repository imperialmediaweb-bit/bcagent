import { isDBEnabled, getDB } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import {
  audit,
  requireOrgUser,
  setOrgUserPassword,
  verifyPassword,
} from "@/modules/platform";

export const runtime = "nodejs";

/** Schimbarea propriei parole (owner sau manager). */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const rl = rateLimit(`org-pass:${clientIP(req)}`, { max: 10, windowMs: 300_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe încercări" }, { status: 429 });

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

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    const rows = await db<Array<{ password_hash: string }>>`
      SELECT password_hash FROM org_users WHERE id = ${auth.session.userId}
    `;
    if (
      !rows[0] ||
      !(await verifyPassword(String(body.current ?? ""), rows[0].password_hash))
    ) {
      return Response.json({ error: "Parola curentă e greșită" }, { status: 401 });
    }
    await setOrgUserPassword(auth.session.userId, next);
    await audit(auth.session.email, "orguser.password", auth.session.userId);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie password]", e);
    return Response.json({ error: "Eroare la schimbarea parolei" }, { status: 500 });
  }
}
