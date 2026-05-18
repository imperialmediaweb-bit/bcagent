import * as XLSX from "xlsx";
import { parseXLSBuffer } from "../src/lib/parse-xls";

function toAB(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

async function main() {
  // Test 1: header pe rândul 3
  const wb1 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb1, XLSX.utils.aoa_to_sheet([
    ["RAPORT VANZARI - APRILIE 2026"],
    [],
    ["Data", "Agent", "Grupa", "Client", "Cantitate"],
    [45748, "Gavrilet Bogdan", "BRITISH (BAT)", "Carrefour", 100],
    [45749, "Cojocaru Razvan", "PHILIP MORRIS", "Lidl", 50],
  ]), "Vanzari");
  const r1 = await parseXLSBuffer(toAB(wb1));
  console.log(`\n=== T1: header rândul 3 ===`);
  console.log(`Rânduri: ${r1.rows.length} (target: 2), header rândul: ${r1.diagnostic?.headerRow}`);
  console.log(`Mapping: ${JSON.stringify(r1.mapping)}`);

  // Test 2: multiple foi, date doar în a doua
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([["Note"], ["text"]]), "Note");
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([
    ["Data document", "Agent vanzari", "Producator", "Client", "Cantitate"],
    [45748, "Costin Vlad", "JTI", "Profi", 75],
    [45750, "Volanschi Robert", "KING", "Mega", 30],
  ]), "Detalii");
  const r2 = await parseXLSBuffer(toAB(wb2));
  console.log(`\n=== T2: date în foaia 2 ===`);
  console.log(`Rânduri: ${r2.rows.length} (target: 2), foaia: ${r2.diagnostic?.sheetUsed}`);
  console.log(`Mapping: ${JSON.stringify(r2.mapping)}`);

  // Test 3: format Saga
  const wb3 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb3, XLSX.utils.aoa_to_sheet([
    ["Nr", "Doc", "Data emiterii", "Partener", "Cod produs", "Denumire produs", "U.M.", "Cant.", "Pret unit.", "Valoare", "TVA", "Total", "Reprezentant"],
    [1, "F001", 45748, "Carrefour Iasi", "P001", "Marlboro Red", "buc", 50, 15.5, 775, 147, 922, "Gavrilet Bogdan"],
    [2, "F002", 45749, "Lidl Suceava", "P002", "Camel Blue", "buc", 30, 14.2, 426, 80, 506, "Cojocaru Razvan"],
  ]), "Vanzari detaliate");
  const r3 = await parseXLSBuffer(toAB(wb3));
  console.log(`\n=== T3: format Saga (13 col) ===`);
  console.log(`Rânduri: ${r3.rows.length} (target: 2)`);
  console.log(`Mapping: ${JSON.stringify(r3.mapping)}`);
  if (r3.rows.length > 0) console.log(`Primul rând:`, JSON.stringify(r3.rows[0]));

  // Test 4: header total invalid
  const wb4 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb4, XLSX.utils.aoa_to_sheet([
    ["x", "y", "z"],
    ["a", "b", "c"],
  ]), "S1");
  const r4 = await parseXLSBuffer(toAB(wb4));
  console.log(`\n=== T4: header invalid → diagnostic ===`);
  console.log(`Rânduri: ${r4.rows.length} (target: 0)`);
  console.log(`Sheets: ${JSON.stringify(r4.diagnostic?.sheetNames)}`);
  console.log(`Sample row count: ${r4.diagnostic?.sample?.length}`);
  console.log(`Candidates count: ${r4.diagnostic?.candidates?.length ?? 0}`);
}
main().catch(e => { console.error(e); process.exit(1); });
