import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { timingSafeEqual } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Statistici bază de prospecți — pentru panoul de admin. */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json(
      { error: "Baza de date nu e configurată" },
      { status: 503 },
    );
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDB();
  if (!db) return Response.json({ error: "DB indisponibil" }, { status: 503 });

  try {
    await ensureSchema();
    const [totals] = await db<
      [{ total: string; verified: string; pending: string }]
    >`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE activ IS NOT NULL)::text AS verified,
             COUNT(*) FILTER (WHERE activ IS NULL)::text AS pending
      FROM prospects
    `;
    const byCounty = await db<Array<{ judet: string; count: string }>>`
      SELECT judet, COUNT(*)::text AS count
      FROM prospects
      GROUP BY judet
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `;
    return Response.json({
      total: parseInt(totals.total, 10),
      verified: parseInt(totals.verified, 10),
      pending: parseInt(totals.pending, 10),
      byCounty: byCounty.map((c) => ({
        judet: c.judet,
        count: parseInt(c.count, 10),
      })),
    });
  } catch (e) {
    console.error("[prospects stats]", e);
    return Response.json({ error: "Eroare la statistici" }, { status: 500 });
  }
}
