import crypto from "node:crypto";

/**
 * AMPRENTA UNUI FIȘIER DE VÂNZĂRI — ca să nu se dubleze cifrele.
 *
 * Dacă cineva încarcă din greșeală de două ori același raport (se întâmplă
 * des: „nu știu dacă a mers, mai încarc o dată"), rândurile se adunau de
 * două ori și TOATE analizele arătau dublu. Amprenta e calculată din
 * conținutul rândurilor, nu din numele fișierului — deci prinde duplicatul
 * chiar dacă fișierul a fost redenumit.
 */
export interface FingerprintRow {
  date: string;
  agent: string;
  producer?: string;
  client?: string;
  volume?: number;
  value?: number;
}

export function rowsFingerprint(rows: FingerprintRow[]): string {
  const canonical = rows
    .map((r) =>
      [
        String(r.date ?? "").slice(0, 10),
        String(r.agent ?? "").trim().toUpperCase(),
        String(r.producer ?? "").trim().toUpperCase(),
        String(r.client ?? "").trim().toUpperCase(),
        Number(r.volume ?? 0),
        Number(r.value ?? 0),
      ].join("|"),
    )
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
