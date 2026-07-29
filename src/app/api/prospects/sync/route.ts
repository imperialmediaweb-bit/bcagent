import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit, timingSafeEqual } from "@/lib/rate-limit";
import {
  getObjectRange,
  headObjectSize,
  isR2Enabled,
  MF_DATASET_KEY,
} from "@/lib/storage";
import {
  caenDescription,
  detectParserConfig,
  isActiveByState,
  isTargetCaen,
  normalizeCaen,
  parseFirmLine,
  TARGET_COUNTIES,
} from "@/modules/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Bytes procesați per apel — 20 MB ține request-ul sub ~15s pe Railway. */
const CHUNK_BYTES = 20 * 1024 * 1024;

interface SyncStateRow {
  byte_offset: string; // BIGINT vine ca string din postgres.js
  total_size: string;
  carry: string;
  delimiter: string | null;
  column_map: Record<string, number> | null;
  header_done: boolean;
  processed: string;
  matched: string;
  done: boolean;
}

/**
 * Procesare incrementală a dataset-ului MF din R2.
 * Fiecare apel: citește următorii ~20 MB, parsează linie cu linie,
 * filtrează (județ SV/BT → CAEN țintă → stare activă), upsert în prospects,
 * salvează progresul în sync_state. UI-ul apelează în buclă până done=true.
 */
export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`prospects-sync:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isR2Enabled()) {
    return Response.json(
      { error: "R2 nu e configurat (R2_* în Railway → Variables)" },
      { status: 503 },
    );
  }
  if (!isDBEnabled()) {
    return Response.json(
      { error: "Baza de date nu e configurată (DATABASE_URL)" },
      { status: 503 },
    );
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();

    const size = await headObjectSize(MF_DATASET_KEY);
    if (size === null) {
      return Response.json(
        { error: "Fișierul nu există în R2 — urcă-l întâi." },
        { status: 404 },
      );
    }

    // Încarcă sau inițializează starea
    const stateRows = await db<SyncStateRow[]>`
      SELECT byte_offset, total_size, carry, delimiter, column_map,
             header_done, processed, matched, done
      FROM sync_state WHERE key = ${MF_DATASET_KEY}
    `;
    let offset = 0;
    let carry = "";
    let delimiter: string | null = null;
    let columnMap: Record<string, number> | null = null;
    let headerDone = false;
    let processed = 0;
    let matched = 0;

    if (stateRows.length > 0) {
      const s = stateRows[0];
      if (s.done && Number(s.total_size) === size) {
        return Response.json({
          done: true,
          offset: size,
          size,
          processed: Number(s.processed),
          matched: Number(s.matched),
        });
      }
      // Fișier nou (mărime diferită) → restart implicit
      if (Number(s.total_size) === size) {
        offset = Number(s.byte_offset);
        carry = s.carry;
        delimiter = s.delimiter;
        columnMap = s.column_map;
        headerDone = s.header_done;
        processed = Number(s.processed);
        matched = Number(s.matched);
      }
    }

    // Citește chunk-ul curent
    const end = Math.min(offset + CHUNK_BYTES, size) - 1;
    const chunkText = await getObjectRange(MF_DATASET_KEY, offset, end);
    const isLast = end + 1 >= size;

    let text = carry + chunkText;
    let newCarry = "";
    if (!isLast) {
      // Ultima linie e probabil incompletă — o păstrăm pentru chunk-ul următor
      const lastNl = text.lastIndexOf("\n");
      if (lastNl >= 0) {
        newCarry = text.slice(lastNl + 1);
        text = text.slice(0, lastNl);
      } else {
        // Nicio linie completă în chunk (improbabil la 20MB) — totul e carry
        newCarry = text;
        text = "";
      }
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

    // Detectează configurația la primul chunk
    let skipLines = 0;
    if (!delimiter || !columnMap) {
      const config = detectParserConfig(lines.slice(0, 10));
      if (!config) {
        return Response.json(
          {
            error:
              "Nu am putut detecta formatul fișierului. Primele linii: " +
              lines.slice(0, 2).map((l) => l.slice(0, 120)).join(" ⏎ "),
          },
          { status: 422 },
        );
      }
      delimiter = config.delimiter;
      columnMap = config.columnMap;
      skipLines = headerDone ? 0 : config.headerLines;
      headerDone = true;
    }

    // Parsează + filtrează
    const toUpsert: Array<{
      cui: string;
      denumire: string;
      adresa: string;
      localitate: string;
      judet: string;
      caen: string;
      caen_desc: string;
    }> = [];
    for (let i = skipLines; i < lines.length; i++) {
      processed++;
      const row = parseFirmLine(lines[i], delimiter, columnMap);
      if (!row) continue;
      // Ordinea filtrelor: județ (ieftin) → CAEN → stare
      if (row.judet && !TARGET_COUNTIES.includes(row.judet)) continue;
      if (!row.judet) continue; // fără județ identificabil nu putem targeta
      const caen = normalizeCaen(row.caen);
      if (caen && !isTargetCaen(caen)) continue;
      if (!isActiveByState(row.stare)) continue;
      matched++;
      toUpsert.push({
        cui: row.cui,
        denumire: row.denumire.slice(0, 256),
        adresa: row.adresa.slice(0, 512),
        localitate: row.localitate.slice(0, 128),
        judet: row.judet,
        caen,
        caen_desc: isTargetCaen(caen) ? caenDescription(caen) : "",
      });
    }

    // Upsert în tranșe
    for (let i = 0; i < toUpsert.length; i += 200) {
      const chunk = toUpsert.slice(i, i + 200);
      await db`
        INSERT INTO prospects ${db(chunk)}
        ON CONFLICT (cui) DO UPDATE SET
          denumire = EXCLUDED.denumire,
          adresa = CASE WHEN EXCLUDED.adresa <> '' THEN EXCLUDED.adresa ELSE prospects.adresa END,
          localitate = CASE WHEN EXCLUDED.localitate <> '' THEN EXCLUDED.localitate ELSE prospects.localitate END,
          judet = CASE WHEN EXCLUDED.judet <> '' THEN EXCLUDED.judet ELSE prospects.judet END,
          caen = CASE WHEN EXCLUDED.caen <> '' THEN EXCLUDED.caen ELSE prospects.caen END,
          caen_desc = CASE WHEN EXCLUDED.caen_desc <> '' THEN EXCLUDED.caen_desc ELSE prospects.caen_desc END,
          updated_at = NOW()
      `;
    }

    const newOffset = end + 1;
    const done = isLast;

    await db`
      INSERT INTO sync_state (key, byte_offset, total_size, carry, delimiter, column_map, header_done, processed, matched, done, updated_at)
      VALUES (${MF_DATASET_KEY}, ${newOffset}, ${size}, ${newCarry}, ${delimiter}, ${db.json(columnMap)}, ${headerDone}, ${processed}, ${matched}, ${done}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        byte_offset = EXCLUDED.byte_offset,
        total_size = EXCLUDED.total_size,
        carry = EXCLUDED.carry,
        delimiter = EXCLUDED.delimiter,
        column_map = EXCLUDED.column_map,
        header_done = EXCLUDED.header_done,
        processed = EXCLUDED.processed,
        matched = EXCLUDED.matched,
        done = EXCLUDED.done,
        updated_at = NOW()
    `;

    return Response.json({
      done,
      offset: newOffset,
      size,
      processed,
      matched,
    });
  } catch (e) {
    console.error("[prospects sync]", e);
    return Response.json(
      { error: "Eroare la procesare — reîncearcă (progresul e salvat)" },
      { status: 500 },
    );
  }
}

/** Reset manual al progresului (reprocesare de la zero). */
export async function DELETE(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    await db`DELETE FROM sync_state WHERE key = ${MF_DATASET_KEY}`;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[prospects sync reset]", e);
    return Response.json({ error: "Eroare la reset" }, { status: 500 });
  }
}
