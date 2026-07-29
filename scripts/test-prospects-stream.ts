/**
 * Test procesare incrementală (chunk-uri cu carry) vs parseFirmsFile.
 * Simulează exact logica din /api/prospects/sync: text tăiat la offset-uri
 * arbitrare, ultima linie parțială devine carry pentru chunk-ul următor.
 * Run: pnpm dlx tsx scripts/test-prospects-stream.ts
 */
import {
  detectParserConfig,
  parseFirmLine,
  parseFirmsFile,
  type RawFirmRow,
} from "../src/modules/prospects";

let ok = true;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

// Generează fixture sintetic mare
function makeFixture(rows: number): string {
  const lines = ["CUI|DENUMIRE|STARE_FIRMA|COD_CAEN|ADRESA|JUDET|LOCALITATE"];
  const judete = ["SV", "BT", "IS", "CJ", "B"];
  const caens = ["4711", "5630", "4726", "4520", "6201"];
  for (let i = 0; i < rows; i++) {
    const j = judete[i % judete.length];
    const c = caens[i % caens.length];
    lines.push(
      `${100000 + i}|FIRMA TEST ${i} SRL|INREGISTRAT|${c}|STR. TEST NR. ${i}|${j}|LOC${i % 50}`,
    );
  }
  return lines.join("\n");
}

/** Reproduce logica de chunking din /api/prospects/sync. */
function processChunked(content: string, chunkSize: number): RawFirmRow[] {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(content);
  const size = bytes.length;

  let offset = 0;
  let carry = "";
  let delimiter: string | null = null;
  let columnMap: Record<string, number> | null = null;
  let headerDone = false;
  const out: RawFirmRow[] = [];

  while (offset < size) {
    const end = Math.min(offset + chunkSize, size);
    const chunkText = decoder.decode(bytes.slice(offset, end));
    const isLast = end >= size;

    let text = carry + chunkText;
    carry = "";
    if (!isLast) {
      const lastNl = text.lastIndexOf("\n");
      if (lastNl >= 0) {
        carry = text.slice(lastNl + 1);
        text = text.slice(0, lastNl);
      } else {
        carry = text;
        text = "";
      }
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    let skipLines = 0;
    if (!delimiter || !columnMap) {
      const config = detectParserConfig(lines.slice(0, 10));
      if (config) {
        delimiter = config.delimiter;
        columnMap = config.columnMap;
        skipLines = headerDone ? 0 : config.headerLines;
        headerDone = true;
      }
    }
    if (delimiter && columnMap) {
      for (let i = skipLines; i < lines.length; i++) {
        const row = parseFirmLine(lines[i], delimiter, columnMap);
        if (row) out.push(row);
      }
    }
    offset = end;
  }
  return out;
}

const ROWS = 100_000;
console.log(`\nGenerez fixture cu ${ROWS.toLocaleString()} firme...`);
const fixture = makeFixture(ROWS);
const sizeMB = (fixture.length / 1024 / 1024).toFixed(1);
console.log(`Fixture: ${sizeMB} MB\n`);

// Referință: parseFirmsFile (tot fișierul dintr-o dată)
const refStart = Date.now();
const ref = parseFirmsFile(fixture);
console.log(
  `parseFirmsFile: ${ref.rows.length.toLocaleString()} rânduri în ${Date.now() - refStart}ms`,
);
check("referință: toate rândurile parsate", ref.rows.length === ROWS);

// Chunk-uri de mărimi variate — inclusiv mărimi care taie linii la mijloc
for (const chunkSize of [1024, 7777, 65536, 1024 * 1024]) {
  const t0 = Date.now();
  const chunked = processChunked(fixture, chunkSize);
  const ms = Date.now() - t0;
  const same =
    chunked.length === ref.rows.length &&
    chunked.every(
      (r, i) =>
        r.cui === ref.rows[i].cui &&
        r.denumire === ref.rows[i].denumire &&
        r.judet === ref.rows[i].judet &&
        r.caen === ref.rows[i].caen,
    );
  check(
    `chunk ${chunkSize.toLocaleString()} bytes → identic cu referința`,
    same,
    `${chunked.length.toLocaleString()} rânduri, ${ms}ms`,
  );
}

// Edge: chunk mai mic decât o linie
const tiny = processChunked(fixture.split("\n").slice(0, 5).join("\n"), 10);
check("chunk de 10 bytes (mai mic decât o linie) nu pierde rânduri", tiny.length === 4, `(${tiny.length})`);

console.log("\n" + "=".repeat(60));
console.log(ok ? "✅ STREAM CHUNKING CORECT" : "❌ TESTE EȘUATE");
console.log("=".repeat(60));
process.exit(ok ? 0 : 1);
