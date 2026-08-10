/**
 * Test de integrare pentru schema și repo-ul de platformă, pe un Postgres real.
 *
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres \
 *     pnpm dlx tsx scripts/test-platform-db.ts
 *
 * Verifică exact ce nu poate prinde typecheck-ul: DDL-ul chiar rulează,
 * upsert-urile se comportă corect, metricile calculează ce trebuie.
 */

import { getDB } from "../src/lib/db";
import { ensurePlatformSchema } from "../src/modules/platform/schema";
import {
  addOrgAgent,
  audit,
  countAdmins,
  createAdmin,
  createOrg,
  createOrgUser,
  deleteOrg,
  getAdminByEmail,
  getOrg,
  getOrgByStripeCustomer,
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
  unmarkStripeEvent,
  updateOrg,
  upsertInvoice,
  upsertPlan,
} from "../src/modules/platform/repo";
import { verifyPassword } from "../src/modules/platform/passwords";
import { recordAiUsage, aiUsageForOrg } from "../src/modules/platform/ai-usage";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL lipsește — pornește un Postgres de test.");
    process.exit(1);
  }
  const db = getDB()!;

  // Pornim de la zero ca testul să fie repetabil.
  await db.unsafe(`
    DROP TABLE IF EXISTS stripe_events, audit_log, invoices, org_agents,
      org_users, organizations, plans, platform_admins CASCADE;
  `);

  console.log("\n── Schema ──");
  await ensurePlatformSchema();
  const tables = await db<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  const names = tables.map((t) => t.table_name);
  for (const t of [
    "platform_admins",
    "organizations",
    "org_users",
    "org_agents",
    "plans",
    "invoices",
    "audit_log",
    "stripe_events",
  ]) {
    check(`tabela ${t} există`, names.includes(t));
  }

  // Idempotență: a doua rulare nu trebuie să arunce.
  const { resetPlatformSchemaCache } = await import(
    "../src/modules/platform/schema"
  );
  resetPlatformSchemaCache();
  await ensurePlatformSchema();
  check("DDL-ul e idempotent (rulat de două ori)", true);

  console.log("\n── Planuri ──");
  const plans = await listPlans();
  check("planurile implicite au fost create", plans.length === 3);
  check(
    "planurile sunt ordonate crescător după preț",
    plans[0].priceCents <= plans[1].priceCents &&
      plans[1].priceCents <= plans[2].priceCents,
  );
  check("planul Start are 3 agenți", plans.find((p) => p.id === "start")?.agentLimit === 3);

  resetPlatformSchemaCache();
  await ensurePlatformSchema();
  check(
    "re-seed-ul NU duplică planurile",
    (await listPlans()).length === 3,
  );

  const custom = await upsertPlan({
    name: "Enterprise Județean",
    priceCents: 249900,
    agentLimit: 100,
    stripePriceId: "price_TEST123",
  });
  check("planul nou primește slug din nume", custom.id === "enterprise-judetean");
  check("prețul se salvează în bani", custom.priceCents === 249900);

  const updated = await upsertPlan({
    id: custom.id,
    name: "Enterprise",
    priceCents: 299900,
    agentLimit: 120,
  });
  check("upsert pe același id actualizează, nu duplică", updated.priceCents === 299900);
  check("planurile sunt acum 4", (await listPlans()).length === 4);

  console.log("\n── Admini ──");
  check("nu există admini la început", (await countAdmins()) === 0);
  const admin = await createAdmin("sef@platforma.ro", "parola-super-secreta", "Șef");
  check("adminul a fost creat", admin.email === "sef@platforma.ro");
  check("countAdmins vede adminul", (await countAdmins()) === 1);
  const fetched = await getAdminByEmail("SEF@PLATFORMA.RO");
  check("emailul e case-insensitive la căutare", fetched?.id === admin.id);
  check(
    "parola stocată se verifică",
    await verifyPassword("parola-super-secreta", fetched!.passwordHash),
  );

  console.log("\n── Organizații ──");
  const org = await createOrg({
    name: "Distribuție Nord SRL",
    cui: "12345678",
    email: "contact@nord.ro",
    planId: "pro",
    trialDays: 14,
    agentLimit: 10,
  });
  check("organizația a fost creată", !!org.id);
  check("statusul implicit e trial", org.status === "trial");
  check("trialul se setează la 14 zile", !!org.trialEndsAt);
  check(
    "trialul expiră peste ~14 zile",
    Math.abs(
      (new Date(org.trialEndsAt!).getTime() - Date.now()) / 86400_000 - 14,
    ) < 0.1,
  );

  const org2 = await createOrg({ name: "Alfa Trade SRL", planId: "start", status: "activ" });
  await createOrg({ name: "Beta Distrib SRL", planId: "business", status: "activ" });
  await createOrg({ name: "Gama SRL", status: "suspendat", trialDays: 0 });

  const all = await listOrgs();
  check("listOrgs întoarce toate cele 4 organizații", all.total === 4);
  check("planName e populat din join", all.orgs.some((o) => o.planName === "Pro"));

  const searched = await listOrgs({ search: "alfa" });
  check("căutarea după nume e case-insensitive", searched.total === 1);
  const byCui = await listOrgs({ search: "1234" });
  check("căutarea după prefix de CUI merge", byCui.total === 1);
  const filtered = await listOrgs({ status: "activ" });
  check("filtrarea după status merge", filtered.total === 2);

  const patched = await updateOrg(org.id, {
    status: "activ",
    agentLimit: 25,
    note: "client important",
  });
  check("updateOrg schimbă statusul", patched?.status === "activ");
  check("updateOrg schimbă limita de agenți", patched?.agentLimit === 25);
  check("updateOrg păstrează câmpurile neatinse", patched?.name === "Distribuție Nord SRL");

  await updateOrg(org.id, { stripeCustomerId: "cus_TEST1" });
  const byCustomer = await getOrgByStripeCustomer("cus_TEST1");
  check("căutarea după stripe_customer_id merge", byCustomer?.id === org.id);

  console.log("\n── Conturi și agenți ──");
  const user = await createOrgUser(org.id, "patron@nord.ro", "parola-firma-1", "Patron", "owner");
  check("contul de firmă a fost creat", user.email === "patron@nord.ro");
  await createOrgUser(org.id, "manager@nord.ro", "parola-firma-2", "Manager", "manager");
  const users = await listOrgUsers(org.id);
  check("organizația are 2 conturi", users.length === 2);
  check("rolurile se păstrează", users.some((u) => u.role === "manager"));

  await setOrgUserActive(user.id, false);
  check(
    "dezactivarea contului se salvează",
    (await listOrgUsers(org.id)).find((u) => u.id === user.id)?.active === false,
  );

  let dupErr = false;
  try {
    await createOrgUser(org2.id, "patron@nord.ro", "alta-parola", "X");
  } catch {
    dupErr = true;
  }
  check("același email nu poate avea două conturi", dupErr);

  await addOrgAgent(org.id, "a-001", "Gavrilet Bogdan");
  await addOrgAgent(org.id, "a-002", "Ion Popescu");
  await addOrgAgent(org.id, "a-001", "Gavrilet B.");
  const agents = await listOrgAgents(org.id);
  check("agenții se adaugă fără duplicate", agents.length === 2);
  check(
    "re-adăugarea aceluiași agent îi actualizează numele",
    agents.find((a) => a.agentId === "a-001")?.name === "Gavrilet B.",
  );

  const orgWithCounts = await getOrg(org.id);
  check("numărul de conturi e calculat", orgWithCounts?.userCount === 2);
  check("numărul de agenți e calculat", orgWithCounts?.agentCount === 2);

  console.log("\n── Facturi ──");
  const inv1 = await upsertInvoice({
    orgId: org.id,
    stripeInvoiceId: "in_TEST1",
    number: "BCA-001",
    amountCents: 49900,
    status: "open",
  });
  check("factura a fost creată", inv1.number === "BCA-001");

  const inv1b = await upsertInvoice({
    orgId: org.id,
    stripeInvoiceId: "in_TEST1",
    number: "BCA-001",
    amountCents: 49900,
    status: "paid",
    pdfUrl: "https://stripe.test/factura.pdf",
    paidAt: new Date().toISOString(),
  });
  check("upsert pe același stripe_invoice_id actualizează", inv1b.status === "paid");
  check("linkul PDF se salvează", inv1b.pdfUrl === "https://stripe.test/factura.pdf");
  check(
    "nu s-a creat o factură duplicat",
    (await listInvoices({ orgId: org.id })).total === 1,
  );

  const manual = await upsertInvoice({
    orgId: org2.id,
    stripeInvoiceId: null,
    number: "BCA-002",
    amountCents: 19900,
    status: "open",
  });
  const manual2 = await upsertInvoice({
    orgId: org2.id,
    stripeInvoiceId: null,
    number: "BCA-003",
    amountCents: 19900,
    status: "open",
  });
  check(
    "facturile manuale (fără id Stripe) nu se ciocnesc între ele",
    manual.id !== manual2.id && (await listInvoices({ orgId: org2.id })).total === 2,
  );

  await setInvoiceStatus(manual.id, "paid");
  const paidNow = (await listInvoices({ orgId: org2.id })).invoices.find(
    (i) => i.id === manual.id,
  );
  check("schimbarea statusului setează și paid_at", !!paidNow?.paidAt);

  check(
    "filtrarea facturilor după status merge",
    (await listInvoices({ status: "paid" })).total === 2,
  );
  check("orgName e populat din join", !!paidNow?.orgName);

  console.log("\n── Metrici ──");
  const m = await platformMetrics();
  check("total organizații = 4", m.orgs.total === 4);
  check("organizații active = 3", m.orgs.activ === 3);
  check("organizații suspendate = 1", m.orgs.suspendat === 1);
  check("utilizatori = 2", m.users === 2);
  check("agenți = 2", m.agents === 2);
  // MRR: Nord=Pro 499, Alfa=Start 199, Beta=Business 999 → 1697 RON
  check(
    `MRR = 169700 bani (a ieșit ${m.mrrCents})`,
    m.mrrCents === 169700,
  );
  check("încasat = 499 + 199 = 69800 bani", m.invoices.paidCents === 69800);
  check("de încasat = 19900 bani", m.invoices.openCents === 19900);
  check("total facturi = 3", m.invoices.count === 3);
  check(
    "metricile de prospecți nu aruncă (tabela e opțională)",
    Number.isFinite(m.prospects.total) && m.prospects.total >= 0,
  );

  const series = await monthlySeries(12);
  check("seria lunară are 12 puncte", series.length === 12);
  check(
    "luna curentă conține cele 4 organizații noi",
    series[series.length - 1].orgs === 4,
  );
  check(
    "luna curentă conține încasările",
    series[series.length - 1].paidCents === 69800,
  );

  console.log("\n── Audit & idempotență Stripe ──");
  await audit("sef@platforma.ro", "org.create", org.id, { name: "Distribuție Nord SRL" });
  await audit("sef@platforma.ro", "invoice.status", inv1.id, { status: "paid" });
  const log = await listAudit(10);
  check("jurnalul are 2 intrări", log.total === 2);
  check("cea mai nouă intrare e prima", log.entries[0].action === "invoice.status");
  check("meta se salvează ca JSON", log.entries[0].meta.status === "paid");

  check("primul eveniment Stripe e nou", await markStripeEvent("evt_1", "invoice.paid"));
  check(
    "al doilea apel pentru același eveniment e duplicat",
    !(await markStripeEvent("evt_1", "invoice.paid")),
  );
  await unmarkStripeEvent("evt_1");
  check(
    "după unmark evenimentul poate fi reprocesat",
    await markStripeEvent("evt_1", "invoice.paid"),
  );

  console.log("\n── Ștergere în cascadă ──");
  await deleteOrg(org.id);
  check("organizația a fost ștearsă", (await getOrg(org.id)) === null);
  check("conturile firmei au fost șterse", (await listOrgUsers(org.id)).length === 0);
  check("agenții au fost șterși", (await listOrgAgents(org.id)).length === 0);
  check(
    "facturile organizației au fost șterse",
    (await listInvoices({ orgId: org.id })).total === 0,
  );
  check("celelalte organizații rămân", (await listOrgs()).total === 3);

  console.log("\n══ Contor de consum AI ══");
  const aiOrg = await createOrg({ name: "QA AI Usage SRL", email: "aiusage@test.ro" });
  await addOrgAgent(aiOrg.id, "ag-ai-test", "Test AI");
  // Direct pe org
  await recordAiUsage({ kind: "briefing", orgId: aiOrg.id });
  await recordAiUsage({ kind: "client_voice", orgId: aiOrg.id });
  // Prin agent (trebuie să afle firma singur)
  await recordAiUsage({ kind: "ocr", agentId: "ag-ai-test" });
  await recordAiUsage({ kind: "ocr", agentId: "ag-ai-test" });
  await recordAiUsage({ kind: "coach", agentId: "ag-ai-test" });
  const usage = await aiUsageForOrg(aiOrg.id, 30);
  check("consumul numără toate apelurile (5)", usage.totalCalls === 5, `${usage.totalCalls}`);
  check(
    "apelul prin agent s-a legat de firmă (2 ocr)",
    (usage.byKind.find((k) => k.kind === "ocr")?.calls ?? 0) === 2,
  );
  // ocr=2×1 + briefing=12 + client_voice=12 + coach=15 = 41 bani
  check("costul estimat e însumat corect (41 bani)", usage.totalBani === 41, `${usage.totalBani}`);
  check("fără consum pe altă firmă", (await aiUsageForOrg("org-inexistent", 30)).totalCalls === 0);
  await getDB()!`DELETE FROM ai_usage WHERE org_id = ${aiOrg.id}`;
  await deleteOrg(aiOrg.id);

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate\n`,
  );
  await db.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
