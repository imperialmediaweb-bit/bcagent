import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Decontul agentului: motorină, diurnă, service — trimis din teren. */

const CATEGORIES = new Set(["combustibil", "diurna", "cazare", "service", "alte"]);

async function authorize(req: Request, tokenFromBody?: string) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  const token =
    tokenFromBody ?? new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return null;
  return verifyFieldToken(token, secret);
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`expenses:${clientIP(req)}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  let body: {
    token?: string;
    date?: string;
    category?: string;
    amount?: number;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = await authorize(req, body.token);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }

  const date = String(body.date ?? new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Dată invalidă" }, { status: 400 });
  }
  const category = CATEGORIES.has(String(body.category ?? ""))
    ? String(body.category)
    : "alte";
  const amountCents = Math.round((Number(body.amount) || 0) * 100);
  if (amountCents <= 0 || amountCents > 100_000_00) {
    return Response.json({ error: "Sumă invalidă" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const id = `exp_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await db`
      INSERT INTO expenses (id, agent_id, agent_name, spent_on, category, amount_cents, note)
      VALUES (${id}, ${payload.agentId}, ${payload.agentName}, ${date},
              ${category}, ${amountCents}, ${String(body.note ?? "").slice(0, 300)})
    `;
    return Response.json({ ok: true, id });
  } catch (e) {
    console.error("[expenses POST]", e);
    return Response.json({ error: "Eroare la trimiterea decontului" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const payload = await authorize(req);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const rows = await db<
      Array<{
        id: string;
        spent_on: Date;
        category: string;
        amount_cents: number;
        note: string;
        status: string;
      }>
    >`
      SELECT id, spent_on, category, amount_cents, note, status FROM expenses
      WHERE agent_id = ${payload.agentId}
      ORDER BY spent_on DESC, created_at DESC LIMIT 60
    `;
    const [month] = await db<[{ total: string; aprobat: string }]>`
      SELECT COALESCE(SUM(amount_cents), 0)::text AS total,
             COALESCE(SUM(amount_cents) FILTER (WHERE status = 'aprobat'), 0)::text AS aprobat
      FROM expenses
      WHERE agent_id = ${payload.agentId}
        AND spent_on >= date_trunc('month', NOW())
    `;
    return Response.json({
      monthTotalCents: parseInt(month.total, 10),
      monthApprovedCents: parseInt(month.aprobat, 10),
      expenses: rows.map((r) => ({
        id: r.id,
        date: r.spent_on.toISOString().slice(0, 10),
        category: r.category,
        amountCents: r.amount_cents,
        note: r.note,
        status: r.status,
      })),
    });
  } catch (e) {
    console.error("[expenses GET]", e);
    return Response.json({ error: "Eroare la citirea decontului" }, { status: 500 });
  }
}
