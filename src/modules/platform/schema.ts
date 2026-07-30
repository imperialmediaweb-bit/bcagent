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
    -- Concedii: managerul marchează agentul „în concediu până la...".
    ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS away_until DATE;

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
