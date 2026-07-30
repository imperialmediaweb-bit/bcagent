/** Nivelurile de acces din platformă (vezi arhitectura SaaS). */
export type PlatformRole = "platform_admin";
export type OrgRole = "owner" | "manager";

export type OrgStatus = "trial" | "activ" | "suspendat" | "anulat";

export interface Organization {
  id: string;
  name: string;
  cui: string;
  email: string;
  telefon: string;
  planId: string | null;
  planName?: string | null;
  status: OrgStatus;
  trialEndsAt: string | null;
  agentLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  note: string;
  createdAt: string;
  /** Statistici calculate (nu se stochează). */
  userCount?: number;
  agentCount?: number;
}

export interface Plan {
  id: string;
  name: string;
  /** Preț lunar în bani (RON × 100). */
  priceCents: number;
  currency: string;
  interval: "month" | "year";
  agentLimit: number;
  /** Funcționalități incluse, pentru afișare și limite. */
  features: {
    aiInsights?: boolean;
    prospects?: boolean;
    export?: boolean;
    support?: string;
  };
  stripePriceId: string | null;
  active: boolean;
  createdAt: string;
}

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "uncollectible"
  | "void";

export interface Invoice {
  id: string;
  orgId: string;
  orgName?: string;
  stripeInvoiceId: string | null;
  number: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  hostedUrl: string | null;
  pdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string;
  paidAt: string | null;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformMetrics {
  orgs: { total: number; trial: number; activ: number; suspendat: number };
  /** Venit lunar recurent estimat, în bani. */
  mrrCents: number;
  users: number;
  agents: number;
  prospects: { total: number; verified: number };
  invoices: { paidCents: number; openCents: number; count: number };
}

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface OrgUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: OrgRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminSession {
  adminId: string;
  email: string;
  role: PlatformRole;
  exp: number;
}
