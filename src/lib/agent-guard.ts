import { getDB, isDBEnabled } from "@/lib/db";

/**
 * POARTA AGENTULUI BLOCAT.
 *
 * Tokenul din link e semnat și valabil până expiră — dar când managerul
 * apasă „blochează agentul" (a plecat din firmă, i s-a furat telefonul),
 * accesul trebuie să moară INSTANT, inclusiv pe aplicația deja deschisă
 * în mâna lui. Pagina singură nu e de ajuns: cine are aplicația deschisă
 * ar putea trimite în continuare comenzi prin API.
 *
 * De aceea fiecare rută de teren trece prin verificarea asta. Rezultatul
 * se ține câteva secunde în memorie, ca să nu lovim baza la fiecare tap.
 */

const TTL_MS = 15_000;
const cache = new Map<string, { blocked: boolean; at: number }>();

export async function isAgentBlocked(agentId: string): Promise<boolean> {
  if (!agentId || !isDBEnabled()) return false;
  const hit = cache.get(agentId);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.blocked;

  const db = getDB();
  if (!db) return false;
  try {
    const rows = await db<Array<{ active: boolean }>>`
      SELECT active FROM org_agents WHERE agent_id = ${agentId}
      ORDER BY active ASC LIMIT 1
    `;
    // Agenții emiși în afara unei organizații (linkuri vechi) trec liber.
    const blocked = rows.length > 0 && rows[0].active === false;
    cache.set(agentId, { blocked, at: now });
    return blocked;
  } catch {
    // Eroare de bază de date → NU blocăm agentul din teren.
    return false;
  }
}

/** Răspunsul standard pentru un agent blocat. */
export function blockedResponse(): Response {
  return Response.json(
    {
      error:
        "Accesul tău a fost oprit de firmă. Vorbește cu managerul pentru un link nou.",
      blocked: true,
    },
    { status: 403 },
  );
}

/** Șterge din cache un agent (după blocare/deblocare din panoul firmei). */
export function forgetAgentBlockState(agentId: string): void {
  cache.delete(agentId);
}

/**
 * Verificarea folosită de TOATE rutele de teren: token semnat valid ȘI
 * agent neblocat. Întoarce null în ambele cazuri de refuz — ruta răspunde
 * la fel ca până acum (401), fără să divulge care dintre ele a fost.
 */
export async function verifyFieldToken(
  token: string,
  secret: string,
): Promise<import("@/lib/signed-token").TokenPayload | null> {
  const { verifyToken } = await import("@/lib/signed-token");
  const payload = await verifyToken(token, secret);
  if (!payload) return null;
  if (await isAgentBlocked(payload.agentId)) return null;
  return payload;
}
