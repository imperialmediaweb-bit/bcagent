import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { requireAdmin } from "@/modules/platform";

export const runtime = "nodejs";

/** Problemele raportate — pentru pagina /platform/probleme. */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const status = new URL(req.url).searchParams.get("status") ?? "";
  try {
    await ensureSchema();
    const rows = await db<
      Array<{
        id: string;
        reporter: string;
        role: string;
        page: string;
        message: string;
        ai_diagnosis: string;
        status: string;
        created_at: Date;
      }>
    >`
      SELECT id, reporter, role, page, message, ai_diagnosis, status, created_at
      FROM issues
      WHERE (${status} = '' OR status = ${status})
      ORDER BY created_at DESC LIMIT 200
    `;
    const [counts] = await db<[{ noi: string; total: string }]>`
      SELECT COUNT(*) FILTER (WHERE status = 'noua')::text AS noi,
             COUNT(*)::text AS total
      FROM issues
    `;
    return Response.json({
      noi: parseInt(counts.noi, 10),
      total: parseInt(counts.total, 10),
      issues: rows.map((r) => ({
        id: r.id,
        reporter: r.reporter,
        role: r.role,
        page: r.page,
        message: r.message,
        aiDiagnosis: r.ai_diagnosis,
        status: r.status,
        createdAt: r.created_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[platform issues GET]", e);
    return Response.json({ error: "Eroare la citire" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  const status = ["noua", "in_lucru", "rezolvata"].includes(String(body.status))
    ? String(body.status)
    : "";
  if (!id || !status) {
    return Response.json({ error: "id/status invalid" }, { status: 400 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    await db`UPDATE issues SET status = ${status} WHERE id = ${id}`;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[platform issues PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}
