import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { requestOrigin } from "@/lib/request-origin";
import { signToken } from "@/lib/signed-token";
import {
  addOrgAgent,
  audit,
  createOrg,
  createOrgUser,
  generatePassword,
  getOrgUserForLogin,
  listOrgAgents,
} from "@/modules/platform";
import CLIENTS from "./clients-data.json";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * INSTALARE UNICĂ „UVERTURA COM" — rută temporară, protejată cu cheie,
 * apelată O DATĂ de administratorul platformei din browser. Face tot:
 * organizația (CUI 6704005, trial 14 zile), contul de Administrator al
 * lui Bogdan, cei 5 agenți cu linkurile lor și importul celor 220 de
 * clienți din fișierul agenției. Idempotentă: al doilea click nu strică
 * nimic — reafișează linkurile fără să schimbe parola.
 * SE ȘTERGE imediat după confirmare.
 */

const SETUP_KEY = "66bcef1a0a7024af6c047bb1b499bfdd";
const ORG_NAME = "UVERTURA COM";
const ORG_CUI = "6704005";
const OWNER_EMAIL = "bogdancarausu1981@gmail.com";
const OWNER_NAME = "Bogdan Cărăușu";
const AGENT_NAMES = [
  "Gavrilet Bogdan",
  "Cojocaru Razvan",
  "Volanschi Robert",
  "Calinciuc Gabriel",
  "Costin Vlad",
];

interface ClientEntry {
  cui: string;
  denumire: string;
  localitate: string;
  judet: string;
  agent: string;
  impartit?: string[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
 body{font-family:ui-monospace,Menlo,monospace;background:#f5efe4;color:#161412;
      margin:0;padding:20px;line-height:1.55;font-size:15px}
 .box{max-width:680px;margin:0 auto;background:#fff;border:3px solid #161412;
      box-shadow:6px 6px 0 #161412;padding:20px}
 h1{font-size:19px;margin:0 0 12px}
 h2{font-size:15px;margin:18px 0 6px;border-bottom:2px solid #161412;padding-bottom:4px}
 .cred{background:#ffd23f;border:2px solid #161412;padding:10px 12px;margin:8px 0;
       font-weight:700;word-break:break-all}
 .agent{border:2px solid #161412;padding:10px 12px;margin:8px 0}
 .agent b{display:block;margin-bottom:4px}
 .agent a{word-break:break-all;color:#ff4d00;font-size:13px}
 .warn{background:#fff3cd;border:2px solid #161412;padding:10px 12px;margin:8px 0;font-size:13px}
 .ok{color:#0a7d33;font-weight:700}
</style></head><body><div class="box">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Pagina rămâne DOAR ca punct de distribuție: mesajele WhatsApp gata
 * scrise pentru Bogdan și agenți. Resetarea de parolă a fost SCOASĂ
 * de tot (Bogdan e în cont; parola se schimbă doar din panou, la
 * Setări) — deschisul paginii nu atinge nimic.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== SETUP_KEY) {
    return new Response("Not found", { status: 404 });
  }
  if (!isDBEnabled()) {
    return page("Eroare", "<h1>Baza de date nu e configurată</h1>", 503);
  }
  const db = getDB();
  if (!db) return page("Eroare", "<h1>Baza de date nu e configurată</h1>", 503);
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    return page("Eroare", "<h1>TOKEN_SECRET lipsește pe server</h1>", 503);
  }

  try {
    await ensureSchema();
    const clients = CLIENTS as ClientEntry[];

    // 1) Contul: îl creăm o singură dată; la al doilea click doar reafișăm.
    let password = "";
    let orgId: string;
    const existing = await getOrgUserForLogin(OWNER_EMAIL);
    if (existing) {
      orgId = existing.orgId;
    } else {
      const org = await createOrg({
        name: ORG_NAME,
        cui: ORG_CUI,
        email: OWNER_EMAIL,
        trialDays: 14,
        agentLimit: 5,
        note: "Organizație de test (instalată de administratorul platformei)",
      });
      orgId = org.id;
      password = generatePassword();
      await createOrgUser(orgId, OWNER_EMAIL, password, OWNER_NAME, "owner");
    }

    // 2) Agenții: idempotent (ON CONFLICT în addOrgAgent).
    const already = await listOrgAgents(orgId);
    const byName = new Map(already.map((a) => [a.name, a.agentId]));
    for (const name of AGENT_NAMES) {
      if (byName.has(name)) continue;
      const agentId = `ag-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
      await addOrgAgent(orgId, agentId, name);
      byName.set(name, agentId);
    }

    // 3) Linkurile agenților (1 an; Bogdan le poate regenera/bloca din panou).
    const origin = requestOrigin(req);
    const links: Array<{ name: string; url: string }> = [];
    for (const name of AGENT_NAMES) {
      const agentId = byName.get(name);
      if (!agentId) continue;
      const token = await signToken(
        {
          agentId,
          agentName: name,
          exp: Math.floor(Date.now() / 1000) + 365 * 86400,
        },
        secret,
      );
      links.push({ name, url: `${origin}/a/${token}` });
    }

    // 4) Importul clienților: firmele existente în universul MF își
    //    păstrează datele oficiale (doar status + agent); cele lipsă se
    //    adaugă cu datele din fișierul agenției.
    const payload = clients.map((c) => ({
      cui: c.cui,
      denumire: c.denumire,
      localitate: c.localitate,
      judet: c.judet,
      agent: c.agent,
    }));
    const updated = await db`
      UPDATE prospects p
      SET status = 'client', assigned_agent = u.agent, updated_at = NOW()
      FROM jsonb_to_recordset(${db.json(
        payload as unknown as Parameters<typeof db.json>[0],
      )}) AS u(cui TEXT, agent TEXT)
      WHERE p.cui = u.cui
    `;
    const inserted = await db`
      INSERT INTO prospects (cui, denumire, localitate, judet, status, assigned_agent)
      SELECT u.cui, u.denumire, u.localitate, u.judet, 'client', u.agent
      FROM jsonb_to_recordset(${db.json(
        payload as unknown as Parameters<typeof db.json>[0],
      )}) AS u(cui TEXT, denumire TEXT, localitate TEXT, judet TEXT, agent TEXT)
      WHERE NOT EXISTS (SELECT 1 FROM prospects p WHERE p.cui = u.cui)
    `;
    await audit("setup-uvertura", "org.seed", orgId, {
      updated: updated.count,
      inserted: inserted.count,
    });

    // 5) Raportul pe ecran.
    const shared = clients.filter((c) => c.impartit && c.impartit.length > 1);
    const body = `
<h1>✅ UVERTURA COM e instalată</h1>
<p><span class="ok">Cont creat · ${clients.length} clienți importați · ${links.length} agenți cu linkuri.</span></p>

<h2>Contul lui Bogdan (trimite-i pe WhatsApp)</h2>
<div class="cred">Pagina: ${esc(origin)}/agentie/login<br>
Email: ${esc(OWNER_EMAIL)}<br>
Parola: ${password ? esc(password) : "(cea pe care o are Bogdan — se schimbă doar din panou, la Setări)"}</div>
<div class="agent"><b>Mesaj gata de trimis lui Bogdan</b>
<textarea readonly rows="7" style="width:100%;font:inherit;font-size:12px;border:2px solid #161412;padding:8px;box-sizing:border-box">${esc(`Salut, Bogdan! Ți-am făcut contul pe Provendi — de aici conduci tot: băieții, clienții, comenzile, vizitele.

Intră aici: ${origin}/agentie/login
Email: ${OWNER_EMAIL}
Parola: ${password || "[parola pe care ți-am trimis-o]"}
(ți-o poți schimba din panou, la Setări)

Ghidul cu tot ce face platforma, pas cu pas: https://provendi.ro/ghid

Mai jos îți trimit și linkurile băieților — fiecare primește DOAR pe al lui, cu instrucțiunile de instalare.`)}</textarea>
<button onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(()=>{this.textContent='✓ Copiat!';setTimeout(()=>this.textContent='Copiază mesajul',2000)})"
 style="margin-top:6px;padding:8px 14px;font:inherit;font-weight:700;background:#ffd23f;border:2px solid #161412;cursor:pointer">Copiază mesajul</button></div>

<h2>Mesaje gata de trimis pe WhatsApp — unul pentru fiecare băiat</h2>
<p style="font-size:13px">Apeși „Copiază mesajul", îl lipești în WhatsApp la agentul respectiv, trimiți. Mesajul conține deja linkul lui, pașii de instalare și ghidul.</p>
${links
  .map((l) => {
    const prenume = l.name.split(" ").pop() ?? l.name;
    const mesaj = `Salut, ${prenume}! Ăsta e linkul tău de lucru — aplicația Provendi a firmei:

${l.url}

Fă exact așa:
1) Apasă pe link — se deschide în Chrome.
2) Prima dată îți cere singură să-ți pui un PIN de 4-6 cifre (ca la card). Alege unul și ține-l minte — cu el intri de acum.
3) Bagă aplicația pe ecranul telefonului:
- Android: sus dreapta cele 3 puncte -> „Adaugă pe ecranul de pornire" -> Adaugă
- iPhone: jos pătratul cu săgeată -> „Adaugă pe ecranul principal" -> Adaugă
De acum deschizi Provendi de pe ecran, ca pe WhatsApp.

Ce ai în ea: clienții tăi, harta cu ruta zilei, vizitele (apeși microfonul și spui ce a zis clientul — se scrie singur), comenzi cu poză la factură.

Vezi tot ce face aplicația ta, explicat pas cu pas: https://provendi.ro/ghid?rol=agent

Linkul e doar al tău — nu-l da nimănui. Nu-ți iese ceva? Sună-l pe Bogdan.`;
    return `<div class="agent"><b>${esc(l.name)}</b>
<textarea readonly rows="8" style="width:100%;font:inherit;font-size:12px;border:2px solid #161412;padding:8px;box-sizing:border-box">${esc(mesaj)}</textarea>
<button onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(()=>{this.textContent='✓ Copiat!';setTimeout(()=>this.textContent='Copiază mesajul',2000)})"
 style="margin-top:6px;padding:8px 14px;font:inherit;font-weight:700;background:#ffd23f;border:2px solid #161412;cursor:pointer">Copiază mesajul</button></div>`;
  })
  .join("")}
<p style="font-size:13px">Linkurile țin UN AN; Bogdan le poate regenera sau bloca oricând din panou → Agenți.</p>

${
  shared.length
    ? `<h2>De decis cu Bogdan</h2><div class="warn">${shared.length} firme apar în fișier la mai mulți agenți — le-am dat primului; Bogdan le poate muta din pagina Clienți:<br>${shared
        .map((s) => `• ${esc(s.denumire)} (CUI ${esc(s.cui)}): ${esc((s.impartit ?? []).join(", "))}`)
        .join("<br>")}</div>`
    : ""
}
<p style="font-size:13px">Pagina asta e de unică folosință și va fi ștearsă de pe server.</p>`;
    return page("Instalare UVERTURA COM", body);
  } catch (e) {
    console.error("[setup-uvertura]", e);
    return page(
      "Eroare",
      "<h1>❌ Ceva n-a mers</h1><p>Reîncearcă sau spune-i dezvoltatorului să se uite în logurile serverului.</p>",
      500,
    );
  }
}
