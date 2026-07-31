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
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Coloane de contact adăugate ulterior (baze existente)
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS telefon TEXT DEFAULT '';
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS contact TEXT DEFAULT '';
    CREATE INDEX IF NOT EXISTS prospects_judet ON prospects(judet);
    CREATE INDEX IF NOT EXISTS prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS prospects_caen ON prospects(caen);
    CREATE INDEX IF NOT EXISTS prospects_localitate ON prospects(localitate);
    -- Index compus pentru filtrarea uzuală (județ + domeniu) la 1M+ rânduri
    CREATE INDEX IF NOT EXISTS prospects_judet_caen ON prospects(judet, caen);
    -- Coada de verificare ANAF (activ IS NULL) — index parțial, foarte mic
    CREATE INDEX IF NOT EXISTS prospects_pending_anaf ON prospects(cui)
      WHERE activ IS NULL;
    -- Problemele raportate din platformă (de agenți/manageri sau automat),
    -- cu diagnosticul AI atașat — adminul le vede în /platform/probleme.
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'user',
      reporter TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      page TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      ai_diagnosis TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'noua',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS issues_status ON issues(status, created_at DESC);
    -- Rutele agenților: șabloane pe zile (Luni — Rădăuți) cu opriri ordonate.
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      day TEXT NOT NULL DEFAULT '',
      stops JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS routes_agent ON routes(agent_id);
    -- Jurnalul vizitelor din teren: cine, când, la ce firmă, cu ce rezultat.
    CREATE TABLE IF NOT EXISTS visits (
      id BIGSERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      cui TEXT NOT NULL,
      denumire TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS visits_agent ON visits(agent_id, visited_at DESC);
    CREATE INDEX IF NOT EXISTS visits_cui ON visits(cui, visited_at DESC);
    -- Targeturi lunare per agent (setate de agenție; realizatul se
    -- calculează din vânzările încărcate).
    CREATE TABLE IF NOT EXISTS targets (
      org_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      month TEXT NOT NULL,
      target_value REAL NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, agent_name, month)
    );
    -- Decontul agenților: motorină, diurnă etc. — aprobat de manager.
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      spent_on DATE NOT NULL,
      category TEXT NOT NULL DEFAULT 'alte',
      amount_cents INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'in_asteptare',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS expenses_agent ON expenses(agent_id, spent_on DESC);
    -- Solduri/restanțe clienți (importate din SAGA) — direct pe firmă.
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS sold_cents BIGINT;
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS sold_updated_at TIMESTAMPTZ;
    -- Comenzile luate din teren: agentul le bate pe telefon la client,
    -- depozitul le vede instant, contabila le exportă pentru SAGA.
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      cui TEXT NOT NULL DEFAULT '',
      denumire TEXT NOT NULL DEFAULT '',
      localitate TEXT NOT NULL DEFAULT '',
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'noua',
      total_value REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orders_agent ON orders(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at DESC);
    -- VAN SALES: agentul vinde marfa pe loc, din mașină (tip='van',
    -- status direct 'livrata') și încasează (plata: numerar/card/termen).
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip TEXT NOT NULL DEFAULT 'comanda';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS plata TEXT NOT NULL DEFAULT '';
    -- Poza facturii/bonului (JPEG mic, data-URL) — dovada vânzării pe loc.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS foto TEXT NOT NULL DEFAULT '';
    -- Stocul din mașina fiecărui agent: se încarcă dimineața, scade la
    -- fiecare vânzare van, se descarcă la retur.
    -- PIN-ul linkului de agent: linkul singur nu mai e de ajuns pe un
    -- dispozitiv străin — se cere PIN-ul setat de agent la prima deschidere.
    CREATE TABLE IF NOT EXISTS agent_pin (
      agent_id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_stock (
      agent_id TEXT NOT NULL,
      produs TEXT NOT NULL,
      um TEXT NOT NULL DEFAULT 'buc',
      cantitate REAL NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, produs)
    );
    -- Cache de geocodare per localitate (Nominatim, 1 req/s) — o localitate
    -- se geocodează O dată, apoi harta o citește instant de aici.
    CREATE TABLE IF NOT EXISTS geo_localitati (
      judet TEXT NOT NULL,
      localitate TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      failed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (judet, localitate)
    );
    -- Potrivire nume client (XLS) ↔ denumire firmă (MF): ambele părți se
    -- normalizează identic, iar indexul face egalitatea instantă la 1,3M rânduri.
    CREATE INDEX IF NOT EXISTS prospects_denumire_norm ON prospects (
      btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g')))
    );
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

  // Căutare rapidă după nume la 1M+ rânduri (ILIKE '%x%' fără index e lent).
  // pg_trgm poate lipsi pe unele instanțe — eșecul nu blochează aplicația.
  try {
    await db.unsafe(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS prospects_denumire_trgm
        ON prospects USING gin (denumire gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS prospects_localitate_trgm
        ON prospects USING gin (localitate gin_trgm_ops);
    `);
  } catch (e) {
    console.warn(
      "[db] pg_trgm indisponibil — căutarea după nume va fi mai lentă:",
      e instanceof Error ? e.message : e,
    );
  }

  schemaReady = true;
}
