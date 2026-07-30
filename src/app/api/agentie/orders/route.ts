import { isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Comenzile din teren, în panoul agenției: depozitul le vede live, le trece
 * prin stări (nouă → pregătită → livrată), contabila le exportă în CSV
 * gata de importat (SAGA / Excel).
 */

const STATUSES = ["noua", "pregatita", "livrata", "anulata"] as const;

interface OrderLine {
  produs: string;
  cantitate: number;
  um: string;
  pret: number | null;
}

interface OrderRow {
  id: string;
  agent_id: string;
  agent_name: string;
  cui: string;
  denumire: string;
  localitate: string;
  lines: OrderLine[];
  note: string;
  status: string;
  total_value: number | null;
  created_at: Date;
}

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "";
  const agentId = url.searchParams.get("agent") ?? "";
  const days = Math.min(
    365,
    Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30),
  );
  const wantCsv = url.searchParams.get("export") === "csv";

  try {
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    const scoped = agentId && ids.includes(agentId) ? [agentId] : ids;

    const rows = await db<OrderRow[]>`
      SELECT * FROM orders
      WHERE agent_id = ANY(${scoped.length ? scoped : [""]})
        AND (${status} = '' OR status = ${status})
        AND created_at >= NOW() - (${days} || ' days')::interval
      ORDER BY created_at DESC
      LIMIT ${wantCsv ? 5000 : 300}
    `;

    if (wantCsv) {
      // O linie CSV per produs — formatul pe care îl înghite orice
      // gestiune (SAGA import / Excel): separator ; și BOM pentru diacritice.
      const head =
        "Data;Ora;Agent;Client;CUI;Localitate;Produs;Cantitate;UM;Pret;Valoare;Status;Nota\n";
      const body = rows
        .flatMap((r) =>
          (r.lines ?? []).map((l) =>
            [
              r.created_at.toISOString().slice(0, 10),
              r.created_at.toISOString().slice(11, 16),
              r.agent_name,
              r.denumire,
              r.cui,
              r.localitate,
              l.produs,
              l.cantitate,
              l.um,
              l.pret ?? "",
              l.pret !== null ? (l.cantitate * l.pret).toFixed(2) : "",
              r.status,
              r.note.replace(/[\r\n;]+/g, " "),
            ]
              .map((v) => String(v).replace(/;/g, ","))
              .join(";"),
          ),
        )
        .join("\n");
      await audit(auth.session.email, "orders.export", auth.session.orgId, {
        rows: rows.length,
      });
      return new Response("﻿" + head + body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="comenzi-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // Contoare pe stări pentru filtrele din UI.
    const counts = await db<Array<{ status: string; n: string }>>`
      SELECT status, COUNT(*)::text AS n FROM orders
      WHERE agent_id = ANY(${ids.length ? ids : [""]})
        AND created_at >= NOW() - (${days} || ' days')::interval
      GROUP BY status
    `;

    return Response.json({
      counts: Object.fromEntries(counts.map((c) => [c.status, parseInt(c.n, 10)])),
      orders: rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        agentName: r.agent_name,
        cui: r.cui,
        denumire: r.denumire,
        localitate: r.localitate,
        lines: r.lines ?? [],
        note: r.note,
        status: r.status,
        totalValue: r.total_value,
        createdAt: r.created_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[agentie orders GET]", e);
    return Response.json({ error: "Eroare la citirea comenzilor" }, { status: 500 });
  }
}

/** Avansarea stării unei comenzi (depozitul apasă pe măsură ce lucrează). */
export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const status = String(body.status ?? "");
  if (!id || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return Response.json({ error: "id/status invalid" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    // Doar comenzile agenților propriei organizații.
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    const rows = await db<Array<{ id: string }>>`
      UPDATE orders SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND agent_id = ANY(${ids.length ? ids : [""]})
      RETURNING id
    `;
    if (rows.length === 0) {
      return Response.json({ error: "Comanda nu e a firmei tale" }, { status: 403 });
    }
    await audit(auth.session.email, "order.status", id, { status });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie orders PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}
