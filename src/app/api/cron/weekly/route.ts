import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import {
  buildWeeklyReport,
  renderReportHTML,
} from "@/modules/platform/weekly-report";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cronul de luni dimineața: trimite raportul săptămânal pe email tuturor
 * patronilor/managerilor activi din toate firmele.
 *
 * Se apelează extern (Railway Cron / cron-job.org), luni la 07:00:
 *   GET /api/cron/weekly?secret=<CRON_SECRET>
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET lipsește" }, { status: 503 });
  }
  const given = new URL(req.url).searchParams.get("secret") ?? "";
  if (given !== secret) {
    return Response.json({ error: "Secret invalid" }, { status: 401 });
  }
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  if (!isEmailEnabled()) {
    return Response.json({ error: "RESEND_API_KEY lipsește" }, { status: 503 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const orgs = await db<Array<{ id: string; name: string }>>`
      SELECT id, name FROM organizations
      WHERE status IN ('activ', 'trial')
      ORDER BY created_at LIMIT 200
    `;

    let sent = 0;
    const errors: string[] = [];
    for (const org of orgs) {
      try {
        const users = await db<Array<{ email: string }>>`
          SELECT email FROM org_users
          WHERE org_id = ${org.id} AND active
        `;
        if (users.length === 0) continue;
        const report = await buildWeeklyReport(org.id, org.name, true);
        // Firma fără nicio activitate nu primește email gol.
        if (report.agents.length === 0) continue;
        const html = renderReportHTML(report);
        for (const u of users) {
          await sendEmail({
            to: u.email,
            subject: `📊 ${org.name} — raportul săptămânii`,
            html,
          });
          sent++;
        }
      } catch (e) {
        errors.push(`${org.name}: ${e instanceof Error ? e.message : "eroare"}`);
      }
    }
    return Response.json({ ok: true, orgs: orgs.length, sent, errors });
  } catch (e) {
    console.error("[cron weekly]", e);
    return Response.json({ error: "Eroare la cron" }, { status: 500 });
  }
}
