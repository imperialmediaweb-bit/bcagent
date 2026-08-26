import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";
import { ZILE, neted as nivelat } from "@/modules/zone/parse";
import {
  citesteZone,
  aliasuriInvatate,
  cautaLocalitati,
  invataAlias,
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

  let body: {
    agent?: string;
    text?: string;
    verificaDoar?: boolean;
    /**
     * Satele pe care le-a ales omul din căutare, pentru ce n-am
     * recunoscut din text („Țara Dornelor"). Alegerea e a lui: noi doar
     * i-am arătat lista lui.
     */
    alese?: Array<{
      zi?: string;
      localitate?: string;
      /**
       * Pentru CE rând nerecunoscut a ales. Cu el învățăm: „Burdujeni" →
       * „SUCEAVA", pentru firma lor, ca data viitoare să meargă singur.
       */
      pentru?: string;
    }>;
    /** Caută în satele lui: două-trei litere, alege din listă. */
    cauta?: string;
  };
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

    const numeAg = agents.map((a) => a.name);

    // CAUTĂ ÎN SATELE LUI. Pentru ce n-am recunoscut din text („Țara
    // Dornelor"), omul tastează două-trei litere și alege — nu ghicim noi
    // și nu-l punem să scrie patruzeci de nume.
    if (typeof body.cauta === "string") {
      return Response.json({
        ok: true,
        localitati: await cautaLocalitati(db, numeAg, body.cauta),
      });
    }

    const cunoscute = await localitatiCunoscute(db, numeAg);
    // CE A ÎNVĂȚAT DE LA EI: „Burdujeni" → „SUCEAVA", fiindcă au ales-o
    // ei odată. Nu scriem noi liste de cartiere pentru fiecare oraș din
    // țară — fiecare firmă și-l învață pe al ei.
    const aliasuri = await aliasuriInvatate(db, auth.session.orgId);
    const { gasite, negasite } = citesteZone(text, cunoscute, aliasuri);

    // Ce a ales omul din căutare intră lângă ce am înțeles din text.
    // Verificăm și aici că satul e unul adevărat din lista LUI: ce vine
    // de la un ecran poate veni și de altundeva.
    const stiute = new Map(cunoscute.map((k) => [nivelat(k), k]));
    for (const a of (body.alese ?? []).slice(0, 500)) {
      const cerut = String(a.localitate ?? "").trim().slice(0, 120);
      // SATUL POATE SĂ NU FIE ÎN LISTELE NOASTRE, ȘI TOTUȘI SĂ EXISTE.
      // Tarnița, Palma, Poieni-Solca sunt sate prin care agentul trece
      // săptămânal, dar în care nu e înregistrată nicio firmă — deci nu
      // apar nici în registru, nici în tabelul de localități. Zona e a
      // LUI: îl luăm cum l-a scris. Când apare acolo primul client sau
      // primul magazin de pe hartă, se leagă singur.
      const oficial = stiute.get(nivelat(cerut)) ?? cerut;
      if (nivelat(oficial).length < 2) continue;
      const zi = String(a.zi ?? "").trim();
      if (gasite.some((g) => g.zi === zi && nivelat(g.localitate) === nivelat(oficial))) {
        continue;
      }
      gasite.push({ zi, localitate: oficial, scris: oficial, cum: "ales de tine din listă" });
      // ÎNVAȚĂ. Data viitoare, „Burdujeni" merge singur.
      const pentru = String(a.pentru ?? "").trim();
      if (pentru !== "" && !body.verificaDoar) {
        await invataAlias(
          db,
          auth.session.orgId,
          pentru,
          oficial,
          auth.session.name || auth.session.email || "managerul firmei",
        );
      }
    }

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
