import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { signToken } from "@/lib/signed-token";
import {
  DEMO_MANAGER_EMAIL,
  DEMO_ORG_NAME,
  DEMO_OWNER_EMAIL,
  ORG_SESSION_TTL_SECONDS,
  ensurePlatformSchema,
  seedDemoOrg,
  setOrgSessionCookie,
} from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * „Vezi DEMO" de pe pagina de login — intră instant în firma demo:
 *   ?rol=patron  → contul de patron (vede tot, inclusiv salarii)
 *   ?rol=manager → contul de manager (implicit)
 *   ?rol=agent   → panoul de teren al unui agent (link semnat, 24h)
 * Dacă firma demo nu există încă, se creează AUTOMAT la prima apăsare
 * (același seed ca butonul din /platform/setari). GET cu redirect —
 * merge dintr-un simplu link.
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

  const url = new URL(req.url);
  const rol = url.searchParams.get("rol") ?? "manager";

  try {
    await ensureSchema();
    await ensurePlatformSchema();

    // Firma demo nu există? O construim pe loc (idempotent, ~2s).
    const orgExists = await db<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE name = ${DEMO_ORG_NAME} LIMIT 1
    `;
    if (orgExists.length === 0) {
      await seedDemoOrg(url.origin);
    }

    if (rol === "agent") {
      const secret = process.env.TOKEN_SECRET;
      if (!secret) {
        return Response.json({ error: "TOKEN_SECRET lipsește" }, { status: 503 });
      }
      const agents = await db<Array<{ agent_id: string; name: string }>>`
        SELECT a.agent_id, a.name
        FROM org_agents a
        JOIN organizations o ON o.id = a.org_id
        WHERE o.name = ${DEMO_ORG_NAME} AND a.active
        ORDER BY a.agent_id
        LIMIT 1
      `;
      if (agents.length === 0) {
        return Response.json({ error: "Firma demo nu are agenți" }, { status: 404 });
      }
      const token = await signToken(
        {
          agentId: agents[0].agent_id,
          agentName: agents[0].name,
          exp: Math.floor(Date.now() / 1000) + 86400,
        },
        secret,
      );
      return Response.redirect(new URL(`/a/${token}`, req.url), 302);
    }

    const email = rol === "patron" ? DEMO_OWNER_EMAIL : DEMO_MANAGER_EMAIL;
    const rows = await db<
      Array<{ id: string; org_id: string; email: string; name: string; role: string }>
    >`
      SELECT u.id, u.org_id, u.email, u.name, u.role
      FROM org_users u
      JOIN organizations o ON o.id = u.org_id
      WHERE o.name = ${DEMO_ORG_NAME} AND u.email = ${email} AND u.active
      LIMIT 1
    `;
    if (rows.length === 0) {
      return Response.json({ error: "Contul demo lipsește" }, { status: 404 });
    }
    const u = rows[0];
    await setOrgSessionCookie({
      userId: u.id,
      orgId: u.org_id,
      email: u.email,
      name: u.name + " (demo)",
      role: u.role === "owner" ? "owner" : "manager",
      exp: Math.floor(Date.now() / 1000) + ORG_SESSION_TTL_SECONDS,
    });
    return Response.redirect(new URL("/agentie", req.url), 302);
  } catch (e) {
    console.error("[demo-login]", e);
    const msg = e instanceof Error ? e.message : "necunoscută";
    return Response.json({ error: `Eroare la demo: ${msg}` }, { status: 500 });
  }
}
