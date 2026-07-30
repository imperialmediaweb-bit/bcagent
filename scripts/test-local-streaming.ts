/**
 * Test streamImportFirms — algoritmul folosit de browser pentru fișierul mare.
 * Node 18+ are Blob.stream() nativ → testăm exact codul de producție.
 * Run: pnpm dlx tsx scripts/test-local-streaming.ts
 */
import { streamImportFirms } from "../src/modules/prospects/stream";
import type { RawFirmRow } from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

async function main() {
  // Fixture mare: 200k firme, mix de județe/CAEN/stări
  const ROWS = 200_000;
  const lines = ["CUI|DENUMIRE|STARE_FIRMA|COD_CAEN|ADRESA|JUDET|LOCALITATE"];
  const judete = ["SV", "BT", "IS", "CJ", "B"];
  const caens = ["4711", "5630", "4726", "4520", "6201"];
  let expectedMatch = 0;
  for (let i = 0; i < ROWS; i++) {
    const j = judete[i % judete.length];
    const c = caens[i % caens.length];
    const stare = i % 97 === 0 ? "RADIAT din 2020" : "INREGISTRAT";
    // match = județ SV/BT + CAEN țintă (4711/5630/4726) + stare activă
    if (
      (j === "SV" || j === "BT") &&
      (c === "4711" || c === "5630" || c === "4726") &&
      !stare.includes("RADIAT")
    ) {
      expectedMatch++;
    }
    lines.push(
      `${100000 + i}|FIRMA ${i} SRL|${stare}|${c}|STR. T ${i}|${j}|LOC${i % 40}`,
    );
  }
  const content = lines.join("\n");
  const blob = new Blob([content], { type: "text/csv" });
  console.log(
    `\nFixture: ${ROWS.toLocaleString()} firme, ${(blob.size / 1024 / 1024).toFixed(1)} MB, așteptăm ${expectedMatch.toLocaleString()} potriviri\n`,
  );

  // Test principal
  const received: RawFirmRow[] = [];
  let batches = 0;
  let maxBatchExceeded = false;
  let progressCalls = 0;
  const t0 = Date.now();
  const result = await streamImportFirms(blob, {
    batchSize: 1500,
    // Filtrele sunt acum EXPLICITE — implicit se importă tot (platformă
    // multi-domeniu). Testul verifică comportamentul cu filtre active.
    counties: ["SV", "BT"],
    caens: ["4711", "5630", "4726"],
    onProgress: () => {
      progressCalls++;
    },
    onBatch: async (rows) => {
      batches++;
      if (rows.length > 1500) maxBatchExceeded = true;
      received.push(...rows);
    },
  });
  const ms = Date.now() - t0;
  console.log(
    `Procesat în ${ms}ms · ${batches} loturi · ${progressCalls} update-uri progres`,
  );
  check("fără eroare", !result.error, result.error);
  check(
    `procesate = ${ROWS.toLocaleString()}`,
    result.processed === ROWS,
    `(${result.processed})`,
  );
  check(
    `potriviri = ${expectedMatch.toLocaleString()}`,
    result.matched === expectedMatch,
    `(${result.matched})`,
  );
  check(
    "onBatch a primit exact potrivirile",
    received.length === expectedMatch,
    `(${received.length})`,
  );
  check(
    "toate potrivirile sunt SV/BT",
    received.every((r) => r.judet === "SV" || r.judet === "BT"),
  );
  check(
    "toate au CAEN țintă",
    received.every((r) => ["4711", "5630", "4726"].includes(r.caen)),
  );
  check("progres raportat", progressCalls > 0, `(${progressCalls})`);
  check("niciun lot peste batchSize (limita serverului)", !maxBatchExceeded);

  // Test binar: xlsx fals (începe cu PK)
  const zipBlob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])]);
  const rZip = await streamImportFirms(zipBlob, {
    onBatch: async () => {},
  });
  check(
    "arhivă ZIP respinsă cu mesaj clar",
    !!rZip.error && rZip.error.includes("arhivă"),
    rZip.error?.slice(0, 60),
  );

  // Test binar: xls vechi (OLE2)
  const xlsBlob = new Blob([
    new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]),
  ]);
  const rXls = await streamImportFirms(xlsBlob, {
    onBatch: async () => {},
  });
  check(
    "Excel binar respins cu mesaj clar",
    !!rXls.error && rXls.error.includes("Excel binar"),
    rXls.error?.slice(0, 60),
  );

  // Test fișier mic (sub 10 linii — bootstrap la final)
  const small = new Blob([
    "CUI|DENUMIRE|STARE_FIRMA|COD_CAEN|ADRESA|JUDET|LOCALITATE\n" +
      "111|MAGAZIN MIC SRL|INREGISTRAT|4711|STR. A|SV|SUCEAVA\n" +
      "222|BAR MIC SRL|INREGISTRAT|5630|STR. B|BT|BOTOSANI",
  ]);
  const smallRows: RawFirmRow[] = [];
  const rSmall = await streamImportFirms(small, {
    counties: ["SV", "BT"],
    caens: ["4711", "5630"],
    onBatch: async (rows) => {
      smallRows.push(...rows);
    },
  });
  check(
    "fișier cu 2 firme (sub pragul de bootstrap) procesat corect",
    !rSmall.error && smallRows.length === 2,
    `matched=${rSmall.matched}, err=${rSmall.error ?? "-"}`,
  );

  // Test gol
  const rEmpty = await streamImportFirms(new Blob([""]), {
    onBatch: async () => {},
  });
  check("fișier gol → eroare explicativă, no crash", !!rEmpty.error);

  // Comportament IMPLICIT (fără filtre) = importă tot ce e activ
  let noFilterCount = 0;
  const rNoFilter = await streamImportFirms(blob, {
    onBatch: async (rows) => {
      noFilterCount += rows.length;
    },
  });
  const activeRows = ROWS - Math.floor((ROWS - 1) / 97) - 1;
  check(
    "implicit (fără filtre) = toate firmele active, toate județele/domeniile",
    rNoFilter.matched === noFilterCount && noFilterCount > expectedMatch * 2,
    `(${noFilterCount.toLocaleString()} din ~${activeRows.toLocaleString()} active)`,
  );

  console.log("\n" + "=".repeat(60));
  console.log(ok ? "✅ STREAMING LOCAL CORECT" : "❌ TESTE EȘUATE");
  console.log("=".repeat(60));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("CRASH:", e);
  process.exit(2);
});
