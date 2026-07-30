/**
 * Test pe formatul REAL al fișierului date_identificare_platitori_2026_a.csv
 * (reconstruit din diagnosticul de pe ecranul utilizatorului, 29.07.2026):
 * - Delimitator: ^ (caret)
 * - Header: COD_FISCAL^DENUMIRE^...^JUDET_COMERT(14)^...^STARE_FIRMA(22)^JUDET(23)^...
 * - Fără coloană CAEN
 * - Encoding: windows-1250 (diacritice legacy)
 */
import { streamImportFirms } from "../src/modules/prospects/stream";
import type { RawFirmRow } from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

const HEADER =
  "COD_FISCAL^DENUMIRE^COD_FISCAL_PARINTE^TIP_UNITATE^TIP_CONTRIB^LOCALITATE^STRADA^NR^DATA_INREGISTRARE^DATA_PRELUCRARE^FAX^SECTOR^TELEFON^JUDET_COMERT^NR_COMERT^AN_COMERT^ACT_AUTORIZARE^TVA^DATA_RADIERE^NR_INMATR^DATA_INMATR^STARE_FIRMA^JUDET^F1^F2^F3^F4^F5^F6^F7";

function makeRow(
  cui: number,
  denumire: string,
  localitate: string,
  strada: string,
  judetComert: string,
  stare: string,
  judet: string,
): string {
  return [
    cui, denumire, "", "Sediu central", "PJ", localitate, strada, "5",
    "15.05.2025", "21.05.2025 17:30:25", "0212528371", "", "252593435",
    judetComert, "123", "2005", "", "DA", "", "21784", "23.02.2006",
    stare, judet, "DA", "NU", "NU", "NU", "NU", "NU", "DA",
  ].join("^");
}

async function main() {
  const lines = [HEADER];
  // Firme de test (cu diacritice legacy în numele județului!)
  lines.push(makeRow(100, "BUCUR OBOR SA", "Bucureşti", "Sos. COLENTINA", "J40", "INREGISTRAT", "MUNICIPIUL BUCUREŞTI"));
  lines.push(makeRow(200, "MAGAZIN RĂDĂUŢI SRL", "Rădăuţi", "Str. PRINCIPALĂ", "J33", "INREGISTRAT", "SUCEAVA"));
  lines.push(makeRow(300, "BAR CENTRAL BT SRL", "Botoşani", "Str. GĂRII", "J7", "INREGISTRAT", "BOTOŞANI"));
  lines.push(makeRow(400, "FIRMA RADIATA SV SRL", "Suceava", "Str. VECHE", "J33", "RADIAT din 2019", "SUCEAVA"));
  lines.push(makeRow(500, "ALT MAGAZIN IASI SRL", "Iaşi", "Str. LĂPUŞNEANU", "J22", "INREGISTRAT", "IAŞI"));
  lines.push(makeRow(600, "ALIMENTARA FALTICENI SRL", "Fălticeni", "Str. NOUĂ", "J33", "INREGISTRAT", "SUCEAVA"));

  const content = lines.join("\r\n");

  // Encodez în windows-1250 (cum e fișierul real):
  // Notă: Node TextEncoder e doar UTF-8, deci construim manual byte-urile
  // pentru caracterele legacy (ş=0xBA în cp1250? — folosim iconv-style simplu:
  // înlocuim diacriticele cu byte-uri cp1250 corecte)
  const CP1250: Record<string, number> = {
    "ş": 0xba, "Ş": 0xaa, "ţ": 0xfe, "Ţ": 0xde,
    "ă": 0xe3, "Ă": 0xc3, "â": 0xe2, "Â": 0xc2, "î": 0xee, "Î": 0xce,
  };
  const bytes: number[] = [];
  for (const ch of content.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp < 128) bytes.push(cp);
    else if (CP1250[ch] !== undefined) bytes.push(CP1250[ch]);
    else if (ch === "ș") bytes.push(0xba); // ș modern → ş legacy poziție
    else if (ch === "Ș") bytes.push(0xaa);
    else if (ch === "ț") bytes.push(0xfe);
    else if (ch === "Ț") bytes.push(0xde);
    else bytes.push(0x3f); // ?
  }
  const blob = new Blob([new Uint8Array(bytes)]);

  const rows: RawFirmRow[] = [];
  const result = await streamImportFirms(blob, {
    counties: ["SV", "BT"],
    onBatch: async (r) => {
      rows.push(...r);
    },
  });

  console.log("Diagnostic:", JSON.stringify(result.diagnostic?.columnMap));
  console.log("County top:", JSON.stringify(result.diagnostic?.countyTop));
  console.log("Rows:", rows.map((r) => `${r.cui}:${r.denumire}(${r.judet})`).join(", "));

  check("fără eroare", !result.error, result.error);
  // Așteptat: 200 (SV), 300 (BT), 600 (SV) — active + SV/BT
  // 100=B, 400=radiat, 500=IS
  check("3 potriviri (SV+BT active)", result.matched === 3, `(${result.matched})`);
  check(
    "CUI-urile corecte",
    rows.map((r) => r.cui).sort().join(",") === "200,300,600",
    rows.map((r) => r.cui).join(","),
  );
  check(
    "județ mapat din coloana 23 (JUDET), nu 14 (JUDET_COMERT)",
    result.diagnostic?.columnMap.judet === 22, // 0-indexed
    `col ${((result.diagnostic?.columnMap.judet ?? -1) as number) + 1}`,
  );
  check(
    "diacriticele windows-1250 decodate (Botoşani→BT)",
    rows.some((r) => r.judet === "BT"),
  );
  check(
    "CAEN nemapat (fișierul nu are coloana; ANAF o aduce)",
    result.diagnostic?.columnMap.caen === undefined,
  );
  check(
    "firma radiată exclusă",
    !rows.some((r) => r.cui === "400"),
  );
  check(
    "stare mapată pe col 22",
    result.diagnostic?.columnMap.stare === 21,
    `col ${((result.diagnostic?.columnMap.stare ?? -1) as number) + 1}`,
  );

  console.log("\n" + "=".repeat(60));
  console.log(ok ? "✅ FORMATUL REAL MF FUNCȚIONEAZĂ" : "❌ TESTE EȘUATE");
  console.log("=".repeat(60));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
