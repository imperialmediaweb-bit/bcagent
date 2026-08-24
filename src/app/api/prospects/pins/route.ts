import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { countyName } from "@/modules/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CLIENȚII CA PUNCTE PE HARTĂ.
 *
 * Până acum harta arăta bule pe localitate — agentul nu putea vedea dacă
 * doi clienți sunt vecini, deci risca să umble aiurea pe drum (timp și
 * combustibil). Aici întoarcem FIECARE client cu coordonatele lui, ca să
 * apară ca punct pe hartă și să-și poată face ruta pe vecinătate.
 *
 * Coordonatele se caută o singură dată și se rețin (geo_firme). Dacă
 * adresa exactă nu se găsește, punem firma în centrul localității, marcată
 * `aprox` — agentul vede că e orientativ, nu-l trimitem greșit ca sigur.
 */

const USER_AGENT = "provendi/1.0 (platforma distributie; contact via repo)";
/** Câte adrese noi geocodăm per cerere (Nominatim cere 1 pe secundă). */
const GEOCODE_PER_REQUEST = 6;

function curataAdresa(adresa: string, localitate: string, judet: string): string {
  const jud = countyName(judet) || judet;
  const a = (adresa || "")
    .replace(/^(JUD\.?|JUDETUL|JUDEȚUL)\s+[A-ZĂÂÎȘȚ\s-]+,?\s*/i, "")
    .replace(/\b(MUN\.|MUNICIPIUL|ORS\.|OR\.|ORAS|ORAȘ|COM\.|COMUNA|SAT)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const loc = (localitate || "")
    .replace(/^(MUN\.|MUNICIPIUL|ORS\.|OR\.|ORAS |ORAȘ |COM\.|COMUNA |SAT )\s*/i, "")
    .trim();
  // „strada + număr, localitate, județ, România" — forma pe care Nominatim
  // o înțelege cel mai bine pentru satele din România.
  return [a, loc, jud, "Romania"].filter(Boolean).join(", ");
}

async function geocodeAdresa(
  q: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ro&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "ro" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Împrăștiere mică și STABILĂ în jurul centrului localității, derivată din
 * CUI: fără ea, toate firmele fără adresă exactă s-ar suprapune într-un
 * singur punct și n-ai putea apăsa pe ele. Același CUI → același loc mereu.
 */
function imprastie(cui: string, lat: number, lng: number) {
  // Hash pe 32 de biți, împărțit în două jumătăți de 16 biți independente:
  // cu doar 10.000 de poziții, două CUI-uri din aceeași localitate se
  // suprapuneau cam la 8% din cazuri — și pinul de dedesubt nu mai putea
  // fi apăsat. Cu 65.536 × 65.536 poziții, practic imposibil.
  let h = 2166136261;
  for (let i = 0; i < cui.length; i++) {
    h ^= cui.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  const sus = h >>> 16;
  const jos = h & 0xffff;
  const dLat = (sus / 65535 - 0.5) * 0.012; // ~±650 m
  const dLng = (jos / 65535 - 0.5) * 0.018;
  return { lat: lat + dLat, lng: lng + dLng };
}

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false }, { status: 503 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`pins:${ip}`, { max: 40, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const payload = token ? await verifyFieldToken(token, secret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const judet = (url.searchParams.get("judet") ?? "").toUpperCase().slice(0, 2);
  if (!judet) return Response.json({ error: "judet lipsește" }, { status: 400 });
  const localitate = (url.searchParams.get("localitate") ?? "").slice(0, 120);
  const doGeocode = url.searchParams.get("geocode") === "1";

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();

    // Doar CLIENȚII agentului (ai lui, nu ai colegilor și nu ai altei firme).
    const rows = await db<
      Array<{
        cui: string;
        denumire: string;
        adresa: string;
        localitate: string;
        telefon: string;
        lat: number | null;
        lng: number | null;
        aprox: boolean | null;
        failed: boolean | null;
        loc_lat: number | null;
        loc_lng: number | null;
      }>
    >`
      SELECT p.cui, p.denumire, COALESCE(p.adresa,'') AS adresa,
             COALESCE(p.localitate,'') AS localitate,
             COALESCE(p.telefon,'') AS telefon,
             g.lat, g.lng, g.aprox, g.failed,
             gl.lat AS loc_lat, gl.lng AS loc_lng
      FROM prospects p
      LEFT JOIN geo_firme g ON g.cui = p.cui
      LEFT JOIN geo_localitati gl
        ON gl.judet = p.judet AND gl.localitate = p.localitate
      WHERE p.judet = ${judet}
        AND p.status = 'client'
        AND p.assigned_agent = ${payload.agentName}
        AND (${localitate} = '' OR p.localitate = ${localitate})
      ORDER BY p.denumire ASC
      LIMIT 400
    `;

    // Geocodăm câteva adrese noi per cerere; restul vin la următoarea.
    let geocodate = 0;
    if (doGeocode) {
      const deFacut = rows.filter((r) => r.lat === null && r.failed !== true);
      const lot = deFacut.slice(0, GEOCODE_PER_REQUEST);
      for (let i = 0; i < lot.length; i++) {
        const r = lot[i];
        let amIntrebatNominatim = false;
        try {
          const q = curataAdresa(r.adresa, r.localitate, judet);
          amIntrebatNominatim = !!r.adresa;
          const c = r.adresa ? await geocodeAdresa(q) : null;
          if (c) {
            await db`
              INSERT INTO geo_firme (cui, lat, lng, aprox, failed)
              VALUES (${r.cui}, ${c.lat}, ${c.lng}, FALSE, FALSE)
              ON CONFLICT (cui) DO UPDATE SET
                lat = EXCLUDED.lat, lng = EXCLUDED.lng,
                aprox = FALSE, failed = FALSE, updated_at = NOW()
            `;
            r.lat = c.lat;
            r.lng = c.lng;
            r.aprox = false;
            geocodate++;
          } else {
            // Adresa nu s-a găsit — marcăm, ca să nu tot încercăm.
            await db`
              INSERT INTO geo_firme (cui, lat, lng, aprox, failed)
              VALUES (${r.cui}, NULL, NULL, FALSE, TRUE)
              ON CONFLICT (cui) DO UPDATE SET failed = TRUE, updated_at = NOW()
            `;
            r.failed = true;
          }
        } catch {
          // rețea/limită — nu marcăm nimic, reîncercăm data viitoare
          break;
        }
        // Nominatim cere 1 cerere/secundă — dar pauza are sens DOAR după o
        // cerere reală, și nu după ultimul element (ar fi secunde moarte).
        if (amIntrebatNominatim && i < lot.length - 1) {
          await new Promise((res) => setTimeout(res, 1100));
        }
      }
    }

    // Rezerva: firmele fără adresă găsită stau în centrul localității,
    // împrăștiate puțin ca să fie apăsabile — marcate „aprox".
    const pins = rows
      .map((r) => {
        if (r.lat !== null && r.lng !== null) {
          return {
            cui: r.cui,
            denumire: r.denumire,
            adresa: r.adresa,
            localitate: r.localitate,
            telefon: r.telefon,
            lat: r.lat,
            lng: r.lng,
            aprox: !!r.aprox,
          };
        }
        if (r.loc_lat !== null && r.loc_lng !== null) {
          const c = imprastie(r.cui, r.loc_lat, r.loc_lng);
          return {
            cui: r.cui,
            denumire: r.denumire,
            adresa: r.adresa,
            localitate: r.localitate,
            telefon: r.telefon,
            lat: c.lat,
            lng: c.lng,
            aprox: true,
          };
        }
        return null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return Response.json({
      pins,
      total: rows.length,
      exacte: pins.filter((p) => !p.aprox).length,
      aproximative: pins.filter((p) => p.aprox).length,
      deGeocodat: rows.filter((r) => r.lat === null && r.failed !== true).length,
      geocodate,
    });
  } catch (e) {
    console.error("[prospects pins]", e);
    return Response.json({ error: "Eroare la punctele de pe hartă" }, { status: 500 });
  }
}
