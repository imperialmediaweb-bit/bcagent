import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { acoperireTeren } from "@/modules/crm/acoperire";

export const runtime = "nodejs";

/**
 * ACOPERIREA MEA — aceeași socoteală ca raportul lui Bogdan, dar văzută
 * de agent, pe telefonul lui: câte din opririle LUI a călcat în perioadă.
 * Cine își vede singur procentul nu mai așteaptă ședința de vineri ca să
 * afle că a rămas în urmă.
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`acoperire:${clientIP(req)}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Server not configured" }, { status: 500 });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifyFieldToken(token, secret);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const zile = Math.min(
    365,
    Math.max(1, parseInt(url.searchParams.get("zile") ?? "30", 10) || 30),
  );

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const { orgIdForAgent } = await import("@/lib/org-scope");
    const orgId = await orgIdForAgent(payload.agentId);
    if (orgId === "") {
      // Link vechi, fără firmă: n-avem univers de care să-l legăm.
      return Response.json({ inOrg: false });
    }
    // DOAR el — nu vede procentele colegilor; clasamentul e treaba
    // șefului, pe pagina lui.
    const raport = await acoperireTeren(
      db,
      orgId,
      [{ name: payload.agentName, agentId: payload.agentId }],
      zile,
    );
    const eu = raport.agenti[0];
    return Response.json({ inOrg: true, zile, eu });
  } catch (e) {
    console.error("[acoperire agent]", e);
    return Response.json({ error: "Eroare la calculul acoperirii" }, { status: 500 });
  }
}
