import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * ZONA DE AZI A AGENTULUI → OPRIRILE ZILEI.
 *
 * Zonele se scriu o dată, pe zile („luni - Vf. Câmpului, Lozna, Dersca…"):
 * ori de agent, de pe telefon (el știe cel mai bine pe unde umblă), ori de
 * manager, din panoul firmei. Dimineața, agentul deschide aplicația și are
 * deja lista: satele de azi și clienții lui din ele. Fără să adune el
 * opririle una câte una de pe hartă — exact ce lipsea când Costin zicea
 * „nu îmi dă nici un traseu".
 *
 * GET  = ce am azi (sau altă zi) + toată săptămâna, ca s-o pot corecta.
 * POST = îmi scriu zonele, cu confirmare înainte de salvare.
 */

const ZILE = [
  "duminica",
  "luni",
  "marti",
  "miercuri",
  "joi",
  "vineri",
  "sambata",
] as const;

interface OprireRow {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  telefon: string;
  lat: number | null;
  lng: number | null;
  ultima_vizita: Date | null;
}

/** Agentul + firma lui, din link. Fără firmă, zonele n-au unde sta. */
async function cineEste(req: Request, tokenDinCorp?: string) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  const token =
    tokenDinCorp ?? new URL(req.url).searchParams.get("token") ?? "";
  const payload = await verifyFieldToken(token, secret);
  if (!payload) return null;
  const { orgIdForAgent } = await import("@/lib/org-scope");
  return { payload, orgId: await orgIdForAgent(payload.agentId) };
}

/**
 * AGENTUL ÎȘI SCRIE SINGUR ZONELE, de pe telefon.
 *
 * „Agenții să treacă rutele pe zone acolo — ei știu exact ce zone au, pe
 * zile" (Bogdan, 26.08). Lipește același text de pe WhatsApp, aplicația
 * îi arată ce a înțeles și abia apoi salvează. Managerul le vede pe toate
 * în panoul firmei; agentul o vede și o schimbă doar pe a lui.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`zona-scrie:${clientIP(req)}`, { max: 20, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  let body: {
    token?: string;
    text?: string;
    verificaDoar?: boolean;
    alese?: Array<{ zi?: string; localitate?: string }>;
    cauta?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cine = await cineEste(req, body.token);
  if (!cine) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  if (!cine.orgId) {
    return Response.json(
      { error: "Linkul tău nu e legat de o firmă — cere-i șefului unul nou." },
      { status: 403 },
    );
  }
  const text = String(body.text ?? "").slice(0, 20_000);

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const { cautaLocalitati, citesteZone, localitatiCunoscute, salveazaZone } =
      await import("@/modules/zone/aplica");
    const { neted: nivelat } = await import("@/modules/zone/parse");
    const { orgAgentNamesForAgent } = await import("@/lib/org-scope");
    const aiMei = await orgAgentNamesForAgent(cine.payload.agentId);
    const numeAg = aiMei.length ? aiMei : [cine.payload.agentName];

    // CAUTĂ ÎN SATELE LUI. Pe telefon, în mașină, nimeni nu scrie
    // patruzeci de nume: tastează două-trei litere și alege din lista lui.
    if (typeof body.cauta === "string") {
      return Response.json({
        ok: true,
        localitati: await cautaLocalitati(db, numeAg, body.cauta),
      });
    }

    const cunoscute = await localitatiCunoscute(db, numeAg);
    const { gasite, negasite } = citesteZone(text, cunoscute);

    // Ce a ales el din căutare intră lângă ce am înțeles din text. Se
    // verifică și aici că satul e din lista LUI: ce vine de la un ecran
    // poate veni și de altundeva.
    const stiute = new Map(cunoscute.map((k) => [nivelat(k), k]));
    for (const a of (body.alese ?? []).slice(0, 500)) {
      const oficial = stiute.get(nivelat(String(a.localitate ?? "")));
      if (!oficial) continue;
      const zi = String(a.zi ?? "").trim();
      if (gasite.some((g) => g.zi === zi && nivelat(g.localitate) === nivelat(oficial))) {
        continue;
      }
      gasite.push({ zi, localitate: oficial, scris: oficial, cum: "ales de tine din listă" });
    }

    // „Verifică doar": îi arătăm ce am înțeles ÎNAINTE să salvăm — pe
    // telefon, în mașină, nimeni nu vrea să descopere greșeala peste o zi.
    if (body.verificaDoar) {
      return Response.json({ ok: true, verificare: true, gasite, negasite });
    }
    await salveazaZone(
      db,
      cine.orgId,
      cine.payload.agentName,
      gasite,
      cine.payload.agentName,
    );
    return Response.json({ ok: true, salvate: gasite.length, gasite, negasite });
  } catch (e) {
    console.error("[zona agent POST]", e);
    return Response.json({ error: "Eroare la salvarea zonelor" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`zona:${clientIP(req)}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });
  const url = new URL(req.url);
  const payload = await verifyFieldToken(url.searchParams.get("token") ?? "", secret);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }

  // Ziua: implicit AZI, dar se poate cere alta („vreau să văd ce am marți").
  const cerut = (url.searchParams.get("zi") ?? "").toLowerCase();
  const zi = (ZILE as readonly string[]).includes(cerut)
    ? cerut
    : ZILE[new Date().getDay()];

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const { orgIdForAgent } = await import("@/lib/org-scope");
    const orgId = await orgIdForAgent(payload.agentId);
    if (!orgId) {
      // Link vechi, fără firmă în spate: n-are cine să-i pună zone.
      return Response.json({ zi, localitati: [], stops: [], alteFirme: 0 });
    }

    // TOATĂ săptămâna: agentul își vede zonele ca să le poată corecta,
    // nu doar ziua de azi.
    const toate = await db<
      Array<{ zi: string; localitate: string; pus_de: string; updated_at: Date }>
    >`
      SELECT zi, localitate, pus_de, updated_at FROM agent_zone
      WHERE org_id = ${orgId} AND agent_name = ${payload.agentName}
      ORDER BY pozitie ASC, localitate ASC
    `;
    // Cine a scris-o ultima dată — ca agentul să vadă dacă i-a schimbat-o
    // managerul peste noapte, nu s-o descopere pe drum.
    const ultima = toate.reduce<{ pusDe: string; cand: string } | null>((acc, r) => {
      const t = r.updated_at?.toISOString() ?? "";
      return !acc || t > acc.cand ? { pusDe: r.pus_de, cand: t } : acc;
    }, null);
    // Satele zilei, în ordinea în care au fost scrise (aia e ordinea
    // drumului, nu alfabetul).
    const localitati = toate.filter((z) => z.zi === zi).map((z) => z.localitate);
    if (localitati.length === 0) {
      return Response.json({ zi, localitati: [], stops: [], alteFirme: 0, toate, ultima });
    }

    // CLIENȚII MEI din satele de azi. Potrivim și pe adresă: registrul MF
    // pune firma pe satul de înregistrare, iar magazinul poate fi în satul
    // vecin — la fel ca pe hartă, ca să nu lipsească nimeni din rută.
    const rows = await db<OprireRow[]>`
      SELECT p.cui, p.denumire, COALESCE(p.adresa,'') AS adresa,
             COALESCE(p.localitate,'') AS localitate, COALESCE(p.judet,'') AS judet,
             COALESCE(p.telefon,'') AS telefon,
             g.lat, g.lng,
             (SELECT MAX(v.visited_at) FROM visits v WHERE v.cui = p.cui) AS ultima_vizita
      FROM prospects p
      LEFT JOIN geo_firme g ON g.cui = p.cui
      WHERE p.status = 'client'
        AND p.assigned_agent = ${payload.agentName}
        -- Ce a închis agentul pe teren („e zid, nu mai există") nu-l mai
        -- trimitem acolo mâine.
        AND p.activ IS DISTINCT FROM FALSE
        AND (p.localitate = ANY(${localitati})
             OR EXISTS (
               SELECT 1 FROM unnest(${localitati}::text[]) AS z(nume)
               WHERE translate(lower(p.adresa), 'ăâîșțşţ', 'aaistst')
                     LIKE '%' || translate(lower(z.nume), 'ăâîșțşţ', 'aaistst') || '%'
             ))
        AND NOT EXISTS (
          SELECT 1 FROM prospect_inchis pi WHERE pi.cui = p.cui AND pi.org_id = ${orgId}
        )
      -- Ordinea satelor e cea scrisă de manager (el știe drumul), iar în
      -- sat: cine n-a fost vizitat demult, primul.
      ORDER BY array_position(${localitati}::text[], p.localitate) NULLS LAST,
               (SELECT MAX(v.visited_at) FROM visits v WHERE v.cui = p.cui)
                 ASC NULLS FIRST,
               p.denumire ASC
      LIMIT 200
    `;

    // Câte firme NEVIZITATE mai sunt în satele de azi (prospecți liberi) —
    // ca agentul să știe că mai are unde bate, dacă termină ruta devreme.
    const [alte] = await db<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects p
      WHERE p.localitate = ANY(${localitati})
        AND p.activ IS DISTINCT FROM FALSE
        AND COALESCE(p.assigned_agent, '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM prospect_inchis pi WHERE pi.cui = p.cui AND pi.org_id = ${orgId}
        )
    `;

    return Response.json({
      zi,
      localitati,
      toate,
      ultima,
      alteFirme: parseInt(alte.n, 10),
      stops: rows.map((r) => ({
        cui: r.cui,
        denumire: r.denumire,
        adresa: r.adresa,
        localitate: r.localitate,
        judet: r.judet,
        telefon: r.telefon,
        lat: r.lat,
        lng: r.lng,
        ultimaVizita: r.ultima_vizita ? r.ultima_vizita.toISOString() : null,
      })),
    });
  } catch (e) {
    console.error("[zona zilei]", e);
    return Response.json({ error: "Eroare la zona de azi" }, { status: 500 });
  }
}
