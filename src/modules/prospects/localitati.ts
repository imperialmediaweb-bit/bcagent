/**
 * NUMELE SATULUI, AȘA CUM ÎL ȘTIE HARTA.
 *
 * Registrul Finanțelor scrie localitățile cum îi vine: „SAT PALTINIS COM.
 * PALTINIS", „PĂLTINIȘ CENTRU", „MUN. BOTOSANI", „VF. CAMPULUI". OpenStreetMap
 * le știe pe scurt: „Păltiniș", „Botoșani", „Vârful Câmpului". Când n-am
 * potrivit numele, satul rămânea FĂRĂ poziție și dispărea de pe hartă cu tot
 * cu clienții agentului din el:
 *
 *   „în Păltiniș Centru am 3 locații, nu găsesc nici măcar unu pe hartă"
 *   (Costin Vlad, 26.08)
 *
 * Aici construim mai multe variante ale aceluiași nume, de la cea mai
 * exactă la cea mai generală. Se încearcă pe rând; prima găsită câștigă.
 * Doar dacă TOATE dau greș spunem că satul chiar nu există pe hartă.
 */

/** Prefixele administrative din datele MF — nu ajută la căutare. */
const PREFIXE =
  /^(SAT\.?|COM\.?|COMUNA|MUN\.?|MUNICIPIUL|ORS\.?|OR\.?|ORAS|ORAȘ|LOC\.?|LOCALITATEA)\s+/i;

/**
 * Cuvinte care descriu o PARTE din sat, nu satul: „Păltiniș Centru" e tot
 * Păltiniș. Le tăiem doar ca variantă de rezervă, niciodată prima —
 * există și sate care chiar se numesc așa („Poiana Nouă").
 */
const PARTI_DE_SAT =
  /\s+(CENTRU|CENTRAL|DEAL|VALE|MARGINE|GARA|GARĂ|NOU|NOUA|NOUĂ|VECHI|VECHE|MIC|MICA|MICĂ|MARE|SUS|JOS|NORD|SUD|EST|VEST)$/i;

/** Prescurtările uzuale din registru. */
// ATENȚIE la punct: „\bVF\.?\b" NU prinde „VF." — după punct nu există
// graniță de cuvânt, așa că regula nu se aplica niciodată. Cerem explicit
// spațiu sau sfârșit de text după prescurtare.
const SCURTARI: Array<[RegExp, string]> = [
  [/\bVF\.?(?=\s|$)/gi, "Vârful"],
  [/\bDL\.?(?=\s|$)/gi, "Dealul"],
  [/\bV\.(?=\s)/gi, "Valea"],
  [/\bPOD\.(?=\s|$)/gi, "Podul"],
  [/\b(MĂN|MAN)\.?(?=\s|$)/gi, "Mănăstirea"],
  [/\bSTAT\.?(?=\s|$)/gi, "Stațiunea"],
];

/** Taie prefixele administrative și spațiile de prisos. */
export function curataLocalitate(loc: string): string {
  let s = String(loc ?? "").replace(/\s+/g, " ").trim();
  // „SAT PALTINIS COM. PALTINIS" → prefixul poate apărea de două ori.
  for (let i = 0; i < 3 && PREFIXE.test(s); i++) s = s.replace(PREFIXE, "");
  // „PALTINIS (COM. PALTINIS)" → paranteza e lămurire, nu nume.
  s = s.replace(/\s*\([^)]*\)\s*/g, " ");
  // „PALTINIS COM. PALTINIS" → partea de după „com." repetă comuna.
  s = s.replace(/\s+(COM\.?|COMUNA)\s+.*$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  // „SAT", „COM." singure nu sunt nume de sat, sunt resturi de formular.
  if (/^(SAT|COM|MUN|ORS|OR|ORAS|ORAȘ|LOC|COMUNA|MUNICIPIUL|LOCALITATEA)\.?$/i.test(s)) {
    return "";
  }
  return s;
}

/**
 * Variantele de căutat, de la cea mai fidelă la cea mai generală, fără
 * duplicate. Se încearcă în ordine — prima găsită pe hartă câștigă.
 */
export function variantePentruGeocodare(localitate: string): string[] {
  const baza = curataLocalitate(localitate);
  if (baza === "") return [];
  const out: string[] = [baza];

  const adauga = (v: string) => {
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length >= 2 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) {
      out.push(t);
    }
  };

  // Prescurtările desfăcute: „VF. CAMPULUI" → „Vârful Campului".
  let desfacut = baza;
  for (const [re, cu] of SCURTARI) desfacut = desfacut.replace(re, cu);
  adauga(desfacut);

  // Fără partea de sat: „Păltiniș Centru" → „Păltiniș". Asta a fost
  // problema din teren, de-aia e varianta imediat următoare. Ce rămâne
  // trebuie să fie tot un nume: din „Nou Mic" nu iese satul „Nou".
  const faraParte = baza.replace(PARTI_DE_SAT, "").trim();
  if (faraParte.length >= 4) adauga(faraParte);
  if (desfacut !== baza) {
    const d = desfacut.replace(PARTI_DE_SAT, "").trim();
    if (d.length >= 4) adauga(d);
  }

  // Ultima încercare: doar primul cuvânt („Cătămărești Deal" → „Cătămărești"),
  // dar numai dacă rămâne un nume adevărat, nu o silabă.
  const primul = faraParte.split(" ")[0] ?? "";
  if (primul.length >= 4) adauga(primul);

  return out;
}
