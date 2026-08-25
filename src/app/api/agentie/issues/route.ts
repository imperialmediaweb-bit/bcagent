import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";

/**
 * PROBLEMELE RAPORTATE DE OAMENII FIRMEI — pentru administrator/manager.
 *
 * Agentul apasă 💬 și scrie „nu-mi merge X"; până acum raportul ajungea
 * doar la platformă, iar Bogdan (managerul lui) nu-l vedea nicăieri.
 * Aici firma își vede propriile rapoarte: ale agenților ei și ale
 * conturilor ei de birou. Rapoartele vechi (dinainte să reținem firma)
 * se recuperează după numele agentului / emailul raportorului.
 */

interface IssueRow {
  id: string;
  reporter: string;
  role: string;
  page: string;
  message: string;
  ai_diagnosis: string;
  status: string;
  created_at: Date;
}

export async function GET() {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const nume = agents.map((a) => a.name);
    const numeSauEmail = [...nume, auth.session.email];
    const rows = await db<IssueRow[]>`
      SELECT id, reporter, role, page, message, ai_diagnosis, status, created_at
      FROM issues
      WHERE org_id = ${auth.session.orgId}
         OR (org_id = '' AND reporter = ANY(${numeSauEmail.length ? numeSauEmail : [""]}))
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return Response.json({
      issues: rows.map((r) => {
        // Din triajul AI arătăm doar partea PENTRU UTILIZATOR — partea
        // „PENTRU ADMIN" e jargon tehnic pentru platformă, nu pentru firmă.
        const m = r.ai_diagnosis.match(
          /SOLU[ȚT]IE PENTRU UTILIZATOR:\s*([\s\S]*?)(?=PENTRU ADMIN:|$)/i,
        );
        return {
          id: r.id,
          reporter: r.reporter,
          role: r.role,
          page: r.page,
          message: r.message,
          solutie: m ? m[1].trim() : "",
          status: r.status,
          createdAt: r.created_at.toISOString(),
        };
      }),
    });
  } catch (e) {
    console.error("[agentie issues]", e);
    return Response.json({ error: "Eroare la citirea rapoartelor" }, { status: 500 });
  }
}
