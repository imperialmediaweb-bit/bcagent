import { isDBEnabled } from "@/lib/db";
import {
  listInvoices,
  listOrgs,
  monthlySeries,
  platformMetrics,
  requireAdmin,
} from "@/modules/platform";

export const runtime = "nodejs";

/** Datele dashboard-ului: KPI + evoluție lunară + ultimele mișcări. */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  try {
    const [metrics, series, recentOrgs, recentInvoices] = await Promise.all([
      platformMetrics(),
      monthlySeries(12),
      listOrgs({ limit: 5 }),
      listInvoices({ limit: 5 }),
    ]);
    return Response.json({
      metrics,
      series,
      recentOrgs: recentOrgs.orgs,
      recentInvoices: recentInvoices.invoices,
    });
  } catch (e) {
    console.error("[platform metrics]", e);
    return Response.json({ error: "Eroare la citirea metricilor" }, { status: 500 });
  }
}
