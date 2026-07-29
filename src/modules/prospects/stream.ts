import type { RawFirmRow } from "./types";
import { detectParserConfig, isActiveByState, parseFirmLine } from "./parse";
import { isTargetCaen, normalizeCaen, TARGET_COUNTIES } from "./caen";

/**
 * Procesare streaming a unui fișier MF de ORICE mărime, direct în browser
 * (sau Node — folosește doar API-uri web standard: Blob.stream, TextDecoder).
 * Memorie constantă: fișierul se citește bucată cu bucată, liniile parțiale
 * dintre bucăți se rezolvă prin carry. Logica de carry e identică cu cea
 * validată în scripts/test-prospects-stream.ts.
 */

export interface StreamImportResult {
  /** Linii de date procesate (fără header). */
  processed: number;
  /** Firme care au trecut toate filtrele. */
  matched: number;
  /** Setat dacă fișierul nu a putut fi procesat. */
  error?: string;
}

export interface StreamImportOptions {
  /** Câte potriviri se acumulează înainte de a chema onBatch. Default 1500. */
  batchSize?: number;
  /** Județele acceptate. Default TARGET_COUNTIES (SV, BT). */
  counties?: string[];
  /** Progres: bytes citiți / total, linii procesate, potriviri. */
  onProgress?: (
    bytesRead: number,
    totalBytes: number,
    processed: number,
    matched: number,
  ) => void;
  /** Primește loturile de firme care au trecut filtrele (ex: POST la API). */
  onBatch: (rows: RawFirmRow[]) => Promise<void>;
}

/** Primii bytes ai formatelor binare pe care NU le putem stream-parsa. */
function looksBinary(head: Uint8Array): "xls" | "zip" | null {
  if (head.length >= 4) {
    // OLE2 (xls vechi): D0 CF 11 E0
    if (
      head[0] === 0xd0 &&
      head[1] === 0xcf &&
      head[2] === 0x11 &&
      head[3] === 0xe0
    ) {
      return "xls";
    }
    // ZIP (xlsx, ods, arhive): 50 4B ("PK")
    if (head[0] === 0x50 && head[1] === 0x4b) {
      return "zip";
    }
  }
  return null;
}

export async function streamImportFirms(
  blob: Blob,
  options: StreamImportOptions,
): Promise<StreamImportResult> {
  const batchSize = options.batchSize ?? 1500;
  const counties = options.counties ?? TARGET_COUNTIES;

  // Detecție binar pe primii 8 bytes
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const binary = looksBinary(head);
  if (binary === "xls") {
    return {
      processed: 0,
      matched: 0,
      error:
        "Fișierul e un Excel binar (.xls adevărat) — nu poate fi procesat la mărimea asta. Pe pagina de download data.gov.ro caută varianta .txt/.csv a aceluiași dataset.",
    };
  }
  if (binary === "zip") {
    return {
      processed: 0,
      matched: 0,
      error:
        "Fișierul e o arhivă (.zip/.xlsx). Dacă e .zip: dezarhivează-l întâi și încarcă fișierul .txt/.csv dinăuntru. Dacă e .xlsx: caută varianta .txt/.csv pe data.gov.ro.",
    };
  }

  const reader = blob.stream().getReader();
  const decoder = new TextDecoder("utf-8");

  let carry = "";
  let bytesRead = 0;
  let delimiter: string | null = null;
  let columnMap: Record<string, number> | null = null;
  let bootstrap: string[] = [];
  let processed = 0;
  let matched = 0;
  let buffer: RawFirmRow[] = [];
  let configError: string | null = null;

  const flush = async (force: boolean) => {
    if (buffer.length === 0) return;
    if (!force && buffer.length < batchSize) return;
    const batch = buffer;
    buffer = [];
    await options.onBatch(batch);
  };

  const processLine = (line: string) => {
    if (!line.trim()) return;
    if (!delimiter || !columnMap) {
      bootstrap.push(line);
      if (bootstrap.length >= 10) initConfig();
      return;
    }
    processed++;
    const row = parseFirmLine(line, delimiter, columnMap);
    if (!row) return;
    // Filtre în ordinea costului: județ → CAEN → stare
    if (!row.judet || !counties.includes(row.judet)) return;
    const caen = normalizeCaen(row.caen);
    if (caen && !isTargetCaen(caen)) return;
    if (!isActiveByState(row.stare)) return;
    matched++;
    buffer.push({ ...row, caen });
  };

  const initConfig = () => {
    const config = detectParserConfig(bootstrap);
    if (!config) {
      configError =
        "Nu am putut detecta formatul fișierului. Primele linii: " +
        bootstrap
          .slice(0, 2)
          .map((l) => l.slice(0, 120))
          .join(" ⏎ ");
      bootstrap = [];
      return;
    }
    delimiter = config.delimiter;
    columnMap = config.columnMap;
    const dataLines = bootstrap.slice(config.headerLines);
    bootstrap = [];
    for (const l of dataLines) processLine(l);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      const text = carry + decoder.decode(value, { stream: true });
      const parts = text.split(/\r?\n/);
      carry = parts.pop() ?? "";
      for (const line of parts) {
        processLine(line);
        if (configError) {
          return { processed, matched, error: configError };
        }
      }
      await flush(false);
      options.onProgress?.(bytesRead, blob.size, processed, matched);
    }

    // Final: golește decoder-ul și ultima linie
    carry += decoder.decode();
    if ((!delimiter || !columnMap) && bootstrap.length > 0) {
      if (carry.trim()) bootstrap.push(carry);
      carry = "";
      initConfig();
      if (configError) {
        return { processed, matched, error: configError };
      }
    }
    if (carry.trim()) processLine(carry);
    if (configError) {
      return { processed, matched, error: configError };
    }
    await flush(true);
    options.onProgress?.(blob.size, blob.size, processed, matched);
  } finally {
    reader.releaseLock();
  }

  if (!delimiter || !columnMap) {
    return {
      processed,
      matched,
      error: "Fișierul nu conține date recunoscibile (prea puține linii sau format necunoscut).",
    };
  }

  return { processed, matched };
}
