/**
 * Teste pentru datele de contact: telefon din fișier MF (coloană TELEFON),
 * adresă completă (STRADA + NR), normalizare telefon.
 */
import {
  normalizePhone,
  streamImportFirms,
  type RawFirmRow,
} from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

async function main() {
  console.log("\n=== normalizePhone ===");
  check("0230123456 rămâne", normalizePhone("0230123456") === "0230123456");
  check("spații curățate", normalizePhone("0745 123 456") === "0745123456");
  check("format cu paranteze", normalizePhone("(0230) 52-14-33") === "0230521433");
  check("prefix internațional păstrat", normalizePhone("+40745123456") === "+40745123456");
  check(
    "9 cifre fără 0 → prefixat cu 0",
    normalizePhone("745123456") === "0745123456",
    normalizePhone("745123456"),
  );
  check("prea scurt respins", normalizePhone("123") === "");
  check("zerouri respinse", normalizePhone("000000") === "");
  check("gol → gol", normalizePhone("") === "");
  check("gunoi text → gol", normalizePhone("nu are") === "");
  check(
    "mai multe numere → primul",
    normalizePhone("0230111222, 0745333444") === "0230111222",
    normalizePhone("0230111222, 0745333444"),
  );

  console.log("\n=== Import cu TELEFON + STRADA/NR (format MF real) ===");
  const HEADER =
    "COD_FISCAL^DENUMIRE^LOCALITATE^STRADA^NR^FAX^TELEFON^STARE_FIRMA^JUDET";
  const lines = [
    HEADER,
    "111^ALIMENTARA CENTRAL SRL^Suceava^Str. Ana Ipătescu^12^0230111111^0230521433^INREGISTRAT^SUCEAVA",
    "222^BAR LA CURTE SRL^Botoșani^Calea Națională^45B^^0745 987 654^INREGISTRAT^BOTOȘANI",
    "333^FIRMA FARA TEL SRL^Rădăuți^Str. Ștefan cel Mare^7^^^INREGISTRAT^SUCEAVA",
  ];
  const rows: RawFirmRow[] = [];
  const res = await streamImportFirms(new Blob([lines.join("\n")]), {
    onBatch: async (r) => rows.push(...r),
  });
  check("3 firme importate", res.matched === 3, `(${res.matched}) err=${res.error ?? "-"}`);
  const byCui = new Map(rows.map((r) => [r.cui, r]));
  check(
    "telefon extras din coloana TELEFON (nu FAX)",
    byCui.get("111")?.telefon === "0230521433",
    byCui.get("111")?.telefon,
  );
  check(
    "telefon cu spații normalizat",
    byCui.get("222")?.telefon === "0745987654",
    byCui.get("222")?.telefon,
  );
  check(
    "firmă fără telefon → câmp gol, nu eroare",
    byCui.get("333")?.telefon === "",
    `"${byCui.get("333")?.telefon}"`,
  );
  check(
    "adresă = STRADA + nr. NR",
    byCui.get("111")?.adresa === "Str. Ana Ipătescu nr. 12",
    byCui.get("111")?.adresa,
  );
  check(
    "număr alfanumeric (45B) inclus",
    byCui.get("222")?.adresa === "Calea Națională nr. 45B",
    byCui.get("222")?.adresa,
  );
  check(
    "coloana NR nu se confundă cu NR_COMERT",
    !rows.some((r) => r.adresa.includes("nr. 2005")),
  );

  // Fișier fără coloană NR → adresa rămâne strada simplă
  const noNr = [
    "CUI^DENUMIRE^ADRESA^JUDET^STARE_FIRMA",
    "444^TEST SRL^Str. Unirii 99^SUCEAVA^INREGISTRAT",
  ];
  const rows2: RawFirmRow[] = [];
  await streamImportFirms(new Blob([noNr.join("\n")]), {
    onBatch: async (r) => rows2.push(...r),
  });
  check(
    "fără coloană NR → adresa neschimbată",
    rows2[0]?.adresa === "Str. Unirii 99",
    rows2[0]?.adresa,
  );

  console.log("\n" + "=".repeat(60));
  console.log(ok ? "✅ DATE DE CONTACT OK" : "❌ TESTE EȘUATE");
  console.log("=".repeat(60));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
