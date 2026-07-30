/**
 * Teste pentru modul „platformă pentru toate domeniile":
 * import fără filtre, etichete CAEN pentru orice diviziune, județe complete.
 */
import {
  caenLabel,
  COUNTY_LIST,
  countyName,
  normalizeCounty,
  streamImportFirms,
  TARGET_COUNTIES,
  type RawFirmRow,
} from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

async function main() {
  // Fixture: 5 județe × 5 domenii, format MF-like cu caret și JUDET la final
  const HEADER = "COD_FISCAL^DENUMIRE^COD_CAEN^STRADA^LOCALITATE^STARE_FIRMA^JUDET";
  const lines = [HEADER];
  const judete = ["SUCEAVA", "BOTOSANI", "IASI", "CLUJ", "MUNICIPIUL BUCURESTI"];
  const caens = ["4711", "5630", "6201", "4120", "8621"];
  for (let i = 0; i < 500; i++) {
    lines.push(
      [
        1000 + i,
        `FIRMA ${i} SRL`,
        caens[i % caens.length],
        `STR. ${i}`,
        `LOC${i % 20}`,
        i % 50 === 0 ? "RADIAT" : "INREGISTRAT",
        judete[i % judete.length],
      ].join("^"),
    );
  }
  const blob = new Blob([lines.join("\n")]);

  // 1. Import FĂRĂ filtre = tot ce e activ
  const all: RawFirmRow[] = [];
  const rAll = await streamImportFirms(blob, {
    onBatch: async (r) => all.push(...r),
  });
  const expectedActive = 500 - Math.ceil(500 / 50);
  check(
    "import fără filtre: toate firmele active, toate județele",
    rAll.matched === expectedActive,
    `(${rAll.matched} vs ${expectedActive})`,
  );
  const countiesFound = new Set(all.map((r) => r.judet));
  check(
    "5 județe distincte importate",
    countiesFound.size === 5,
    Array.from(countiesFound).join(","),
  );
  check("București normalizat la B", countiesFound.has("B"));
  const domainsFound = new Set(all.map((r) => r.caen));
  check(
    "5 domenii distincte (nu doar FMCG)",
    domainsFound.size === 5,
    Array.from(domainsFound).join(","),
  );

  // 2. Import cu filtru pe județe (preset SV+BT)
  const svbt: RawFirmRow[] = [];
  const rSvBt = await streamImportFirms(blob, {
    counties: TARGET_COUNTIES,
    onBatch: async (r) => svbt.push(...r),
  });
  check(
    "filtru județe funcționează încă",
    svbt.every((r) => r.judet === "SV" || r.judet === "BT") && rSvBt.matched > 0,
    `(${rSvBt.matched})`,
  );

  // 3. Import cu filtru CAEN explicit
  const fmcg: RawFirmRow[] = [];
  await streamImportFirms(blob, {
    caens: ["4711", "5630"],
    onBatch: async (r) => fmcg.push(...r),
  });
  check(
    "filtru CAEN funcționează",
    fmcg.length > 0 && fmcg.every((r) => ["4711", "5630"].includes(r.caen)),
    `(${fmcg.length})`,
  );

  // 4. skipInactive = false → include radiatele
  let withRadiate = 0;
  await streamImportFirms(blob, {
    skipInactive: false,
    onBatch: async (r) => {
      withRadiate += r.length;
    },
  });
  check(
    "skipInactive=false include radiatele",
    withRadiate === 500,
    `(${withRadiate})`,
  );

  // 5. Etichete CAEN pentru orice domeniu
  check("caenLabel(6201) → IT", caenLabel("6201").includes("IT"), caenLabel("6201"));
  check(
    "caenLabel(4120) → Construcții",
    caenLabel("4120").includes("Construcții"),
    caenLabel("4120"),
  );
  check(
    "caenLabel(8621) → Sănătate",
    caenLabel("8621").includes("Sănătate"),
    caenLabel("8621"),
  );
  check(
    "caenLabel(4711) → descriere detaliată FMCG",
    caenLabel("4711").includes("alimentare"),
    caenLabel("4711").slice(0, 40),
  );
  check("caenLabel('') → gol", caenLabel("") === "");

  // 6. Județe: lista completă + normalizări
  check("42 județe în listă", COUNTY_LIST.length === 42, `(${COUNTY_LIST.length})`);
  check("countyName(SV) = Suceava", countyName("SV") === "Suceava");
  check("normalizeCounty('CLUJ') = CJ", normalizeCounty("CLUJ") === "CJ");
  check("normalizeCounty('Iasi') = IS", normalizeCounty("Iasi") === "IS");
  check(
    "normalizeCounty('JUDETUL TIMIS') = TM",
    normalizeCounty("JUDETUL TIMIS") === "TM",
    normalizeCounty("JUDETUL TIMIS"),
  );
  check("normalizeCounty('Ilfov') = IF", normalizeCounty("Ilfov") === "IF");
  check("normalizeCounty('33') = SV (numeric)", normalizeCounty("33") === "SV");

  console.log("\n" + "=".repeat(60));
  console.log(ok ? "✅ PLATFORMĂ MULTI-DOMENIU OK" : "❌ TESTE EȘUATE");
  console.log("=".repeat(60));
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
