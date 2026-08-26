import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * CE AU FĂCUT AGENȚII PE TEREN.
 *
 * Vizitele se vedeau deja. Munca de hartă — nu: cine a pus locul exact la
 * un magazin, cine a confirmat că prăvălia din harta veche mai există,
 * cine a tăiat una care s-a închis, cine și-a scris zonele pe zile.
 * Toate se făceau, dar nu le vedea nimeni — nici patronul, ca să știe pe
 * cine să bată pe umăr, nici agentul, ca să aibă cu ce se lăuda.
 *
 * Aici sunt adunate, pe fiecare om. NIMIC nu se șterge și nimic nu se
 * schimbă de aici: se citește, atât.
 */

interface Rand {
  agent: string;
  /** Pinuri puse cu mâna pe hartă (deget) sau din poziția telefonului. */
  pinuri: number;
  /** Magazine de prospectat confirmate: „există". */
  confirmate: number;
  /** Magazine găsite închise — nimeni nu mai pierde drumul acolo. */
  taiate: number;
  /** Localități scrise de el în zone. */
  zone: number;
  /** Zilele în care are zone scrise. */
  zile: string[];
  vizite: number;
  comenzi: number;
  /** Ultima urmă lăsată de el, orice ar fi fost. */
  ultima: string | null;
}

export async function GET() {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const orgId = auth.session.orgId;
    const agenti = await listOrgAgents(orgId);
    if (agenti.length === 0) return Response.json({ agenti: [], total: null });

    const nume = agenti.map((a) => a.name);
    const ids = agenti.map((a) => a.id);

    // Fiecare număr, o întrebare limpede. Un singur SQL cu șase JOIN-uri ar
    // fi arătat deștept și ar fi mințit la prima dublură.
    const [pinuri, magazine, zone, vizite, comenzi] = await Promise.all([
      // PINURILE. `pus_de` se scrie de azi înainte; pentru cele mai vechi
      // nu inventăm un nume — le punem pe seama agentului care are firma.
      db<Array<{ agent: string; n: string; ultima: string }>>`
        SELECT COALESCE(NULLIF(g.pus_de, ''), p.assigned_agent) AS agent,
               COUNT(*)::text AS n, MAX(g.updated_at)::text AS ultima
        FROM geo_firme g
        JOIN prospects p ON p.cui = g.cui
        JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${orgId}
        WHERE g.sursa IN ('deget', 'gps')
        GROUP BY 1
      `,
      db<Array<{ agent: string; stare: string; n: string; ultima: string }>>`
        SELECT confirmat_de AS agent, stare, COUNT(*)::text AS n,
               MAX(confirmat_la)::text AS ultima
        FROM magazin_harta
        WHERE org_id = ${orgId} AND confirmat_de <> ''
        GROUP BY 1, 2
      `,
      db<Array<{ agent: string; n: string; zile: string[]; ultima: string }>>`
        SELECT agent_name AS agent, COUNT(*)::text AS n,
               ARRAY_AGG(DISTINCT zi) FILTER (WHERE zi <> '') AS zile,
               MAX(updated_at)::text AS ultima
        FROM agent_zone
        WHERE org_id = ${orgId} AND pus_de = agent_name
        GROUP BY 1
      `,
      db<Array<{ agent: string; n: string; ultima: string }>>`
        SELECT agent_name AS agent, COUNT(*)::text AS n,
               MAX(visited_at)::text AS ultima
        FROM visits WHERE agent_id = ANY(${ids}) GROUP BY 1
      `,
      db<Array<{ agent: string; n: string; ultima: string }>>`
        SELECT agent_name AS agent, COUNT(*)::text AS n,
               MAX(created_at)::text AS ultima
        FROM orders WHERE agent_id = ANY(${ids}) GROUP BY 1
      `,
    ]);

    const gol = (agent: string): Rand => ({
      agent,
      pinuri: 0,
      confirmate: 0,
      taiate: 0,
      zone: 0,
      zile: [],
      vizite: 0,
      comenzi: 0,
      ultima: null,
    });
    const dupaNume = new Map(nume.map((n) => [n, gol(n)]));
    /** Cea mai proaspătă urmă, oricare ar fi ea. */
    const marcheaza = (r: Rand, cand: string | null) => {
      if (!cand) return;
      if (r.ultima === null || cand > r.ultima) r.ultima = cand;
    };

    for (const p of pinuri) {
      const r = dupaNume.get(p.agent);
      if (!r) continue;
      r.pinuri += parseInt(p.n, 10);
      marcheaza(r, p.ultima);
    }
    for (const m of magazine) {
      const r = dupaNume.get(m.agent);
      if (!r) continue;
      if (m.stare === "inchis") r.taiate += parseInt(m.n, 10);
      else r.confirmate += parseInt(m.n, 10);
      marcheaza(r, m.ultima);
    }
    for (const z of zone) {
      const r = dupaNume.get(z.agent);
      if (!r) continue;
      r.zone = parseInt(z.n, 10);
      r.zile = z.zile ?? [];
      marcheaza(r, z.ultima);
    }
    for (const v of vizite) {
      const r = dupaNume.get(v.agent);
      if (!r) continue;
      r.vizite = parseInt(v.n, 10);
      marcheaza(r, v.ultima);
    }
    for (const c of comenzi) {
      const r = dupaNume.get(c.agent);
      if (!r) continue;
      r.comenzi = parseInt(c.n, 10);
      marcheaza(r, c.ultima);
    }

    const lista = [...dupaNume.values()];
    // Întâi cine a muncit mai mult pe hartă — aia e partea nouă, pe care
    // n-o vedea nimeni până acum.
    lista.sort(
      (a, b) =>
        b.pinuri + b.confirmate + b.taiate - (a.pinuri + a.confirmate + a.taiate) ||
        b.vizite - a.vizite,
    );

    // CÂT DIN HARTĂ E GATA — cifra care contează pentru patron.
    const [acoperire] = await db<
      [{ clienti: string; cu_loc: string; din_teren: string; magazine: string }]
    >`
      SELECT
        COUNT(*)::text AS clienti,
        COUNT(g.cui)::text AS cu_loc,
        COUNT(*) FILTER (WHERE g.sursa IN ('deget', 'gps'))::text AS din_teren,
        (SELECT COUNT(*)::text FROM magazin_harta WHERE org_id = ${orgId}) AS magazine
      FROM prospects p
      JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${orgId}
      LEFT JOIN geo_firme g ON g.cui = p.cui
    `;

    return Response.json({
      agenti: lista,
      total: {
        clienti: parseInt(acoperire.clienti, 10),
        cuLoc: parseInt(acoperire.cu_loc, 10),
        dinTeren: parseInt(acoperire.din_teren, 10),
        magazine: parseInt(acoperire.magazine, 10),
      },
    });
  } catch (e) {
    console.error("[agentie teren]", e);
    return Response.json({ error: "Eroare la munca de teren" }, { status: 500 });
  }
}
