/**
 * DICTAREA CARE NU SE BÂLBÂIE.
 *
 * Din teren, 26.08 — notele lui Robert arătau așa:
 *   „rău rău platnic"
 *   „nu nu vrea nu vrea țigări"
 *   „lucrează lucrează cu lucrează cu producătorii"
 *
 * Nu agentul se bâlbâia. Chrome pe Android retrimite ACEEAȘI vorbă, tot
 * mai lungă, pe INDEXURI DIFERITE, fiecare marcată „finală":
 *
 *   results[0] final: „nu"
 *   results[1] final: „nu vrea"          ← aceeași vorbă, revizuită
 *   results[2] final: „nu vrea țigări"   ← tot ea, gata
 *
 * Paza de dinainte ținea minte pe index. Cum indexul era altul de fiecare
 * dată, le adăuga pe toate trei. De-aici păsăreasca.
 *
 * Aici curățăm: o revizuire mai lungă O ÎNLOCUIEȘTE pe cea scurtă, iar
 * din text se trimite mai departe DOAR partea nouă. Cuvintele deja
 * scrise în notă nu se mai scriu a doua oară — niciodată.
 *
 * Se compară fără diacritice și fără semne: telefonul scrie „țigări"
 * într-o clipă și „tigari" în alta, dar e aceeași vorbă.
 */

/** Forma de comparat a unui cuvânt: fără diacritice, fără semne, mic. */
export function felCuvant(cuvant: string): string {
  return cuvant
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Textul în cuvinte, fără goluri. */
export function cuvinte(text: string): string[] {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter((c) => c !== "");
}

/** `sir` începe cu `inceput`? (comparat pe cuvinte, fără diacritice) */
function incepeCu(sir: string[], inceput: string[]): boolean {
  if (inceput.length === 0 || sir.length < inceput.length) return false;
  for (let i = 0; i < inceput.length; i++) {
    if (felCuvant(sir[i]) !== felCuvant(inceput[i])) return false;
  }
  return true;
}

/**
 * Bucățile FINALE ale unei sesiuni de dictare, curățate de revizuiri.
 *
 * Primește transcrierile în ordinea în care le-a dat browserul; întoarce
 * textul întreg, o singură dată fiecare vorbă.
 */
export function textulSesiunii(bucatiFinale: string[]): string[] {
  const iesire: string[][] = [];
  for (const bucata of bucatiFinale) {
    const c = cuvinte(bucata);
    if (c.length === 0) continue;
    const ultima = iesire[iesire.length - 1];
    if (ultima) {
      // „nu" → „nu vrea": e aceeași vorbă, dusă mai departe. O înlocuim.
      if (incepeCu(c, ultima)) {
        iesire[iesire.length - 1] = c;
        continue;
      }
      // „nu vrea" după „nu vrea țigări": veche, o avem deja.
      if (incepeCu(ultima, c)) continue;
    }
    iesire.push(c);
  }
  return iesire.flat();
}

/**
 * CE E NOU față de ce s-a scris deja în notă.
 *
 * `trimis` = cuvintele trimise deja în sesiunea asta. Se numără, nu se
 * ghicește: tot ce e peste ele e nou, restul s-a scris o dată și nu se
 * mai scrie. Așa nota nu se poate bâlbâi nici dacă browserul se răzgândește.
 */
export function ceEnou(
  trimis: string[],
  intreg: string[],
): { nou: string; trimisAcum: string[] } {
  if (intreg.length <= trimis.length) return { nou: "", trimisAcum: trimis };
  return {
    nou: intreg.slice(trimis.length).join(" "),
    trimisAcum: intreg,
  };
}
