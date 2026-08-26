/**
 * PINUL DE PE HARTA LUI BOGDAN → CLIENTUL DIN APLICAȚIE.
 *
 * Pe hartă scrie cum îi zice omul: „Andronache", „Magazin Filotia",
 * „Bar la Vale Dersca". În registru scrie cum e la Finanțe:
 * „ANDRONACHE FILOTIA ÎNTREPRINDERE INDIVIDUALĂ". Trebuie să le legăm,
 * dar cu mare grijă: un pin pus greșit trimite agentul la altă adresă,
 * iar el va crede aplicația, nu ochii.
 *
 * De-aia regula e: potrivim doar când suntem SIGURI, iar restul îl
 * arătăm omului să aleagă. Mai bine 40 nepotrivite pe care le pune el,
 * decât una greșită pe care n-o observă nimeni.
 */

/** Textul, adus la litere simple: fără diacritice, fără majuscule. */
export function neted(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cuvintele care apar la mai toate firmele și nu ajută la deosebit:
 * forma juridică și cuvintele generice de magazin.
 */
const CUVINTE_GOALE = new Set([
  "srl", "sa", "ii", "pfa", "snc", "sca", "scs", "srld", "intreprindere",
  "individuala", "familiala", "societate", "comerciala", "com", "company",
  "magazin", "magazinul", "market", "minimarket", "alimentara", "alimentar",
  "bar", "barul", "depozit", "unitatea", "punct", "lucru", "de", "la", "si",
  "cu", "din", "pe", "sat", "com", "nr",
]);

/** Cuvintele care chiar spun ceva despre firma asta. */
export function cuvinteTari(text: string): string[] {
  return neted(text)
    .split(" ")
    // Cifrele deosebesc firmele („Magazin 2" nu e „Magazin 21"), deci
    // rămân chiar dacă sunt scurte.
    .filter((c) => (c.length >= 3 || /\d/.test(c)) && !CUVINTE_GOALE.has(c));
}

/**
 * „Cheia" unei firme: numele fără forma juridică și fără cuvintele
 * generice. „MAGAZIN ANDRONACHE SRL" și „Andronache" au aceeași cheie,
 * deci se recunosc între ele — fără să confundăm „Test 0" cu „Test 10".
 */
function cheie(text: string): string {
  return cuvinteTari(text).join(" ");
}

export interface ClientDePotrivit {
  cui: string;
  denumire: string;
  localitate: string;
}
export interface PunctDePotrivit {
  nume: string;
  descriere?: string;
  lat: number;
  lng: number;
}

export interface Potrivire {
  punct: PunctDePotrivit;
  /** Clientul găsit, sau null dacă n-am fost destul de siguri. */
  client: ClientDePotrivit | null;
  /** Cât de sigur: 1 = potrivire exactă, 0 = deloc. */
  scor: number;
  /** De ce am ales-o — omul trebuie să poată verifica din ochi. */
  motiv: string;
  /** Alternativele, când n-am fost siguri: le alege el. */
  variante: ClientDePotrivit[];
}

/** Câți kilometri sunt între două puncte (destul de exact pentru un județ). */
function km(a: [number, number], b: [number, number]): number {
  const dLat = (a[0] - b[0]) * 111;
  const dLng = (a[1] - b[1]) * 111 * Math.cos((a[0] * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Câte cuvinte tari au în comun, raportat la cel mai scurt dintre ele. */
function suprapunere(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const comune = a.filter((c) => setB.has(c)).length;
  // Raportat la cel mai LUNG, nu la cel mai scurt: altfel un nume scurt
  // („Ana Maria") se potrivea perfect cu oricare firmă care-l conține
  // („Pristavu Ana-Maria"), deși sunt firme diferite. Cazul „numele e
  // conținut în celălalt" e tratat separat, mai sus, cu chei.
  return comune / Math.max(a.length, b.length);
}

/**
 * Leagă fiecare pin de un client. Întoarce ȘI nepotrivirile, cu variante —
 * nimic nu se scrie fără ca omul să vadă întâi ce am înțeles.
 *
 * `prag` = cât de siguri trebuie să fim ca să potrivim singuri (0-1).
 */
export function potriveștePuncte(
  puncte: PunctDePotrivit[],
  clienti: ClientDePotrivit[],
  prag = 0.7,
  /**
   * Centrele satelor, dacă le știm. Când două firme au același nume
   * („Andronache" în Darabani și în Săveni), numele nu le mai deosebește
   * — dar pinul ARE coordonate. Atunci decide geografia, nu norocul.
   */
  centre?: Map<string, { lat: number; lng: number }>,
): Potrivire[] {
  const pregatiti = clienti.map((c) => ({
    c,
    n: neted(c.denumire),
    tari: cuvinteTari(c.denumire),
    cheie: cheie(c.denumire),
    loc: neted(c.localitate),
  }));
  // Un client nu poate primi DOUĂ pinuri: primul care-l prinde sigur îl ia.
  const luati = new Set<string>();
  const rezultat: Potrivire[] = [];

  // Două treceri: întâi potrivirile sigure (ca ele să-și rezerve clientul),
  // apoi restul. Altfel un pin slab putea fura clientul unuia exact.
  const calcul = puncte.map((p) => {
    const nP = neted(p.nume);
    // ATENȚIE: NU băgăm toată descrierea la potrivire. În harta reală ea
    // conține șablon („Tip Outlet: Convenience"), identic la toate pinurile
    // — și crea potriviri din senin între firme fără nicio legătură.
    // Harta exportată din sistemul vechi are în descriere „Nume Legal: X",
    // adică exact denumirea din registru. Când există, e cheia cea mai
    // bună — mai bună decât numele scurt de pe pin.
    const numeLegal =
      (p.descriere ?? "").match(/Nume Legal:\s*([^\n]+?)(?:\s+Tip Outlet:|$)/i)?.[1] ?? "";
    const textPotrivire = numeLegal !== "" ? `${p.nume} ${numeLegal}` : p.nume;
    const tariP = cuvinteTari(textPotrivire);
    const cheieP = cheie(textPotrivire);
    const scoruri = pregatiti.map((q) => {
      let scor = 0;
      let motiv = "";
      if (q.n === nP) {
        scor = 1;
        motiv = "același nume";
      } else if (cheieP !== "" && q.cheie === cheieP) {
        // „MAGAZIN ANDRONACHE SRL" vs „Andronache": diferă doar prin
        // cuvinte care nu spun nimic.
        scor = 0.98;
        motiv = "același nume, fără forma juridică";
      } else if (
        cheieP !== "" &&
        q.cheie !== "" &&
        // De la ÎNCEPUT, nu de oriunde. La firmele românești partea care
        // deosebește stă în față („PODU COSNEI comert"), iar restul e
        // generic. Fără regula asta, „ANA MARIA" se lipea de „PRISTAVU
        // ANA-MARIA" — alt om, altă adresă.
        (`${q.cheie} `.startsWith(`${cheieP} `) || `${cheieP} `.startsWith(`${q.cheie} `))
      ) {
        scor = 0.9;
        motiv = "numele de pe hartă e începutul denumirii firmei";
      } else {
        const s = suprapunere(tariP, q.tari);
        if (s > 0) {
          scor = s * 0.85;
          motiv = "cuvinte comune în denumire";
        }
      }
      // Aceeași localitate întărește; alta slăbește. „Andronache" din
      // Darabani nu e „Andronache" din Săveni.
      if (scor > 0 && q.loc !== "" && nP.includes(q.loc)) {
        scor = Math.min(1, scor + 0.1);
        motiv += " + satul se potrivește";
      }
      return { q, scor, motiv };
    });
    scoruri.sort((a, b) => b.scor - a.scor);
    return { p, scoruri };
  });

  calcul.sort((a, b) => (b.scoruri[0]?.scor ?? 0) - (a.scoruri[0]?.scor ?? 0));

  for (const { p, scoruri } of calcul) {
    // Cel mai bun candidat, FĂRĂ să ne uităm cine e deja luat. Dacă ăsta e
    // o potrivire tare dar firma lui e ocupată, înseamnă că avem al doilea
    // magazin al aceleiași firme — NU că trebuie să căutăm altă firmă.
    // Fără regula asta, „ANA MARIA SRL" (al doilea punct de lucru) ajungea
    // legat de „PRISTAVU ANA-MARIA II", adică de cu totul altcineva, și
    // trimitea agentul la adresa greșită.
    const celMaiBun = scoruri[0];
    if (celMaiBun && celMaiBun.scor >= 0.9 && luati.has(celMaiBun.q.c.cui)) {
      rezultat.push({
        punct: p,
        client: null,
        scor: Math.round(celMaiBun.scor * 100) / 100,
        motiv: `firma „${celMaiBun.q.c.denumire}" are deja un magazin pus de pe hartă — ăsta pare al doilea punct de lucru`,
        variante: [],
      });
      continue;
    }
    const bun = scoruri.find((s) => s.scor >= prag && !luati.has(s.q.c.cui));
    // Ambiguu: doi candidați la fel de buni. Mai bine îl întrebăm pe om.
    const laFel =
      bun === undefined
        ? []
        : scoruri.filter(
            (s) => s.q.c.cui !== bun.q.c.cui && s.scor >= bun.scor - 0.05 && s.scor >= prag,
          );
    let aproapeLaFel = laFel.length > 0;
    let bunAles = bun;
    let motivExtra = "";

    // GEOGRAFIA RUPE EGALITATEA: pinul e la Darabani, deci „Andronache"
    // e cel din Darabani, nu cel din Săveni. Doar dacă unul e limpede
    // mai aproape — altfel tot îl întrebăm pe om.
    if (aproapeLaFel && bun && centre && centre.size > 0) {
      const candidati = [bun, ...laFel]
        .map((s) => {
          const c = centre.get(neted(s.q.c.localitate));
          return c ? { s, d: km([p.lat, p.lng], [c.lat, c.lng]) } : null;
        })
        .filter((x): x is { s: typeof bun; d: number } => x !== null)
        .sort((a, b2) => a.d - b2.d);
      if (
        candidati.length >= 2 &&
        candidati[0].d <= 25 &&
        candidati[1].d > candidati[0].d * 2
      ) {
        bunAles = candidati[0].s;
        aproapeLaFel = false;
        motivExtra = ` (pinul e la ${Math.round(candidati[0].d)} km de ${candidati[0].s.q.c.localitate}, mult mai aproape decât celelalte)`;
      }
    }
    const bun2 = bunAles;

    if (bun2 && !aproapeLaFel) {
      luati.add(bun2.q.c.cui);
      rezultat.push({
        punct: p,
        client: bun2.q.c,
        scor: Math.round(bun2.scor * 100) / 100,
        motiv: bun2.motiv + motivExtra,
        variante: [],
      });
    } else {
      rezultat.push({
        punct: p,
        client: null,
        scor: Math.round((scoruri[0]?.scor ?? 0) * 100) / 100,
        motiv: aproapeLaFel
          ? "două firme se potrivesc la fel de bine — alege tu"
          : // O firmă poate avea mai multe magazine pe hartă („ADEMAT
            // COMERT" la Cucuteni ȘI la Durnești), dar în aplicație ține
            // un singur loc. Spunem adevărul: firma e deja luată, nu că
            // „n-am găsit-o" — altfel omul caută o greșeală care nu există.
            scoruri[0] !== undefined && scoruri[0].scor >= prag
            ? `firma „${scoruri[0].q.c.denumire}" are deja un magazin pus de pe hartă — ăsta pare al doilea punct de lucru`
            : "n-am găsit o firmă destul de asemănătoare",
        variante: scoruri
          .filter((s) => s.scor > 0.25 && !luati.has(s.q.c.cui))
          .slice(0, 5)
          .map((s) => s.q.c),
      });
    }
  }
  // Le dăm înapoi în ordinea în care au venit de pe hartă.
  const index = new Map(puncte.map((p, i) => [p, i]));
  rezultat.sort((a, b) => (index.get(a.punct) ?? 0) - (index.get(b.punct) ?? 0));
  return rezultat;
}
