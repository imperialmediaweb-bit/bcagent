import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Celulă de CSV inofensivă: Excel execută ca formulă orice text care
 * începe cu = + - @, deci îl prefixăm cu apostrof.
 */
function csvCell(value: unknown): string {
  let s = String(value ?? "").replace(/[\r\n]+/g, " ").replace(/;/g, ",");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

/** Deconturile echipei: managerul aprobă/respinge, contabila exportă. */

const STATUSES = new Set(["in_asteptare", "aprobat", "respins"]);

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "")
    ? url.searchParams.get("month")!
    : new Date().toISOString().slice(0, 7);
  const status = url.searchParams.get("status") ?? "";
  const wantCsv = url.searchParams.get("export") === "csv";

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);

    const rows = await db<
      Array<{
        id: string;
        agent_name: string;
        spent_on: Date;
        category: string;
        amount_cents: number;
        note: string;
        status: string;
      }>
    >`
      SELECT id, agent_name, spent_on, category, amount_cents, note, status
      FROM expenses
      WHERE agent_id = ANY(${ids.length ? ids : [""]})
        AND to_char(spent_on, 'YYYY-MM') = ${month}
        AND (${status} = '' OR status = ${status})
      ORDER BY spent_on DESC
      LIMIT 1000
    `;

    if (wantCsv) {
      const head = "Data;Agent;Categorie;Suma;Status;Nota\n";
      const body = rows
        .map((r) =>
          [
            r.spent_on.toISOString().slice(0, 10),
            r.agent_name,
            r.category,
            (r.amount_cents / 100).toFixed(2),
            r.status,
            r.note,
          ]
            .map((v) => csvCell(v))
            .join(";"),
        )
        .join("\n");
      return new Response("﻿" + head + body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="decont-${month}.csv"`,
        },
      });
    }

    // Totaluri per agent, pe luna selectată (doar aprobat + în așteptare).
    const totals = new Map<string, { total: number; aprobat: number }>();
    for (const r of rows) {
      const t = totals.get(r.agent_name) ?? { total: 0, aprobat: 0 };
      if (r.status !== "respins") t.total += r.amount_cents;
      if (r.status === "aprobat") t.aprobat += r.amount_cents;
      totals.set(r.agent_name, t);
    }

    return Response.json({
      month,
      totals: Array.from(totals.entries()).map(([agent, t]) => ({
        agent,
        totalCents: t.total,
        approvedCents: t.aprobat,
      })),
      expenses: rows.map((r) => ({
        id: r.id,
        agentName: r.agent_name,
        date: r.spent_on.toISOString().slice(0, 10),
        category: r.category,
        amountCents: r.amount_cents,
        note: r.note,
        status: r.status,
      })),
    });
  } catch (e) {
    console.error("[agentie expenses GET]", e);
    return Response.json({ error: "Eroare la citirea deconturilor" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { id?: string; status?: string };
  try {
    await ensureSchema();
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const status = String(body.status ?? "");
  if (!id || !STATUSES.has(status)) {
    return Response.json({ error: "id/status invalid" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    const rows = await db<Array<{ id: string }>>`
      UPDATE expenses SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND agent_id = ANY(${ids.length ? ids : [""]})
      RETURNING id
    `;
    if (rows.length === 0) {
      return Response.json({ error: "Decontul nu e al firmei tale" }, { status: 403 });
    }
    await audit(auth.session.email, "expense.status", id, { status });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie expenses PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}
