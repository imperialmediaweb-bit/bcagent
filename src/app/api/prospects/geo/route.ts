import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { countyName } from "@/modules/prospects";
import { variantePentruGeocodare } from "@/modules/prospects/localitati";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Datele hărții: prospecții agregați per localitate într-un județ, cu
 * coordonate din cache-ul geo_localitati. Localitățile negeocodate încă se
 * geocodează câteva per cerere (Nominatim permite 1 req/s) — UI-ul recheamă
 * endpointul până când `pendingGeocode` ajunge la 0.
 */

const GEOCODE_PER_REQUEST = 8;
const NOMINATIM_DELAY_MS = 1100;
const USER_AGENT = "bcagent-saas/1.0 (platforma distributie; contact via repo)";

/** O singură întrebare pusă hărții. */
async function intreabaHarta(
  nume: string,
  county: string,
): Promise<{ lat: number; lng: number } | null> {
  const q = `${nume}, ${county}, Romania`;
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
 * Întoarce coordonate, `null` = harta chiar nu știe satul (am încercat
 * TOATE variantele numelui), sau ARUNCĂ la erori de rețea / rate-limit
 * (nu se marchează nimic — se reîncearcă la următoarea cerere).
 *
 * Registrul scrie „PĂLTINIȘ CENTRU", harta știe „Păltiniș" — cu o singură
 * întrebare, satul rămânea fără poziție și dispărea de pe hartă cu tot cu
 * clienții agentului. Acum întrebăm pe rând, de la exact la general.
 */
async function geocode(
  localitate: string,
  judet: string,
): Promise<{ lat: number; lng: number } | null> {
  const county = countyName(judet) || judet;
  const variante = variantePentruGeocodare(localitate);
  for (let i = 0; i < variante.length; i++) {
    const gasit = await intreabaHarta(variante[i], county);
    if (gasit) return gasit;
    // Nominatim cere o secundă între întrebări; ultima n-are după ce aștepta.
    if (i < variante.length - 1) {
      await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
    }
  }
  return null;
}

interface LocalityRow {
  localitate: string;
  count: string;
  cu_telefon: string;
  /** Câți CLIENȚI ai apelantului sunt în localitate (bula devine verde). */
  clienti: string;
  lat: number | null;
  lng: number | null;
  failed: boolean | null;
}

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false }, { status: 503 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`prospects-geo:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }

  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const payload = token ? await verifyFieldToken(token, tokenSecret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }

  const judet = (url.searchParams.get("judet") ?? "").toUpperCase().slice(0, 2);
  if (!judet) {
    return Response.json({ error: "judet lipsește" }, { status: 400 });
  }
  // `caenIn` opțional: harta poate arăta doar un domeniu (ex: alimentare).
  const caenIn = (url.searchParams.get("caenIn") ?? "")
    .split(",")
    .map((s) => s.replace(/\D/g, "").slice(0, 4))
    .filter((s) => s.length >= 2)
    .slice(0, 40);
  const caenPatterns = caenIn.map((c) => `${c}%`);
  const doGeocode = url.searchParams.get("geocode") !== "0";

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();

    // LOCALITĂȚILE CU CLIENȚII APELANTULUI intră MEREU pe hartă (peste
    // filtrul de domeniu/activ) și primele la geocodare — altfel satul
    // clientului fără nicio firmă pe domeniul ales n-avea bulă deloc și
    // agentul întreba „unde-s restul de clienți?".
    const { orgIdForAgent } = await import("@/lib/org-scope");
    const orgIdMeu = (await orgIdForAgent(payload.agentId)) || "-";
    const rows = await db<LocalityRow[]>`
      SELECT p.localitate,
             COUNT(*)::text AS count,
             COUNT(*) FILTER (WHERE p.telefon IS NOT NULL AND p.telefon <> '')::text AS cu_telefon,
             COUNT(*) FILTER (WHERE p.status = 'client' AND p.assigned_agent = ${payload.agentName})::text AS clienti,
             g.lat, g.lng, g.failed
      FROM prospects p
      LEFT JOIN geo_localitati g
        ON g.judet = ${judet} AND g.localitate = p.localitate
      WHERE p.judet = ${judet}
        AND p.localitate <> ''
        -- Ce a închis firma noastră pe teren nu mai umflă bulele.
        AND NOT EXISTS (
          SELECT 1 FROM prospect_inchis pi
          WHERE pi.cui = p.cui AND pi.org_id = ${orgIdMeu}
        )
        AND (((p.activ IS DISTINCT FROM FALSE)
              AND (${caenPatterns.length === 0} OR p.caen LIKE ANY(${caenPatterns})))
             OR (p.status = 'client' AND p.assigned_agent = ${payload.agentName}))
      GROUP BY p.localitate, g.lat, g.lng, g.failed
      ORDER BY COUNT(*) FILTER (WHERE p.status = 'client' AND p.assigned_agent = ${payload.agentName}) DESC,
               COUNT(*) DESC
      LIMIT 300
    `;

    // PLASA DE SIGURANȚĂ, ÎNAINTE DE A ÎNTREBA HARTA: dacă în satul ăsta
    // agenții au pus deja pini pe magazine, satul are o poziție bună —
    // chiar mai bună decât ce ne-ar da geocodarea. O folosim și pentru
    // satele pe care harta nu le știe deloc („Păltiniș Centru"), ca să nu
    // mai dispară de pe ecran cu tot cu clienții din ele.
    const faraPozitie = rows.filter((r) => r.lat === null).map((r) => r.localitate);
    if (faraPozitie.length > 0) {
      const dinPini = await db<
        Array<{ localitate: string; lat: number; lng: number }>
      >`
        SELECT p.localitate, AVG(g.lat)::float8 AS lat, AVG(g.lng)::float8 AS lng
        FROM prospects p
        JOIN geo_firme g ON g.cui = p.cui
        WHERE p.judet = ${judet}
          AND p.localitate = ANY(${faraPozitie})
          AND g.aprox = FALSE
        GROUP BY p.localitate
      `;
      for (const d of dinPini) {
        const r = rows.find((x) => x.localitate === d.localitate);
        if (!r) continue;
        r.lat = d.lat;
        r.lng = d.lng;
        r.failed = false;
        await db`
          INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
          VALUES (${judet}, ${d.localitate}, ${d.lat}, ${d.lng}, FALSE)
          ON CONFLICT (judet, localitate) DO UPDATE SET
            lat = EXCLUDED.lat, lng = EXCLUDED.lng,
            failed = FALSE, updated_at = NOW()
        `;
      }
    }

    // Geocodăm câteva localități lipsă (cele mai mari întâi).
    const missing = rows.filter((r) => r.lat === null && r.failed !== true);
    let geocoded = 0;
    let networkErrors = 0;
    if (doGeocode && missing.length > 0) {
      for (const m of missing.slice(0, GEOCODE_PER_REQUEST)) {
        try {
          const coords = await geocode(m.localitate, judet);
          await db`
            INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES (${judet}, ${m.localitate}, ${coords?.lat ?? null},
                    ${coords?.lng ?? null}, ${coords === null})
            ON CONFLICT (judet, localitate) DO UPDATE SET
              lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              failed = EXCLUDED.failed, updated_at = NOW()
          `;
          if (coords) {
            m.lat = coords.lat;
            m.lng = coords.lng;
            geocoded++;
          } else {
            m.failed = true;
          }
          networkErrors = 0;
        } catch (e) {
          // Eroare de rețea / rate-limit: NU marcăm failed (retry data
          // viitoare); după 2 consecutive renunțăm la restul cererii.
          console.warn("[geo] geocodare eșuată", m.localitate, e);
          if (++networkErrors >= 2) break;
        }
        await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
      }
    }

    const pendingGeocode = rows.filter(
      (r) => r.lat === null && r.failed !== true,
    ).length;
    // Satele pe care harta nu le știe DELOC: până acum dispăreau în tăcere,
    // cu tot cu clienții agentului. Le spunem pe nume, ca agentul să le
    // poată deschide din listă și să pună el locul magazinelor.
    const faraLoc = rows
      .filter((r) => r.lat === null && r.failed === true)
      .map((r) => ({
        localitate: r.localitate,
        count: parseInt(r.count, 10),
        clienti: parseInt(r.clienti, 10),
      }));

    return Response.json({
      judet,
      localities: rows.map((r) => ({
        localitate: r.localitate,
        count: parseInt(r.count, 10),
        cuTelefon: parseInt(r.cu_telefon, 10),
        clienti: parseInt(r.clienti, 10),
        lat: r.lat,
        lng: r.lng,
      })),
      pendingGeocode,
      geocoded,
      faraLoc,
    });
  } catch (e) {
    console.error("[prospects geo]", e);
    return Response.json({ error: "Eroare la datele hărții" }, { status: 500 });
  }
}
