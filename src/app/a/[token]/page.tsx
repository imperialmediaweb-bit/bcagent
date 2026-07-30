import { notFound } from "next/navigation";
import { verifyToken } from "@/lib/signed-token";
import { isAIEnabled } from "@/lib/llm";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";

/**
 * Linkurile magice sunt semnate stateless, dar un agent DEZACTIVAT din
 * panoul platformei trebuie blocat instant — chiar dacă tokenul mai are
 * valabilitate. Agenții emiși în afara unei organizații trec nestingheriți.
 */
async function isAgentDeactivated(agentId: string): Promise<boolean> {
  if (!isDBEnabled()) return false;
  const db = getDB();
  if (!db) return false;
  try {
    await ensureSchema();
    const rows = await db<Array<{ active: boolean }>>`
      SELECT active FROM org_agents WHERE agent_id = ${agentId}
      ORDER BY active ASC LIMIT 1
    `;
    return rows.length > 0 && rows[0].active === false;
  } catch {
    // La orice eroare de DB nu blocăm accesul — tokenul semnat rămâne legea.
    return false;
  }
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    throw new Error("TOKEN_SECRET not configured");
  }
  const payload = await verifyToken(token, secret);
  if (!payload) {
    notFound();
  }
  if (await isAgentDeactivated(payload.agentId)) {
    notFound();
  }
  return (
    <Dashboard
      agentId={payload.agentId}
      agentName={payload.agentName}
      token={token}
      aiEnabled={isAIEnabled()}
    />
  );
}
