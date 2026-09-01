import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";
import { normalizeName, variantsFor } from "@/lib/name-match";
import { requestOrigin } from "@/lib/request-origin";
import { signToken } from "@/lib/signed-token";
import {
  addOrgAgent,
  audit,
  getOrg,
  listOrgAgents,
  requireOrgUser,
} from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * UNIVERSUL DE CLIENȚI, importat de manager/patron dintr-un fișier:
 * denumire (+ CUI dacă există + agent dacă există). Fiecare rând se
 * potrivește cu firma oficială MF (întâi pe CUI — exact, apoi pe nume),
 * trece pe status „client" și se DISTRIBUIE agentului din fișier
 * (numele agenților din fișier se potrivesc cu agenții firmei).
 */

interface InClient {
  name: string;
  cui: string;
  agent: string;
  /** Adresa de livrare din fișier — unde e magazinul, nu sediul social. */
  adresa: string;
  localitate: string;
}

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: {
    clients?: Array<Partial<InClient>>;
    dryRun?: boolean;
    createAgents?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.clients) || body.clients.length === 0) {
    return Response.json({ error: "Lista de clienți e goală" }, { status: 400 });
  }
  const clients: InClient[] = body.clients
    .map((c) => ({
      name: String(c.name ?? "").trim().slice(0, 200),
      cui: String(c.cui ?? "").replace(/\D/g, "").slice(0, 12),
      agent: String(c.agent ?? "").trim().slice(0, 128),
      adresa: String(c.adresa ?? "").trim().slice(0, 300),
      localitate: String(c.localitate ?? "").trim().slice(0, 120),
    }))
    .filter((c) => c.name.length >= 4 || c.cui.length >= 2)
    .slice(0, 5000);

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();

    // Agenții firmei — numele din fișier se potrivesc pe normalizare
    // (diacritice/ordine ignorate) sau pe incluziune (ex: „Popescu" ↔
    // „Popescu Ion").
    const orgAgents = await listOrgAgents(auth.session.orgId);
    const agentNorm = orgAgents.map((a) => ({
      name: a.name,
      norm: normalizeName(a.name),
    }));
    const unknownAgents = new Set<string>();
    const resolveAgent = (raw: string): string => {
      if (!raw) return "";
      const n = normalizeName(raw);
      if (!n) return "";
      const exact = agentNorm.find((a) => a.norm === n);
      if (exact) return exact.name;
      const partial = agentNorm.find(
        (a) => a.norm.includes(n) || n.includes(a.norm),
      );
      if (partial) return partial.name;
      unknownAgents.add(raw);
      return "";
    };

    // „Să-i facă și cont": agenții noi din fișier primesc automat cont
    // (intrare în org_agents) + link de panou — respectând limita planului.
    const agentsCreated: Array<{ name: string; url: string }> = [];
    if (body.createAgents && !body.dryRun) {
      const rawAgents = new Set(
        clients.map((c) => c.agent).filter((a) => a.length >= 3),
      );
      const secret = process.env.TOKEN_SECRET;
      const org = await getOrg(auth.session.orgId);
      let slots = Math.max(0, (org?.agentLimit ?? 0) - orgAgents.length);
      for (const raw of rawAgents) {
        const n = normalizeName(raw);
        if (!n) continue;
        const exists = agentNorm.some(
          (a) => a.norm === n || a.norm.includes(n) || n.includes(a.norm),
        );
        if (exists) continue;
        if (slots <= 0) {
          unknownAgents.add(`${raw} (limita de agenți atinsă)`);
          continue;
        }
        const cleanName = raw.replace(/\s+/g, " ").trim().slice(0, 128);
        const agentId = `ag-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
        try {
          await addOrgAgent(auth.session.orgId, agentId, cleanName);
        } catch (e) {
          // Un nume deja folosit nu oprește importul întreg: se trece
          // peste agentul ăsta și i se spune omului care e.
          const { NumeAgentFolosit } = await import("@/modules/platform");
          if (e instanceof NumeAgentFolosit) {
            unknownAgents.add(`${raw} (mai ai un agent cu numele ăsta)`);
            continue;
          }
          throw e;
        }
        agentNorm.push({ name: cleanName, norm: n });
        slots--;
        if (secret) {
          const token = await signToken(
            {
              agentId,
              agentName: cleanName,
              exp: Math.floor(Date.now() / 1000) + 365 * 86400,
            },
            secret,
          );
          agentsCreated.push({
            name: cleanName,
            url: `${requestOrigin(req)}/a/${token}`,
          });
        } else {
          agentsCreated.push({ name: cleanName, url: "" });
        }
      }
    }

    // 1) Potrivire pe CUI — exactă, prioritară.
    const withCui = clients.filter((c) => c.cui.length >= 2);
    const cuiRows =
      withCui.length > 0
        ? await db<
            Array<{
              cui: string;
              denumire: string;
              localitate: string;
              judet: string;
              status: string;
            }>
          >`
            SELECT cui, denumire, localitate, judet, status FROM prospects
            WHERE cui = ANY(${withCui.map((c) => c.cui)})
          `
        : [];
    const byCui = new Map(cuiRows.map((r) => [r.cui, r]));

    // 2) Restul — pe nume, cu variante de formă juridică.
    const byName = clients.filter((c) => !byCui.has(c.cui) && c.name.length >= 4);
    const variantToClient = new Map<string, InClient>();
    for (const c of byName) {
      for (const v of variantsFor(c.name)) {
        if (!variantToClient.has(v)) variantToClient.set(v, c);
      }
    }
    const nameRows =
      variantToClient.size > 0
        ? await db<
            Array<{
              cui: string;
              denumire: string;
              localitate: string;
              judet: string;
              status: string;
              norm: string;
            }>
          >`
            SELECT cui, denumire, localitate, judet, status,
                   btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g'))) AS norm
            FROM prospects
            WHERE btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g')))
                  = ANY(${Array.from(variantToClient.keys())})
            LIMIT 10000
          `
        : [];

    // Asamblăm: un client din fișier → o firmă.
    const matched: Array<{
      client: string;
      cui: string;
      denumire: string;
      localitate: string;
      judet: string;
      agent: string;
      /** Adresa de livrare adusă din fișier (poate fi goală). */
      adresaLivrare: string;
      localitateLivrare: string;
      wasClient: boolean;
      via: "cui" | "nume";
    }> = [];
    const matchedKeys = new Set<string>();
    for (const c of withCui) {
      const r = byCui.get(c.cui);
      if (!r) continue;
      matched.push({
        client: c.name || r.denumire,
        cui: r.cui,
        denumire: r.denumire,
        localitate: r.localitate,
        judet: r.judet,
        agent: resolveAgent(c.agent),
        adresaLivrare: c.adresa,
        localitateLivrare: c.localitate,
        wasClient: r.status === "client",
        via: "cui",
      });
      matchedKeys.add(`${c.cui}|${c.name.toUpperCase()}`);
    }
    const nameHit = new Map<string, (typeof nameRows)[number]>();
    for (const r of nameRows) {
      const c = variantToClient.get(r.norm);
      if (!c) continue;
      const prev = nameHit.get(c.name);
      if (!prev || (!prev.localitate && r.localitate)) nameHit.set(c.name, r);
    }
    for (const [clientName, r] of nameHit) {
      const c = byName.find((x) => x.name === clientName);
      if (!c) continue;
      matched.push({
        client: clientName,
        cui: r.cui,
        denumire: r.denumire,
        localitate: r.localitate,
        judet: r.judet,
        agent: resolveAgent(c.agent),
        adresaLivrare: c.adresa,
        localitateLivrare: c.localitate,
        wasClient: r.status === "client",
        via: "nume",
      });
      matchedKeys.add(`${c.cui}|${clientName.toUpperCase()}`);
    }
    // NEPOTRIVIȚII, PĂSTRAȚI ÎNTREGI. Până acum plecau de aici doar ca
    // nume, se arătau o dată pe ecran și se pierdeau la primul refresh —
    // așa au dispărut clienți adevărați ai lui Costin. Acum ținem tot ce
    // scria în fișier, ca să-i putem aduce în registru cu un buton.
    const nepotrivitiIntregi = clients.filter(
      (c) => !matchedKeys.has(`${c.cui}|${c.name.toUpperCase()}`),
    );
    const unmatched = nepotrivitiIntregi.map((c) => c.name || `CUI ${c.cui}`);

    // Scriem: status client + distribuția pe agenți (fișierul e autoritar
    // când are agent; fără agent nu stricăm alocarea existentă).
    let updated = 0;
    if (!body.dryRun && matched.length > 0) {
      const payload = matched.map((m) => ({ cui: m.cui, agent: m.agent }));
      // IZOLARE: nu atingem rândurile aflate deja în lucru la ALTĂ
      // agenție — importul nostru nu are voie să-i fure clienții.
      const numeleNoastre = agentNorm.map((a) => a.name);
      const result = await db`
        UPDATE prospects p
        SET status = 'client',
            assigned_agent = CASE
              WHEN u.agent <> '' THEN u.agent
              ELSE p.assigned_agent
            END,
            -- Alocarea capătă și firma care a făcut-o.
            assigned_org = ${auth.session.orgId},
            updated_at = NOW()
        FROM jsonb_to_recordset(${db.json(
          payload as unknown as Parameters<typeof db.json>[0],
        )}) AS u(cui TEXT, agent TEXT)
        WHERE p.cui = u.cui
          AND (COALESCE(p.assigned_agent, '') = ''
               OR ${alAgentiei(db, auth.session.orgId, numeleNoastre)})
      `;
      updated = result.count;
      await audit(auth.session.email, "clients.import", auth.session.orgId, {
        matched: matched.length,
        unmatched: unmatched.length,
      });
    }

    // Lista de nepotriviți se scrie și în bază, la fiecare import real:
    // altfel managerul o vede o dată și gata.
    //
    // NU ștergem toată lista: managerul importă des agent cu agent, iar
    // un „DELETE tot" ar fi șters nepotrivițiii celorlalți agenți la
    // fiecare fișier. Ștergem doar rândurile care se referă la firmele
    // din fișierul ăsta (aceleași denumiri), ca să nu se dubleze.
    if (!body.dryRun) {
      const numeAcum = clients
        .map((c) => String(c.name ?? "").slice(0, 200))
        .filter((n) => n !== "");
      if (numeAcum.length > 0) {
        await db`DELETE FROM clienti_nepotriviti
                 WHERE org_id = ${auth.session.orgId} AND rezolvat_la IS NULL
                   AND denumire = ANY(${numeAcum})`;
      }
      const deScris = nepotrivitiIntregi.slice(0, 5000).map((c) => ({
        org_id: auth.session.orgId,
        denumire: String(c.name ?? "").slice(0, 200),
        cui: String(c.cui ?? "").replace(/\D/g, "").slice(0, 10),
        adresa: String(c.adresa ?? "").slice(0, 300),
        localitate: String(c.localitate ?? "").slice(0, 120),
        agent: resolveAgent(c.agent),
      }));
      for (let i = 0; i < deScris.length; i += 500) {
        await db`
          INSERT INTO clienti_nepotriviti ${db(
            deScris.slice(i, i + 500),
            "org_id", "denumire", "cui", "adresa", "localitate", "agent",
          )}
        `;
      }
    }

    return Response.json({
      matched,
      unmatched,
      updated,
      agentsUnknown: Array.from(unknownAgents),
      agentsCreated,
      dryRun: !!body.dryRun,
    });
  } catch (e) {
    console.error("[agentie clients-import]", e);
    return Response.json({ error: "Eroare la import" }, { status: 500 });
  }
}
