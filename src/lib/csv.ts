/**
 * O celulă de CSV, făcută inofensivă (protecție anti „CSV/formula injection”).
 *
 * Excel/LibreOffice execută ca formulă orice celulă care începe cu = + - @
 * (sau tab). Un client cu numele „=cmd|'/c calc'!A1” ar rula cod pe
 * calculatorul contabilei când deschide exportul. Prefixăm cu un apostrof:
 * programul afișează textul, nu-l mai execută. Separatorul nostru e „;”,
 * deci îl schimbăm în virgulă în text, iar rândurile noi devin spații.
 *
 * Un singur loc pentru regula asta de securitate — ca să nu dividă între
 * exporturi (comenzi, decont, orice viitor).
 */
export function csvCell(value: unknown): string {
  let s = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/;/g, ",");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}
