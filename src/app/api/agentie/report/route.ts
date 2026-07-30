import { ensureSchema, isDBEnabled } from "@/lib/db";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { audit, getOrg, requireOrgUser } from "@/modules/platform";
import {
  buildWeeklyReport,
  renderReportHTML,
} from "@/modules/platform/weekly-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Raportul săptămânal al firmei — pentru pagina /agentie/raport. */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  try {
    await ensureSchema();
    const org = await getOrg(auth.session.orgId);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });
    const report = await buildWeeklyReport(auth.session.orgId, org.name, true);
    return Response.json({ report, emailEnabled: isEmailEnabled() });
  } catch (e) {
    console.error("[agentie report]", e);
    return Response.json({ error: "Eroare la generarea raportului" }, { status: 500 });
  }
}

/** „Trimite-mi raportul pe email" — la adresa contului logat. */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const rl = rateLimit(`report-mail:${clientIP(req)}`, { max: 3, windowMs: 300_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe trimiteri" }, { status: 429 });
  if (!isEmailEnabled()) {
    return Response.json(
      { error: "Emailul nu e configurat (RESEND_API_KEY)" },
      { status: 503 },
    );
  }
  try {
    await ensureSchema();
    const org = await getOrg(auth.session.orgId);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });
    const report = await buildWeeklyReport(auth.session.orgId, org.name, true);
    await sendEmail({
      to: auth.session.email,
      subject: `📊 ${org.name} — raportul săptămânii`,
      html: renderReportHTML(report),
    });
    await audit(auth.session.email, "report.email", auth.session.orgId);
    return Response.json({ ok: true, to: auth.session.email });
  } catch (e) {
    console.error("[agentie report POST]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Eroare la trimitere" },
      { status: 500 },
    );
  }
}
