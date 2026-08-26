/**
 * HARTA LUI BOGDAN, ADUSĂ ÎN APLICAȚIE.
 *
 * „Aveam linkul ăsta de la firma veche… cu locații mai actualizate. Poate
 * îl poți integra." (Bogdan, 26.08) — o hartă Google My Maps cu magazinele
 * puse punct cu punct, de mână, de-a lungul anilor. Alea sunt cele mai
 * bune coordonate care există: nu le-a ghicit niciun algoritm, le-a pus
 * omul care a fost acolo.
 *
 * Google My Maps dă harta ca fișier KML:
 *   https://www.google.com/maps/d/kml?mid=<ID>&forcekml=1
 *
 * Aici îl citim. Fără bibliotecă de XML: KML-ul de la My Maps e simplu și
 * previzibil, iar un parser scris de mână nu aduce încă o dependență în
 * aplicație pentru o singură funcție.
 *
 * ATENȚIE la ordinea coordonatelor: KML scrie „longitudine,latitudine",
 * adică INVERS față de cum le scrie toată lumea. Confuzia asta ar muta
 * toate magazinele din Botoșani în Africa.
 */

export interface PunctKML {
  /** Numele pus de om pe pin: „Magazin Andronache", „Bar la Vale". */
  nume: string;
  /** Descrierea, dacă a scris ceva (uneori conține adresa sau telefonul). */
  descriere: string;
  /** Dosarul/straturile din My Maps — de obicei agentul sau zona. */
  strat: string;
  lat: number;
  lng: number;
}

/** Scoate `<![CDATA[ ... ]]>` și dezescapează entitățile XML uzuale. */
function textCurat(brut: string): string {
  return brut
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // Descrierile My Maps conțin adesea HTML (tabele, linkuri) — pe noi
    // ne interesează doar textul.
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // `&amp;` la SFÂRȘIT: altfel „&amp;lt;" ar deveni „<" în doi pași.
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prima etichetă `<nume>` dintr-o bucată, sau text gol. */
function eticheta(bucata: string, nume: string): string {
  const m = bucata.match(new RegExp(`<${nume}[^>]*>([\\s\\S]*?)</${nume}>`, "i"));
  return m ? textCurat(m[1]) : "";
}

/**
 * KML → lista de puncte. Ce nu are coordonate valide se sare în tăcere
 * (My Maps pune și linii, poligoane, straturi goale).
 */
export function citesteKML(kml: string): PunctKML[] {
  const text = String(kml ?? "");
  const out: PunctKML[] = [];
  if (text.trim() === "") return out;

  // Straturile („Folder"/„Document"): rețin numele ca să știm din care
  // parte a hărții vine punctul (de obicei agentul sau zona).
  const straturi: Array<{ start: number; nume: string }> = [];
  const reFolder = /<Folder[^>]*>\s*(?:<[^>]+>\s*)*?<name[^>]*>([\s\S]*?)<\/name>/gi;
  let mf: RegExpExecArray | null;
  while ((mf = reFolder.exec(text)) !== null) {
    straturi.push({ start: mf.index, nume: textCurat(mf[1]) });
  }
  const stratPentru = (poz: number): string => {
    let ales = "";
    for (const s of straturi) {
      if (s.start < poz) ales = s.nume;
      else break;
    }
    return ales;
  };

  const rePlacemark = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let m: RegExpExecArray | null;
  while ((m = rePlacemark.exec(text)) !== null) {
    const bucata = m[1];
    // Doar punctele ne interesează: liniile și poligoanele sunt zone
    // desenate, nu magazine.
    const coordBloc = bucata.match(
      /<Point[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i,
    );
    if (!coordBloc) continue;
    const bucati = coordBloc[1].trim().split(/[\s,]+/);
    if (bucati.length < 2) continue;
    // KML: LONGITUDINE întâi, apoi latitudinea. Invers față de obicei.
    const lng = parseFloat(bucati[0]);
    const lat = parseFloat(bucati[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Un punct în afara României e o greșeală (sau coordonate inversate) —
    // nu-l luăm, ca să nu mutăm magazine peste mări și țări.
    if (lat < 43.3 || lat > 48.4 || lng < 20.1 || lng > 30.1) continue;

    const nume = eticheta(bucata, "name");
    if (nume === "") continue;
    out.push({
      nume,
      descriere: eticheta(bucata, "description"),
      strat: stratPentru(m.index),
      lat,
      lng,
    });
  }
  return out;
}

/**
 * Exportul din My Maps poate fi doar un INDICATOR, nu datele:
 *
 *   <NetworkLink><Link><href>https://…/kml?mid=…</href></Link></NetworkLink>
 *
 * Se întâmplă când omul exportă harta întreagă, nu un strat. Fișierul are
 * zero magazine în el — trebuie urmat linkul dinăuntru. Îl scoatem de
 * aici, ca serverul să-l poată cere mai departe.
 */
export function linkDinNetworkLink(kml: string): string {
  const text = String(kml ?? "");
  if (!/<NetworkLink/i.test(text)) return "";
  const m = text.match(/<href>([\s\S]*?)<\/href>/i);
  if (!m) return "";
  const href = textCurat(m[1]);
  // Doar către Google: n-avem de ce urma un link oarecare dintr-un fișier
  // pe care ni-l dă cineva.
  return /^https:\/\/(www\.)?google\.com\//i.test(href) ? href : "";
}

/** Din linkul dat de om scoatem identificatorul hărții (`mid`). */
export function midDinLink(link: string): string {
  const t = String(link ?? "").trim();
  if (t === "") return "";
  const m = t.match(/[?&]mid=([A-Za-z0-9_-]{8,})/);
  if (m) return m[1];
  // Poate a lipit direct identificatorul.
  if (/^[A-Za-z0-9_-]{12,}$/.test(t)) return t;
  return "";
}

/** Adresa de descărcare a hărții, din identificator. */
export function linkKML(mid: string): string {
  return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`;
}
