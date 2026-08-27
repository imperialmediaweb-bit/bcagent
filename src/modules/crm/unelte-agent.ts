import { getDB } from "@/lib/db";
import { alAgentiei, orgAgentNamesForAgent, orgIdForAgent } from "@/lib/org-scope";

/**
 * MÂINILE ASISTENTULUI — ce poate FACE, nu doar spune.
 *
 * „Vreau să pun o firmă în rută" zis cu vocea, în mașină, trebuie să fie
 * de ajuns. Până acum asistentul explica pe ce buton să apeși; de acum
 * apasă el. Butoanele rămân toate la locul lor — asta e în plus, nu în
 * loc.
 *
 * REGULA CARE NU SE ÎNCALCĂ: fiecare unealtă lucrează DOAR pe contul
 * agentului care vorbește, cu exact aceleași paze ca butoanele pe care
 * le înlocuiește. Asistentul nu are nicio putere în plus față de degetul
 * omului — doar mâna mai rapidă:
 *   · ruta = ruta LUI (routes.agent_id e al lui, nimic altceva);
 *   · zonele = zonele LUI, în firma LUI, prin ACEEAȘI citire care nu
 *     ghicește sate;
 *   · căutarea = ce ar vedea și el pe ecran (starea altora e mascată).
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

/** Cine e omul: identitatea verificată din token, nimic de la AI. */
export interface Identitate {
  agentId: string;
  agentName: string;
}

/** Textul, adus la litere simple (î și â sunt aceeași literă). */
function neted(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FirmaGasita {
  cui: string;
  denumire: string;
  localitate: string;
  judet: string;
  /** Statusul VIZIBIL lui — al altora e mascat, ca pe ecran. */
  status: string;
  aMea: boolean;
}

/**
 * CAUTĂ O FIRMĂ, cum ar căuta el pe ecran: fără diacritice, pe bucăți
 * de nume, și cu starea altora ascunsă. Registrul e comun — găsește
 * orice firmă activă, dar despre ale altora află doar că există.
 */
export async function cautaFirme(
  db: DB,
  cine: Identitate,
  text: string,
  cate = 6,
): Promise<FirmaGasita[]> {
  const cautat = neted(text);
  if (cautat.length < 2) return [];
  const mine = await orgAgentNamesForAgent(cine.agentId);
  const orgId = await orgIdForAgent(cine.agentId);
  const aiMei = mine.length ? mine : [cine.agentName];
  // Cuvintele din ce a zis omul — vorbit, nu tastat: „pune-mi magazinul
  // ovi tacomax din cernești" trebuie să găsească OVI-TACOMAX. Vorbele
  // de comandă și de umplutură NU sunt nume de firmă: fără lista asta,
  // „pune-mi magazinul X" căuta firme cu „pune" în nume, iar „magazinul
  // care nu există" se potrivea cu orice MAGAZIN — și băga în rută altă
  // firmă decât a cerut omul. Testul a prins-o.
  const UMPLUTURA = new Set([
    "pune", "punemi", "puneti", "baga", "bagami", "bagati", "adauga",
    "adaugami", "cauta", "cautami", "gaseste", "gasestemi", "vreau",
    "vrea", "ruta", "rutele", "lista", "harta", "client", "clientul",
    "clienti", "magazin", "magazinul", "magazine", "firma", "firmele",
    "societatea", "din", "care", "pentru", "deloc", "exista", "azi",
    "maine", "luni", "marti", "miercuri", "joi", "vineri", "sambata",
    "duminica", "srl", "pfa", "sc", "sa", "imi", "mie",
  ]);
  const cuvinte = cautat
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !UMPLUTURA.has(w))
    .slice(0, 5);
  if (cuvinte.length === 0) return [];
  const tipare = cuvinte.map((w) => `%${w}%`);
  const randuri = await db<
    Array<{
      cui: string;
      denumire: string;
      localitate: string;
      judet: string;
      status: string;
      a_mea: boolean;
    }>
  >`
    SELECT p.cui, p.denumire, COALESCE(p.localitate,'') AS localitate,
           COALESCE(p.judet,'') AS judet,
           -- Starea altora e mascată, exact ca pe ecran.
           CASE WHEN COALESCE(p.assigned_agent,'') = ''
                     OR ${alAgentiei(db, orgId, aiMei)}
                THEN p.status ELSE 'nou' END AS status,
           (COALESCE(p.assigned_agent,'') <> ''
            AND ${alAgentiei(db, orgId, aiMei)}) AS a_mea
    FROM prospects p
    WHERE p.activ IS DISTINCT FROM FALSE
      AND lower(translate(p.denumire,
            'ăâîșțĂÂÎȘȚşţŞŢ', 'aaastAAASTstST')) LIKE ALL(${tipare})
    ORDER BY (COALESCE(p.assigned_agent,'') <> ''
              AND ${alAgentiei(db, orgId, aiMei)}) DESC,
             length(p.denumire)
    LIMIT ${cate}
  `;
  // Nimic cu toate cuvintele? Mai încearcă FĂRĂ primul (poate-i tot o
  // vorbă de legătură) — dar niciodată nu coborâm la un singur cuvânt
  // generic: mai bine „n-am găsit" decât altă firmă decât a cerut omul.
  if (randuri.length === 0 && cuvinte.length > 2) {
    return cautaFirme(db, cine, cuvinte.slice(1).join(" "), cate);
  }
  return randuri.map((r) => ({
    cui: r.cui,
    denumire: r.denumire,
    localitate: r.localitate,
    judet: r.judet,
    status: r.status,
    aMea: r.a_mea,
  }));
}

export interface RezultatRuta {
  facut: boolean;
  /** Ce-i spunem omului — de citit ca atare. */
  mesaj: string;
  /** Când numele se potrivește la mai multe: să aleagă el. */
  variante?: FirmaGasita[];
}

const ZILE = ["luni", "marti", "miercuri", "joi", "vineri", "sambata", "duminica"];

/** Ziua cerută de om („azi", „mâine", „luni") → cheia rutei. */
export function ziaCeruta(text: string, acum = new Date()): string {
  const t = neted(text);
  // Duminică=0 în JS; rutele noastre n-au „azi" ca zi — azi E o zi.
  const aziIdx = (acum.getDay() + 6) % 7;
  if (t === "" || t === "azi") return ZILE[aziIdx];
  if (t === "maine" || t === "mâine") return ZILE[(aziIdx + 1) % 7];
  return ZILE.includes(t) ? t : ZILE[aziIdx];
}

/**
 * PUNE O FIRMĂ ÎN RUTA LUI pe o zi — exact ce face „+ Pune în rută",
 * doar că prin vorbă. Ruta e a LUI (routes.agent_id); coordonatele vin
 * din pinul exact dacă există, ca la buton.
 */
export async function puneInRuta(
  db: DB,
  cine: Identitate,
  numeFirma: string,
  zi: string,
): Promise<RezultatRuta> {
  const gasite = await cautaFirme(db, cine, numeFirma, 5);
  if (gasite.length === 0) {
    return {
      facut: false,
      mesaj: `N-am găsit nicio firmă activă care să semene cu „${numeFirma.slice(0, 80)}". Încearcă 3-4 litere din numele din acte.`,
    };
  }
  // Mai multe potriviri și niciuna clar a lui → întrebăm, nu ghicim.
  const aleLui = gasite.filter((g) => g.aMea);
  const aleasa =
    gasite.length === 1 ? gasite[0] : aleLui.length === 1 ? aleLui[0] : null;
  if (!aleasa) {
    return {
      facut: false,
      mesaj: "Am găsit mai multe — spune-mi care din ele:",
      variante: gasite,
    };
  }

  const [f] = await db<
    Array<{
      cui: string;
      denumire: string;
      adresa: string;
      localitate: string;
      judet: string;
      telefon: string;
      lat: number | null;
      lng: number | null;
    }>
  >`
    SELECT p.cui, p.denumire, COALESCE(p.adresa,'') AS adresa,
           COALESCE(p.localitate,'') AS localitate,
           COALESCE(p.judet,'') AS judet, COALESCE(p.telefon,'') AS telefon,
           -- Doar pinul EXACT dă coordonate rutei — cel aproximativ e
           -- centrul satului, pe adresă Google se descurcă mai bine.
           CASE WHEN g.aprox IS DISTINCT FROM TRUE THEN g.lat END AS lat,
           CASE WHEN g.aprox IS DISTINCT FROM TRUE THEN g.lng END AS lng
    FROM prospects p
    LEFT JOIN geo_firme g ON g.cui = p.cui
    WHERE p.cui = ${aleasa.cui}
  `;
  if (!f) {
    return { facut: false, mesaj: "Firma a dispărut între timp — mai zi o dată." };
  }

  const ziKey = ziaCeruta(zi);
  const oprire = {
    cui: f.cui,
    denumire: f.denumire,
    adresa: f.adresa,
    localitate: f.localitate,
    judet: f.judet,
    telefon: f.telefon,
    lat: f.lat,
    lng: f.lng,
  };
  // Ruta LUI pe ziua aia: o completăm sau o facem. Aceeași formă ca la
  // butonul de salvare — nimic în plus.
  const [ruta] = await db<Array<{ id: string; stops: unknown }>>`
    SELECT id, stops FROM routes
    WHERE agent_id = ${cine.agentId} AND day = ${ziKey}
    ORDER BY updated_at DESC LIMIT 1
  `;
  const opriri: Array<{ cui?: string; magazinId?: string }> = Array.isArray(
    ruta?.stops,
  )
    ? (ruta!.stops as Array<{ cui?: string; magazinId?: string }>)
    : [];
  if (opriri.some((s) => s.cui === f.cui && !s.magazinId)) {
    return {
      facut: true,
      mesaj: `„${f.denumire}" era deja în ruta de ${ziKey} — n-am pus-o de două ori.`,
    };
  }
  if (opriri.length >= 40) {
    return {
      facut: false,
      mesaj: `Ruta de ${ziKey} are deja 40 de opriri — mai mult nu duce Google Maps. Scoate ceva întâi.`,
    };
  }
  const noi = [...opriri, oprire];
  if (ruta) {
    await db`
      UPDATE routes SET stops = ${db.json(noi as never)}, updated_at = NOW()
      WHERE id = ${ruta.id} AND agent_id = ${cine.agentId}
    `;
  } else {
    await db`
      INSERT INTO routes (id, agent_id, name, day, stops)
      VALUES (${"rt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16)},
              ${cine.agentId}, ${"Ruta de " + ziKey}, ${ziKey},
              ${db.json(noi as never)})
    `;
  }
  return {
    facut: true,
    mesaj:
      `Gata: „${f.denumire}"${f.localitate ? ` (${f.localitate})` : ""} e în ruta ta de ${ziKey}` +
      ` — oprirea ${noi.length}.` +
      (f.lat === null
        ? " N-are încă loc exact pe hartă: când ajungi, apasă «Sunt aici» și rămâne fixată."
        : ""),
  };
}

export interface RezultatZone {
  facut: boolean;
  mesaj: string;
}

/**
 * PUNE ZONELE LUI PE ZILE din text — ACEEAȘI citire ca ecranul: satele
 * se recunosc din listele lui + ce a învățat firma; ce nu se recunoaște
 * NU se ghicește, i se spune pe nume.
 */
export async function puneZonele(
  db: DB,
  cine: Identitate,
  text: string,
): Promise<RezultatZone> {
  const orgId = await orgIdForAgent(cine.agentId);
  if (orgId === "") {
    return {
      facut: false,
      mesaj: "Linkul tău nu e legat de o firmă — zonele se pun din panoul firmei.",
    };
  }
  const {
    aliasuriInvatate,
    citesteZone,
    localitatiCunoscute,
    salveazaZone,
  } = await import("@/modules/zone/aplica");
  const mine = await orgAgentNamesForAgent(cine.agentId);
  const numeAg = mine.length ? mine : [cine.agentName];
  const cunoscute = await localitatiCunoscute(db, numeAg, orgId);
  const aliasuri = await aliasuriInvatate(db, orgId);
  const { gasite, negasite } = citesteZone(String(text).slice(0, 20_000), cunoscute, aliasuri);
  if (gasite.length === 0) {
    return {
      facut: false,
      mesaj:
        "N-am recunoscut niciun sat din ce mi-ai zis. Zi-mi în forma: luni - Dorohoi, Broscăuți; marți - Hudești…",
    };
  }
  await salveazaZone(db, orgId, cine.agentName, gasite, cine.agentName);
  const zile = [...new Set(gasite.map((g) => g.zi))].length;
  let mesaj = `Am salvat zonele tale: ${gasite.length} sate pe ${zile} zile.`;
  if (negasite.length > 0) {
    mesaj +=
      ` N-am recunoscut: ${negasite.map((n) => `„${n.scris}"`).join(", ")} — ` +
      `pe astea NU le-am pus (nu ghicesc sate). ` +
      `Zi-mi satele din ele pe nume, sau alege-le din „Zonele mele pe zile".`;
  }
  return { facut: true, mesaj };
}
