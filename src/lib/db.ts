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
  `);
  schemaReady = true;
}
