import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents } from "@/modules/platform";
import {
  planificaOSM,
  ramaseOSM,
  unJudetOSM,
} from "@/modules/prospects/osm-import";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * MAGAZINELE DIN OPENSTREETMAP, ADUSE NOAPTEA.
 *
 * Un județ întreg se ia în zeci de secunde de la un serviciu public și
 * adesea ocupat. Toată Moldova înseamnă opt județe — nimeni n-are de ce
 * să stea cu ochii pe un ecran care se învârte.
 *
 * Cronul ia din ACEEAȘI coadă ca butonul din panou: fiecare firmă
 * primește un județ la fiecare trecere, în ordinea în care are clienți
 * acolo, apoi vecinii. Dimineața harta e mai plină decât aseară, fără să
 * fi apăsat nimeni nimic.
 *
 * Se cheamă din afară (Railway Cron / cron-job.org), din 15 în 15 minute:
 *   GET /api/cron/osm?secret=<CRON_SECRET>
 *
 * Când nu mai are ce face, răspunde `{ gata: true }` și nu costă nimic —
 * se poate lăsa să bată oricât.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET lipsește" }, { status: 503 });
  }
  if (new URL(req.url).searchParams.get("secret") !== secret) {
    return Response.json({ error: "Secret invalid" }, { status: 401 });
  }
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const orgs = await db<Array<{ id: string; name: string }>>`
      SELECT id, name FROM organizations
      WHERE status IN ('activ', 'trial')
      ORDER BY created_at LIMIT 200
    `;

    // UN JUDEȚ PE FIRMĂ, la fiecare trecere. Nu golim coada dintr-o dată:
    // Overpass e gratuit și ținut de oameni cu mâna lor — nu-l batem.
    const facute: Array<Record<string, unknown>> = [];
    let ramase = 0;
    for (const org of orgs) {
      try {
        await planificaOSM(db, org.id);
        const numeAg = (await listOrgAgents(org.id)).map((a) => a.name);
        const r = await unJudetOSM(db, org.id, numeAg, 60_000);
        if (r) {
          facute.push({ firma: org.name, ...r });
        }
        ramase += await ramaseOSM(db, org.id);
      } catch (e) {
        // O firmă cu necaz nu oprește restul.
        facute.push({
          firma: org.name,
          eroare: e instanceof Error ? e.message.slice(0, 120) : "necunoscut",
        });
      }
    }

    return Response.json({ ok: true, gata: ramase === 0, ramase, facute });
  } catch (e) {
    console.error("[cron osm]", e);
    return Response.json({ error: "Eroare la cron OSM" }, { status: 500 });
  }
}
