import { normalizeCounty, splitDelimited, streamImportFirms } from "../src/modules/prospects";
import type { RawFirmRow } from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

// Coduri numerice
check("33 → SV", normalizeCounty("33") === "SV");
check("7 → BT", normalizeCounty("7") === "BT");
check("07 → BT", normalizeCounty("07") === "BT");
check("33.0 → SV", normalizeCounty("33.0") === "SV");
check("22 → IS", normalizeCounty("22") === "IS");
check("40 → B", normalizeCounty("40") === "B");
check("SV rămâne SV", normalizeCounty("SV") === "SV");
check("Suceava → SV", normalizeCounty("Suceava") === "SV");

// splitDelimited cu ghilimele
const r1 = splitDelimited('"FIRMA X, SRL",123,"STR. A, NR. 5",SV', ",");
check("CSV cu ghilimele: 4 câmpuri", r1.length === 4, JSON.stringify(r1));
check("virgula din nume păstrată", r1[0] === "FIRMA X, SRL", r1[0]);
const r2 = splitDelimited('a|b|c', "|");
check("fast-path fără ghilimele", r2.length === 3);
const r3 = splitDelimited('"escaped ""quotes"" here",x', ",");
check("ghilimele escapate", r3[0] === 'escaped "quotes" here', r3[0]);

// Streaming cu județe numerice (formatul probabil real al fișierului MF)
async function main() {
  const lines = ["CUI,DENUMIRE,COD_CAEN,ADRESA,JUDET,LOCALITATE,STARE_FIRMA"];
  for (let i = 0; i < 1000; i++) {
    const judNum = [33, 7, 22, 12, 40][i % 5]; // SV, BT, IS, CJ, B numeric!
    const caen = ["4711", "5630", "6201"][i % 3];
    lines.push(
      `${200000 + i},"FIRMA ${i}, SRL",${caen},"STR. T ${i}",${judNum},LOC${i % 10},INREGISTRAT`,
    );
  }
  // SV(33) și BT(7) apar la i%5==0 și i%5==1; CAEN țintă la i%3==0,1 (4711, 5630)
  let expected = 0;
  for (let i = 0; i < 1000; i++) {
    const isTargetCounty = i % 5 === 0 || i % 5 === 1;
    const isTargetCaen = i % 3 === 0 || i % 3 === 1;
    if (isTargetCounty && isTargetCaen) expected++;
  }
  const rows: RawFirmRow[] = [];
  const result = await streamImportFirms(new Blob([lines.join("\n")]), {
    onBatch: async (r) => {
      rows.push(...r);
    },
  });
  check(
    `streaming cu județe NUMERICE: ${expected} potriviri`,
    result.matched === expected,
    `(${result.matched}, err=${result.error ?? "-"})`,
  );
  check(
    "denumirile cu virgulă intacte",
    rows.every((r) => r.denumire.includes(", SRL")),
    rows[0]?.denumire,
  );
  check(
    "diagnostic prezent cu countyTop",
    !!result.diagnostic && result.diagnostic.countyTop.length > 0,
    JSON.stringify(result.diagnostic?.countyTop.slice(0, 3)),
  );

  console.log("\n" + "=".repeat(60));
  console.log(ok ? "✅ COUNTY FORMATS + QUOTES OK" : "❌ TESTE EȘUATE");
  console.log("=".repeat(60));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
