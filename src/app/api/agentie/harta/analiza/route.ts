import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";
import { isAIEnabled, streamCompletion } from "@/lib/llm";
import { rateLimit } from "@/lib/rate-limit";
import { listOrgAgents, orgAIFeatures, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CE-MI SPUNE HARTA — analiza AI peste situația centralizată.
 *
 * Harta arată UNDE sunt clienții; asta spune CE E DE FĂCUT cu ei: care
 * agent a rămas în urmă, care localități s-au răcit de tot, unde sunt
 * bani blocați în restanțe și cu ce începe săptămâna.
 *
 * Cifrele se calculează AICI, pe server, din baza de date — nu se preiau
 * din browser (altfel oricine ar putea trimite cifre inventate) și nu
 * pleacă nicio dată personală spre AI: doar nume de firme, localități,
 * agenți și numărători.
 */

const SYSTEM = `Ești directorul de vânzări al unei firme de distribuție FMCG din România. Primești situația CENTRALIZATĂ a portofoliului (agenți, clienți, ultima vizită, localități, restanțe la plată). Scrie un rezumat SCURT și de acțiune, în română, markdown, DOAR pe baza cifrelor primite — nu inventa nimic.

## Cum stăm
2-3 fraze cu starea reală: câți clienți, cât e acoperit, cât s-a răcit. Cifre concrete.

## Unde pierdem bani
Agenții/localitățile cu cei mai mulți clienți nevizitați și restanțele mari. Numește-i, cu cifre.

## Săptămâna asta
Exact 3 acțiuni concrete pentru manager, fiecare cu agentul și localitatea: pe cine trimite unde și de ce. Măsurabile.

Maxim 220 de cuvinte. Fără teorie, fără generalități — vorbește ca un om care cunoaște terenul.`;

interface Rand {
  cui: string;
  denumire: string;
  localitate: string;
  agent: string;
  sold_cents: string | null;
  ultima_vizita: Date | null;
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  // Limită pe FIRMĂ (biroul iese pe același IP).
  const rl = rateLimit(`harta-analiza:${auth.session.orgId}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri. Reîncearcă într-un minut." }, { status: 429 });
  }
  let body: { agent?: string; zile?: number; doarDate?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const zile = Math.min(90, Math.max(1, Number(body.zile) || 7));
  // „doarDate" = doar cifrele, fără AI. Nu trece prin verificările de AI:
  // numărătoarea din baza noastră trebuie să se poată vedea și când AI-ul
  // e oprit sau planul firmei nu-l include.
  if (body.doarDate !== true) {
    if (!isAIEnabled()) {
      return Response.json({ error: "AI-ul nu e configurat pe platformă." }, { status: 503 });
    }
    const feats = await orgAIFeatures(auth.session.orgId);
    if (!feats.aiInsights) {
      return Response.json(
        { error: "Planul firmei tale nu include analizele AI." },
        { status: 402 },
      );
    }
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const nume = agents.map((a) => a.name).filter(Boolean);
    if (nume.length === 0) {
      return Response.json({
        ok: true,
        enough: false,
        text: "Firma n-are încă agenți cu clienți. Adaugă agenții și adu clienții, apoi harta se umple singură.",
      });
    }
    const cerut = String(body.agent ?? "");
    const cautati = cerut && nume.includes(cerut) ? [cerut] : nume;

    const rows = await db<Rand[]>`
      SELECT p.cui, p.denumire, COALESCE(p.localitate, '') AS localitate,
             p.assigned_agent AS agent, p.sold_cents::text AS sold_cents,
             v.ultima_vizita
      FROM prospects p
      LEFT JOIN LATERAL (
        SELECT visited_at AS ultima_vizita FROM visits vv
        WHERE vv.cui = p.cui AND vv.agent_name = ANY(${cautati})
        ORDER BY visited_at DESC LIMIT 1
      ) v ON TRUE
      WHERE p.status = 'client'
        AND ${alAgentiei(db, auth.session.orgId, cautati)}
        AND p.activ IS DISTINCT FROM FALSE
      LIMIT 3000
    `;
    if (rows.length < 3) {
      return Response.json({
        ok: true,
        enough: false,
        count: rows.length,
        text: "Sunt prea puțini clienți alocați ca să scot o analiză folositoare. Adu clienții pe agenți și revino.",
      });
    }

    const acum = Date.now();
    const prag = zile * 86_400_000;
    const restant = (r: Rand) =>
      !r.ultima_vizita || acum - r.ultima_vizita.getTime() > prag;

    // Agregări PE SERVER (cifre reale, nu din browser).
    const peAgent = new Map<string, { total: number; restanti: number; zileMax: number }>();
    const peLocalitate = new Map<string, { total: number; restanti: number }>();
    let soldTotal = 0;
    const restantiMari: string[] = [];
    for (const r of rows) {
      const a = peAgent.get(r.agent) ?? { total: 0, restanti: 0, zileMax: 0 };
      a.total++;
      const zileDeCand = r.ultima_vizita
        ? Math.floor((acum - r.ultima_vizita.getTime()) / 86_400_000)
        : 999;
      if (restant(r)) a.restanti++;
      a.zileMax = Math.max(a.zileMax, zileDeCand);
      peAgent.set(r.agent, a);

      const cheie = r.localitate || "(fără localitate)";
      const l = peLocalitate.get(cheie) ?? { total: 0, restanti: 0 };
      l.total++;
      if (restant(r)) l.restanti++;
      peLocalitate.set(cheie, l);

      const sold = r.sold_cents ? parseInt(r.sold_cents, 10) : 0;
      if (sold > 0) {
        soldTotal += sold;
        if (restant(r)) {
          restantiMari.push(
            `${r.denumire} (${r.localitate || "?"}, ${r.agent}): restanță ${(sold / 100).toFixed(0)} RON, ${zileDeCand === 999 ? "nevizitat niciodată" : `${zileDeCand} zile de la ultima vizită`}`,
          );
        }
      }
    }

    const situatie = {
      pragRestantZile: zile,
      clientiTotal: rows.length,
      restantiTotal: rows.filter(restant).length,
      localitatiTotal: peLocalitate.size,
      restanteDePlataRON: Math.round(soldTotal / 100),
      agenti: [...peAgent.entries()]
        .map(([n, d]) => ({
          agent: n,
          clienti: d.total,
          restanti: d.restanti,
          acoperirePct: d.total ? Math.round(((d.total - d.restanti) / d.total) * 100) : 0,
          celMaiVechiNevizitatZile: d.zileMax === 999 ? "niciodată" : d.zileMax,
        }))
        .sort((a, b) => b.restanti - a.restanti),
      localitatiCeleMaiRacite: [...peLocalitate.entries()]
        .map(([n, d]) => ({ localitate: n, clienti: d.total, restanti: d.restanti }))
        .filter((l) => l.restanti > 0)
        .sort((a, b) => b.restanti - a.restanti)
        .slice(0, 12),
      clientiCuBaniBlocati: restantiMari.slice(0, 12),
    };

    // Mod de verificare: întoarce CIFRELE pe care s-ar baza analiza, fără
    // să cheme AI-ul. Folosit de teste și când vrem să vedem cu ochii
    // noștri că sinteza pleacă de la date corecte.
    if (body.doarDate === true) {
      return Response.json({ ok: true, doarDate: true, situatie });
    }

    let out = "";
    await streamCompletion(
      {
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Situația centralizată a portofoliului (cifre reale din platformă):\n\`\`\`json\n${JSON.stringify(situatie).slice(0, 14_000)}\n\`\`\``,
          },
        ],
        maxTokens: 1000,
        onText: (t) => {
          out += t;
        },
      },
      "analiza",
    );

    void (await import("@/modules/platform")).recordAiUsage({
      kind: "harta_analiza",
      orgId: auth.session.orgId,
    });
    const text = out.trim();
    return Response.json({
      ok: true,
      enough: true,
      count: rows.length,
      text:
        text ||
        "N-am putut scoate ceva clar de data asta. Mai încearcă o dată sau schimbă pragul de zile.",
    });
  } catch (e) {
    console.error("[harta analiza]", e);
    const { mesajEroareAI } = await import("@/lib/ai-error");
    return Response.json({ error: mesajEroareAI(e) }, { status: 500 });
  }
}
