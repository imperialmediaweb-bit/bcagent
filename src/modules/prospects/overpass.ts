/**
 * MAGAZINELE DIN OPENSTREETMAP.
 *
 * Registrul Finanțelor are SEDIUL SOCIAL — la un PFA, casa omului. Harta
 * lui Bogdan are magazinele LUI. Ce lipsește sunt magazinele la care n-a
 * ajuns nimeni: alimentara din satul unde firma n-are încă niciun client.
 *
 * OpenStreetMap le are, puse de oameni care au trecut pe-acolo: nume,
 * poziție exactă, uneori și program sau telefon. Gratis, legal, fără cont.
 * Se interoghează prin Overpass — un serviciu public care răspunde la
 * întrebări de tipul „toate magazinele alimentare din județul Botoșani".
 *
 * Aici construim întrebarea și citim răspunsul. Potrivirea cu firmele din
 * registru și salvarea se fac cu ACELEAȘI unelte ca la harta lui Bogdan —
 * n-are rost două mecanisme pentru același lucru.
 */

import { normalizeCounty } from "./caen";

/** Ce ne interesează pe teren: unde se vinde marfa noastră. */
const MAGAZINE = [
  "convenience", "supermarket", "general", "kiosk", "greengrocer",
  "butcher", "bakery", "alcohol", "tobacco", "beverages", "deli",
  "department_store", "wholesale",
];
const LOCALURI = ["bar", "pub", "cafe", "restaurant", "fast_food", "biergarten"];

/** Serviciile publice Overpass — dacă unul e ocupat, se încearcă altul. */
export const SERVERE_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

/**
 * Întrebarea pentru un județ. `ISO3166-2` e codul standard al județului
 * („RO-BT"), pe care OpenStreetMap îl are pus pe granițele administrative.
 *
 * `out center` e important: magazinele desenate ca CLĂDIRI (nu ca punct)
 * n-au coordonate proprii — cu „center" primim mijlocul clădirii.
 */
export function intrebareJudet(codJudet: string, timeoutSec = 180): string {
  // În baza noastră județul poate fi scris în fel și chip („Suceava",
  // „JUD. SUCEAVA", „33", „J33"). ISO3166-2 vrea codul auto: RO-SV.
  const jud = normalizeCounty(String(codJudet ?? ""))
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
  const shop = MAGAZINE.join("|");
  const amenity = LOCALURI.join("|");
  // Două căi spre granița județului: eticheta ISO (calea curată) și `ref`
  // (pusă de cartografii români). Dacă una lipsește, cealaltă salvează
  // cererea. Ce cade în afara României e aruncat oricum la citire.
  return `[out:json][timeout:${timeoutSec}];
(
  area["ISO3166-2"="RO-${jud}"][admin_level=4];
  area["ref"="${jud}"][admin_level=4]["boundary"="administrative"];
)->.j;
(
  node["shop"~"^(${shop})$"](area.j);
  way["shop"~"^(${shop})$"](area.j);
  node["amenity"~"^(${amenity})$"](area.j);
  way["amenity"~"^(${amenity})$"](area.j);
);
out center tags;`;
}

export interface MagazinOSM {
  /** Identificatorul din OpenStreetMap: „node/123", „way/456". */
  osmId: string;
  nume: string;
  lat: number;
  lng: number;
  /** Ce fel de loc e: „alimentara", „bar", „supermarket"… */
  fel: string;
  /** Strada și numărul, dacă le-a pus cineva. */
  adresa: string;
  localitate: string;
  telefon: string;
}

interface ElementOSM {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Traducerea etichetelor OSM în vorbe pe care le înțelege agentul. */
const FEL: Record<string, string> = {
  convenience: "alimentară",
  supermarket: "supermarket",
  general: "magazin mixt",
  kiosk: "chioșc",
  greengrocer: "legume-fructe",
  butcher: "măcelărie",
  bakery: "brutărie",
  alcohol: "băuturi",
  tobacco: "tutungerie",
  beverages: "băuturi",
  deli: "delicatese",
  department_store: "magazin universal",
  wholesale: "cash & carry",
  bar: "bar",
  pub: "pub",
  cafe: "cafenea",
  restaurant: "restaurant",
  fast_food: "fast-food",
  biergarten: "grădină de vară",
};

/** Numărul de telefon, adus la forma din România. */
function telefonCurat(t: string): string {
  const cifre = String(t ?? "").replace(/[^\d+]/g, "");
  if (cifre === "") return "";
  if (cifre.startsWith("+40")) return `0${cifre.slice(3)}`;
  if (cifre.startsWith("0040")) return `0${cifre.slice(4)}`;
  return cifre.startsWith("0") ? cifre : "";
}

/**
 * Răspunsul Overpass → lista de magazine. Ce n-are nume sau poziție se
 * sare: un punct fără nume n-ajută pe nimeni pe hartă.
 */
export function citesteOverpass(json: unknown): MagazinOSM[] {
  const out: MagazinOSM[] = [];
  const el = (json as { elements?: ElementOSM[] } | null)?.elements;
  if (!Array.isArray(el)) return out;

  for (const e of el) {
    const t = e.tags ?? {};
    const nume = String(t.name ?? "").trim();
    if (nume === "") continue;

    const lat = Number(e.lat ?? e.center?.lat);
    const lng = Number(e.lon ?? e.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // În afara României e o greșeală de date — nu punem magazine aiurea.
    if (lat < 43.3 || lat > 48.4 || lng < 20.1 || lng > 30.1) continue;

    const cheieFel = String(t.shop ?? t.amenity ?? "").trim();
    const strada = String(t["addr:street"] ?? "").trim();
    const numar = String(t["addr:housenumber"] ?? "").trim();
    out.push({
      osmId: `${e.type ?? "node"}/${e.id ?? 0}`,
      nume: nume.slice(0, 200),
      lat,
      lng,
      fel: FEL[cheieFel] ?? cheieFel.slice(0, 40),
      adresa: [strada, numar].filter(Boolean).join(" ").slice(0, 200),
      localitate: String(t["addr:city"] ?? t["addr:village"] ?? "").trim().slice(0, 120),
      telefon: telefonCurat(String(t.phone ?? t["contact:phone"] ?? "")),
    });
  }

  // Același magazin poate fi și punct, și clădire. Îl păstrăm o dată.
  const vazute = new Set<string>();
  return out.filter((m) => {
    const k = `${m.nume.toLowerCase()}@${m.lat.toFixed(4)},${m.lng.toFixed(4)}`;
    if (vazute.has(k)) return false;
    vazute.add(k);
    return true;
  });
}
