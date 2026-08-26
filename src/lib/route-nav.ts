/**
 * NAVIGAREA PE RUTĂ — inclusiv rutele care nu încap într-o zi.
 *
 * Google Maps acceptă maximum 10 puncte într-un link (9 opriri + destinația).
 * O rută de 25 de firme nu se poate porni dintr-un singur link — înainte se
 * tăiau restul în tăcere, iar agentul rămânea cu 15 clienți nevizitați fără
 * să știe. Acum ruta se împarte în ETAPE de câte 10, iar opririle deja
 * vizitate azi ies din calcul: a doua zi „Continuă ruta" pleacă exact de
 * unde a rămas.
 */

export const MAX_STOPS_PER_LEG = 10;

export interface NavStop {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  /** Județul firmei — „Dumbrava" există în vreo 10 județe; fără el,
   *  Google alege la întâmplare. */
  judet?: string;
  /** Poziția exactă, dacă o știm (pin geocodat sau GPS de la vizită). */
  lat?: number | null;
  lng?: number | null;
}

import { countyName, normalizeCounty } from "@/modules/prospects";

/**
 * ADRESA DIN REGISTRU, CURĂȚATĂ PENTRU GOOGLE.
 *
 * Finanțele scriu adresa în ordinea lor, cu prescurtări și cu județul în
 * față: „JUD. BOTOȘANI, ORȘ. DARABANI, STR. CUCULUI, NR.6". Trimisă așa,
 * Google nu leagă numărul de stradă, nu știe „ORȘ." și lasă pinul la
 * întâmplare, la zeci de kilometri:
 *
 *   „exemplu la clientul Andronache, dacă dau navigare mă lasă rece"
 *   (Costin Vlad, 26.08)
 *
 * Aici o rescriem cum o înțelege orice hartă: „Strada Cucului 6". Județul
 * și localitatea le adaugă `navAddress`, o singură dată, la sfârșit —
 * unde le așteaptă Google.
 */
/** „CUCULUI" → „Cucului". Cifrele și prescurtările scurte rămân cum sunt. */
function caLumea(text: string): string {
  return text
    .split(" ")
    .map((c) =>
      /\d/.test(c) || c.length <= 2
        ? c
        : c.charAt(0).toUpperCase() + c.slice(1).toLowerCase(),
    )
    .join(" ");
}

export function adresaCurataPentruNavigatie(adresa: string): string {
  const brut = String(adresa ?? "").replace(/\s+/g, " ").trim();
  if (brut === "") return "";

  let strada = "";
  let numar = "";
  const altele: string[] = [];

  for (const bucataBruta of brut.split(",")) {
    const b = bucataBruta.trim();
    if (b === "") continue;
    // Județul și localitatea se adaugă separat, în formă curată — aici
    // ar veni de două ori și încurcă.
    if (/^JUD\.?\s|^JUDETUL\s|^JUDEȚUL\s/i.test(b)) continue;
    if (/^(MUN|ORS|ORȘ|OR|COM|SAT|LOC)\.?\s/i.test(b)) continue;
    // Blocul, scara, etajul, apartamentul: Google nu le geocodează, dar
    // ÎL ÎNCURCĂ. Clădirea se găsește din stradă + număr.
    if (/^(BL|SC|ET|AP|CAM|BIROU|TR)\.?\s*\S*$/i.test(b)) continue;

    const peStrada = b.match(
      /^(STR|STRADA|B-?DUL|BD|BULEVARDUL|CALEA|ALEEA|ALEA|SOS|ȘOS|SOSEAUA|ȘOSEAUA|PIATA|PIAȚA|SPLAIUL|INTRAREA|DRUMUL)\.?\s+(.+)$/i,
    );
    if (peStrada) {
      const tip = /^(B-?DUL|BD|BULEVARDUL)$/i.test(peStrada[1])
        ? "Bulevardul"
        : /^(SOS|ȘOS|SOSEAUA|ȘOSEAUA)$/i.test(peStrada[1])
          ? "Șoseaua"
          : /^(PIATA|PIAȚA)$/i.test(peStrada[1])
            ? "Piața"
            : /^(CALEA)$/i.test(peStrada[1])
              ? "Calea"
              : /^(ALEEA|ALEA)$/i.test(peStrada[1])
                ? "Aleea"
                : /^(INTRAREA)$/i.test(peStrada[1])
                  ? "Intrarea"
                  : /^(DRUMUL)$/i.test(peStrada[1])
                    ? "Drumul"
                    : /^(SPLAIUL)$/i.test(peStrada[1])
                      ? "Splaiul"
                      : "Strada";
      // „STR. CUCULUI NR.6" — numărul poate sta chiar în bucata străzii.
      const cuNumar = peStrada[2].match(/^(.*?)[\s,]*NR\.?\s*(.+)$/i);
      if (cuNumar) {
        strada = `${tip} ${caLumea(cuNumar[1].trim())}`;
        numar = numar || cuNumar[2].trim().replace(/[.,;]+$/, "");
      } else {
        strada = `${tip} ${caLumea(peStrada[2].trim())}`;
      }
      continue;
    }

    const peNumar = b.match(/^(NR|NUMAR|NUMĂRUL)\.?\s*(.+)$/i);
    if (peNumar) {
      numar = numar || peNumar[2].trim().replace(/[.,;]+$/, "");
      continue;
    }
    altele.push(b);
  }

  if (strada !== "") {
    return numar !== "" ? `${strada} ${numar}` : strada;
  }
  // Adresă fără stradă recunoscută („Sat Coșna nr. 12"): păstrăm ce a mai
  // rămas, dar tot lipim numărul, ca să nu rămână rătăcit.
  const rest = caLumea(altele.join(", "));
  if (rest !== "" && numar !== "") return `${rest} ${numar}`;
  return rest || (numar !== "" ? `nr. ${numar}` : "");
}

/** Adresa completă, așa cum o înțelege Google Maps. Numele județului vine
 *  din lista COMPLETĂ (toate cele 42), nu dintr-o copie parțială — altfel
 *  agentul din Timiș/Constanța ar fi navigat greșit. Acceptăm și cod, și
 *  nume, și cod numeric (normalizeCounty le duce pe toate la cod). */
export function navAddress(
  f: { adresa: string; localitate: string; judet?: string; denumire?: string },
): string {
  const judetNume = f.judet ? countyName(normalizeCounty(f.judet)) : "";
  // Fără NUMĂR în adresă (satele din registru, des), Google ar duce în
  // centrul satului — atunci căutăm firma pe NUME + sat, ca să găsească
  // magazinul real.
  const curata = adresaCurataPentruNavigatie(f.adresa || "");
  const areNumar = /\d/.test(curata);
  return [
    !areNumar && f.denumire ? f.denumire : "",
    curata,
    f.localitate,
    judetNume,
    "Romania",
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Poate Google să ne ducă la oprirea asta? Are ori coordonate exacte, ori
 * măcar o adresă/sat. Fără nimic din astea, punctul ar trimite ruta în
 * mijlocul județului — mai bine îl sărim și SPUNEM câte am sărit.
 */
export function poateNaviga(s: NavStop): boolean {
  return (
    (typeof s.lat === "number" && typeof s.lng === "number") ||
    String(s.adresa ?? "").trim() !== "" ||
    String(s.localitate ?? "").trim() !== ""
  );
}

/**
 * OPRIRILE RĂMASE: cele la care nu s-a ajuns încă.
 *
 * O oprire e un MAGAZIN, nu o firmă. Ovi Tacomax e o singură firmă cu
 * șase magazine: dacă socoteala se ține pe CUI, o vizită la cel din
 * Cernești scotea din rută toate șase, iar agentul „termina ruta" cu
 * cinci magazine nevăzute. Ruta arăta bifat, drumul nu era făcut.
 *
 * Cheia unei opriri e deci magazinul, când îl știm, și firma când nu.
 * Vizitele făcute vin scrise la fel: „magazinId dacă există, altfel CUI".
 */
export function cheieOprire(s: { cui: string; magazinId?: string }): string {
  const m = String(s.magazinId ?? "").trim();
  return m !== "" ? `m:${m}` : `c:${String(s.cui).replace(/\D/g, "")}`;
}

export function remainingStops<T extends { cui: string; magazinId?: string }>(
  stops: T[],
  /** Ce s-a bifat azi: chei de oprire (vezi cheieOprire) sau CUI-uri
   *  goale, pentru linkurile vechi care încă trimit doar CUI. */
  vizitate: Iterable<string>,
): T[] {
  const done = new Set<string>();
  for (const v of vizitate) {
    const t = String(v);
    // Cheile noi vin gata scrise; ce vine simplu e un CUI, ca înainte.
    done.add(t.startsWith("m:") || t.startsWith("c:") ? t : `c:${t.replace(/\D/g, "")}`);
  }
  return stops.filter((s) => !done.has(cheieOprire(s)));
}

/** Ruta spartă în etape de maximum 10 opriri (limita Google Maps). */
export function routeLegs<T>(stops: T[], size = MAX_STOPS_PER_LEG): T[][] {
  const n = Math.max(1, Math.floor(size));
  const legs: T[][] = [];
  for (let i = 0; i < stops.length; i += n) legs.push(stops.slice(i, i + n));
  return legs;
}

/**
 * Link Google Maps pentru o etapă (maximum 10 opriri). Dacă primește mai
 * multe, ia primele 10 — restul se pornesc din etapa următoare, niciodată
 * pierdute în tăcere.
 */
export function legMapsUrl(stops: NavStop[], judet: string): string {
  // Pe RUTĂ (mai multe opriri) Google e mult mai pretențios decât la o
  // singură destinație: dacă un punct nu se rezolvă, refuză TOT traseul
  // („nu am găsit ruta"). De-aia aici folosim, în ordine:
  //   1. coordonatele exacte, când le avem (pin geocodat / GPS de la
  //      „Am fost") — nu pot fi greșit înțelese;
  //   2. adresa SIMPLĂ (stradă, sat, județ) — FĂRĂ numele firmei.
  // Numele firmei ajută la navigarea către UN client (caută magazinul),
  // dar ca punct de trecere pe rută strică rezolvarea.
  const addrs = stops
    .slice(0, MAX_STOPS_PER_LEG)
    // Fără coordonate ȘI fără adresă/sat n-avem ce trimite: oprirea aia
    // ar duce ruta în mijlocul județului. O sărim — restul rutei merge.
    .filter(poateNaviga)
    .map((s) =>
      typeof s.lat === "number" && typeof s.lng === "number"
        ? `${s.lat},${s.lng}`
        : navAddress({
            adresa: s.adresa,
            localitate: s.localitate,
            // Județul PROPRIU al opririi bate județul hărții.
            judet: s.judet || judet,
          }),
    );
  if (addrs.length === 0) return "";
  const destination = addrs[addrs.length - 1];
  const waypoints = addrs.slice(0, -1).join("|");
  return (
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
    "&travelmode=driving"
  );
}

export interface RoutePlan<T extends NavStop> {
  /** Câte opriri are ruta în total. */
  total: number;
  /** Câte au fost deja bifate („Am fost"). */
  done: number;
  /** Ce a mai rămas de făcut, în ordine. */
  remaining: T[];
  /** Etapele rămase (fiecare = un link de navigare). */
  legs: T[][];
  /** Linkurile de navigare, unul per etapă (poate conține și goale). */
  urls: string[];
  /** Etapele CARE CHIAR SE POT PORNI: linkul și opririle lui, împreună —
   *  ca eticheta „Etapa 2 (7 opriri)" să nu se mai desincronizeze. */
  etape: Array<{ url: string; stops: T[] }>;
  /** Câte opriri s-au sărit (n-au nici coordonate, nici adresă). */
  sarite: number;
  /** Ruta e terminată complet. */
  finished: boolean;
}

/** Tot ce trebuie ca să pornești sau să CONTINUI o rută. */
export function planRoute<T extends NavStop>(
  stops: T[],
  visitedCuis: Iterable<string>,
  judet: string,
): RoutePlan<T> {
  const remaining = remainingStops(stops, visitedCuis);
  // Opririle la care Google nu poate duce (nici coordonate, nici adresă)
  // ies ÎNAINTE de împărțirea în etape. Altfel o etapă întreagă putea
  // ieși goală, iar cele următoare se renumerotau — agentul apăsa
  // „Etapa 1" și pleca de fapt de la oprirea 11, fără să afle nimic.
  const navigabile = remaining.filter(poateNaviga);
  const legs = routeLegs(navigabile);
  const urls = legs.map((leg) => legMapsUrl(leg, judet));
  const etape = legs.map((leg, i) => ({ url: urls[i], stops: leg }));
  return {
    total: stops.length,
    done: stops.length - remaining.length,
    remaining,
    legs,
    urls,
    etape,
    sarite: remaining.length - navigabile.length,
    finished: stops.length > 0 && remaining.length === 0,
  };
}
