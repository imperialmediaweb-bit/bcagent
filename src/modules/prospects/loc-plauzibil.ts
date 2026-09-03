import { getDB } from "@/lib/db";

/**
 * E LOCUL ĂSTA PLAUZIBIL PENTRU JUDEȚUL ĂSTA?
 *
 * Oamenii conduc după hărțile noastre. O bulă de sat apărută în Republica
 * Moldova (raportată de Gavrileț, 03.09) trimite un agent la 300 km de
 * clienții lui. Cum s-a ajuns acolo: toate „verificările România" din cod
 * erau un dreptunghi 43.3–48.4 / 20.1–30.1 — care cuprinde TOATĂ Republica
 * Moldova și bucăți din Ucraina. Un pin pus greșit acolo trecea de toate
 * gărzile, iar satul își lua centrul din media pinurilor, fără nicio
 * verificare. Un singur deget tremurat pe harta micșorată muta tot satul.
 *
 * Garda de aici nu e un dreptunghi și nu e o listă scrisă de mână: e
 * geometrie pe DATELE NOASTRE. Un județ românesc are cel mult ~150 km cap
 * la cap; niciun sat al lui nu poate fi la peste 120 km de mijlocul
 * celorlalte sate cunoscute din același județ. Mijlocul se ia ca MEDIANĂ
 * (câteva rânduri stricate n-o mișcă), și doar când județul are destule
 * sate cunoscute ca mediana să însemne ceva.
 *
 * Fără destule sate cunoscute (județ nou pe platformă), garda tace și
 * rămâne doar dreptunghiul de dinainte — mai bine puțin decât greșit.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

/** Peste atât de mijlocul județului = greșeală, nu locație. */
export const LIMITA_KM = 120;
/** Sub atâtea sate cunoscute, mediana județului nu-i de încredere. */
export const MINIM_SATE_CUNOSCUTE = 10;

/** Dreptunghiul grosier de dinainte — prima sită, nu ultima. */
export function inDreptunghiulRomaniei(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 43.3 && lat <= 48.4 && lng >= 20.1 && lng <= 30.1
  );
}

/** Distanța în kilometri între două puncte (haversine). */
export function kmIntre(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Mijlocul județului: mediana satelor lui cunoscute. `null` când nu sunt
 * destule ca să ne bazăm pe ea.
 */
export async function centrulJudetului(
  db: DB,
  judet: string,
): Promise<{ lat: number; lng: number; n: number } | null> {
  const j = String(judet ?? "").trim().toUpperCase();
  if (j === "") return null;
  const [r] = await db<[{ lat: number | null; lng: number | null; n: string }]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY lat)::float8 AS lat,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lng)::float8 AS lng,
           COUNT(*)::text AS n
    FROM geo_localitati
    WHERE judet = ${j} AND lat IS NOT NULL AND lng IS NOT NULL
  `;
  const n = parseInt(r?.n ?? "0", 10);
  if (!r || r.lat === null || r.lng === null || n < MINIM_SATE_CUNOSCUTE) return null;
  return { lat: r.lat, lng: r.lng, n };
}

export interface VerdictLoc {
  ok: boolean;
  /** Distanța până la mijlocul județului, când s-a putut calcula. */
  km: number | null;
  /** Ce-i spunem omului când refuzăm. Gol când e OK. */
  motiv: string;
}

/**
 * Verdictul pentru un punct dat unui județ. Refuză DOAR ce e sigur
 * greșit: în afara dreptunghiului, sau la peste LIMITA_KM de mijlocul
 * unui județ cu destule sate cunoscute.
 */
export async function locPlauzibil(
  db: DB,
  judet: string,
  lat: number,
  lng: number,
): Promise<VerdictLoc> {
  if (!inDreptunghiulRomaniei(lat, lng)) {
    return { ok: false, km: null, motiv: "Locul ăsta nu e în România." };
  }
  const centru = await centrulJudetului(db, judet);
  if (!centru) return { ok: true, km: null, motiv: "" };
  const km = kmIntre(centru, { lat, lng });
  if (km > LIMITA_KM) {
    return {
      ok: false,
      km,
      motiv: `Locul ăsta e la ${Math.round(km)} km de județul ${String(judet).toUpperCase()} — probabil un pin pus din greșeală. Apropie harta și pune-l pe magazin.`,
    };
  }
  return { ok: true, km, motiv: "" };
}

/**
 * REPARĂ CE E DEJA STRICAT într-un județ, fără să șteargă muncă bună:
 *   · satele cu centrul la peste LIMITA_KM de mijlocul județului își pierd
 *     centrul (se geocodează din nou, corect, la următoarea deschidere);
 *   · pinii de firmă din același județ aflați la peste LIMITA_KM își pierd
 *     coordonata și primesc sursa „gresit" — firma revine în centrul
 *     satului, iar „Pune locul" reapare ca omul s-o pună bine.
 * Se cheamă la fiecare deschidere a hărții pe județ: ieftin (rânduri
 * puține), idempotent (a doua oară nu mai are ce repara).
 */
export async function reparaJudetul(
  db: DB,
  judet: string,
): Promise<{ localitati: number; pini: number; centru: { lat: number; lng: number } | null }> {
  const j = String(judet ?? "").trim().toUpperCase();
  const centru = await centrulJudetului(db, j);
  if (!centru) return { localitati: 0, pini: 0, centru: null };
  // Distanță plană în km — la 120 km, sub 1% diferență față de haversine.
  const cosLat = Math.cos((centru.lat * Math.PI) / 180);
  const loc = await db`
    UPDATE geo_localitati
    SET lat = NULL, lng = NULL, failed = FALSE, updated_at = NOW()
    WHERE judet = ${j} AND lat IS NOT NULL AND lng IS NOT NULL
      AND sqrt(power((lat - ${centru.lat}) * 111.0, 2)
             + power((lng - ${centru.lng}) * 111.0 * ${cosLat}, 2)) > ${LIMITA_KM}
  `;
  const pini = await db`
    UPDATE geo_firme g
    SET lat = NULL, lng = NULL, failed = FALSE, aprox = FALSE,
        sursa = 'gresit', updated_at = NOW()
    FROM prospects p
    WHERE p.cui = g.cui AND p.judet = ${j}
      AND g.lat IS NOT NULL AND g.lng IS NOT NULL
      AND sqrt(power((g.lat - ${centru.lat}) * 111.0, 2)
             + power((g.lng - ${centru.lng}) * 111.0 * ${cosLat}, 2)) > ${LIMITA_KM}
  `;
  return { localitati: loc.count, pini: pini.count, centru: { lat: centru.lat, lng: centru.lng } };
}

/** Mijlocul fiecărui județ cu destule sate cunoscute. */
export async function centreleJudetelor(
  db: DB,
): Promise<Array<{ judet: string; lat: number; lng: number }>> {
  return db<Array<{ judet: string; lat: number; lng: number }>>`
    SELECT judet,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lat)::float8 AS lat,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lng)::float8 AS lng
    FROM geo_localitati
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND judet <> ''
    GROUP BY judet
    HAVING COUNT(*) >= ${MINIM_SATE_CUNOSCUTE}
  `;
}

/**
 * MAGAZINELE DE PE HARTĂ (OSM, hartă importată, puse de agent) ale unei
 * firme: cele care stau la peste LIMITA_KM de județul în care sunt scrise
 * ori se mută în județul CEL MAI APROPIAT (dacă e unul la sub LIMITA_KM —
 * magazin real, doar băgat la județul greșit de o măturare vecină), ori
 * primesc starea „in_afara" și nu se mai arată nimănui (Moldova). Nimic
 * nu se șterge; starea se poate întoarce de mână.
 */
export async function reparaMagazinele(
  db: DB,
  orgId: string,
): Promise<{ mutate: number; ascunse: number }> {
  const centre = await centreleJudetelor(db);
  if (centre.length === 0) return { mutate: 0, ascunse: 0 };
  const stiute = new Map(centre.map((c) => [c.judet, c]));
  const rele = await db<Array<{ id: string; judet: string; lat: number; lng: number }>>`
    SELECT id, COALESCE(judet,'') AS judet, lat, lng
    FROM magazin_harta
    WHERE org_id = ${orgId} AND stare NOT IN ('inchis', 'in_afara')
    LIMIT 20000
  `;
  let mutate = 0;
  let ascunse = 0;
  for (const m of rele) {
    const al = stiute.get(m.judet.toUpperCase());
    if (al && kmIntre(al, m) <= LIMITA_KM) continue; // e unde trebuie
    if (!al && m.judet !== "") continue; // județ fără date: nu judecăm
    let celMaiApropiat: { judet: string; km: number } | null = null;
    for (const c of centre) {
      const km = kmIntre(c, m);
      if (!celMaiApropiat || km < celMaiApropiat.km) celMaiApropiat = { judet: c.judet, km };
    }
    if (celMaiApropiat && celMaiApropiat.km <= LIMITA_KM) {
      await db`UPDATE magazin_harta SET judet = ${celMaiApropiat.judet} WHERE id = ${m.id}`;
      mutate++;
    } else {
      await db`UPDATE magazin_harta SET stare = 'in_afara' WHERE id = ${m.id}`;
      ascunse++;
    }
  }
  return { mutate, ascunse };
}
