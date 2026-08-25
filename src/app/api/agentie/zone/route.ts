import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";
import { ZILE, neted, parseZone, potriveste } from "@/modules/zone/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ZONELE AGENȚILOR — cine unde lucrează, pe zile.
 *
 * Managerul lipește textul exact cum îl are pe WhatsApp („luni - vf
 * câmpului, Lozna, dersca…"), platforma îl citește, potrivește satele cu
 * cele reale din registru și îi spune limpede ce n-a găsit — nu ghicește
 * în tăcere. De aici ies rutele zilei și „ce clienți din zona ta n-au
 * fost vizitați".
 */

interface ZonaRand {
  agent_name: string;
  localitate: string;
  zi: string;
}

/** Localitățile REALE ale firmei: din clienți + din județele lor. */
async function localitatiCunoscute(
  db: NonNullable<ReturnType<typeof getDB>>,
  nume: string[],
): Promise<string[]> {
  if (nume.length === 0) return [];
  const rows = await db<Array<{ localitate: string }>>`
    SELECT DISTINCT localitate FROM prospects
    WHERE localitate <> ''
      AND judet IN (
        SELECT DISTINCT judet FROM prospects
        WHERE assigned_agent = ANY(${nume}) AND judet <> ''
      )
    LIMIT 5000
  `;
  return rows.map((r) => r.localitate);
}

export async function GET() {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const rows = await db<ZonaRand[]>`
      SELECT agent_name, localitate, zi FROM agent_zone
      WHERE org_id = ${auth.session.orgId}
      ORDER BY agent_name, zi, localitate
    `;
    return Response.json({
      zile: ZILE,
      agenti: agents.map((a) => ({
        nume: a.name,
        zone: rows
          .filter((r) => r.agent_name === a.name)
          .map((r) => ({ localitate: r.localitate, zi: r.zi })),
      })),
    });
  } catch (e) {
    console.error("[zone GET]", e);
    return Response.json({ error: "Eroare la citirea zonelor" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { agent?: string; text?: string; verificaDoar?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agent = String(body.agent ?? "").trim();
  const text = String(body.text ?? "").slice(0, 20_000);
  if (!agent) return Response.json({ error: "Alege agentul" }, { status: 400 });

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    if (!agents.some((a) => a.name === agent)) {
      return Response.json({ error: "Agentul nu e al firmei tale" }, { status: 403 });
    }

    const citite = parseZone(text);
    const cunoscute = await localitatiCunoscute(
      db,
      agents.map((a) => a.name),
    );
    const gasite: Array<{ zi: string; localitate: string; scris: string }> = [];
    const negasite: Array<{ scris: string; sugestii: string[] }> = [];
    const vazute = new Set<string>();
    for (const c of citite) {
      const p = potriveste(c.localitate, cunoscute);
      if (p.oficial) {
        const cheie = `${c.zi}|${neted(p.oficial)}`;
        if (vazute.has(cheie)) continue;
        vazute.add(cheie);
        gasite.push({ zi: c.zi, localitate: p.oficial, scris: c.localitate });
      } else {
        negasite.push({ scris: c.localitate, sugestii: p.sugestii });
      }
    }

    // „Verifică doar": arătăm ce am înțeles ÎNAINTE să salvăm, ca omul
    // să vadă negru pe alb și să corecteze, nu să salveze pe încredere.
    if (body.verificaDoar) {
      return Response.json({ ok: true, verificare: true, gasite, negasite });
    }

    await db.begin(async (tx) => {
      await tx`
        DELETE FROM agent_zone
        WHERE org_id = ${auth.session.orgId} AND agent_name = ${agent}
      `;
      if (gasite.length > 0) {
        const payload = gasite.map((g) => ({
          org_id: auth.session.orgId,
          agent_name: agent,
          localitate: g.localitate,
          zi: g.zi,
        }));
        await tx`
          INSERT INTO agent_zone ${tx(payload, "org_id", "agent_name", "localitate", "zi")}
          ON CONFLICT (org_id, agent_name, localitate, zi) DO NOTHING
        `;
      }
    });

    return Response.json({ ok: true, salvate: gasite.length, gasite, negasite });
  } catch (e) {
    console.error("[zone POST]", e);
    return Response.json({ error: "Eroare la salvarea zonelor" }, { status: 500 });
  }
}
