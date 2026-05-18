import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false });
  }
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return Response.json({ error: "token lipsește" }, { status: 400 });
  }
  const payload = await verifyToken(token, tokenSecret);
  if (!payload) {
    return Response.json({ error: "Token invalid" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "id lipsește" }, { status: 400 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false });
  try {
    await ensureSchema();
    await db`
      DELETE FROM batches
      WHERE id = ${id} AND agent_id = ${payload.agentId}
    `;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
