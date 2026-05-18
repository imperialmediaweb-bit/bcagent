import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

interface BatchPayload {
  id: string;
  fileName: string;
  uploadedAt: string;
  rowCount: number;
  dateRange: { min: string; max: string };
  rows: Array<{
    date: string;
    agent: string;
    producer: string;
    client: string;
    volume: number;
    value: number;
  }>;
}

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false });
  }
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: { token?: string; batch?: BatchPayload };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.token || !body.batch) {
    return Response.json(
      { error: "token și batch sunt obligatorii" },
      { status: 400 },
    );
  }
  const payload = await verifyToken(body.token, tokenSecret);
  if (!payload) {
    return Response.json({ error: "Token invalid" }, { status: 401 });
  }

  const b = body.batch;
  if (!b.id || !b.fileName || !Array.isArray(b.rows)) {
    return Response.json({ error: "batch incomplet" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false });

  try {
    await ensureSchema();
    await db`
      INSERT INTO batches (id, agent_id, file_name, uploaded_at, row_count, date_min, date_max, rows)
      VALUES (
        ${b.id},
        ${payload.agentId},
        ${b.fileName},
        ${new Date(b.uploadedAt)},
        ${b.rowCount},
        ${b.dateRange.min},
        ${b.dateRange.max},
        ${db.json(b.rows)}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
