/**
 * CE PĂȚEȘTE O FIRMĂ DUPĂ O VIZITĂ.
 *
 * Regula veche se uita doar la butonul apăsat, nu și la cine e firma. La
 * un prospect era corectă; la un client vechi, nu:
 *
 *   Agentul intră la un client pe care-l are de trei ani. Azi omul are
 *   marfă și zice „nu iau nimic". Agentul apasă «Nu vrea», fiindcă asta
 *   s-a întâmplat. Firma trecea pe „respins" — adică ieșea din lista lui
 *   de clienți, ieșea din «de vizitat săptămâna asta», ieșea din
 *   raportul patronului. Un client cu istoric de trei ani, șters de pe
 *   listă pentru că într-o zi n-a avut nevoie de marfă.
 *
 * „Nu vrea" înseamnă două lucruri diferite, după cine e în fața ta:
 *   · la un PROSPECT — „nu vrea să lucreze cu noi". Ăla e respins.
 *   · la un CLIENT — „nu vrea marfă azi". Ăla rămâne client; vizita s-a
 *     făcut, se vede în jurnal, iar rândul lui vine iar peste o săptămână.
 *
 * Aici stă regula, într-un singur loc, ca să nu se despartă în două
 * variante care se bat cap în cap.
 */

/**
 * Rezultatele pe care le poate apăsa agentul.
 *
 * `inchis` și `nu_mai_exista` erau, până acum, UN SINGUR buton:
 * „Închis / nu era nimeni". Două lucruri cu totul diferite sub același
 * deget:
 *   · magazinul era închis la ora aia, sau n-a prins pe nimeni — se
 *     întâmplă zilnic, la prânz, în zi de inventar;
 *   · firma nu mai există, s-a desființat.
 *
 * Iar apăsatul stingea firma DEFINITIV: dispărea de pe hartă și din
 * listele întregii firme, iar verificarea lunară de la ANAF era anume
 * oprită să o mai reînvie. Adică un agent care trecea la prânz pe la un
 * client vechi și găsea ușa închisă îl ștergea din firmă pentru
 * totdeauna, cu un singur deget, fără să afle nimeni.
 *
 * Acum sunt două butoane, iar cel greu se poate și da înapoi.
 */
export const REZULTATE = [
  "gandeste",
  "ne_suna",
  "nu_vrea",
  "client",
  /** Închis azi / n-am prins pe nimeni. NU schimbă nimic despre firmă. */
  "inchis",
  /** Nu mai există: s-a desființat. Ăsta o scoate din liste. */
  "nu_mai_exista",
] as const;
export type RezultatVizita = (typeof REZULTATE)[number];

/**
 * Starea nouă a firmei, sau `null` dacă vizita n-o schimbă.
 *
 * `stareaDeAcum` e statusul din bază înainte de vizită („nou",
 * „contactat", „client", „respins"). Gol sau necunoscut = tratăm firma ca
 * pe un prospect, adică exact ca înainte.
 */
export function STATUS_DUPA_VIZITA(
  stareaDeAcum: string,
  rezultat: RezultatVizita | string,
): string | null {
  const eClient = stareaDeAcum === "client";
  switch (rezultat) {
    case "client":
      // Prospect devenit client; la un client, nu schimbă nimic.
      return "client";
    case "gandeste":
    case "ne_suna":
      // Un client care se mai gândește la o comandă nu se retrogradează
      // la „contactat": ar dispărea din lista lui de clienți.
      return eClient ? null : "contactat";
    case "nu_vrea":
      return eClient ? "client" : "respins";
    case "inchis":
      // „N-a fost nimeni acolo" nu spune nimic despre relație.
      return null;
    case "nu_mai_exista":
      // Firma dispare din liste prin `activ`/`inchis_teren`, nu prin
      // stare: dacă i-am pune „respins", s-ar citi ca „nu vrea cu noi",
      // ceea ce nu e adevărat — pur și simplu nu mai e.
      return null;
    default:
      return null;
  }
}
