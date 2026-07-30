import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { countyName } from "@/modules/prospects";

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

/** Prefixele administrative din datele MF strică geocodarea — le tăiem. */
function cleanLocality(loc: string): string {
  return loc
    .replace(/^(MUN\.|MUNICIPIUL|ORS\.|OR\.|ORAS |ORAȘ |COM\.|COMUNA |SAT )\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Întoarce coordonate, `null` = Nominatim a răspuns dar nu a găsit locul
 * (se marchează failed, nu mai încercăm), sau ARUNCĂ la erori de rețea /
 * rate-limit (nu se marchează nimic — se reîncearcă la următoarea cerere).
 */
async function geocode(
  localitate: string,
  judet: string,
): Promise<{ lat: number; lng: number } | null> {
  const county = countyName(judet) || judet;
  const q = `${cleanLocality(localitate)}, ${county}, Romania`;
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

interface LocalityRow {
  localitate: string;
  count: string;
  cu_telefon: string;
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
  if (!token || !(await verifyToken(token, tokenSecret))) {
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

    const rows = await db<LocalityRow[]>`
      SELECT p.localitate,
             COUNT(*)::text AS count,
             COUNT(*) FILTER (WHERE p.telefon IS NOT NULL AND p.telefon <> '')::text AS cu_telefon,
             g.lat, g.lng, g.failed
      FROM prospects p
      LEFT JOIN geo_localitati g
        ON g.judet = ${judet} AND g.localitate = p.localitate
      WHERE p.judet = ${judet}
        AND p.localitate <> ''
        AND (p.activ IS DISTINCT FROM FALSE)
        AND (${caenPatterns.length === 0} OR p.caen LIKE ANY(${caenPatterns}))
      GROUP BY p.localitate, g.lat, g.lng, g.failed
      ORDER BY COUNT(*) DESC
      LIMIT 300
    `;

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

    return Response.json({
      judet,
      localities: rows.map((r) => ({
        localitate: r.localitate,
        count: parseInt(r.count, 10),
        cuTelefon: parseInt(r.cu_telefon, 10),
        lat: r.lat,
        lng: r.lng,
      })),
      pendingGeocode,
      geocoded,
    });
  } catch (e) {
    console.error("[prospects geo]", e);
    return Response.json({ error: "Eroare la datele hărții" }, { status: 500 });
  }
}
