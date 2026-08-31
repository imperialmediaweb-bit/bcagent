/**
 * SALVAREA UNEI VIZITE — forma canonică, fără UI: ia poziția GPS (max 3
 * secunde, ca agentul să nu aștepte în fața magazinului) și trimite
 * vizita pe /api/visits, EXACT ca butoanele de pe hartă și din căutare.
 *
 * CautareClient și MapPanel au încă fiecare copia lor a acestei secvențe
 * (merg în producție, nu le mișcăm acum) — migrarea lor pe helperul ăsta
 * e treabă separată. Orice schimbare de flux se face AICI, nu a patra oară.
 */

export async function salveazaVizita(
  token: string,
  f: { cui: string; denumire: string },
  result: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Poziția GPS din momentul vizitei — pinul firmei devine exact.
    const pozitie = await new Promise<{ lat: number; lng: number; acc: number } | null>(
      (resolve) => {
        if (!navigator.geolocation) return resolve(null);
        const ceas = setTimeout(() => resolve(null), 3000);
        navigator.geolocation.getCurrentPosition(
          (p) => {
            clearTimeout(ceas);
            resolve({
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              acc: p.coords.accuracy,
            });
          },
          () => {
            clearTimeout(ceas);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 2800, maximumAge: 0 },
        );
      },
    );
    const res = await fetch("/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        cui: f.cui,
        denumire: f.denumire,
        result,
        note,
        ...(pozitie ?? {}),
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: data?.error ?? "Eroare la salvare" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Fără semnal — încearcă din nou când prinzi rețea." };
  }
}
