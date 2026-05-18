import * as XLSX from "xlsx";
import { parseXLSBuffer } from "../src/lib/parse-xls";
import { computeTotals, aggregateByDimension, findAnomalies } from "../src/lib/analytics";

async function main() {
  // Reproduce EXACT formatul SAGA primit de la user
  const data: unknown[][] = [
    ["Iesiri marfuri pe documente"],
    [],
    [],
    [],
    [],
    ["Agent (din doc.):  Calinciuc Gabriel, Gavrilet Bogdan, Cojocaru Razvan, Volanschi Robert, Costin Vlad"],
    ["Perioada:  01.04.2026..30.04.2026"],
    ["Tip marfa:  Alte materiale consumabile (3028)"],
    ["Tip document:  Factura"],
    ["Discount separat de pret"],
    [],
    ["Agent", "Nume grupa", "Cantitate"],
    ["", "BRITISH", "1.529,00"],
    ["", "CARPATI", 20],
    ["", "DAVIDOFF", 2],
    ["", "DENIM", 491],
    ["", "HTS Hongta", 136],
    ["", "JTI", 563],
    ["", "KING", 40],
    ["", "PHILIP MORIS", "1.273,00"],
    ["T:Calinciuc Gabriel", "", "4.054,00"],
    ["", "BRITISH", "2.320,00"],
    ["", "DAVIDOFF", 159],
    ["", "DENIM", 580],
    ["", "HTS Hongta", 110],
    ["", "JTI", "1.423,00"],
    ["", "KING", 840],
    ["", "PHILIP MORIS", 347],
    ["", "SOLO", 30],
    ["T:Cojocaru Razvan", "", "5.809,00"],
    ["", "- IMPLICIT -", 35],
    ["", "BRITISH", "1.497,00"],
    ["", "CARPATI", 70],
    ["", "DAVIDOFF", -10],
    ["", "DENIM", 209],
    ["", "ELF BAR", 20],
    ["", "HTS Hongta", 544],
    ["", "JTI", 588],
    ["", "KING", 569],
    ["", "PHILIP MORIS", 951],
    ["", "UVERTURA", 20],
    ["T:Costin Vlad", "", "4.493,00"],
    ["", "BRITISH", "4.678,00"],
    ["", "DAVIDOFF", 285],
    ["", "DENIM", 550],
    ["", "HTS Hongta", 565],
    ["", "JTI", 335],
    ["", "KING", 665],
    ["", "PHILIP MORIS", "2.086,00"],
    ["T:Gavrilet Bogdan", "", "9.164,00"],
    ["", "BRITISH", 523],
    ["", "DAVIDOFF", 230],
    ["", "DENIM", 215],
    ["", "HTS Hongta", 91],
    ["", "JTI", 652],
    ["", "KING", 255],
    ["", "PHILIP MORIS", 512],
    ["T:Volanschi Robert", "", "2.478,00"],
    ["Total general:", "", "25.998,00"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const result = await parseXLSBuffer(buf);
  console.log("\n=== Parsare ===");
  console.log(`Rânduri: ${result.rows.length}`);
  console.log(`Mapping: ${JSON.stringify(result.mapping)}`);
  console.log(`Foaia: ${result.diagnostic?.sheetUsed}, header rândul: ${result.diagnostic?.headerRow}`);
  if (result.rows.length > 0) {
    console.log(`Primul rând:`, JSON.stringify(result.rows[0]));
    console.log(`Ultimul rând:`, JSON.stringify(result.rows[result.rows.length - 1]));
  }

  console.log("\n=== Totaluri ===");
  const totals = computeTotals(result.rows);
  console.log(`Volum total: ${totals.volume} (target: 25.998)`);
  console.log(`Clienți unici: ${totals.clients} (target: 0, doar pivot fără clienți)`);
  console.log(`Tranzacții: ${totals.transactions}`);
  console.log(`Storno: ${totals.returns}`);

  console.log("\n=== Top agenți ===");
  const byAgent = aggregateByDimension(result.rows, "agent", "volume");
  byAgent.forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.key}: ${a.volume} buc`);
  });

  console.log("\n=== Top branduri ===");
  const byProducer = aggregateByDimension(result.rows, "producer", "volume").slice(0, 5);
  byProducer.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.key}: ${b.volume} buc`);
  });

  console.log("\n=== Anomalii ===");
  const anom = findAnomalies(result.rows);
  const byType = anom.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify(byType));

  // Verificări target
  console.log("\n=== VERIFICĂRI ===");
  const expectedAgents = {
    "Calinciuc Gabriel": 4054,
    "Cojocaru Razvan": 5809,
    "Costin Vlad": 4493,
    "Gavrilet Bogdan": 9164,
    "Volanschi Robert": 2478,
  };
  let okCount = 0;
  for (const [name, expected] of Object.entries(expectedAgents)) {
    const actual = byAgent.find(a => a.key === name)?.volume ?? 0;
    const ok = actual === expected;
    console.log(`  ${ok ? "✅" : "❌"} ${name}: ${actual} (target ${expected})`);
    if (ok) okCount++;
  }
  console.log(`\nTotal verificat ${okCount}/${Object.keys(expectedAgents).length} agenți.`);
}
main().catch(e => { console.error(e); process.exit(1); });
