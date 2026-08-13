import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { requestOrigin } from "@/lib/request-origin";
import { signToken } from "@/lib/signed-token";
import {
  addOrgAgent,
  audit,
  getOrg,
  listOrgAgents,
  requireOrgUser,
  setOrgAgentAway,
  setOrgAgentSalary,
} from "@/modules/platform";

export const runtime = "nodejs";

/** Agenții organizației, cu statistici de activitate. */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    const names = agents.map((a) => a.name);

    const stats = await db<
      Array<{ agent_id: string; azi: string; saptamana: string; luna: string }>
    >`
      SELECT agent_id,
        COUNT(*) FILTER (WHERE visited_at >= date_trunc('day', NOW()))::text AS azi,
        COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', NOW()))::text AS saptamana,
        COUNT(*) FILTER (WHERE visited_at >= NOW() - INTERVAL '30 days')::text AS luna
      FROM visits WHERE agent_id = ANY(${ids.length ? ids : [""]})
      GROUP BY agent_id
    `;
    const clients = await db<Array<{ assigned_agent: string; n: string }>>`
      SELECT assigned_agent, COUNT(*)::text AS n FROM prospects
      WHERE status = 'client' AND assigned_agent = ANY(${names.length ? names : [""]})
      GROUP BY assigned_agent
    `;
    const byId = Object.fromEntries(stats.map((s) => [s.agent_id, s]));
    const clientsByName = Object.fromEntries(
      clients.map((c) => [c.assigned_agent, parseInt(c.n, 10)]),
    );

    return Response.json({
      myRole: auth.session.role,
      agents: agents.map((a) => ({
        ...a,
        visitsToday: parseInt(byId[a.agentId]?.azi ?? "0", 10),
        visitsWeek: parseInt(byId[a.agentId]?.saptamana ?? "0", 10),
        visits30: parseInt(byId[a.agentId]?.luna ?? "0", 10),
        clients: clientsByName[a.name] ?? 0,
      })),
    });
  } catch (e) {
    console.error("[agentie agents GET]", e);
    return Response.json({ error: "Eroare la listare" }, { status: 500 });
  }
}

/** Emitere link magic pentru un agent — respectă limita planului. */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    return Response.json({ error: "TOKEN_SECRET lipsește" }, { status: 500 });
  }

  let body: { agentId?: string; agentName?: string; ttlDays?: number };
  try {
    await ensureSchema();
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agentId = String(body.agentId ?? "").trim().slice(0, 64);
  const agentName = String(body.agentName ?? "").trim().slice(0, 120);
  if (!agentId || !agentName) {
    return Response.json({ error: "ID și nume agent obligatorii" }, { status: 400 });
  }
  const ttlDays = Math.min(365, Math.max(1, Number(body.ttlDays) || 365));

  try {
    await ensureSchema();
    const orgId = auth.session.orgId;
    const org = await getOrg(orgId);
    if (!org) return Response.json({ error: "Organizația nu există" }, { status: 404 });
    const existing = await listOrgAgents(orgId);
    const isNew = !existing.some((a) => a.agentId === agentId);
    if (isNew && existing.filter((a) => a.active).length >= org.agentLimit) {
      return Response.json(
        {
          error: `Limita planului: ${org.agentLimit} agenți. Cere upgrade administratorului platformei.`,
        },
        { status: 409 },
      );
    }

    await addOrgAgent(orgId, agentId, agentName);
    const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
    const token = await signToken({ agentId, agentName, exp }, secret);
    const origin = requestOrigin(req);
    await audit(auth.session.email, "agent.token", agentId, { orgId, ttlDays });

    return Response.json({
      url: `${origin}/a/${token}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  } catch (e) {
    console.error("[agentie agents POST]", e);
    return Response.json({ error: "Eroare la emiterea linkului" }, { status: 500 });
  }
}

function isDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Blocare/deblocare instant, concediu (perioadă, cu detecție de suprapunere
 * între agenți) și salarizare (doar owner).
 */
export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: {
    agentRowId?: string;
    active?: boolean;
    awayFrom?: string | null;
    awayUntil?: string | null;
    force?: boolean;
    salaryCents?: number | null;
    commissionPct?: number | null;
    resetPin?: boolean;
  };
  try {
    await ensureSchema();
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rowId = String(body.agentRowId ?? "");
  if (!rowId) return Response.json({ error: "agentRowId lipsește" }, { status: 400 });

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const orgId = auth.session.orgId;

    if (typeof body.active === "boolean") {
      const [changed] = await db<Array<{ agent_id: string }>>`
        UPDATE org_agents SET active = ${body.active}
        WHERE id = ${rowId} AND org_id = ${orgId}
        RETURNING agent_id
      `;
      // Blocarea trebuie să muște INSTANT, inclusiv pe telefonul care are
      // aplicația deja deschisă — golim starea ținută în memorie.
      if (changed?.agent_id) {
        const { forgetAgentBlockState } = await import("@/lib/agent-guard");
        forgetAgentBlockState(changed.agent_id);
      }
      await audit(
        auth.session.email,
        body.active ? "agent.activate" : "agent.deactivate",
        rowId,
        { orgId },
      );
    }

    if (body.awayUntil !== undefined || body.awayFrom !== undefined) {
      const until = body.awayUntil ? String(body.awayUntil).slice(0, 10) : null;
      const from = body.awayFrom
        ? String(body.awayFrom).slice(0, 10)
        : until
          ? new Date().toISOString().slice(0, 10)
          : null;
      if ((until && !isDate(until)) || (from && !isDate(from))) {
        return Response.json({ error: "Dată invalidă" }, { status: 400 });
      }
      if (from && until && from > until) {
        return Response.json(
          { error: "Începutul concediului e după sfârșit" },
          { status: 400 },
        );
      }

      // Suprapunere cu concediile ALTOR agenți activi → avertizăm (409);
      // managerul poate forța cu force:true dacă își asumă zona descoperită.
      if (from && until && !body.force) {
        const agents = await listOrgAgents(orgId);
        const overlapping = agents.filter(
          (a) =>
            a.id !== rowId &&
            a.active &&
            a.awayFrom &&
            a.awayUntil &&
            a.awayFrom <= until &&
            a.awayUntil >= from,
        );
        if (overlapping.length > 0) {
          return Response.json(
            {
              error: `Se suprapune cu concediul: ${overlapping
                .map((a) => `${a.name} (${a.awayFrom} → ${a.awayUntil})`)
                .join(", ")}`,
              overlapping: overlapping.map((a) => a.name),
            },
            { status: 409 },
          );
        }
      }

      await setOrgAgentAway(orgId, rowId, from, until);
      await audit(auth.session.email, "agent.concediu", rowId, {
        orgId,
        awayFrom: from,
        awayUntil: until,
        forced: !!body.force,
      });
    }

    if (body.resetPin === true) {
      // Telefon pierdut/schimbat: PIN-ul și dispozitivele agentului se
      // șterg — la următoarea deschidere a linkului își setează PIN nou.
      const [row] = await db<Array<{ agent_id: string }>>`
        SELECT agent_id FROM org_agents WHERE id = ${rowId} AND org_id = ${orgId}
      `;
      if (!row) {
        return Response.json({ error: "Agentul nu e al firmei tale" }, { status: 403 });
      }
      await db`DELETE FROM agent_pin WHERE agent_id = ${row.agent_id}`;
      await db`DELETE FROM known_devices WHERE kind = 'agent' AND email = ${row.agent_id}`;
      await audit(auth.session.email, "agent.pin_reset", row.agent_id, { orgId });
    }

    if (body.salaryCents !== undefined || body.commissionPct !== undefined) {
      if (auth.session.role !== "owner") {
        return Response.json(
          { error: "Doar patronul poate seta salariile" },
          { status: 403 },
        );
      }
      const salary =
        body.salaryCents === null
          ? null
          : Math.min(10_000_000_00, Math.max(0, Math.round(Number(body.salaryCents) || 0)));
      const pct =
        body.commissionPct === null
          ? null
          : Math.min(100, Math.max(0, Number(body.commissionPct) || 0));
      await setOrgAgentSalary(orgId, rowId, salary, pct);
      await audit(auth.session.email, "agent.salariu", rowId, { orgId });
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie agents PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}
