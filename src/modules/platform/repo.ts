import { getDB } from "@/lib/db";
import { ensurePlatformSchema } from "./schema";
import { hashPassword } from "./passwords";
import type {
  AuditEntry,
  Invoice,
  InvoiceStatus,
  Organization,
  OrgStatus,
  OrgUser,
  Plan,
  PlatformAdmin,
  PlatformMetrics,
} from "./types";

/**
 * Accesul la date pentru panoul de super-admin.
 * Toate funcțiile presupun DATABASE_URL configurat; apelanții verifică
 * `isDBEnabled()` înainte și răspund 503 dacă lipsește.
 */

function db() {
  const d = getDB();
  if (!d) throw new Error("DATABASE_URL lipsește");
  return d;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/* ────────────────────────────── admini ────────────────────────────── */

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: Date;
  last_login_at: Date | null;
}

export async function countAdmins(): Promise<number> {
  await ensurePlatformSchema();
  const [{ count }] = await db()<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM platform_admins
  `;
  return parseInt(count, 10);
}

export async function getAdminByEmail(
  email: string,
): Promise<(PlatformAdmin & { passwordHash: string }) | null> {
  await ensurePlatformSchema();
  const rows = await db()<AdminRow[]>`
    SELECT * FROM platform_admins WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: iso(r.created_at)!,
    lastLoginAt: iso(r.last_login_at),
    passwordHash: r.password_hash,
  };
}

export async function createAdmin(
  email: string,
  password: string,
  name = "",
): Promise<PlatformAdmin> {
  await ensurePlatformSchema();
  const id = newId("adm");
  const hash = await hashPassword(password);
  const [r] = await db()<AdminRow[]>`
    INSERT INTO platform_admins (id, email, password_hash, name)
    VALUES (${id}, ${email.toLowerCase()}, ${hash}, ${name})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING *
  `;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: iso(r.created_at)!,
    lastLoginAt: iso(r.last_login_at),
  };
}

export async function touchAdminLogin(id: string): Promise<void> {
  await db()`UPDATE platform_admins SET last_login_at = NOW() WHERE id = ${id}`;
}

export async function changeAdminPassword(
  id: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await db()`UPDATE platform_admins SET password_hash = ${hash} WHERE id = ${id}`;
}

/* ────────────────────────────── planuri ───────────────────────────── */

interface PlanRow {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  interval: string;
  agent_limit: number;
  features: Plan["features"];
  stripe_price_id: string | null;
  active: boolean;
  created_at: Date;
}

function toPlan(r: PlanRow): Plan {
  return {
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    currency: r.currency,
    interval: r.interval === "year" ? "year" : "month",
    agentLimit: r.agent_limit,
    features: r.features ?? {},
    stripePriceId: r.stripe_price_id,
    active: r.active,
    createdAt: iso(r.created_at)!,
  };
}

export async function listPlans(includeInactive = true): Promise<Plan[]> {
  await ensurePlatformSchema();
  const rows = await db()<PlanRow[]>`
    SELECT * FROM plans
    WHERE (${includeInactive} OR active IS TRUE)
    ORDER BY price_cents ASC
  `;
  return rows.map(toPlan);
}

export interface PlanInput {
  id?: string;
  name: string;
  priceCents: number;
  currency?: string;
  interval?: "month" | "year";
  agentLimit: number;
  features?: Plan["features"];
  stripePriceId?: string | null;
  active?: boolean;
}

export async function upsertPlan(input: PlanInput): Promise<Plan> {
  await ensurePlatformSchema();
  const id =
    input.id?.trim() ||
    input.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) ||
    newId("plan");
  const [r] = await db()<PlanRow[]>`
    INSERT INTO plans (id, name, price_cents, currency, interval, agent_limit,
                       features, stripe_price_id, active)
    VALUES (${id}, ${input.name}, ${input.priceCents}, ${input.currency ?? "RON"},
            ${input.interval ?? "month"}, ${input.agentLimit},
            ${db().json(input.features ?? {})}, ${input.stripePriceId ?? null},
            ${input.active ?? true})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      price_cents = EXCLUDED.price_cents,
      currency = EXCLUDED.currency,
      interval = EXCLUDED.interval,
      agent_limit = EXCLUDED.agent_limit,
      features = EXCLUDED.features,
      stripe_price_id = EXCLUDED.stripe_price_id,
      active = EXCLUDED.active
    RETURNING *
  `;
  return toPlan(r);
}

export async function deletePlan(id: string): Promise<void> {
  await db()`DELETE FROM plans WHERE id = ${id}`;
}

/* ──────────────────────────── organizații ─────────────────────────── */

interface OrgRow {
  id: string;
  name: string;
  cui: string;
  email: string;
  telefon: string;
  plan_id: string | null;
  status: string;
  trial_ends_at: Date | null;
  agent_limit: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  note: string;
  created_at: Date;
  user_count?: string;
  agent_count?: string;
  plan_name?: string | null;
}

const ORG_STATUSES: OrgStatus[] = ["trial", "activ", "suspendat", "anulat"];

export function isOrgStatus(v: unknown): v is OrgStatus {
  return typeof v === "string" && ORG_STATUSES.includes(v as OrgStatus);
}

function toOrg(r: OrgRow): Organization {
  return {
    id: r.id,
    name: r.name,
    cui: r.cui,
    email: r.email,
    telefon: r.telefon,
    planId: r.plan_id,
    planName: r.plan_name ?? null,
    status: isOrgStatus(r.status) ? r.status : "trial",
    trialEndsAt: iso(r.trial_ends_at),
    agentLimit: r.agent_limit,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    currentPeriodEnd: iso(r.current_period_end),
    note: r.note,
    createdAt: iso(r.created_at)!,
    userCount: r.user_count ? parseInt(r.user_count, 10) : undefined,
    agentCount: r.agent_count ? parseInt(r.agent_count, 10) : undefined,
  };
}

export interface OrgFilter {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listOrgs(
  filter: OrgFilter = {},
): Promise<{ orgs: Organization[]; total: number }> {
  await ensurePlatformSchema();
  const status = filter.status ?? "";
  const search = filter.search ?? "";
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  const d = db();

  const where = () => d`
    WHERE (${status} = '' OR o.status = ${status})
      AND (${search} = '' OR o.name ILIKE ${"%" + search + "%"}
           OR o.cui LIKE ${search + "%"} OR o.email ILIKE ${"%" + search + "%"})
  `;

  const rows = await d<OrgRow[]>`
    SELECT o.*, p.name AS plan_name,
           (SELECT COUNT(*)::text FROM org_users u WHERE u.org_id = o.id) AS user_count,
           (SELECT COUNT(*)::text FROM org_agents a WHERE a.org_id = o.id AND a.active) AS agent_count
    FROM organizations o
    LEFT JOIN plans p ON p.id = o.plan_id
    ${where()}
    ORDER BY o.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [{ count }] = await d<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM organizations o ${where()}
  `;
  return { orgs: rows.map(toOrg), total: parseInt(count, 10) };
}

export async function getOrg(id: string): Promise<Organization | null> {
  await ensurePlatformSchema();
  const rows = await db()<OrgRow[]>`
    SELECT o.*, p.name AS plan_name,
           (SELECT COUNT(*)::text FROM org_users u WHERE u.org_id = o.id) AS user_count,
           (SELECT COUNT(*)::text FROM org_agents a WHERE a.org_id = o.id AND a.active) AS agent_count
    FROM organizations o
    LEFT JOIN plans p ON p.id = o.plan_id
    WHERE o.id = ${id}
    LIMIT 1
  `;
  return rows[0] ? toOrg(rows[0]) : null;
}

export async function getOrgByStripeCustomer(
  customerId: string,
): Promise<Organization | null> {
  await ensurePlatformSchema();
  const rows = await db()<OrgRow[]>`
    SELECT * FROM organizations WHERE stripe_customer_id = ${customerId} LIMIT 1
  `;
  return rows[0] ? toOrg(rows[0]) : null;
}

export interface OrgInput {
  name: string;
  cui?: string;
  email?: string;
  telefon?: string;
  planId?: string | null;
  status?: OrgStatus;
  trialDays?: number;
  agentLimit?: number;
  note?: string;
}

export async function createOrg(input: OrgInput): Promise<Organization> {
  await ensurePlatformSchema();
  const id = newId("org");
  const trialDays = input.trialDays ?? 14;
  const status: OrgStatus = input.status ?? "trial";
  const [r] = await db()<OrgRow[]>`
    INSERT INTO organizations
      (id, name, cui, email, telefon, plan_id, status, trial_ends_at, agent_limit, note)
    VALUES (${id}, ${input.name}, ${input.cui ?? ""}, ${(input.email ?? "").toLowerCase()},
            ${input.telefon ?? ""}, ${input.planId || null}, ${status},
            ${status === "trial" && trialDays > 0
              ? new Date(Date.now() + trialDays * 86400_000)
              : null},
            ${input.agentLimit ?? 5}, ${input.note ?? ""})
    RETURNING *
  `;
  return toOrg(r);
}

export interface OrgPatch {
  name?: string;
  cui?: string;
  email?: string;
  telefon?: string;
  planId?: string | null;
  status?: OrgStatus;
  trialEndsAt?: string | null;
  agentLimit?: number;
  note?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}

export async function updateOrg(
  id: string,
  patch: OrgPatch,
): Promise<Organization | null> {
  await ensurePlatformSchema();
  const updates: Record<string, string | number | Date | null> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.cui !== undefined) updates.cui = patch.cui;
  if (patch.email !== undefined) updates.email = patch.email.toLowerCase();
  if (patch.telefon !== undefined) updates.telefon = patch.telefon;
  if (patch.planId !== undefined) updates.plan_id = patch.planId || null;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.trialEndsAt !== undefined)
    updates.trial_ends_at = patch.trialEndsAt ? new Date(patch.trialEndsAt) : null;
  if (patch.agentLimit !== undefined) updates.agent_limit = patch.agentLimit;
  if (patch.note !== undefined) updates.note = patch.note;
  if (patch.stripeCustomerId !== undefined)
    updates.stripe_customer_id = patch.stripeCustomerId;
  if (patch.stripeSubscriptionId !== undefined)
    updates.stripe_subscription_id = patch.stripeSubscriptionId;
  if (patch.currentPeriodEnd !== undefined)
    updates.current_period_end = patch.currentPeriodEnd
      ? new Date(patch.currentPeriodEnd)
      : null;

  if (Object.keys(updates).length === 0) return getOrg(id);
  const d = db();
  await d`UPDATE organizations SET ${d(updates)}, updated_at = NOW() WHERE id = ${id}`;
  return getOrg(id);
}

export async function deleteOrg(id: string): Promise<void> {
  await db()`DELETE FROM organizations WHERE id = ${id}`;
}

/* ─────────────────────── utilizatori organizație ──────────────────── */

interface OrgUserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

function toOrgUser(r: OrgUserRow): OrgUser {
  return {
    id: r.id,
    orgId: r.org_id,
    email: r.email,
    name: r.name,
    role: r.role === "manager" ? "manager" : "owner",
    active: r.active,
    createdAt: iso(r.created_at)!,
    lastLoginAt: iso(r.last_login_at),
  };
}

export async function listOrgUsers(orgId: string): Promise<OrgUser[]> {
  await ensurePlatformSchema();
  const rows = await db()<OrgUserRow[]>`
    SELECT id, org_id, email, name, role, active, created_at, last_login_at
    FROM org_users WHERE org_id = ${orgId} ORDER BY created_at ASC
  `;
  return rows.map(toOrgUser);
}

export async function createOrgUser(
  orgId: string,
  email: string,
  password: string,
  name = "",
  role: "owner" | "manager" = "owner",
): Promise<OrgUser> {
  await ensurePlatformSchema();
  const id = newId("usr");
  const hash = await hashPassword(password);
  const [r] = await db()<OrgUserRow[]>`
    INSERT INTO org_users (id, org_id, email, password_hash, name, role)
    VALUES (${id}, ${orgId}, ${email.toLowerCase()}, ${hash}, ${name}, ${role})
    RETURNING id, org_id, email, name, role, active, created_at, last_login_at
  `;
  return toOrgUser(r);
}

export async function setOrgUserPassword(
  id: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await db()`UPDATE org_users SET password_hash = ${hash} WHERE id = ${id}`;
}

export async function setOrgUserActive(
  id: string,
  active: boolean,
): Promise<void> {
  await db()`UPDATE org_users SET active = ${active} WHERE id = ${id}`;
}

export async function deleteOrgUser(id: string): Promise<void> {
  await db()`DELETE FROM org_users WHERE id = ${id}`;
}

/* ────────────────────────── agenți organizație ────────────────────── */

export interface OrgAgentRow {
  id: string;
  agentId: string;
  name: string;
  active: boolean;
  awayFrom: string | null;
  awayUntil: string | null;
  salaryCents: number | null;
  commissionPct: number | null;
}

export async function listOrgAgents(orgId: string): Promise<OrgAgentRow[]> {
  await ensurePlatformSchema();
  const rows = await db()<
    Array<{
      id: string;
      agent_id: string;
      name: string;
      active: boolean;
      away_from: Date | null;
      away_until: Date | null;
      salary_cents: number | null;
      commission_pct: number | null;
    }>
  >`
    SELECT id, agent_id, name, active, away_from, away_until,
           salary_cents, commission_pct
    FROM org_agents
    WHERE org_id = ${orgId} ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    name: r.name,
    active: r.active,
    awayFrom: r.away_from ? iso(r.away_from)!.slice(0, 10) : null,
    awayUntil: r.away_until ? iso(r.away_until)!.slice(0, 10) : null,
    salaryCents: r.salary_cents,
    commissionPct: r.commission_pct,
  }));
}

/** Concediu: setează / șterge perioada în care agentul lipsește. */
export async function setOrgAgentAway(
  orgId: string,
  agentRowId: string,
  awayFrom: string | null,
  awayUntil: string | null,
): Promise<void> {
  await db()`
    UPDATE org_agents
    SET away_from = ${awayFrom ? new Date(awayFrom) : null},
        away_until = ${awayUntil ? new Date(awayUntil) : null}
    WHERE id = ${agentRowId} AND org_id = ${orgId}
  `;
}

/** Salarizare: salariu de bază + procent de comision. */
export async function setOrgAgentSalary(
  orgId: string,
  agentRowId: string,
  salaryCents: number | null,
  commissionPct: number | null,
): Promise<void> {
  await db()`
    UPDATE org_agents
    SET salary_cents = ${salaryCents}, commission_pct = ${commissionPct}
    WHERE id = ${agentRowId} AND org_id = ${orgId}
  `;
}

/** Login agenție: userul + hash-ul + starea organizației, dintr-un foc. */
export async function getOrgUserForLogin(email: string): Promise<
  | (OrgUser & {
      passwordHash: string;
      orgStatus: OrgStatus;
      orgName: string;
    })
  | null
> {
  await ensurePlatformSchema();
  const rows = await db()<
    Array<OrgUserRow & { password_hash: string; org_status: string; org_name: string }>
  >`
    SELECT u.*, o.status AS org_status, o.name AS org_name
    FROM org_users u JOIN organizations o ON o.id = u.org_id
    WHERE u.email = ${email.toLowerCase()} LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    ...toOrgUser(r),
    passwordHash: r.password_hash,
    orgStatus: isOrgStatus(r.org_status) ? r.org_status : "trial",
    orgName: r.org_name,
  };
}

export async function touchOrgUserLogin(id: string): Promise<void> {
  await db()`UPDATE org_users SET last_login_at = NOW() WHERE id = ${id}`;
}

export async function addOrgAgent(
  orgId: string,
  agentId: string,
  name: string,
): Promise<void> {
  await ensurePlatformSchema();
  await db()`
    INSERT INTO org_agents (id, org_id, agent_id, name)
    VALUES (${newId("agt")}, ${orgId}, ${agentId}, ${name})
    ON CONFLICT (org_id, agent_id) DO UPDATE SET name = EXCLUDED.name, active = TRUE
  `;
}

/* ────────────────────────────── facturi ───────────────────────────── */

interface InvoiceRow {
  id: string;
  org_id: string;
  stripe_invoice_id: string | null;
  number: string;
  amount_cents: number;
  currency: string;
  status: string;
  hosted_url: string | null;
  pdf_url: string | null;
  period_start: Date | null;
  period_end: Date | null;
  issued_at: Date;
  paid_at: Date | null;
  org_name?: string;
}

const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
];

export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return typeof v === "string" && INVOICE_STATUSES.includes(v as InvoiceStatus);
}

function toInvoice(r: InvoiceRow): Invoice {
  return {
    id: r.id,
    orgId: r.org_id,
    orgName: r.org_name,
    stripeInvoiceId: r.stripe_invoice_id,
    number: r.number,
    amountCents: r.amount_cents,
    currency: r.currency,
    status: isInvoiceStatus(r.status) ? r.status : "draft",
    hostedUrl: r.hosted_url,
    pdfUrl: r.pdf_url,
    periodStart: iso(r.period_start),
    periodEnd: iso(r.period_end),
    issuedAt: iso(r.issued_at)!,
    paidAt: iso(r.paid_at),
  };
}

export async function listInvoices(
  filter: { orgId?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ invoices: Invoice[]; total: number }> {
  await ensurePlatformSchema();
  const orgId = filter.orgId ?? "";
  const status = filter.status ?? "";
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  const d = db();
  const where = () => d`
    WHERE (${orgId} = '' OR i.org_id = ${orgId})
      AND (${status} = '' OR i.status = ${status})
  `;
  const rows = await d<InvoiceRow[]>`
    SELECT i.*, o.name AS org_name
    FROM invoices i LEFT JOIN organizations o ON o.id = i.org_id
    ${where()}
    ORDER BY i.issued_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [{ count }] = await d<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM invoices i ${where()}
  `;
  return { invoices: rows.map(toInvoice), total: parseInt(count, 10) };
}

export interface InvoiceInput {
  orgId: string;
  stripeInvoiceId?: string | null;
  number: string;
  amountCents: number;
  currency?: string;
  status?: InvoiceStatus;
  hostedUrl?: string | null;
  pdfUrl?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  issuedAt?: string | null;
  paidAt?: string | null;
}

/** Inserează sau actualizează o factură (cheia naturală = stripe_invoice_id). */
export async function upsertInvoice(input: InvoiceInput): Promise<Invoice> {
  await ensurePlatformSchema();
  const d = db();
  const id = newId("inv");
  const [r] = await d<InvoiceRow[]>`
    INSERT INTO invoices (id, org_id, stripe_invoice_id, number, amount_cents,
                          currency, status, hosted_url, pdf_url,
                          period_start, period_end, issued_at, paid_at)
    VALUES (${id}, ${input.orgId}, ${input.stripeInvoiceId ?? null}, ${input.number},
            ${input.amountCents}, ${input.currency ?? "RON"}, ${input.status ?? "draft"},
            ${input.hostedUrl ?? null}, ${input.pdfUrl ?? null},
            ${input.periodStart ? new Date(input.periodStart) : null},
            ${input.periodEnd ? new Date(input.periodEnd) : null},
            ${input.issuedAt ? new Date(input.issuedAt) : new Date()},
            ${input.paidAt ? new Date(input.paidAt) : null})
    ON CONFLICT (stripe_invoice_id) DO UPDATE SET
      number = EXCLUDED.number,
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      hosted_url = EXCLUDED.hosted_url,
      pdf_url = EXCLUDED.pdf_url,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      paid_at = EXCLUDED.paid_at
    RETURNING *
  `;
  return toInvoice(r);
}

export async function setInvoiceStatus(
  id: string,
  status: InvoiceStatus,
): Promise<void> {
  await db()`
    UPDATE invoices
    SET status = ${status},
        paid_at = CASE WHEN ${status} = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
    WHERE id = ${id}
  `;
}

export async function deleteInvoice(id: string): Promise<void> {
  await db()`DELETE FROM invoices WHERE id = ${id}`;
}

/* ──────────────────────────── audit + idempotență ─────────────────── */

export async function audit(
  actor: string,
  action: string,
  target = "",
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await ensurePlatformSchema();
    await db()`
      INSERT INTO audit_log (actor, action, target, meta)
      VALUES (${actor}, ${action}, ${target}, ${db().json(
        // meta e liber ca formă; îl serializăm ca JSON generic
        meta as Record<string, string | number | boolean | null>,
      )})
    `;
  } catch (e) {
    // Auditul nu trebuie să dea peste cap acțiunea propriu-zisă.
    console.error("[audit]", e);
  }
}

export async function listAudit(
  limit = 100,
  offset = 0,
): Promise<{ entries: AuditEntry[]; total: number }> {
  await ensurePlatformSchema();
  const d = db();
  const rows = await d<
    Array<{
      id: string;
      actor: string;
      action: string;
      target: string;
      meta: Record<string, unknown>;
      created_at: Date;
    }>
  >`
    SELECT id::text, actor, action, target, meta, created_at
    FROM audit_log ORDER BY id DESC
    LIMIT ${Math.min(500, Math.max(1, limit))} OFFSET ${Math.max(0, offset)}
  `;
  const [{ count }] = await d<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM audit_log
  `;
  return {
    entries: rows.map((r) => ({
      id: parseInt(r.id, 10),
      actor: r.actor,
      action: r.action,
      target: r.target,
      meta: r.meta ?? {},
      createdAt: iso(r.created_at)!,
    })),
    total: parseInt(count, 10),
  };
}

/** True dacă evenimentul Stripe a mai fost procesat (retry-uri webhook). */
export async function markStripeEvent(
  id: string,
  type: string,
): Promise<boolean> {
  await ensurePlatformSchema();
  const rows = await db()<Array<{ id: string }>>`
    INSERT INTO stripe_events (id, type) VALUES (${id}, ${type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

/** Șterge marcajul dacă procesarea a eșuat, ca retry-ul Stripe să reintre. */
export async function unmarkStripeEvent(id: string): Promise<void> {
  try {
    await db()`DELETE FROM stripe_events WHERE id = ${id}`;
  } catch (e) {
    console.error("[unmarkStripeEvent]", e);
  }
}

/* ────────────────────────────── metrici ───────────────────────────── */

export async function platformMetrics(): Promise<PlatformMetrics> {
  await ensurePlatformSchema();
  const d = db();

  const [orgs] = await d<
    [{ total: string; trial: string; activ: string; suspendat: string }]
  >`
    SELECT COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status = 'trial')::text AS trial,
           COUNT(*) FILTER (WHERE status = 'activ')::text AS activ,
           COUNT(*) FILTER (WHERE status = 'suspendat')::text AS suspendat
    FROM organizations
  `;

  // MRR: planurile organizațiilor active, anualele normalizate pe lună.
  const [mrr] = await d<[{ cents: string }]>`
    SELECT COALESCE(SUM(
      CASE WHEN p.interval = 'year' THEN p.price_cents / 12 ELSE p.price_cents END
    ), 0)::text AS cents
    FROM organizations o JOIN plans p ON p.id = o.plan_id
    WHERE o.status = 'activ'
  `;

  const [users] = await d<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM org_users
  `;
  const [agents] = await d<[{ count: string }]>`
    SELECT COUNT(*)::text AS count FROM org_agents WHERE active
  `;

  let prospects = { total: 0, verified: 0 };
  try {
    const [p] = await d<[{ total: string; verified: string }]>`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE activ IS NOT NULL)::text AS verified
      FROM prospects
    `;
    prospects = {
      total: parseInt(p.total, 10),
      verified: parseInt(p.verified, 10),
    };
  } catch {
    // tabela prospects poate lipsi pe o bază nouă — metrica rămâne 0
  }

  const [inv] = await d<
    [{ paid: string; open: string; count: string }]
  >`
    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::text AS paid,
           COALESCE(SUM(amount_cents) FILTER (WHERE status = 'open'), 0)::text AS open,
           COUNT(*)::text AS count
    FROM invoices
  `;

  return {
    orgs: {
      total: parseInt(orgs.total, 10),
      trial: parseInt(orgs.trial, 10),
      activ: parseInt(orgs.activ, 10),
      suspendat: parseInt(orgs.suspendat, 10),
    },
    mrrCents: parseInt(mrr.cents, 10),
    users: parseInt(users.count, 10),
    agents: parseInt(agents.count, 10),
    prospects,
    invoices: {
      paidCents: parseInt(inv.paid, 10),
      openCents: parseInt(inv.open, 10),
      count: parseInt(inv.count, 10),
    },
  };
}

/** Serie lunară pentru graficul din dashboard (organizații noi + încasări). */
export async function monthlySeries(
  months = 12,
): Promise<Array<{ month: string; orgs: number; paidCents: number }>> {
  await ensurePlatformSchema();
  const d = db();
  const n = Math.min(36, Math.max(1, months));
  const rows = await d<
    Array<{ month: string; orgs: string; paid: string }>
  >`
    WITH luni AS (
      SELECT to_char(generate_series(
        date_trunc('month', NOW()) - (${n - 1} || ' months')::interval,
        date_trunc('month', NOW()),
        '1 month'
      ), 'YYYY-MM') AS month
    )
    SELECT l.month,
           COALESCE((SELECT COUNT(*) FROM organizations o
                     WHERE to_char(o.created_at, 'YYYY-MM') = l.month), 0)::text AS orgs,
           COALESCE((SELECT SUM(i.amount_cents) FROM invoices i
                     WHERE i.status = 'paid'
                       AND to_char(COALESCE(i.paid_at, i.issued_at), 'YYYY-MM') = l.month), 0)::text AS paid
    FROM luni l ORDER BY l.month
  `;
  return rows.map((r) => ({
    month: r.month,
    orgs: parseInt(r.orgs, 10),
    paidCents: parseInt(r.paid, 10),
  }));
}
