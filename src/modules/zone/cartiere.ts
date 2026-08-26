/**
 * CARTIERELE, cum le zic agenții.
 *
 * Răzvan a scris „Burdujeni" în zona lui de luni și aplicația i-a răspuns
 * că n-o găsește — ba i-a mai și propus „Bursuceni" și „Budeni", două sate
 * la zeci de kilometri. Burdujeni EXISTĂ, dar la Finanțe firmele de acolo
 * sunt înregistrate în „SUCEAVA": e cartier, nu comună. În listele noastre
 * nu apare niciodată, oricâte firme ar fi acolo.
 *
 * Agentul nu vorbește în unități administrativ-teritoriale. El zice
 * „luni fac Burdujeniul, marți Ițcanii" — și are dreptate, așa e drumul.
 * Aici traducem vorba lui în orașul din registru, ca zona să nu se piardă.
 *
 * Ce se pierde: cartierul e o BUCATĂ din oraș, iar noi punem tot orașul în
 * ziua aia. Adică luni îi apar și clienți din alt capăt al Sucevei. E mai
 * bine decât să-i lipsească jumătate din zi — dar i-o spunem pe ecran, ca
 * să știe de ce vede mai mult decât a scris.
 *
 * Lista e ținută SCURT și pe județele unde lucrează oamenii ăștia. Una
 * pentru toată țara ar fi o listă de întreținut degeaba, plină de nume
 * care se bat cu satele adevărate.
 */

/** cartier (fără diacritice, litere mici) → orașul din registru */
const CARTIERE: Record<string, string> = {
  // ── SUCEAVA ──
  burdujeni: "SUCEAVA",
  "burdujeni sat": "SUCEAVA",
  itcani: "SUCEAVA",
  obcini: "SUCEAVA",
  zamca: "SUCEAVA",
  areni: "SUCEAVA",
  "george enescu": "SUCEAVA",
  "cuza voda": "SUCEAVA",
  // ── BOTOȘANI ──
  "imparat traian": "BOTOSANI",
  primaverii: "BOTOSANI",
  bucovina: "BOTOSANI",
  "parcul tineretului": "BOTOSANI",
  // ── IAȘI ──
  copou: "IASI",
  pacurari: "IASI",
  tatarasi: "IASI",
  nicolina: "IASI",
  dacia: "IASI",
  "alexandru cel bun": "IASI",
  bucium: "IASI",
  galata: "IASI",
  "podu ros": "IASI",
  canta: "IASI",
  "mircea cel batran": "IASI",
  "tudor vladimirescu": "IASI",
  // ── RĂDĂUȚI / FĂLTICENI / DOROHOI (orașele mari din zona lor) ──
  "gradina publica": "RADAUTI",
  vatra: "CAMPULUNG MOLDOVENESC",
};

/**
 * E un cartier? Întoarce orașul din registru, sau `null`.
 *
 * `neted` e aceeași curățare ca la restul potrivirii (fără diacritice,
 * litere mici, un singur spațiu) — o primim de afară ca să nu ținem două
 * feluri de a curăța același text.
 */
export function orasulCartierului(
  scrisNeted: string,
  neted: (s: string) => string,
): string | null {
  const cheie = scrisNeted.trim();
  if (cheie === "") return null;
  for (const [cartier, oras] of Object.entries(CARTIERE)) {
    if (neted(cartier) === cheie) return oras;
  }
  return null;
}

/** Toate cartierele știute — pentru teste și pentru ghid. */
export function cartiereStiute(): Array<{ cartier: string; oras: string }> {
  return Object.entries(CARTIERE).map(([cartier, oras]) => ({ cartier, oras }));
}
