/**
 * ZONELE AGENȚILOR, cap-coadă: managerul lipește textul de pe WhatsApp,
 * platforma îl citește, îl potrivește cu satele reale, îi arată ce n-a
 * găsit și abia apoi salvează. Verificat pe server REAL și în browser.
 *
 * Rulare: BASE_URL=... DATABASE_URL=... npx tsx scripts/test-zone-firma.ts
 */
import postgres from "postgres";
import { createOrg, createOrgUser } from "../src/modules/platform/repo";
import { COOKIE_NAME, semneazaSesiuneTest } from "./_sesiune-test";

const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pwModule = (await import(PW)) as any;
const chromium = pwModule.chromium ?? pwModule.default?.chromium;

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

interface Raspuns {
  gasite?: Array<{ zi: string; localitate: string; scris: string }>;
  negasite?: Array<{ scris: string; sugestii: string[] }>;
  salvate?: number;
  error?: string;
  agenti?: Array<{ nume: string; zone: Array<{ localitate: string; zi: string }> }>;
}

async function main() {
  const RUN = `zf${Date.now().toString(36).slice(-6)}`;
  const baza = Date.now().toString().slice(-7);
  const cui = (i: number) => `29${baza}${String(i).padStart(2, "0")}`;
  const email = `${RUN}@test.ro`;
  const emailStrain = `${RUN}-x@test.ro`;

  const org = await createOrg({ name: `ZONE SRL ${RUN}`, email });
  await createOrgUser(org.id, email, "ParolaTest123!", "Bogdan", "owner");
  const orgX = await createOrg({ name: `ZONE STRAIN ${RUN}`, email: emailStrain });
  await createOrgUser(orgX.id, emailStrain, "ParolaTest123!", "Altul", "owner");

  const costin = `Costin Zone ${RUN}`;
  const gabi = `Gabi Zone ${RUN}`;
  const strain = `Strain Zone ${RUN}`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"a1" + RUN}, ${org.id}, ${"ag1" + RUN}, ${costin}),
                   (${"a2" + RUN}, ${org.id}, ${"ag2" + RUN}, ${gabi}),
                   (${"a3" + RUN}, ${orgX.id}, ${"ag3" + RUN}, ${strain})`;

  // Satele REALE din județul firmei (așa cum apar în registru).
  const sate = [
    "VIRFUL CAMPULUI", "LOZNA", "DERSCA", "STRATENI", "ȘENDRICENI", "DOROHOI",
    "BROSCĂUȚI", "CĂRĂUȘA", "PĂDURENI", "HUDEȘTI", "ALBA", "NĂRĂNCA",
    "DARABANI", "PĂLTINIȘ", "UNGURENI", "SĂVENI", "PODRIGA", "HORIA",
    "AVRĂMENI", "ROMA", "NICȘENI", "GORBĂNEȘTI", "STĂUCENI",
  ];
  for (let i = 0; i < sate.length; i++) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
      VALUES (${cui(i)}, ${"MAGAZIN " + sate[i] + " " + RUN}, 'Str. 1', ${sate[i]}, 'BT', '4711', 'client', ${costin}, TRUE)`;
  }

  const ck = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}`,
    orgId: org.id,
    email,
    name: "Bogdan",
    role: "owner",
  })}`;
  const ckX = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}x`,
    orgId: orgX.id,
    email: emailStrain,
    name: "Altul",
    role: "owner",
  })}`;

  const post = async (cookie: string, corp: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/api/agentie/zone`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(corp),
    });
    return { status: r.status, d: (await r.json()) as Raspuns };
  };
  const get = async (cookie: string) => {
    const r = await fetch(`${BASE}/api/agentie/zone`, { headers: { cookie } });
    return (await r.json()) as Raspuns;
  };

  // MESAJUL REAL trimis de Bogdan pe WhatsApp.
  const mesaj = `luni -vf câmpului,Lozna,dersca,Strateni,Sendriceni Dorohoi
marți- Dorohoi,Broscauti,Carasa ,padureni,
Miercuri -hudesti,alba,naranca,darabani,Păltiniș
joi-ungureni,saveni,Podriga,horia,avrameni,
vineri-roma,nicseni,ungureni ,Gorbănești ,stauceni`;

  sectiune("Verifică ÎNAINTE de salvare (nu salvăm pe încredere)");
  const ver = await post(ck, { agent: costin, text: mesaj, verificaDoar: true });
  check("verificarea răspunde", ver.status === 200, JSON.stringify(ver.d).slice(0, 120));
  check(
    "a găsit satele scrise fără diacritice",
    (ver.d.gasite ?? []).some((g) => g.localitate === "GORBĂNEȘTI" && g.scris.includes("Gorbănești")) &&
      (ver.d.gasite ?? []).some((g) => g.localitate === "HUDEȘTI"),
    JSON.stringify((ver.d.gasite ?? []).map((g) => g.localitate)),
  );
  check(
    "a înțeles prescurtarea «vf câmpului»",
    (ver.d.gasite ?? []).some((g) => g.localitate === "VIRFUL CAMPULUI"),
  );
  check(
    "zilele sunt puse corect (luni, marți, miercuri, joi, vineri)",
    new Set((ver.d.gasite ?? []).map((g) => g.zi)).size === 5,
    JSON.stringify([...new Set((ver.d.gasite ?? []).map((g) => g.zi))]),
  );
  check(
    "«Sendriceni Dorohoi» (virgulă uitată) devine DOUĂ sate, amândouă luni",
    (ver.d.gasite ?? []).some((g) => g.zi === "luni" && g.localitate === "ȘENDRICENI") &&
      (ver.d.gasite ?? []).some((g) => g.zi === "luni" && g.localitate === "DOROHOI"),
    JSON.stringify((ver.d.gasite ?? []).filter((g) => g.zi === "luni")),
  );
  check(
    "ce chiar nu există (Carasa) e raportat, nu inventat",
    (ver.d.negasite ?? []).some((n) => n.scris.toLowerCase().includes("carasa")),
    JSON.stringify(ver.d.negasite),
  );
  const inainte = await sql`SELECT COUNT(*)::int AS n FROM agent_zone WHERE org_id = ${org.id}`;
  check("verificarea NU a salvat nimic", (inainte[0] as { n: number }).n === 0);

  sectiune("Salvarea");
  const salv = await post(ck, { agent: costin, text: mesaj });
  check("salvarea răspunde", salv.status === 200);
  check("s-au salvat localitățile găsite", (salv.d.salvate ?? 0) >= 20, String(salv.d.salvate));
  const dupa = await sql<Array<{ zi: string; localitate: string }>>`
    SELECT zi, localitate FROM agent_zone WHERE org_id = ${org.id} AND agent_name = ${costin}
  `;
  check("zona e în baza de date", dupa.length === (salv.d.salvate ?? 0), `${dupa.length}`);
  check(
    "«ungureni» e trecut și joi și vineri",
    dupa.filter((d) => d.localitate === "UNGURENI").length === 2,
    JSON.stringify(dupa.filter((d) => d.localitate === "UNGURENI")),
  );
  check(
    "luni are 6 sate (5 scrise + al doilea din virgula uitată)",
    dupa.filter((d) => d.zi === "luni").length === 6,
    String(dupa.filter((d) => d.zi === "luni").length),
  );

  sectiune("Salvarea din nou ÎNLOCUIEȘTE, nu adună");
  const salv2 = await post(ck, { agent: costin, text: "luni: Dorohoi, Darabani" });
  check("a doua salvare merge", salv2.status === 200);
  const dupa2 = await sql<Array<{ localitate: string }>>`
    SELECT localitate FROM agent_zone WHERE org_id = ${org.id} AND agent_name = ${costin}
  `;
  check("zona veche a fost înlocuită", dupa2.length === 2, `${dupa2.length}`);
  // o punem la loc pentru restul verificărilor
  await post(ck, { agent: costin, text: mesaj });

  sectiune("Fiecare agent cu zona lui");
  await post(ck, { agent: gabi, text: "marti: Suceava, Radauti" });
  const zoneGabi = await sql`SELECT COUNT(*)::int AS n FROM agent_zone WHERE org_id = ${org.id} AND agent_name = ${gabi}`;
  check("zona lui Gabi nu se amestecă cu a lui Costin", (zoneGabi[0] as { n: number }).n >= 0);
  const dupaTot = await get(ck);
  const alCostin = (dupaTot.agenti ?? []).find((a) => a.nume === costin);
  check("lista întoarce zona fiecărui agent", (alCostin?.zone.length ?? 0) >= 20, String(alCostin?.zone.length));

  sectiune("Izolare și drepturi");
  const straina = await post(ckX, { agent: costin, text: "luni: Dorohoi" });
  check("altă firmă NU poate scrie zona agentului nostru", straina.status === 403, String(straina.status));
  const vedeStrainul = await get(ckX);
  check(
    "altă firmă nu vede agenții noștri",
    !(vedeStrainul.agenti ?? []).some((a) => a.nume === costin),
  );
  const faraCont = await fetch(`${BASE}/api/agentie/zone`);
  check("fără cont nu se văd zonele", faraCont.status === 401, String(faraCont.status));
  const faraAgent = await post(ck, { text: "luni: Dorohoi" });
  check("fără agent ales, refuză politicos", faraAgent.status === 400);

  sectiune("Pagina, cu ochii");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 850 } });
  const [n, v] = ck.split("=");
  await ctx.addCookies([{ name: n, value: v, domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  const erori: string[] = [];
  page.on("pageerror", (e: Error) => erori.push(e.message));
  await page.goto(`${BASE}/agentie/zone`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const text = await page.locator("body").innerText();
  check("pagina se deschide", text.includes("Zonele agenților"));
  check("arată zona deja salvată a agentului", text.includes("Zona salvată"));
  await page.locator("textarea").fill(mesaj);
  await page.locator("button", { hasText: "Verifică" }).first().click();
  await page.waitForTimeout(4000);
  const dupaVerificare = await page.locator("body").innerText();
  // Titlurile sunt scrise cu majuscule din CSS (text-transform), iar
  // innerText le întoarce așa — comparăm fără să ne pese de litere.
  const paginaJos = dupaVerificare.toLowerCase();
  check("arată ce a înțeles, pe zile", paginaJos.includes("ce am înțeles") && paginaJos.includes("luni"));
  check("arată și ce n-a găsit", paginaJos.includes("nu am găsit"));
  check(
    "…cu numărul lor și cu sugestii",
    /nu am găsit aceste localități \(\d+\)/i.test(dupaVerificare),
    dupaVerificare.slice(-200),
  );
  const iese = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("nimic nu iese din ecranul telefonului", iese <= 1, `${iese}px`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(600);
  const ieseDesktop = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("nici pe calculator", ieseDesktop <= 1, `${ieseDesktop}px`);
  check("zero erori de JavaScript", erori.length === 0, erori.slice(0, 2).join(" | "));
  await browser.close();

  sectiune("Curățenie");
  await sql`DELETE FROM agent_zone WHERE org_id IN (${org.id}, ${orgX.id})`;
  await sql`DELETE FROM prospects WHERE cui LIKE ${"29" + baza + "%"}`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${org.id}, ${orgX.id})`;
  await sql`DELETE FROM org_users WHERE email IN (${email}, ${emailStrain})`;
  await sql`DELETE FROM organizations WHERE id IN (${org.id}, ${orgX.id})`;
  console.log("  · datele de test șterse");

  await sql.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
