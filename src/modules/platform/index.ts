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
  recordLoginEvent,
  isLockedOut,
  loginHistory,
  getOrgUserTotp,
  setOrgUserTotp,
  orgUserTotpByEmail,
  getAdminTotp,
  setAdminTotp,
  adminTotpByEmail,
} from "./login-security";
export {
  describeDevice,
  hasAnyDevice,
  listDevices,
  touchDevice,
} from "./login-security";
export type { LoginEvent, KnownDevice } from "./login-security";
export { handleDeviceOnLogin } from "./device-alert";
export {
  seedDemoOrg,
  DEMO_ORG_NAME,
  DEMO_OWNER_EMAIL,
  DEMO_MANAGER_EMAIL,
} from "./demo-seed";
export type { DemoSeedResult } from "./demo-seed";
export {
  signOrgSession,
  verifyOrgSession,
  setOrgSessionCookie,
  clearOrgSessionCookie,
  getOrgSession,
  requireOrgUser,
  ORG_SESSION_TTL_SECONDS,
} from "./org-session";
export type { OrgSession } from "./org-session";
export {
  addOrgAgent,
  agentAIFeatures,
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
  getOrgUserForLogin,
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
  orgAIFeatures,
  platformMetrics,
  setInvoiceStatus,
  setOrgAgentAway,
  setOrgAgentSalary,
  setOrgUserActive,
  setOrgUserPassword,
  touchAdminLogin,
  touchOrgUserLogin,
  unmarkStripeEvent,
  updateOrg,
  upsertInvoice,
  upsertPlan,
} from "./repo";
export type {
  AIFeatures,
  InvoiceInput,
  OrgFilter,
  OrgInput,
  OrgPatch,
  PlanInput,
} from "./repo";
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
