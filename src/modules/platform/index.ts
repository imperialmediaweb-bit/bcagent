/**
 * Modulul platform — panoul de super-admin (nivelul 1 din arhitectura SaaS).
 * Importurile din alte module trec DOAR prin acest index.
 */
export type {
  AdminSession,
  AuditEntry,
  Invoice,
  InvoiceStatus,
  Organization,
  OrgRole,
  OrgStatus,
  OrgUser,
  Plan,
  PlatformAdmin,
  PlatformMetrics,
  PlatformRole,
} from "./types";

export { hashPassword, verifyPassword, generatePassword } from "./passwords";
export {
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAdmin,
  SESSION_TTL_SECONDS,
} from "./session";
export { ensurePlatformSchema } from "./schema";
export {
  addOrgAgent,
  audit,
  changeAdminPassword,
  countAdmins,
  createAdmin,
  createOrg,
  createOrgUser,
  deleteInvoice,
  deleteOrg,
  deleteOrgUser,
  deletePlan,
  getAdminByEmail,
  getOrg,
  getOrgByStripeCustomer,
  isInvoiceStatus,
  isOrgStatus,
  listAudit,
  listInvoices,
  listOrgAgents,
  listOrgUsers,
  listOrgs,
  listPlans,
  markStripeEvent,
  monthlySeries,
  platformMetrics,
  setInvoiceStatus,
  setOrgUserActive,
  setOrgUserPassword,
  touchAdminLogin,
  unmarkStripeEvent,
  updateOrg,
  upsertInvoice,
  upsertPlan,
} from "./repo";
export type { InvoiceInput, OrgFilter, OrgInput, OrgPatch, PlanInput } from "./repo";
export {
  applyInvoice,
  applySubscription,
  constructWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  ensureCustomer,
  getStripe,
  handleWebhookEvent,
  stripeEnabled,
  syncOrgInvoices,
  verifyPlanPrices,
  webhookConfigured,
} from "./stripe";
