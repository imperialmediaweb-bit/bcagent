import { verifyFieldToken } from "@/lib/agent-guard";
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
  const payload = await verifyFieldToken(token, tokenSecret);
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
    // „Anulează încărcarea", nu „șterge istoricul": agentul poate scoate
    // doar un fișier urcat de el ÎN ULTIMELE 24h (greșeala de azi).
    // Istoricul mai vechi rămâne al firmei — agenții se schimbă, datele nu
    // pleacă odată cu ei.
    const sters = await db`
      DELETE FROM batches
      WHERE id = ${id} AND agent_id = ${payload.agentId}
        AND uploaded_at > NOW() - INTERVAL '24 hours'
    `;
    if (sters.count === 0) {
      const [exista] = await db<Array<{ n: string }>>`
        SELECT COUNT(*)::text AS n FROM batches
        WHERE id = ${id} AND agent_id = ${payload.agentId}
      `;
      if (exista && exista.n !== "0") {
        return Response.json(
          {
            error:
              "Fișierele mai vechi de o zi rămân în istoricul firmei. Cere managerului dacă trebuie scos.",
          },
          { status: 403 },
        );
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
