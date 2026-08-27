import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/** Jurnalul de vizite al întregii agenții, cu filtre pe agent și perioadă. */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent") ?? "";
  const days = Math.min(
    365,
    Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30),
  );
  const limit = Math.min(
    500,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    // Filtrul de agent trebuie să fie DIN organizație — altfel ignorat.
    const scoped = agentId && ids.includes(agentId) ? [agentId] : ids;

    // ?foto=<id vizită> → poza de la vizită, decriptată — DOAR dacă
    // vizita e a unui agent al firmei ăsteia (aceeași pază ca la facturi).
    const fotoId = url.searchParams.get("foto") ?? "";
    if (fotoId !== "") {
      const [fr] = await db<Array<{ foto: string }>>`
        SELECT foto FROM visits
        WHERE id::text = ${fotoId}
          AND agent_id = ANY(${ids.length ? ids : [""]})
          AND foto <> ''
      `;
      if (!fr) return Response.json({ error: "Poza nu există" }, { status: 404 });
      const { decryptData } = await import("@/lib/crypto-data");
      const dataUrl = await decryptData(fr.foto);
      const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/s);
      if (!m) return Response.json({ error: "Poza e stricată" }, { status: 500 });
      return new Response(Buffer.from(m[2], "base64"), {
        headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=300" },
      });
    }

    const rows = await db<
      Array<{
        id: string;
        agent_id: string;
        agent_name: string;
        cui: string;
        denumire: string;
        result: string;
        note: string;
        visited_at: Date;
        are_foto: boolean;
      }>
    >`
      SELECT id::text, agent_id, agent_name, cui, denumire, result, note, visited_at,
             (foto <> '') AS are_foto
      FROM visits
      WHERE agent_id = ANY(${scoped.length ? scoped : [""]})
        AND visited_at >= NOW() - (${days} || ' days')::interval
      ORDER BY visited_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM visits
      WHERE agent_id = ANY(${scoped.length ? scoped : [""]})
        AND visited_at >= NOW() - (${days} || ' days')::interval
    `;

    return Response.json({
      total: parseInt(count, 10),
      visits: rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        agentName: r.agent_name,
        cui: r.cui,
        denumire: r.denumire,
        result: r.result,
        note: r.note,
        areFoto: r.are_foto === true,
        visitedAt: r.visited_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[agentie visits]", e);
    return Response.json({ error: "Eroare la citirea vizitelor" }, { status: 500 });
  }
}
