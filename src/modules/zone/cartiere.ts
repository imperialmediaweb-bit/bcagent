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

/**
 * PRESCURTĂRILE, cum le scriu agenții pe telefon.
 *
 * „Cn-lung" e Câmpulung Moldovenesc. Nimeni nu scrie numele întreg de 22
 * de litere într-o listă de 40 de sate, pe telefon, în mașină.
 */
export const PRESCURTARI: Record<string, string> = {
  // Scrise chiar de agent, în textul lui din 26.08: „Cn-lung".
  "cn lung": "CAMPULUNG MOLDOVENESC",
  "cn-lung": "CAMPULUNG MOLDOVENESC",
  "c lung": "CAMPULUNG MOLDOVENESC",
  "c-lung": "CAMPULUNG MOLDOVENESC",
  // Aceeași localitate, scrisă cu î sau cu â — ambele forme oficiale.
  cimpulung: "CAMPULUNG MOLDOVENESC",
  campulung: "CAMPULUNG MOLDOVENESC",
  // Am avut aici și „rad" → Rădăuți, „s-va" → Suceava și altele
  // asemenea. Le-am scos: nu le scrisese nimeni, le pusesem eu, iar
  // „rad" poate fi orice. Se adaugă doar când un om chiar le scrie.
};

/**
 * ȚINUTURILE — DE CE NU LE DESFACEM SINGURI.
 *
 * Un agent a scris „Țara Dornelor (toate locațiile)". Am fost tentat să
 * pun satele din jurul Vetrei Dornei, pe o rază de 30 km.
 *
 * NU se face. Raza aia e o cifră scoasă de mine din burtă, nu un fapt.
 * Un sat băgat greșit în ziua unui agent înseamnă un drum făcut degeaba,
 * un client nevizitat, o cifră falsă în raport. Ce inventăm noi aici
 * ajunge în deciziile unor oameni.
 *
 * Ce facem în loc: îi spunem omului, limpede, că e o zonă și nu un sat, și
 * îl rugăm să scrie satele — el le știe, noi nu. Cinci secunde de scris
 * bat orice ghicit.
 *
 * Ce ținem aici sunt doar FAPTE, verificabile: Burdujeni chiar e cartier
 * în Suceava, „Cn-lung" chiar e Câmpulung Moldovenesc. Nu presupuneri
 * despre unde lucrează cineva.
 */
export const PARE_ZONA = [
  "tara dornelor",
  "dornele",
  "zona dornei",
  "tara de sus",
  "bucovina",
  "zona",
];

/** E o zonă/un ținut, nu un sat? Atunci nu ghicim — întrebăm. */
export function pareZona(scrisNeted: string): boolean {
  const n = scrisNeted.trim();
  return PARE_ZONA.some((z) => n === z || n.startsWith(`${z} `));
}

/** cartier (fără diacritice, litere mici) → orașul din registru */
const CARTIERE: Record<string, string> = {
  // ── SUCEAVA ── (scrise de agent în textul lui: Obcini, George Enescu,
  // Ițcani, Burdujeni. Restul sunt cartiere binecunoscute ale orașului.)
  burdujeni: "SUCEAVA",
  "burdujeni sat": "SUCEAVA",
  itcani: "SUCEAVA",
  obcini: "SUCEAVA",
  zamca: "SUCEAVA",
  areni: "SUCEAVA",
  "george enescu": "SUCEAVA",
  // „Centru" singur nu spune despre ce oraș e vorba. Îl lăsăm aici, dar
  // se folosește DOAR când în aceeași zi omul a scris și alte cartiere
  // ale aceluiași oraș — atunci se știe. Altfel rămâne nelămurit, și
  // întrebăm, nu ghicim.
  centru: "SUCEAVA",
  // ── BOTOȘANI ──
  // Aici aveam patru cartiere pe care le pusesem din memorie, iar unul
  // („Bucovina") se bate cu numele ținutului. Nimeni nu le-a scris. Afară.
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
  // Aveam aici și „Grădina Publică" → Rădăuți și „Vatra" → Câmpulung.
  // Le-am scos: „Vatra" e nume de SAT în mai multe locuri, iar dacă îl
  // luam drept cartier trimiteam agentul în alt oraș.
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

/**
 * Numele astea nu se leagă singure de un oraș: sunt prea generale. Se
 * lipesc de orașul din aceeași zi, dacă omul a scris și altele limpezi.
 */
export const NUME_GENERALE = new Set(["centru", "gara", "piata", "centrul"]);

/** Toate cartierele știute — pentru teste și pentru ghid. */
export function cartiereStiute(): Array<{ cartier: string; oras: string }> {
  return Object.entries(CARTIERE).map(([cartier, oras]) => ({ cartier, oras }));
}
