import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/signed-token";
import { isAIEnabled } from "@/lib/llm";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import Dashboard from "./Dashboard";
import PinGate from "./PinGate";

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

  // Poarta cu PIN: linkul singur nu e de ajuns pe un dispozitiv străin.
  // Agenții demo (demo-*) sunt exceptați — demo-ul curge fără fricțiune.
  if (!payload.agentId.startsWith("demo-") && isDBEnabled()) {
    const db = getDB();
    if (db) {
      try {
        const { ensurePlatformSchema } = await import("@/modules/platform");
        await ensurePlatformSchema();
        const [pinRow] = await db<Array<{ agent_id: string }>>`
          SELECT agent_id FROM agent_pin WHERE agent_id = ${payload.agentId}
        `;
        if (!pinRow) {
          return (
            <PinGate token={token} agentName={payload.agentName} mode="setup" />
          );
        }
        const deviceId = (await cookies()).get("bcagent_device")?.value ?? "";
        const known = deviceId
          ? await db<Array<{ id: string }>>`
              SELECT id::text AS id FROM known_devices
              WHERE kind = 'agent' AND email = ${payload.agentId}
                AND device_id = ${deviceId}
              LIMIT 1
            `
          : [];
        if (known.length === 0) {
          return (
            <PinGate token={token} agentName={payload.agentName} mode="verify" />
          );
        }
      } catch (e) {
        // Poarta nu are voie să omoare panoul la o eroare temporară de DB.
        console.error("[pin-gate]", e);
      }
    }
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
