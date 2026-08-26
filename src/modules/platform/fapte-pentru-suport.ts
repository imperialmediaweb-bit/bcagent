import { getDB } from "@/lib/db";

/**
 * FAPTELE LUI, NU VORBE GENERALE.
 *
 * Costin a scris din teren: „sc ancavit tonic srl, nu găsesc pe hartă".
 * A primit un scenariu general — „verifică dacă are adresă completă",
 * „apasă Salvează locația curentă" — cu butoane care nici nu există.
 *
 * Un om de la suport care merită plătit ar fi făcut altceva: s-ar fi
 * uitat în baza LUI. „ANCAVIT TONIC SRL — o ai, la Broscăuți, CUI
 * 12345678, alocată ție. Nu apare pe hartă pentru că n-are loc pus și
 * adresa din acte n-are număr. Când ajungi acolo, apasă «Sunt aici»."
 *
 * Aici scoatem faptele alea — DOAR din datele firmei care întreabă.
 * Fără ele, orice răspuns e ghicit; cu ele, e un răspuns adevărat.
 */

type DB = NonNullable<ReturnType<typeof getDB>>;

/** Textul, adus la litere simple (î și â sunt aceeași literă). */
function neted(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[ăâî]/g, "a")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cuvintele din mesaj care ar putea fi nume de firmă sau de sat.
 *
 * Sărim peste vorbele de umplutură („nu", „este", „harta") — altfel am
 * căuta în bază după „pe" și am scoate jumătate din registru.
 */
const UMPLUTURA = new Set(
  neted(
    [
      "nu este sunt am are ai avem aveti pe la in din cu si sau dar ca ce cum",
      "unde cand nici mai foarte tot toate toti niciun nicio harta mapa",
      "aplicatie aplicatia client clienti firma firme magazin magazine",
      "problema probleme gasesc gasit gaseste apare aparut arata vad vazut",
      "merge mergea poate pot buton butonul pagina ecran telefon srl sc pfa",
      "sa se de el ea lui pentru cred vreau trebuie face facut zice",
    ].join(" "),
  ).split(" "),
);

export function cuvinteDeCautat(mesaj: string): string[] {
  const out: string[] = [];
  for (const w of neted(mesaj).split(/[^a-z0-9]+/)) {
    if (w.length < 4 || UMPLUTURA.has(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

export interface FapteSuport {
  /** Rândurile găsite, gata de citit de un om. */
  text: string;
  /** Câte firme am găsit după cuvintele din mesaj. */
  gasite: number;
}

/**
 * Ce știm despre ce a scris omul: firmele care seamănă, cu locul lor,
 * plus cifrele firmei (câți clienți, câți cu loc exact).
 *
 * `numeAgenti` = agenții firmei. Fără ei nu căutăm nimic: registrul e
 * comun tuturor agențiilor de pe platformă, iar cine întreabă vede DOAR
 * ce e al lui.
 */
export async function fapteDinDate(
  db: DB,
  orgId: string,
  numeAgenti: string[],
  mesaj: string,
): Promise<FapteSuport> {
  if (orgId === "" || numeAgenti.length === 0) {
    return { text: "", gasite: 0 };
  }
  const cuvinte = cuvinteDeCautat(mesaj);
  const randuri: string[] = [];

  // ── CIFRELE FIRMEI, ca să știm despre ce vorbim ──
  const [c] = await db<
    [{ clienti: string; cu_loc: string; din_teren: string; magazine: string }]
  >`
    SELECT COUNT(*)::text AS clienti,
           COUNT(g.cui)::text AS cu_loc,
           COUNT(*) FILTER (WHERE g.sursa IN ('deget','gps'))::text AS din_teren,
           (SELECT COUNT(*)::text FROM magazin_harta WHERE org_id = ${orgId}) AS magazine
    FROM prospects p
    JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${orgId}
    LEFT JOIN geo_firme g ON g.cui = p.cui
  `;
  randuri.push(
    `Firma are ${c.clienti} clienți alocați pe agenți; ${c.cu_loc} au loc pe ` +
      `hartă (dintre care ${c.din_teren} puse de agenți la fața locului). ` +
      `Plus ${c.magazine} magazine pe hartă (de prospectat sau ale clienților).`,
  );

  // ── FIRMELE CARE SEAMĂNĂ CU CE A SCRIS ──
  let gasite = 0;
  if (cuvinte.length > 0) {
    const tipare = cuvinte.map((w) => `%${w}%`);
    const firme = await db<
      Array<{
        cui: string;
        denumire: string;
        localitate: string;
        judet: string;
        status: string;
        assigned_agent: string;
        adresa: string;
        lat: number | null;
        sursa: string | null;
        aprox: boolean | null;
      }>
    >`
      SELECT p.cui, p.denumire, COALESCE(p.localitate,'') AS localitate,
             COALESCE(p.judet,'') AS judet, p.status,
             COALESCE(p.assigned_agent,'') AS assigned_agent,
             COALESCE(NULLIF(p.adresa_livrare,''), COALESCE(p.adresa,'')) AS adresa,
             g.lat, g.sursa, g.aprox
      FROM prospects p
      LEFT JOIN geo_firme g ON g.cui = p.cui
      WHERE (COALESCE(p.assigned_agent,'') = ''
             OR p.assigned_agent = ANY(${numeAgenti}))
        -- Fără diacritice, ca să prindem „Aghiorghiţoaie" și cu ț, și cu
        -- ţ, și fără. Î și Â merg la aceeași literă, ca peste tot la noi.
        AND lower(translate(p.denumire,
              'ăâîșțĂÂÎȘȚşţŞŢ', 'aaastAAASTstST')) LIKE ANY(${tipare})
      ORDER BY (p.assigned_agent = ANY(${numeAgenti})) DESC, p.denumire
      LIMIT 8
    `;
    gasite = firme.length;
    if (firme.length === 0) {
      randuri.push(
        `Am căutat în listele firmei după: ${cuvinte.join(", ")} — NICIO ` +
          `firmă nu se potrivește. Deci firma asta nu e în bază deloc, nu e ` +
          `doar „fără loc pe hartă".`,
      );
    } else {
      for (const f of firme) {
        const alCui =
          f.assigned_agent === ""
            ? "NEALOCATĂ (nu e clientul niciunui agent)"
            : `alocată lui ${f.assigned_agent}`;
        const loc =
          f.lat === null
            ? "FĂRĂ loc pe hartă"
            : f.sursa === "deget" || f.sursa === "gps"
              ? "cu locul pus de un agent la fața locului"
              : f.aprox
                ? "cu locul aproximativ (centrul satului)"
                : "cu locul exact, adus din hartă";
        randuri.push(
          `„${f.denumire}" · CUI ${f.cui} · ${f.localitate || "fără localitate"}` +
            `${f.judet ? `, ${f.judet}` : ""} · ${f.status} · ${alCui} · ${loc}` +
            `${f.adresa ? ` · adresa: ${f.adresa}` : " · FĂRĂ adresă în acte"}`,
        );
      }
    }
  }

  return { text: randuri.join("\n"), gasite };
}
