/**
 * E UN CUI ADEVĂRAT, SAU E O CIFRĂ SCRISĂ AIUREA?
 *
 * Registrul de firme e COMUN tuturor agențiilor de pe platformă. Când
 * aducem firme noi în el dintr-o hartă, trebuie să fim siguri că sunt
 * firme, nu greșeli de tastare: un rând stricat îl vede toată lumea și
 * nu-l mai scoate nimeni.
 *
 * CUI-ul românesc are cifră de control, calculată după o cheie fixă
 * (753217532). Verificarea e ieftină și taie 90% din gunoi: un număr de
 * telefon, un an, un cod intern — niciunul nu trece.
 *
 * NU verificăm dacă firma există la ANAF — asta o face măturătorul, care
 * trece oricum peste tot ce are `activ IS NULL`. Aici doar oprim ce nu
 * poate fi CUI nici teoretic.
 */

/** Cheia oficială de control, cifră cu cifră. */
const CHEIE = [7, 5, 3, 2, 1, 7, 5, 3, 2];

/**
 * Curăță un CUI scris de om: „RO 14758812", „ro14758812", „14758812 ".
 * Întoarce doar cifrele, sau text gol dacă n-a rămas nimic.
 */
export function curataCui(brut: string): string {
  return String(brut ?? "").replace(/\D/g, "").replace(/^0+/, "").slice(0, 10);
}

/**
 * Are cifra de control corectă?
 *
 * CUI-urile românești au între 2 și 10 cifre; ultima e de control. Se
 * înmulțește fiecare cifră din față cu cheia, aliniată LA DREAPTA, se
 * adună, se înmulțește cu 10, se ia restul la 11 — iar 10 se citește 0.
 */
export function cuiValid(brut: string): boolean {
  const c = curataCui(brut);
  // Sub 2 cifre nu e CUI. Peste 10 nici atât — dar `curataCui` taie deja.
  if (c.length < 2 || c.length > 10) return false;
  const cifre = c.split("").map(Number);
  const control = cifre.pop() as number;
  // Aliniere LA DREAPTA: ultima cifră din față se înmulțește cu ultima
  // cifră din cheie. Fără asta, CUI-urile scurte pică pe nedrept.
  const cheie = CHEIE.slice(CHEIE.length - cifre.length);
  let suma = 0;
  for (let i = 0; i < cifre.length; i++) suma += cifre[i] * cheie[i];
  const rest = (suma * 10) % 11;
  return (rest === 10 ? 0 : rest) === control;
}
