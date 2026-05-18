import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false });
  }
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  let body: {
    token?: string;
    defaultRate?: number;
    avgPrice?: number;
    agentRates?: Record<string, number>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.token) {
    return Response.json({ error: "token lipsește" }, { status: 400 });
  }
  const payload = await verifyToken(body.token, tokenSecret);
  if (!payload) {
    return Response.json({ error: "Token invalid" }, { status: 401 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false });
  try {
    await ensureSchema();
    await db`
      INSERT INTO agent_settings (agent_id, default_rate, avg_price, agent_rates, updated_at)
      VALUES (
        ${payload.agentId},
        ${body.defaultRate ?? 5},
        ${body.avgPrice ?? 1},
        ${db.json(body.agentRates ?? {})},
        NOW()
      )
      ON CONFLICT (agent_id) DO UPDATE SET
        default_rate = EXCLUDED.default_rate,
        avg_price = EXCLUDED.avg_price,
        agent_rates = EXCLUDED.agent_rates,
        updated_at = NOW()
    `;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
