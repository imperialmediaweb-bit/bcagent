import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import {
  ORG_SESSION_TTL_SECONDS,
  setOrgSessionCookie,
} from "@/modules/platform";

export const runtime = "nodejs";

/**
 * „Vezi DEMO" de pe pagina de login: intră instant în firma demo, pe
 * contul de MANAGER (vede tot, dar nu poate umbla la conturi/salarii).
 * Firma demo se creează/reface de admin din /platform/setari.
 * GET cu redirect — merge dintr-un simplu link.
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "Demo indisponibil" }, { status: 503 });
  }
  const rl = rateLimit(`demo-login:${clientIP(req)}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe încercări" }, { status: 429 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const rows = await db<
      Array<{ id: string; org_id: string; email: string; name: string }>
    >`
      SELECT u.id, u.org_id, u.email, u.name
      FROM org_users u
      JOIN organizations o ON o.id = u.org_id
      WHERE o.name = 'Demo Distribuție SRL'
        AND u.email = 'manager.demo@bcagent.ro' AND u.active
      LIMIT 1
    `;
    if (rows.length === 0) {
      return Response.json(
        { error: "Firma demo nu există încă — se creează din /platform/setari." },
        { status: 404 },
      );
    }
    const u = rows[0];
    await setOrgSessionCookie({
      userId: u.id,
      orgId: u.org_id,
      email: u.email,
      name: u.name + " (demo)",
      role: "manager",
      exp: Math.floor(Date.now() / 1000) + ORG_SESSION_TTL_SECONDS,
    });
    return Response.redirect(new URL("/agentie", req.url), 302);
  } catch (e) {
    console.error("[demo-login]", e);
    return Response.json({ error: "Eroare la demo" }, { status: 500 });
  }
}
