import { verifyFieldToken } from "@/lib/agent-guard";
import { alAgentiei } from "@/lib/org-scope";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * MAGAZINELE DIN HARTA VECHE, pentru agentul de teren.
 *
 * Harta adusă de firmă are magazine care nu s-au potrivit cu nicio firmă
 * din registru — dar sunt magazine ADEVĂRATE, cu locul pus de mână de
 * cineva care a fost acolo. Pe harta lui Costin sunt 1756 de puncte de
 * prospectare gata verificate.
 *
 * Sunt ale firmei care le-a adus. Un agent vede doar magazinele firmei
 * lui — n-au CUI, deci nu sunt în registrul comun.
 */

interface Rand {
  id: string;
  nume: string;
  adresa: string;
  lat: number;
  lng: number;
  strat: string;
  /** Ce a găsit agentul acolo: "" (nevăzut încă) sau "exista". */
  stare: string;
  /** CUI-ul, când harta îl are scris în pin. */
  cui: string;
  /** Denumirea din acte, când diferă de numele de pe firmă. */
  nume_legal: string;
  /** Firma căreia îi aparține, dacă CUI-ul din pin e cunoscut. */
  firma: string;
  status_firma: string;
  agentul_firmei: string;
}

/**
 * AGENTUL CONFIRMĂ CE A VĂZUT CU OCHII LUI.
 *
 * Harta veche poate fi de acum trei ani. Agentul care trece pe-acolo
 * spune ce e: „există" (și poate muta pinul, dacă nu-i chiar acolo) sau
 * „nu mai există". De-atunci nimeni nu mai pierde drumul degeaba.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`magharta-scrie:${clientIP(req)}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });

  let body: {
    token?: string;
    id?: string;
    stare?: string;
    lat?: number;
    lng?: number;
    /**
     * ADAUGĂ UN MAGAZIN DE PE TEREN.
     *
     * „Doar că la Ovi Tacomax sunt 6 puncte… mai sunt 2 pe Lunca: Lunca
     * magazin și Lunca bar." (Bogdan, 26.08) — în fișier erau patru.
     * Fișierul n-o să fie complet niciodată; agentul e acolo. Apasă pe
     * hartă, scrie numele, gata în zece secunde.
     */
    adauga?: {
      nume?: string;
      /** CUI-ul firmei, dacă e al doilea magazin al unui client de-al lor. */
      cui?: string;
      lat?: number;
      lng?: number;
      telefon?: string;
      /** Satul și județul, când firma trebuie adusă în registru. */
      localitate?: string;
      judet?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = await verifyFieldToken(String(body.token ?? ""), secret);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const db0 = getDB();
  if (!db0) return Response.json({ enabled: false }, { status: 503 });

  // ── ADAUGĂ UN MAGAZIN, DE PE TEREN ──
  if (body.adauga) {
    await ensureSchema();
    const { orgIdForAgent } = await import("@/lib/org-scope");
    const orgId = await orgIdForAgent(payload.agentId);
    if (!orgId) {
      return Response.json({ error: "Linkul tău nu e legat de o firmă" }, { status: 403 });
    }
    const nume = String(body.adauga.nume ?? "").trim().slice(0, 200);
    const lat = Number(body.adauga.lat);
    const lng = Number(body.adauga.lng);
    if (nume.length < 2) {
      return Response.json({ error: "Scrie numele magazinului" }, { status: 400 });
    }
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < 43.3 || lat > 48.4 || lng < 20.1 || lng > 30.1
    ) {
      return Response.json(
        { error: "Locul ăsta nu e în România — apasă pe hartă unde e magazinul" },
        { status: 400 },
      );
    }
    // CUI-ul e al firmei doar dacă e o firmă pe care agenția o poate
    // atinge. Altfel îl lăsăm gol: magazinul rămâne al lui, fără firmă.
    const cuiCerut = String(body.adauga.cui ?? "").replace(/\D/g, "").slice(0, 12);
    let cui = "";
    if (cuiCerut !== "") {
      const { orgAgentNamesForAgent } = await import("@/lib/org-scope");
      const aiMei = await orgAgentNamesForAgent(payload.agentId);
      const [f] = await db0<Array<{ cui: string }>>`
        SELECT cui FROM prospects
        WHERE cui = ${cuiCerut}
          AND (COALESCE(assigned_agent, '') = ''
               OR ${alAgentiei(db0, orgId, aiMei.length ? aiMei : [payload.agentName])})
      `;
      if (f) {
        cui = f.cui;
      } else {
        // FIRMA NU E ÎN REGISTRU. Copia noastră de registru nu e completă
        // (1634 din cele 2450 de pinuri ale hărții aveau CUI-uri
        // necunoscute nouă), iar agentul stă în fața magazinului cu CUI-ul
        // în mână: îl credem și aducem firma la noi, marcată cu cine a
        // adus-o. Dacă CUI-ul e al altei agenții, aduFirmeLipsa n-o
        // alocă — magazinul rămâne fără firmă, ca înainte.
        const [ocupata] = await db0<Array<{ cui: string }>>`
          SELECT cui FROM prospects WHERE cui = ${cuiCerut}
        `;
        if (!ocupata) {
          const { aduFirmeLipsa } = await import("@/modules/prospects");
          const rez = await aduFirmeLipsa(
            db0,
            orgId,
            [{
              cui: cuiCerut,
              denumire: nume,
              localitate: String(body.adauga.localitate ?? ""),
              judet: String(body.adauga.judet ?? ""),
            }],
            payload.agentName,
          );
          if (rez.create > 0 && rez.alocate > 0) cui = cuiCerut;
        }
      }
    }
    const { cheieMagazin } = await import("@/modules/prospects/potrivire");
    const id = `${orgId}:teren:${cheieMagazin(nume, lat, lng)}`.slice(0, 220);
    await db0`
      INSERT INTO magazin_harta
        (id, org_id, nume, cui, lat, lng, strat, stare, confirmat_de,
         confirmat_la, adaugat_de, telefon)
      VALUES (${id}, ${orgId}, ${nume}, ${cui}, ${lat}, ${lng},
              'pus de agent', 'exista', ${payload.agentName}, NOW(),
              ${payload.agentName},
              ${String(body.adauga.telefon ?? "").replace(/[^\d+ ]/g, "").slice(0, 30)})
      ON CONFLICT (id) DO UPDATE
        SET nume = EXCLUDED.nume, cui = EXCLUDED.cui,
            stare = 'exista', confirmat_de = EXCLUDED.confirmat_de,
            confirmat_la = NOW()
    `;
    return Response.json({ ok: true, adaugat: true, id, nume, cui });
  }

  const id = String(body.id ?? "").slice(0, 220);
  const stare = body.stare === "exista" || body.stare === "inchis" ? body.stare : "";
  if (id === "" || stare === "") {
    return Response.json({ error: "Spune ce magazin și ce ai găsit acolo" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const { orgIdForAgent } = await import("@/lib/org-scope");
    const orgId = await orgIdForAgent(payload.agentId);
    if (!orgId) {
      return Response.json({ error: "Linkul tău nu e legat de o firmă" }, { status: 403 });
    }
    // Poziția din telefon, dacă agentul e chiar acolo și fixul e bun:
    // atunci pinul se mută pe locul adevărat.
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const potMuta =
      stare === "exista" &&
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= 43.3 && lat <= 48.4 && lng >= 20.1 && lng <= 30.1;

    // Două scrieri limpezi în loc de un CASE încâlcit: ori mută și pinul
    // (agentul e chiar acolo, cu fix bun), ori doar notează ce a găsit.
    const r = potMuta
      ? await db`
          UPDATE magazin_harta
          SET stare = ${stare}, confirmat_de = ${payload.agentName},
              confirmat_la = NOW(), lat = ${lat}, lng = ${lng}
          WHERE id = ${id} AND org_id = ${orgId}
        `
      : await db`
          UPDATE magazin_harta
          SET stare = ${stare}, confirmat_de = ${payload.agentName},
              confirmat_la = NOW()
          WHERE id = ${id} AND org_id = ${orgId}
        `;
    if (r.count === 0) {
      return Response.json({ error: "Magazinul nu e al firmei tale" }, { status: 403 });
    }
    return Response.json({ ok: true, stare });
  } catch (err) {
    console.error("[magazine harta POST]", err);
    return Response.json({ error: "Eroare la salvare" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`magharta:${clientIP(req)}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });
  const url = new URL(req.url);
  const payload = await verifyFieldToken(url.searchParams.get("token") ?? "", secret);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const { orgIdForAgent } = await import("@/lib/org-scope");
    const orgId = await orgIdForAgent(payload.agentId);
    // Link vechi, fără firmă în spate: n-are ce magazine să vadă.
    if (!orgId) return Response.json({ magazine: [] });

    // Doar ce se vede pe ecran: harta poate avea mii de puncte, iar
    // telefonul agentului n-are de ce să le descarce pe toate.
    // ATENȚIE: `Number(null)` e 0, nu „lipsă". Fără verificarea asta,
    // lipsa chenarului devenea un chenar „între 0 și 0" — adică undeva în
    // Golful Guineei — și agentul nu vedea NICIUN magazin.
    const nr = (text: string | null) => {
      if (text === null || text.trim() === "") return null;
      const v = Number(text);
      return Number.isFinite(v) ? v : null;
    };
    const s = nr(url.searchParams.get("s"));
    const n = nr(url.searchParams.get("n"));
    const v = nr(url.searchParams.get("v"));
    const e = nr(url.searchParams.get("e"));
    const areChenar = s !== null && n !== null && v !== null && e !== null;

    // UN CLIENT = UN MAGAZIN.
    // Dacă magazinul are CUI-ul unei firme care e CLIENTUL agenției, nu e
    // un punct de prospectat: e al doilea (al șaselea) magazin al unui
    // client de-al lor. Ovi Tacomax are șase; agentul vedea unul.
    // Le deosebim aici, la citire, ca să nu ținem aceeași informație în
    // două locuri și să nu se poată bate între ele.
    const randuri = await db<Rand[]>`
      SELECT m.id, m.nume, m.adresa, m.lat, m.lng, m.strat, m.stare,
             COALESCE(m.cui, '') AS cui, COALESCE(m.nume_legal, '') AS nume_legal,
             COALESCE(p.denumire, '') AS firma,
             COALESCE(p.status, '') AS status_firma,
             COALESCE(p.assigned_agent, '') AS agentul_firmei
      FROM magazin_harta m
      LEFT JOIN prospects p
        ON p.cui = m.cui AND COALESCE(m.cui, '') <> ''
      WHERE m.org_id = ${orgId}
        -- Ce a găsit agentul închis nu-l mai trimitem pe nimeni acolo.
        AND m.stare <> 'inchis'
        AND (${!areChenar}
             OR (m.lat BETWEEN ${s ?? -90} AND ${n ?? 90}
                 AND m.lng BETWEEN ${v ?? -180} AND ${e ?? 180}))
      ORDER BY m.nume
      LIMIT 1500
    `;
    return Response.json({
      magazine: randuri.map((r) => ({
        id: r.id,
        nume: r.nume,
        adresa: r.adresa,
        lat: r.lat,
        lng: r.lng,
        strat: r.strat,
        // Cine e, când harta o spune. Agentul intră la un om, nu la un
        // punct mov: știe firma, CUI-ul și adresa cu număr.
        cui: r.cui,
        numeLegal: r.nume_legal,
        // AL CUI E. Când firma lui e client, ăsta nu-i un punct de
        // prospectat — e o oprire de-a lui, la un client pe care îl are
        // deja. Agentul trebuie să intre acolo, nu să se întrebe ce e.
        firma: r.firma,
        eAlClientului: r.status_firma === "client",
        confirmat: r.stare === "exista",
      })),
    });
  } catch (err) {
    console.error("[magazine harta]", err);
    return Response.json({ error: "Eroare la magazinele din hartă" }, { status: 500 });
  }
}
