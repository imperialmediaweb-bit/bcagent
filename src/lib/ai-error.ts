/**
 * Ce VEDE omul când AI-ul nu răspunde.
 *
 * Agentul de pe teren nu are ce face cu „invalid_request_error: Your
 * credit balance is too low..." — a apărut exact așa pe telefonul lui
 * Răzvan. Traducem orice defect într-o propoziție pe românește, care
 * spune ce se întâmplă și că restul aplicației merge mai departe.
 * Detaliul tehnic rămâne în logurile serverului, pentru noi.
 */
export function mesajEroareAI(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  console.error("[AI]", brut);

  const t = brut.toLowerCase();
  // Fără credit / plată la furnizorul de AI — problema e la noi, nu la el.
  if (
    t.includes("credit balance") ||
    t.includes("billing") ||
    t.includes("quota") ||
    t.includes("insufficient")
  ) {
    return "\n\n⚠️ Analiza AI e oprită momentan (ține de abonamentul platformei). Am anunțat administratorul. Restul aplicației merge normal — poți bifa vizita și trimite comenzi ca de obicei.";
  }
  // Prea multe cereri într-un timp scurt.
  if (t.includes("rate limit") || t.includes("429") || t.includes("overloaded")) {
    return "\n\n⚠️ AI-ul e aglomerat acum. Încearcă din nou peste un minut — restul aplicației merge normal.";
  }
  // Rețea / timeout.
  if (
    t.includes("timeout") ||
    t.includes("network") ||
    t.includes("fetch failed") ||
    t.includes("econnreset")
  ) {
    return "\n\n⚠️ Nu am reușit să iau legătura cu AI-ul (semnal slab?). Încearcă din nou — restul aplicației merge normal.";
  }
  return "\n\n⚠️ Analiza AI n-a mers de data asta. Încearcă din nou — restul aplicației merge normal.";
}
