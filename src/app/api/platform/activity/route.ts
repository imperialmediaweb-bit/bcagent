import { getDB, isDBEnabled } from "@/lib/db";
import { ensurePlatformSchema, requireAdmin } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Fluxul de activitate pentru admin: TOT ce s-a împiedicat (erori prinse
 * automat, login-uri eșuate) + ce au făcut utilizatorii (jurnalul de
 * audit) — ca să vezi TU unde se blochează testerii, fără să-ți spună ei.
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const hours = Math.min(
    24 * 14,
    Math.max(1, parseInt(url.searchParams.get("hours") ?? "48", 10) || 48),
  );

  try {
    await ensurePlatformSchema();

    // Erorile prinse automat, grupate ca să nu te înece zgomotul.
    const errors = await db<
      Array<{
        kind: string;
        message: string;
        page: string;
        status: number | null;
        n: string;
        last: Date;
      }>
    >`
      SELECT kind, message, page, status, COUNT(*)::text AS n, MAX(created_at) AS last
      FROM app_events
      WHERE created_at > NOW() - (${hours} || ' hours')::interval
      GROUP BY kind, message, page, status
      ORDER BY MAX(created_at) DESC
      LIMIT 100
    `;

    const failedLogins = await db<
      Array<{ kind: string; email: string; ip: string; n: string; last: Date }>
    >`
      SELECT kind, email, ip, COUNT(*)::text AS n, MAX(created_at) AS last
      FROM login_events
      WHERE ok = FALSE AND created_at > NOW() - (${hours} || ' hours')::interval
      GROUP BY kind, email, ip
      ORDER BY MAX(created_at) DESC
      LIMIT 50
    `;

    const activity = await db<
      Array<{ actor: string; action: string; target: string; created_at: Date }>
    >`
      SELECT actor, action, target, created_at FROM audit_log
      WHERE created_at > NOW() - (${hours} || ' hours')::interval
      ORDER BY created_at DESC
      LIMIT 150
    `;

    return Response.json({
      errors: errors.map((e) => ({
        kind: e.kind,
        message: e.message,
        page: e.page,
        status: e.status,
        count: parseInt(e.n, 10),
        last: e.last.toISOString(),
      })),
      failedLogins: failedLogins.map((f) => ({
        kind: f.kind,
        email: f.email,
        ip: f.ip,
        count: parseInt(f.n, 10),
        last: f.last.toISOString(),
      })),
      activity: activity.map((a) => ({
        actor: a.actor,
        action: a.action,
        target: a.target,
        at: a.created_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[platform activity]", e);
    return Response.json({ error: "Eroare la citirea activității" }, { status: 500 });
  }
}
