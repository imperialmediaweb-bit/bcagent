import { getDB } from "@/lib/db";

/**
 * Schema multi-tenant (nivelurile 1–3 din arhitectură):
 *   platform_admins  → super-adminul SaaS (tu)
 *   organizations    → firma de distribuție (tenantul plătitor)
 *   org_users        → conturile firmei (owner/manager, email+parolă)
 *   org_agents       → agenții de teren (magic link), atașați organizației
 *   plans            → planurile de abonament (mapate pe prețuri Stripe)
 *   invoices         → facturi (sincronizate din Stripe sau emise manual)
 *   audit_log        → cine, ce, când — pentru orice acțiune de admin
 *
 * DDL idempotent, ca `ensureSchema` din lib/db — se rulează la prima cerere.
 */

let ready = false;

export async function ensurePlatformSchema(): Promise<void> {
  if (ready) return;
  const db = getDB();
  if (!db) return;

  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS platform_admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RON',
      interval TEXT NOT NULL DEFAULT 'month',
      agent_limit INTEGER NOT NULL DEFAULT 5,
      features JSONB NOT NULL DEFAULT '{}'::jsonb,
      stripe_price_id TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cui TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      telefon TEXT NOT NULL DEFAULT '',
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'trial',
      trial_ends_at TIMESTAMPTZ,
      agent_limit INTEGER NOT NULL DEFAULT 5,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      current_period_end TIMESTAMPTZ,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS organizations_status ON organizations(status);
    CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer
      ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS org_users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'owner',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS org_users_org ON org_users(org_id);
    -- 2FA (TOTP — Google Authenticator) pentru conturile cu parolă.
    ALTER TABLE org_users ADD COLUMN IF NOT EXISTS totp_secret TEXT NOT NULL DEFAULT '';
    ALTER TABLE org_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS totp_secret TEXT NOT NULL DEFAULT '';
    ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

    -- Istoricul conectărilor (ca la bancă): cine, când, de unde, reușit
    -- sau nu. Tot de aici se calculează blocarea contului după eșecuri.
    CREATE TABLE IF NOT EXISTS login_events (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,            -- 'org' | 'platform'
      email TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      ok BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS login_events_email
      ON login_events(email, created_at DESC);

    -- Dispozitivele cunoscute ale unui cont (ca la Facebook): la login de
    -- pe un browser nou, proprietarul primește email de alertă.
    CREATE TABLE IF NOT EXISTS known_devices (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,            -- 'org' | 'platform'
      email TEXT NOT NULL,
      device_id TEXT NOT NULL,
      ua TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (kind, email, device_id)
    );
    CREATE INDEX IF NOT EXISTS known_devices_email ON known_devices(kind, email);

    -- Telemetrie de erori: TOT ce se împiedică la utilizatori se prinde
    -- automat (crash JS, cereri API eșuate) — adminul vede fără ca omul
    -- să raporteze nimic.
    CREATE TABLE IF NOT EXISTS app_events (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,             -- 'js_error' | 'api_error'
      page TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      status INTEGER,
      ua TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS app_events_time ON app_events(created_at DESC);

    -- CONSUM AI per firmă: fiecare apel AI (OCR factură, analize, antrenor)
    -- lasă un rând cu un cost estimat. Adminul vede cât îl costă un client
    -- — ca să nu vândă în pierdere.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id BIGSERIAL PRIMARY KEY,
      org_id TEXT,
      agent_id TEXT,
      kind TEXT NOT NULL,            -- 'ocr' | 'analiza' | 'coach' | 'chat' | ...
      cost_bani INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_usage_org ON ai_usage(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_usage_time ON ai_usage(created_at DESC);

    CREATE TABLE IF NOT EXISTS org_agents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS org_agents_org_agent
      ON org_agents(org_id, agent_id);
    -- Concedii: perioadă completă (de la – până la), cu detecție de
    -- suprapunere între agenți la setare.
    ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS away_until DATE;
    ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS away_from DATE;
    -- Salarizare: salariu de bază (bani) + procent comision, per agent.
    ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS salary_cents INTEGER;
    ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS commission_pct REAL;

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      stripe_invoice_id TEXT UNIQUE,
      number TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RON',
      status TEXT NOT NULL DEFAULT 'draft',
      hosted_url TEXT,
      pdf_url TEXT,
      period_start TIMESTAMPTZ,
      period_end TIMESTAMPTZ,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS invoices_org ON invoices(org_id);
    CREATE INDEX IF NOT EXISTS invoices_status ON invoices(status);

    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at DESC);

    -- Evenimente Stripe deja procesate (idempotență la retry-urile webhook-ului)
    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '',
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await seedPlans();
  ready = true;
}

/** Planurile implicite — doar dacă tabela e goală (nu suprascrie nimic). */
async function seedPlans(): Promise<void> {
  const db = getDB();
  if (!db) return;
  const [{ count }] = await db<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM plans
  `;
  if (parseInt(count, 10) > 0) return;

  // AI-ul costă bani per folosire (tokeni) → intră doar la Pro/Business.
  // Operaționalul (hartă, comenzi, rute, vizite) e la toți — retenția vine
  // din folosirea zilnică.
  const defaults = [
    {
      id: "start",
      name: "Start",
      price_cents: 19900,
      agent_limit: 3,
      features: { prospects: true, export: true, support: "email" },
    },
    {
      id: "pro",
      name: "Pro",
      price_cents: 49900,
      agent_limit: 10,
      features: {
        prospects: true,
        export: true,
        aiInsights: true,
        aiCoach: true,
        support: "prioritar",
      },
    },
    {
      id: "business",
      name: "Business",
      price_cents: 99900,
      agent_limit: 40,
      features: {
        prospects: true,
        export: true,
        aiInsights: true,
        aiCoach: true,
        aiVision: true,
        support: "dedicat",
      },
    },
  ];

  for (const p of defaults) {
    await db`
      INSERT INTO plans (id, name, price_cents, currency, interval, agent_limit, features, active)
      VALUES (${p.id}, ${p.name}, ${p.price_cents}, 'RON', 'month',
              ${p.agent_limit}, ${db.json(p.features)}, TRUE)
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

/** Doar pentru teste — forțează re-rularea DDL-ului. */
export function resetPlatformSchemaCache(): void {
  ready = false;
}
