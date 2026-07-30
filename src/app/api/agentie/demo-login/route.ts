import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { signToken } from "@/lib/signed-token";
import {
  ORG_SESSION_TTL_SECONDS,
  setOrgSessionCookie,
} from "@/modules/platform";

export const runtime = "nodejs";

const DEMO_ORG = "Demo Distribuție SRL";

/**
 * „Vezi DEMO" de pe pagina de login — intră instant în firma demo:
 *   ?rol=patron  → contul de patron (vede tot, inclusiv salarii)
 *   ?rol=manager → contul de manager (implicit)
 *   ?rol=agent   → panoul de teren al unui agent (link semnat, 24h)
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

  const url = new URL(req.url);
  const rol = url.searchParams.get("rol") ?? "manager";

  try {
    await ensureSchema();

    if (rol === "agent") {
      const secret = process.env.TOKEN_SECRET;
      if (!secret) {
        return Response.json({ error: "Demo indisponibil" }, { status: 503 });
      }
      const agents = await db<Array<{ agent_id: string; name: string }>>`
        SELECT a.agent_id, a.name
        FROM org_agents a
        JOIN organizations o ON o.id = a.org_id
        WHERE o.name = ${DEMO_ORG} AND a.active
        ORDER BY a.agent_id
        LIMIT 1
      `;
      if (agents.length === 0) {
        return Response.json(
          { error: "Firma demo nu există încă — se creează din /platform/setari." },
          { status: 404 },
        );
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

    const email =
      rol === "patron" ? "demo@bcagent.ro" : "manager.demo@bcagent.ro";
    const rows = await db<
      Array<{ id: string; org_id: string; email: string; name: string; role: string }>
    >`
      SELECT u.id, u.org_id, u.email, u.name, u.role
      FROM org_users u
      JOIN organizations o ON o.id = u.org_id
      WHERE o.name = ${DEMO_ORG} AND u.email = ${email} AND u.active
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
      role: u.role === "owner" ? "owner" : "manager",
      exp: Math.floor(Date.now() / 1000) + ORG_SESSION_TTL_SECONDS,
    });
    return Response.redirect(new URL("/agentie", req.url), 302);
  } catch (e) {
    console.error("[demo-login]", e);
    return Response.json({ error: "Eroare la demo" }, { status: 500 });
  }
}
