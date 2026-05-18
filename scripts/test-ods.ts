import * as XLSX from "xlsx";
import { parseXLSBuffer } from "../src/lib/parse-xls";

async function main() {
  // Construiește un workbook și scrie-l ca ODS, apoi parsează
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Data", "Agent", "Grupa", "Client", "Cantitate"],
    [45748, "Gavrilet Bogdan", "BRITISH (BAT)", "Carrefour", 9164],
    [45749, "Cojocaru Razvan", "PHILIP MORRIS", "Lidl", 5809],
    [45750, "Costin Vlad", "JTI", "Profi", 4493],
  ]), "Vanzari");

  // Write as ODS
  const odsBuf = XLSX.write(wb, { type: "array", bookType: "ods" }) as ArrayBuffer;
  console.log("ODS buffer size:", odsBuf.byteLength, "bytes");

  const result = await parseXLSBuffer(odsBuf);
  console.log("\nRezultat parsare .ods:");
  console.log(`  Rânduri: ${result.rows.length}`);
  console.log(`  Mapping: ${JSON.stringify(result.mapping)}`);
  console.log(`  Headers: ${JSON.stringify(result.headers)}`);
  if (result.rows.length > 0) {
    console.log(`  Primul rând:`, JSON.stringify(result.rows[0]));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
