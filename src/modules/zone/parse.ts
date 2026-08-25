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

/** Textul, adus la litere simple: fără diacritice, fără majuscule. */
export function neted(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ziua din capul rândului („Marți:", „marti -", „MARTI") sau null. */
export function ziDinText(bucata: string): Zi | null {
  const n = neted(bucata).replace(/[^a-z]/g, "");
  for (const z of ZILE) {
    // „marti", „marţi", „martii" — prefixul e de-ajuns.
    if (n === z || n.startsWith(z)) return z;
  }
  if (n.startsWith("sambat") || n.startsWith("simbat")) return "sambata";
  return null;
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
    let rand = randBrut.trim();
    if (!rand) continue;

    // „luni - ..." / „Marți: ..." / „luni ..." — ziua din capul rândului.
    const cuSeparator = rand.match(/^([A-Za-zĂÂÎȘȚăâîșț]+)\s*[-–:.]\s*(.*)$/);
    if (cuSeparator) {
      const z = ziDinText(cuSeparator[1]);
      if (z) {
        ziCurenta = z;
        rand = cuSeparator[2];
      }
    } else {
      const primulCuvant = rand.split(/[\s,;]+/)[0] ?? "";
      const z = ziDinText(primulCuvant);
      if (z) {
        ziCurenta = z;
        rand = rand.slice(primulCuvant.length);
      }
    }

    for (const bucata of rand.split(/[,;/|]+/)) {
      const loc = bucata
        .replace(/^[\s\-–:.]+/, "")
        .replace(/[\s\-–:.]+$/, "")
        .trim();
      if (loc.length < 2) continue;
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
): { oficial: string | null; sugestii: string[] } {
  const n = neted(scris);
  const perechi = cunoscute.map((c) => ({ c, n: neted(c) }));

  const exact = perechi.find((p) => p.n === n);
  if (exact) return { oficial: exact.c, sugestii: [] };

  // „vf campului" ↔ „VIRFUL CAMPULUI": scoatem prescurtările uzuale.
  const fara = n
    .replace(/\bvf\.?\b/g, "virful")
    .replace(/\bsat\b|\bcom\.?\b|\bmun\.?\b|\bors\.?\b|\boras\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const exact2 = perechi.find((p) => p.n === fara);
  if (exact2) return { oficial: exact2.c, sugestii: [] };

  const incepe = perechi.filter((p) => p.n.startsWith(fara) || fara.startsWith(p.n));
  if (incepe.length === 1) return { oficial: incepe[0].c, sugestii: [] };

  const contine = perechi.filter((p) => p.n.includes(fara) || fara.includes(p.n));
  if (contine.length === 1) return { oficial: contine[0].c, sugestii: [] };

  const sugestii = [...incepe, ...contine]
    .map((p) => p.c)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);
  return { oficial: null, sugestii };
}
