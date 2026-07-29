import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;
let schemaReady = false;

export function isDBEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getDB() {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) {
    const url = process.env.DATABASE_URL;
    sql = postgres(url, {
      ssl:
        url.includes("localhost") || url.includes("127.0.0.1")
          ? false
          : "require",
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }
  return sql;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const db = getDB();
  if (!db) return;
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      row_count INTEGER NOT NULL,
      date_min DATE NOT NULL,
      date_max DATE NOT NULL,
      rows JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS batches_agent_id ON batches(agent_id);
    CREATE TABLE IF NOT EXISTS agent_settings (
      agent_id TEXT PRIMARY KEY,
      default_rate REAL DEFAULT 5,
      avg_price REAL DEFAULT 1,
      agent_rates JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Prospecți: firmele potențial-client din județele țintă.
    -- org_id e nullable acum (F1); devine NOT NULL la multi-tenant (F2).
    CREATE TABLE IF NOT EXISTS prospects (
      cui TEXT PRIMARY KEY,
      org_id TEXT,
      denumire TEXT NOT NULL,
      adresa TEXT DEFAULT '',
      localitate TEXT DEFAULT '',
      judet TEXT DEFAULT '',
      caen TEXT DEFAULT '',
      caen_desc TEXT DEFAULT '',
      tva BOOLEAN,
      activ BOOLEAN,
      status TEXT NOT NULL DEFAULT 'nou',
      note TEXT DEFAULT '',
      assigned_agent TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS prospects_judet ON prospects(judet);
    CREATE INDEX IF NOT EXISTS prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS prospects_caen ON prospects(caen);
    CREATE INDEX IF NOT EXISTS prospects_localitate ON prospects(localitate);
    -- Progres procesare incrementală a fișierelor mari din R2 (dataset MF).
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      byte_offset BIGINT NOT NULL DEFAULT 0,
      total_size BIGINT NOT NULL DEFAULT 0,
      carry TEXT NOT NULL DEFAULT '',
      delimiter TEXT,
      column_map JSONB,
      header_done BOOLEAN NOT NULL DEFAULT FALSE,
      processed BIGINT NOT NULL DEFAULT 0,
      matched BIGINT NOT NULL DEFAULT 0,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaReady = true;
}
