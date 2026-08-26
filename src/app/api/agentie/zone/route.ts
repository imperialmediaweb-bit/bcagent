import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";
import { ZILE } from "@/modules/zone/parse";
import {
  citesteZone,
  localitatiCunoscute,
  salveazaZone,
} from "@/modules/zone/aplica";

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
  pus_de: string;
  updated_at: Date;
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
      SELECT agent_name, localitate, zi, pus_de, updated_at FROM agent_zone
      WHERE org_id = ${auth.session.orgId}
      ORDER BY agent_name, zi, pozitie, localitate
    `;
    return Response.json({
      zile: ZILE,
      agenti: agents.map((a) => {
        const ale = rows.filter((r) => r.agent_name === a.name);
        // Cine a scris-o ultima dată: agentul de pe teren sau managerul.
        const ultima = ale.reduce<{ pusDe: string; cand: string } | null>((acc, r) => {
          const t = r.updated_at?.toISOString() ?? "";
          return !acc || t > acc.cand ? { pusDe: r.pus_de, cand: t } : acc;
        }, null);
        return {
          nume: a.name,
          ultima,
          zone: ale.map((r) => ({ localitate: r.localitate, zi: r.zi })),
        };
      }),
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

    const cunoscute = await localitatiCunoscute(
      db,
      agents.map((a) => a.name),
    );
    const { gasite, negasite } = citesteZone(text, cunoscute);

    // „Verifică doar": arătăm ce am înțeles ÎNAINTE să salvăm, ca omul
    // să vadă negru pe alb și să corecteze, nu să salveze pe încredere.
    if (body.verificaDoar) {
      return Response.json({ ok: true, verificare: true, gasite, negasite });
    }

    await salveazaZone(
      db,
      auth.session.orgId,
      agent,
      gasite,
      auth.session.name || auth.session.email || "managerul firmei",
    );

    return Response.json({ ok: true, salvate: gasite.length, gasite, negasite });
  } catch (e) {
    console.error("[zone POST]", e);
    return Response.json({ error: "Eroare la salvarea zonelor" }, { status: 500 });
  }
}
