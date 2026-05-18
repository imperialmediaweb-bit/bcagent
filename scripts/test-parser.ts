/**
 * End-to-end test: generează un XLS realist (vânzări țigări, aprilie 2026,
 * 5 agenți, branduri BAT/PM/JTI/KING/DENIM, plus storno și "- IMPLICIT -"),
 * apoi rulează parserul și analytics-ul exact ca în browser.
 *
 * Run: pnpm dlx tsx scripts/test-parser.ts
 */
import * as XLSX from "xlsx";
import {
  aggregateByDimension,
  agentEfficiency,
  computeTotals,
  crossTab,
  findAnomalies,
  hasValueData,
} from "../src/lib/analytics";
import { parseXLSBuffer, detectColumns } from "../src/lib/parse-xls";

interface ExpectedAgent {
  name: string;
  expectedUnits: number;
}

const AGENTS: ExpectedAgent[] = [
  { name: "Gavrilet Bogdan", expectedUnits: 9164 },
  { name: "Cojocaru Răzvan", expectedUnits: 5809 },
  { name: "Costin Vlad", expectedUnits: 4493 },
  { name: "Călinciuc Gabriel", expectedUnits: 4054 },
  { name: "Volanschi Robert", expectedUnits: 2478 },
];

const BRANDS = [
  { name: "BRITISH (BAT)", weight: 10547 },
  { name: "PHILIP MORRIS", weight: 5169 },
  { name: "JTI", weight: 3561 },
  { name: "KING", weight: 2369 },
  { name: "DENIM", weight: 2045 },
  { name: "DAVIDOFF", weight: 1200 },
  { name: "WINSTON", weight: 800 },
  { name: "MARLBORO", weight: 307 },
];

const CLIENTS = [
  "Carrefour Iași",
  "Lidl Suceava",
  "Profi Botoșani",
  "Mega Image Iași",
  "Auchan Vaslui",
  "Penny Roman",
  "Selgros Iași",
  "Tabac SRL",
  "Distribu Plus",
  "Express Market",
];

function seedRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateRows() {
  const rand = seedRand(2026);
  const rows: Array<Record<string, unknown>> = [];

  // Pentru fiecare agent, generăm tranzacții proporțional cu targetul lor
  for (const agent of AGENTS) {
    let remaining = agent.expectedUnits;
    // Numărul de tranzacții variază
    const txCount = 40 + Math.floor(rand() * 60);
    // Weighted brand pick (BAT > PM > JTI > KING > DENIM > ...)
    const totalWeight = BRANDS.reduce((s, b) => s + b.weight, 0);
    const pickBrand = () => {
      let r = rand() * totalWeight;
      for (const b of BRANDS) {
        r -= b.weight;
        if (r <= 0) return b;
      }
      return BRANDS[BRANDS.length - 1];
    };
    for (let t = 0; t < txCount && remaining > 0; t++) {
      const brand = pickBrand();
      const client = CLIENTS[Math.floor(rand() * CLIENTS.length)];
      // Cantități realiste — cartușe/baxuri de țigări
      const target = Math.max(
        1,
        Math.min(remaining, Math.floor(rand() * 200) + 5),
      );
      // Excel serial dates pentru aprilie 2026 (1-30 aprilie)
      const day = 1 + Math.floor(rand() * 30);
      const excelSerial = dateToExcelSerial(new Date(Date.UTC(2026, 3, day)));
      rows.push({
        "Data document": excelSerial,
        Agent: agent.name,
        Grupa: brand.name,
        Client: client,
        Cantitate: target,
      });
      remaining -= target;
    }
  }

  // Storno: -10 DAVIDOFF la Costin Vlad
  rows.push({
    "Data document": dateToExcelSerial(new Date(Date.UTC(2026, 3, 15))),
    Agent: "Costin Vlad",
    Grupa: "DAVIDOFF",
    Client: "Tabac SRL",
    Cantitate: -10,
  });

  // 35 buc "- IMPLICIT -" la Costin Vlad (produse fără grupă)
  rows.push({
    "Data document": dateToExcelSerial(new Date(Date.UTC(2026, 3, 20))),
    Agent: "Costin Vlad",
    Grupa: "- IMPLICIT -",
    Client: "Express Market",
    Cantitate: 35,
  });

  return rows;
}

function dateToExcelSerial(d: Date): number {
  // Excel serial: zile de la 1899-12-30 (UTC)
  const epoch = Date.UTC(1899, 11, 30);
  return Math.floor((d.getTime() - epoch) / 86400000);
}

function buildWorkbook(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  // Marchez coloana Data document ca date pentru serializare corectă
  for (let r = 2; r <= rows.length + 1; r++) {
    const ref = XLSX.utils.encode_cell({ c: 0, r: r - 1 });
    if (ws[ref]) ws[ref].t = "n";
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vânzări");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer;
}

function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) console.log(`   actual:   ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
  return ok;
}

function assertCmp(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  return cond;
}

async function main() {
  let ok = true;
  console.log("\n=== 1. Generare XLS realist (țigări aprilie 2026) ===\n");
  const rows = generateRows();
  console.log(`   Generat ${rows.length} rânduri de tranzacții`);
  const buf = buildWorkbook(rows);
  console.log(`   XLS buffer: ${buf.byteLength} bytes\n`);

  console.log("=== 2. Test detectColumns() pe headere romanești ===\n");
  const detected = detectColumns([
    "Data document",
    "Agent",
    "Grupa",
    "Client",
    "Cantitate",
  ]);
  console.log("   Detectat:", JSON.stringify(detected, null, 2));
  ok = assertEq("date detectat ca 'Data document'", detected.date, "Data document") && ok;
  ok = assertEq("agent detectat ca 'Agent'", detected.agent, "Agent") && ok;
  ok = assertEq("client detectat ca 'Client'", detected.client, "Client") && ok;
  ok = assertEq("volume detectat ca 'Cantitate'", detected.volume, "Cantitate") && ok;
  // "Grupa" trebuie să mapeze la producer prin substring/alias — verific
  ok = assertCmp(
    "producer detectat (din 'Grupa' via fallback)",
    !!detected.producer,
    detected.producer || "(nedetectat)",
  ) && ok;

  console.log("\n=== 3. Test detectColumns() cu diacritice ===\n");
  const detectedDiacr = detectColumns([
    "Data vânzării",
    "Agent vânzări",
    "Producător",
    "Client",
    "Cantitate netă",
    "Valoare totală",
  ]);
  console.log("   Detectat:", JSON.stringify(detectedDiacr, null, 2));
  ok = assertCmp("agent detectat cu diacritice", !!detectedDiacr.agent, detectedDiacr.agent) && ok;
  ok = assertCmp("producer detectat cu diacritice", !!detectedDiacr.producer, detectedDiacr.producer) && ok;
  ok = assertCmp("value detectat cu diacritice", !!detectedDiacr.value, detectedDiacr.value) && ok;

  console.log("\n=== 4. Test parseXLSBuffer() ===\n");
  const result = await parseXLSBuffer(buf);
  console.log(`   Rânduri procesate: ${result.rows.length}`);
  console.log(`   Skipped: ${result.skipped}`);
  console.log("   Mapping:", JSON.stringify(result.mapping));
  ok = assertCmp(
    "minim 250 rânduri parsate",
    result.rows.length > 250,
    `(${result.rows.length})`,
  ) && ok;
  ok = assertCmp("0 rânduri skipped (toate au date valide)", result.skipped === 0) && ok;
  ok = assertCmp(
    "date parsate ca obiecte Date",
    result.rows.every((r) => r.date instanceof Date && !isNaN(r.date.getTime())),
  ) && ok;
  // Verifică că datele sunt în aprilie 2026
  const months = new Set(result.rows.map((r) => r.date.getMonth()));
  ok = assertCmp(
    "toate datele în aprilie (month=3)",
    months.size === 1 && months.has(3),
    `months: ${Array.from(months).join(",")}`,
  ) && ok;

  console.log("\n=== 5. Test computeTotals() ===\n");
  const totals = computeTotals(result.rows);
  console.log("   Totaluri:", JSON.stringify(totals));
  ok = assertCmp(
    "value=0 (no value column → volume mode)",
    totals.value === 0,
  ) && ok;
  ok = assertCmp(
    "returns >= 1 (storno detectat)",
    totals.returns >= 1,
    `(${totals.returns})`,
  ) && ok;
  ok = assertCmp(
    "volume total > 20000 buc",
    totals.volume > 20000,
    `(${totals.volume})`,
  ) && ok;

  console.log("\n=== 6. Test hasValueData() — mod cantitate ===\n");
  const hasVal = hasValueData(result.rows);
  ok = assertEq("hasValueData = false (XLS fără valoare)", hasVal, false) && ok;

  console.log("\n=== 7. Test aggregateByDimension(agent, volume) ===\n");
  const byAgent = aggregateByDimension(result.rows, "agent", "volume");
  console.log("   Top 5 agenți (ordine):");
  byAgent.slice(0, 5).forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.key} — ${a.volume} buc`);
  });
  ok = assertEq(
    "primul agent = Gavrilet Bogdan",
    byAgent[0]?.key,
    "Gavrilet Bogdan",
  ) && ok;
  ok = assertCmp(
    "5 agenți distincți",
    byAgent.filter((a) => a.key !== "(necunoscut)").length === 5,
  ) && ok;

  console.log("\n=== 8. Test aggregateByDimension(producer, volume) — branduri ===\n");
  const byBrand = aggregateByDimension(result.rows, "producer", "volume");
  console.log("   Top 5 branduri:");
  byBrand.slice(0, 5).forEach((b, i) => {
    console.log(`   ${i + 1}. ${b.key} — ${b.volume} buc`);
  });
  ok = assertCmp(
    "BRITISH (BAT) e top brand",
    byBrand[0]?.key === "BRITISH (BAT)",
    byBrand[0]?.key,
  ) && ok;

  console.log("\n=== 9. Test findAnomalies() — storno + IMPLICIT ===\n");
  const anomalies = findAnomalies(result.rows);
  const byType = anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log("   Anomalii detectate:", JSON.stringify(byType));
  ok = assertCmp("≥1 storno detectat", (byType.return ?? 0) >= 1) && ok;
  ok = assertCmp("≥1 IMPLICIT detectat", (byType.implicit ?? 0) >= 1) && ok;

  console.log("\n=== 10. Test crossTab(agent×producer) ===\n");
  const matrix = crossTab(result.rows, "agent", "producer", "volume", 8, 5);
  console.log(`   Matrix: ${matrix.rows.length} agenți × ${matrix.cols.length} branduri`);
  console.log("   Grand total:", matrix.grandTotal);
  ok = assertCmp(
    "matrix are ≥5 agenți",
    matrix.rows.length >= 5,
  ) && ok;
  ok = assertCmp(
    "matrix are ≥5 branduri",
    matrix.cols.length >= 5,
  ) && ok;
  ok = assertCmp(
    "intensitate funcționează (max > 0)",
    matrix.max > 0,
  ) && ok;

  console.log("\n=== 11. Test agentEfficiency() ===\n");
  const eff = agentEfficiency(result.rows, "month", "volume");
  console.log("   Eficiență agenți:");
  eff.slice(0, 5).forEach((e) => {
    console.log(
      `   ${e.agent} — vol=${e.volume}, clienți=${e.uniqueClients}, tranz=${e.transactions}, perioade=${e.activePeriods}`,
    );
  });
  ok = assertCmp(
    "Gavrilet top după volum",
    eff[0]?.agent === "Gavrilet Bogdan",
    eff[0]?.agent,
  ) && ok;
  ok = assertCmp(
    "fiecare agent are clienți unici > 0",
    eff.every((e) => e.uniqueClients > 0),
  ) && ok;

  console.log("\n=== 12. Test format românesc cu virgulă ===\n");
  // Simulez ce ar veni dintr-un XLS cu valori "1.234,56"
  const stringRows: Array<Record<string, unknown>> = [
    {
      Data: "15.04.2026",
      Agent: "Test Agent",
      Producator: "Test Brand",
      Client: "Test Client",
      Cantitate: "1.234",
      Valoare: "5.678,90",
    },
  ];
  const ws2 = XLSX.utils.json_to_sheet(stringRows);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws2, "T");
  const buf2raw = XLSX.write(wb2, { type: "array", bookType: "xlsx" });
  const buf2 = buf2raw instanceof ArrayBuffer ? buf2raw : (buf2raw as Uint8Array).buffer;
  const r2 = await parseXLSBuffer(buf2);
  console.log("   Parsed:", JSON.stringify(r2.rows, null, 2));
  ok = assertCmp(
    "dată 'dd.mm.yyyy' parsată corect (15 aprilie 2026)",
    r2.rows[0]?.date.getDate() === 15 &&
      r2.rows[0]?.date.getMonth() === 3 &&
      r2.rows[0]?.date.getFullYear() === 2026,
    `${r2.rows[0]?.date.toISOString()}`,
  ) && ok;
  ok = assertCmp(
    "valoare '5.678,90' → 5678.90",
    Math.abs((r2.rows[0]?.value ?? 0) - 5678.9) < 0.01,
    `(${r2.rows[0]?.value})`,
  ) && ok;
  ok = assertCmp(
    "cantitate '1.234' → 1234 (mii separator)",
    r2.rows[0]?.volume === 1234,
    `(${r2.rows[0]?.volume})`,
  ) && ok;

  console.log("\n=== 13. Test edge case: XLS gol ===\n");
  const wbEmpty = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbEmpty, XLSX.utils.json_to_sheet([]), "S");
  const bufEmpty = XLSX.write(wbEmpty, { type: "array", bookType: "xlsx" });
  const bufEmptyAB =
    bufEmpty instanceof ArrayBuffer ? bufEmpty : (bufEmpty as Uint8Array).buffer;
  const rEmpty = await parseXLSBuffer(bufEmptyAB);
  ok = assertCmp(
    "XLS gol → 0 rânduri, no crash",
    rEmpty.rows.length === 0,
  ) && ok;

  console.log("\n" + "=".repeat(60));
  console.log(ok ? "✅ TOATE TESTELE TRECUTE" : "❌ UNELE TESTE AU EȘUAT");
  console.log("=".repeat(60));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("CRASH:", e);
  process.exit(2);
});
