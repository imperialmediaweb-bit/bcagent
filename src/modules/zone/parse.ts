/**
 * ZONELE AGENȚILOR — citite din text scris de om.
 *
 * Bogdan trimite zonele pe WhatsApp, exact cum le are în cap:
 *
 *   luni - vf câmpului, Lozna, dersca, Strateni, Sendriceni Dorohoi
 *   marti: Dorohoi, Broscauti, Carasa, padureni
 *   miercuri hudesti alba naranca darabani Păltiniș
 *
 * Nimeni n-o să completeze un formular cu 40 de sate. Aici transformăm
 * textul ăsta — cu sau fără diacritice, cu virgule sau fără, cu ziua
 * scrisă oricum — în perechi (zi, localitate) pe care le putem folosi.
 */

export const ZILE = [
  "luni",
  "marti",
  "miercuri",
  "joi",
  "vineri",
  "sambata",
  "duminica",
] as const;
export type Zi = (typeof ZILE)[number];

/**
 * Textul, adus la litere simple: fără diacritice, fără majuscule.
 *
 * Î ȘI Â SUNT ACEEAȘI LITERĂ. Reforma din 1993 a schimbat scrierea, iar
 * registrele n-au ținut pasul: Finanțele scriu „Pîrteştii de Sus", omul
 * scrie „Pârteștii de Sus", și satul nu se mai găsea — deși e același.
 * La fel „Cîmpulung"/„Câmpulung", „Rîmnicu"/„Râmnicu". Le facem pe
 * amândouă la fel, altfel pierdem sate întregi din zona agentului.
 */
export function neted(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ăâî]/g, "a")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    // LINIUȚA E TOT SPAȚIU. Registrul scrie „Poieni-Solca", omul scrie
    // „Poieni Solca" — același sat. La fel „Vatra-Moldoviței".
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ANTETUL DE WHATSAPP, tăiat din capul rândului.
 *
 * Când omul copiază conversația, nu doar mesajul, fiecare rând vine așa:
 *   [18:04, 26.08.2026] +40 749 714 955: LUNI
 * Iar ora și data au virgulă în ele — deci se rupeau în două „localități"
 * și ieșeau pe ecran „[18:04" și „26.08.2026] +40 749 714 955: LUNI".
 * Se taie ÎNAINTE de orice altceva, altfel virgula lor strică tot rândul.
 */
export function faraAntetWhatsApp(rand: string): string {
  return String(rand ?? "")
    // [18:04, 26.08.2026] +40 749 714 955:  ·  [18:04] Nume:  ·  18:04 - Nume:
    .replace(
      /^\s*\[?\s*\d{1,2}[:.]\d{2}(\s*[:.]\d{2})?\s*(,\s*[\d./-]{6,12})?\s*\]?\s*(-\s*)?([^:]{0,40}:)?\s*/u,
      "",
    )
    .trim();
}

/**
 * Ce scrie omul în paranteză e o lămurire, nu un sat: „(toate locațiile)",
 * „(dacă am timp)", „(2 magazine)". O scoatem — dar o ținem minte, ca să
 * putem spune pe ecran ce am înțeles.
 */
export function faraParanteze(text: string): { curat: string; nota: string } {
  const note: string[] = [];
  let curat = String(text ?? "")
    .replace(/[（(]([^)）]*)[)）]/gu, (_, ce: string) => {
      const t = String(ce).trim();
      if (t) note.push(t);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  // Aceeași lămurire, scrisă cu linie în loc de paranteză:
  //   „Țara Dornelor – toate locațiile"
  // Omul o scrie cum îi vine la îndemână pe telefon; pentru noi e tot o
  // lămurire, nu parte din numele satului.
  const dupaLinie = curat.match(
    /^(.*?)\s*[-–—]\s*(toate\s+loca[țt]iile?|toate|tot|tot\s+ce\s+e)\s*$/iu,
  );
  if (dupaLinie) {
    note.push(dupaLinie[2].trim());
    curat = dupaLinie[1].trim();
  }
  return { curat, nota: note.join("; ") };
}

/**
 * Cum scriu oamenii zilele, adus la litere simple. LISTĂ ÎNCHISĂ, nu
 * „începe cu": în România există sate care încep exact ca o zi — JOIȚA,
 * VINERIA, MARTINEȘTI, LUNCA. Cu regula „prefixul e de-ajuns" satul
 * dispărea din zonă, citit ca zi. Mai bine nu recunoaștem o formă
 * ciudată de zi (omul o vede în confirmare) decât să pierdem un sat.
 */
const FORME_ZI: Record<string, Zi> = {
  luni: "luni", lunea: "luni", lun: "luni",
  marti: "marti", martii: "marti", martea: "marti", mart: "marti",
  miercuri: "miercuri", miercurea: "miercuri", mierc: "miercuri", mircuri: "miercuri",
  joi: "joi", joia: "joi",
  vineri: "vineri", vinerea: "vineri", vin: "vineri", vineri1: "vineri",
  sambata: "sambata", simbata: "sambata", sambat: "sambata", simbat: "sambata",
  sambăta: "sambata", sam: "sambata", sb: "sambata",
  duminica: "duminica", dumineca: "duminica", dum: "duminica", duminia: "duminica",
};

/** Ziua din capul rândului („Marți:", „marti -", „MARTI") sau null. */
export function ziDinText(bucata: string): Zi | null {
  const n = neted(bucata).replace(/[^a-z]/g, "");
  return FORME_ZI[n] ?? null;
}

export interface ZonaLinie {
  zi: Zi | "";
  localitate: string;
}

/**
 * Textul → lista de (zi, localitate). Ziua rămâne goală dacă omul n-a
 * scris zile (zonă fără program, tot valabilă). Localitățile se despart
 * după virgulă, punct-virgulă, slash sau linie nouă — spațiile NU sunt
 * separator (multe sate au două cuvinte: „Vf. Câmpului", „Poiana Stampei").
 */
export function parseZone(text: string): ZonaLinie[] {
  const out: ZonaLinie[] = [];
  const vazute = new Set<string>();
  let ziCurenta: Zi | "" = "";

  for (const randBrut of String(text ?? "").split(/\r?\n/)) {
    // Antetul de WhatsApp PRIMUL: ora lui are virgulă, iar virgula e
    // separator de localități. Dacă nu-l tăiem întâi, rândul se rupe în
    // bucăți care nu înseamnă nimic.
    let rand = faraAntetWhatsApp(randBrut);
    if (!rand) continue;
    // „Completare vineri", „continuare luni", „încă la marți" — nu e o zi
    // nouă, e o adăugire la una scrisă mai sus. Fără asta, satele de sub
    // ea rămâneau fără zi, sau se lipeau de ziua greșită.
    const completare = rand.match(
      /^\s*(completare|completari|complet[aă]ri|continuare|inca la|inc[aă] la|si la|[șs]i la|adaug|adaugare|ad[aă]ugare)\b[\s:.\-–]*(.*)$/iu,
    );
    if (completare) {
      const z = ziDinText(completare[2].trim());
      if (z) {
        ziCurenta = z;
        rand = "";
      } else {
        rand = completare[2].trim();
      }
      if (!rand) continue;
    }

    // Ziua din capul rândului, scrisă oricum: „luni - …", „Marți: …",
    // „joi-ungureni" (fără spațiu), „miercuri hudesti".
    // Luăm DOAR literele de la început: dacă satul e lipit de zi
    // („marţi-Dorohoi"), altfel îl înghițeam odată cu ziua.
    // Clasa include și ş/ţ cu sedilă (cele de pe tastatura veche și din
    // Word), nu doar ș/ț cu virgulă — pe teren apar amândouă.
    const cap = rand.match(/^[A-Za-zĂÂÎȘȚŞŢăâîșțşţ]+/);
    if (cap) {
      const z = ziDinText(cap[0]);
      if (z) {
        ziCurenta = z;
        rand = rand.slice(cap[0].length).replace(/^[\s\-–:.]+/, "");
      }
    }

    for (const bucata of rand.split(/[,;/|]+/)) {
      // Lămuririle din paranteză nu sunt sate.
      const { curat } = faraParanteze(bucata);
      const loc = curat
        .replace(/^[\s\-–:.]+/, "")
        .replace(/[\s\-–:.]+$/, "")
        .trim();
      if (loc.length < 2) continue;
      // Un rest de număr de telefon sau de dată nu e sat.
      if (!/[a-zăâîșțşţ]{2}/i.test(loc)) continue;
      // Nu lăsăm resturi de zi rătăcite („marti" singur pe rând).
      if (ziDinText(loc) && neted(loc).length <= 9) continue;
      const cheie = `${ziCurenta}|${neted(loc)}`;
      if (vazute.has(cheie)) continue;
      vazute.add(cheie);
      out.push({ zi: ziCurenta, localitate: loc.slice(0, 120) });
    }
  }
  return out;
}

/**
 * Potrivește localitățile scrise de om cu cele REALE din registru.
 * Întoarce, pentru fiecare, varianta oficială (dacă am găsit-o) — ca
 * harta și rutele să lucreze pe același nume, nu pe cum a scris omul.
 *
 * Ordinea încercărilor: potrivire exactă (fără diacritice) → localitate
 * care începe cu textul → localitate care conține textul. Dacă tot nu
 * iese, încercăm și pe cuvinte (omul poate scrie două sate lipite).
 */
export function potriveste(
  scris: string,
  cunoscute: string[],
): { oficial: string | null; parti?: string[]; sugestii: string[] } {
  const n = neted(scris);
  const perechi = cunoscute.map((c) => ({ c, n: neted(c) }));

  const exact = perechi.find((p) => p.n === n);
  if (exact) return { oficial: exact.c, sugestii: [] };

  // „vf. campului" ↔ „VIRFUL CAMPULUI": scoatem prescurtările uzuale.
  // PUNCTUL PRIMUL: fără el, „vf." rămânea „virful." și nu mai semăna cu
  // nimic — satul se pierdea din zonă în tăcere.
  const fara = n
    .replace(/\./g, " ")
    .replace(/\bvf\b/g, "virful")
    .replace(/\b(sat|com|mun|municipiul|comuna|ors|oras|orasul)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const exact2 = perechi.find((p) => p.n === fara);
  if (exact2) return { oficial: exact2.c, sugestii: [] };

  const incepe = perechi.filter((p) => p.n.startsWith(fara) || fara.startsWith(p.n));
  const contine = perechi.filter((p) => p.n.includes(fara) || fara.includes(p.n));

  // VIRGULA UITATĂ: „Sendriceni Dorohoi" înseamnă DOUĂ sate, nu unul.
  // Încercăm să spargem textul în localități cunoscute (cele mai lungi
  // întâi); dacă TOT textul se acoperă, le întoarcem pe amândouă — altfel
  // al doilea sat s-ar pierde în tăcere din zona agentului.
  const parti = spargeInLocalitati(fara, perechi);
  if (parti && parti.length >= 2) return { oficial: null, parti, sugestii: [] };

  if (incepe.length === 1) return { oficial: incepe[0].c, sugestii: [] };
  if (contine.length === 1) return { oficial: contine[0].c, sugestii: [] };

  let sugestii = [...incepe, ...contine]
    .map((p) => p.c)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);

  // SCRIS STRICAT RĂU („sendirceim" în loc de „Sendriceni"): niciun
  // început și niciun cuprins nu se potrivesc. Atunci căutăm satele cu
  // litere APROAPE la fel și le propunem — ca SUGESTIE, nu ca răspuns.
  // Ghicitul automat aici ar duce agentul în alt sat; întrebarea, nu.
  if (sugestii.length === 0 && fara.length >= 4) {
    sugestii = perechi
      .map((p) => ({ c: p.c, d: distanta(fara, p.n) }))
      // Cel mult ~40% din nume greșit — peste atât nu mai e o scăpare de
      // tastatură, e alt cuvânt, și n-are rost să-l propunem.
      .filter((x) => x.d <= Math.max(1, Math.floor(fara.length * 0.4)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((x) => x.c);
  }
  return { oficial: null, sugestii };
}

/**
 * Câte litere trebuie schimbate ca un cuvânt să devină celălalt
 * (Levenshtein). Folosită DOAR ca să propunem variante omului, niciodată
 * ca să alegem în locul lui.
 */
function distanta(a: string, b: string): number {
  // Diferență mare de lungime → nici n-are rost să calculăm.
  if (Math.abs(a.length - b.length) > 6) return 99;
  let precedent = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curent = [i];
    for (let j = 1; j <= b.length; j++) {
      curent[j] = Math.min(
        precedent[j] + 1, // ștergere
        curent[j - 1] + 1, // inserare
        precedent[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // schimbare
      );
    }
    precedent = curent;
  }
  return precedent[b.length];
}

/** Sparge „sendriceni dorohoi" în [ȘENDRICENI, DOROHOI], dacă se poate
 *  acoperi TOT textul cu localități cunoscute. Altfel, null. */
function spargeInLocalitati(
  text: string,
  perechi: Array<{ c: string; n: string }>,
): string[] | null {
  const cuvinte = text.split(" ").filter(Boolean);
  if (cuvinte.length < 2 || cuvinte.length > 6) return null;
  const gasite: string[] = [];
  let i = 0;
  while (i < cuvinte.length) {
    let potrivit: { c: string; lungime: number } | null = null;
    // Cea mai LUNGĂ potrivire de la poziția curentă („poiana stampei"
    // înainte de „poiana").
    for (let j = cuvinte.length; j > i; j--) {
      const bucata = cuvinte.slice(i, j).join(" ");
      const p = perechi.find((x) => x.n === bucata);
      if (p) {
        potrivit = { c: p.c, lungime: j - i };
        break;
      }
    }
    if (!potrivit) return null; // a rămas ceva neacoperit → nu ghicim
    gasite.push(potrivit.c);
    i += potrivit.lungime;
  }
  return gasite.length >= 2 ? gasite : null;
}
