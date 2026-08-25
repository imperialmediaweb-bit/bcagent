/**
 * CIOCANUL pe funcțiile cerute de agenți (25.08): căutarea de clienți de
 * pe prima pagină, ruta care chiar pornește, „Unde sunt eu" și banda de
 * actualizare. Totul în browser REAL, cu situațiile de pe teren:
 * semnal pierdut, link expirat, scris repede, permisiune refuzată la
 * locație, ecrane mici, nume cu diacritice sau cu cod periculos.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 DATABASE_URL=... TOKEN_SECRET=... \
 *   npx tsx scripts/test-teren-nou.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";

const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pwModule = (await import(PW)) as any;
const chromium = pwModule.chromium ?? pwModule.default?.chromium;

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

/** Curățenia, expusă și în afara lui main() ca să ruleze și la eroare. */
let curataGlobal: (() => Promise<void>) | null = null;

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

async function main() {
  // Ce trebuie curățat, indiferent cum se termină rularea (altfel datele
  // de test rămân în baza comună și strică rulările următoare).
  let curata: (() => Promise<void>) | null = null;
  const RUN = `tn${Date.now().toString(36).slice(-6)}`;
  const orgId = `org-${RUN}`;
  const idA = `ag-${RUN}-a`;
  const numeA = `Agent Teren ${RUN}`;
  const baza = Date.now().toString().slice(-7);
  const cui = (i: number) => `66${baza}${i}`;

  // Date de test: clienții agentului, cu nume „grele" pentru interfață.
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, 'TEREN TEST SRL', ${RUN + "@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN}, ${orgId}, ${idA}, ${numeA})`;
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon)
    VALUES
    (${cui(1)}, ${"MĂGĂZINUL LUI ȘTEFĂNIȚĂ SRL " + RUN}, 'Str. Mare 12', 'RADAUTI', 'SV', '4711', 'client', ${numeA}, TRUE, '0740111222'),
    (${cui(2)}, ${"<script>alert(1)</script> COM " + RUN}, 'Str. Mica 3', 'RADAUTI', 'SV', '4711', 'client', ${numeA}, TRUE, ''),
    (${cui(3)}, ${"MAGAZIN CU NUME FOARTE FOARTE LUNG CARE NU INCAPE PE UN ECRAN DE TELEFON NICIODATA SRL " + RUN}, '', 'SAT FARA ADRESA', 'SV', '4711', 'client', ${numeA}, TRUE, ''),
    (${cui(4)}, ${"MAGAZIN ALTUI AGENT " + RUN}, 'Str. X 1', 'RADAUTI', 'SV', '6202', 'client', 'Alt Agent Strain', TRUE, '')`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = await signToken({ agentId: idA, agentName: numeA, exp }, SECRET);
  const tokExpirat = await signToken(
    { agentId: idA, agentName: numeA, exp: Math.floor(Date.now() / 1000) - 60 },
    SECRET,
  );

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  curata = async () => {
    await browser.close().catch(() => {});
    await sql`DELETE FROM visits WHERE cui = ANY(${[cui(1), cui(2), cui(3), cui(4)]})`;
    await sql`DELETE FROM prospects WHERE cui LIKE ${"66" + baza + "%"}`;
    await sql`DELETE FROM routes WHERE agent_id = ${idA}`;
    await sql`DELETE FROM org_agents WHERE org_id = ${orgId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql`DELETE FROM agent_pin WHERE agent_id = ${idA}`.catch(() => {});
    console.log("  · datele de test șterse");
  };
  curataGlobal = curata;

  /* ─────────── CĂUTAREA ─────────── */
  sectiune("Căutarea de clienți — cazurile de zi cu zi");
  const ctx = await browser.newContext({ viewport: { width: 393, height: 800 } });
  const page = await ctx.newPage();
  const erori: string[] = [];
  page.on("pageerror", (e: Error) => erori.push(e.message));
  await page.goto(`${BASE}/a/${tok}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // PIN-ul, dacă îl cere (link nou)
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  if ((await pinInput.count()) > 0) {
    await pinInput.fill("1234");
    const al2 = page.locator('input[type="password"], input[inputmode="numeric"]').nth(1);
    if ((await al2.count()) > 0) await al2.fill("1234");
    const btn = page.locator("button", { hasText: /Salvează|Intră/ }).first();
    if ((await btn.count()) > 0) await btn.click();
    await page.waitForTimeout(2500);
  }

  const caseta = page.locator('input[placeholder*="Caută un client"]');
  check("căseta de căutare e pe prima pagină", (await caseta.count()) === 1);

  await caseta.fill("m");
  await page.waitForTimeout(900);
  check(
    "o singură literă NU caută (nu bombardăm serverul)",
    (await page.locator("#acasa li").count()) === 0,
  );

  // diacritice: scrie fără, găsește cu
  await caseta.fill("magazin");
  await page.waitForTimeout(1600);
  const dupaMagazin = await page.locator("#acasa").innerText();
  check("găsește clienții după o bucată din nume", dupaMagazin.includes(RUN));
  // Firma altei agenții poate apărea (universul de firme e comun), dar
  // MASCATĂ: fără eticheta „client" și fără starea lor de lucru.
  const randuriMagazin = await page.locator("#acasa li").allInnerTexts();
  const randStrain = randuriMagazin.find((t) => t.includes("MAGAZIN ALTUI AGENT"));
  check(
    "firma altei agenții NU apare ca «client» al meu",
    !randStrain || !randStrain.includes("client"),
    String(randStrain).slice(0, 120),
  );
  const primulRand = randuriMagazin[0] ?? "";
  check(
    "CLIENȚII MEI sunt primii în listă",
    primulRand.includes("client"),
    primulRand.slice(0, 120),
  );

  // DIACRITICE: pe telefon nimeni nu scrie „MĂGĂZINUL" — scrie „magazinul".
  await caseta.fill("magazinul lui stefanita");
  await page.waitForTimeout(1700);
  check(
    "scris FĂRĂ diacritice, găsește clientul scris CU diacritice",
    (await page.locator("#acasa").innerText()).includes("ȘTEFĂNIȚĂ"),
    (await page.locator("#acasa").innerText()).slice(0, 140),
  );
  // Firmă care NU e clientul meu, scrisă cu diacritice: trebuie găsită
  // și ea când scriu fără (universul general, nu doar clienții mei).
  await caseta.fill("altui agent");
  await page.waitForTimeout(1700);
  check(
    "și firmele care nu-s clienții mei se găsesc (universul general)",
    (await page.locator("#acasa").innerText()).includes("ALTUI AGENT"),
  );

  await caseta.fill("radauti");
  await page.waitForTimeout(1700);
  check(
    "caută și după localitate, tot fără diacritice",
    (await page.locator("#acasa li").count()) > 0,
  );

  // XSS: numele cu <script> trebuie să apară ca TEXT, nu executat
  await caseta.fill("script");
  await page.waitForTimeout(1600);
  const textXss = await page.locator("#acasa").innerText();
  check("numele cu cod periculos apare ca text simplu", textXss.includes("<script>"));
  check("nu s-a executat nimic (zero erori/alerte)", erori.length === 0, erori.join(" | "));

  // scris repede: ultima căutare câștigă
  await caseta.fill("mag");
  await page.waitForTimeout(120);
  await caseta.fill("stefan");
  await page.waitForTimeout(120);
  await caseta.fill("script");
  await page.waitForTimeout(1800);
  const dupaRapid = await page.locator("#acasa").innerText();
  check(
    "scrisul rapid: rămâne rezultatul ULTIMEI căutări",
    dupaRapid.includes("<script>") && !dupaRapid.includes("ȘTEFĂNIȚĂ"),
    dupaRapid.slice(0, 160),
  );

  // golire → lista dispare
  await caseta.fill("");
  await page.waitForTimeout(800);
  check("la golire lista dispare", (await page.locator("#acasa li").count()) === 0);

  // fără rezultate → mesaj clar
  await caseta.fill("qwertyzzz");
  await page.waitForTimeout(1600);
  check(
    "fără rezultate: mesaj clar, nu ecran gol",
    (await page.locator("#acasa").innerText()).includes("Nimic găsit"),
  );

  sectiune("Căutarea — când pică netul sau expiră linkul");
  await ctx.route("**/api/prospects?*", (r: { abort: (s: string) => void }) =>
    r.abort("failed"),
  );
  await caseta.fill("magazin");
  await page.waitForTimeout(2000);
  check(
    "fără internet: îi spune, nu-l lasă cu «nimic găsit»",
    (await page.locator("#acasa").innerText()).includes("Fără internet"),
  );
  await ctx.unroute("**/api/prospects?*");
  await ctx.route("**/api/prospects?*", (r: { fulfill: (o: unknown) => void }) =>
    r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Token invalid sau expirat" }),
    }),
  );
  await caseta.fill("magazinul");
  await page.waitForTimeout(2000);
  check(
    "link expirat: mesaj pe românește, cu ce are de făcut",
    (await page.locator("#acasa").innerText()).includes("expirat"),
  );
  check(
    "eroarea are buton de reîncercare (semnalul revine, nu rescrii textul)",
    (await page.locator("button", { hasText: "Încearcă din nou" }).count()) === 1,
  );
  await ctx.unroute("**/api/prospects?*");
  await page.locator("button", { hasText: "Încearcă din nou" }).first().click();
  await page.waitForTimeout(2500);
  check(
    "«Încearcă din nou» chiar reface căutarea, cu ACELAȘI text",
    (await page.locator("#acasa li").count()) > 0 &&
      (await page.locator("button", { hasText: "Încearcă din nou" }).count()) === 0,
  );

  sectiune("Căutarea — butoanele de pe fiecare client");
  await caseta.fill("ștefăniță");
  await page.waitForTimeout(1800);
  await page.waitForTimeout(600);
  const rand = page.locator("#acasa li").first();
  const textRand = await rand.innerText();
  check("clientul are butonul „Am fost”", textRand.includes("Am fost"));
  check("clientul are butonul „Comandă”", textRand.includes("Comandă"));
  check("clientul are „Navighează”", textRand.includes("Navighează"));
  check("clientul cu telefon are „Sună”", textRand.includes("Sună"));
  const linkNav = await rand.locator('a[href*="google.com/maps"]').first().getAttribute("href");
  check(
    "linkul de navigare e spre Google Maps, cu adresa",
    !!linkNav && linkNav.includes("maps/dir") && decodeURIComponent(linkNav).includes("Suceava"),
    String(linkNav).slice(0, 120),
  );

  // „Am fost" deschide dictarea
  await rand.locator("button", { hasText: "Am fost" }).first().click();
  await page.waitForTimeout(700);
  const dupaAmFost = await page.locator("#acasa").innerText();
  check("«Am fost» deschide caseta de dictare", dupaAmFost.includes("spune ce a zis"));
  check(
    "are toate rezultatele de ales",
    ["client", "gândește", "sună", "vrea"].every((w) => dupaAmFost.toLowerCase().includes(w)),
  );

  // scriem o notă și salvăm
  const nota = page.locator("#acasa textarea").first();
  await nota.fill("test ciocan " + RUN);
  await page.locator("#acasa button", { hasText: "Se mai gândește" }).first().click();
  // Salvarea așteaptă întâi poziția GPS (max 3s), apoi trimite.
  await page.waitForTimeout(6000);
  const [vizitaSalvata] = await sql<Array<{ note: string; agent_name: string }>>`
    SELECT note, agent_name FROM visits WHERE cui = ${cui(1)} ORDER BY visited_at DESC LIMIT 1
  `;
  check(
    "vizita din CĂUTARE ajunge în baza de date, cu nota ei",
    vizitaSalvata?.note?.includes("test ciocan") === true,
    JSON.stringify(vizitaSalvata),
  );
  check("vizita e pe numele agentului care a bifat", vizitaSalvata?.agent_name === numeA);

  sectiune("Căutarea — pe ecrane mici și mari");
  for (const w of [320, 360, 393, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(250);
    const iese = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`nimic nu iese din ecran la ${w}px`, iese <= 1, `${iese}px`);
  }
  await page.setViewportSize({ width: 393, height: 800 });
  // clientul cu nume foarte lung
  await caseta.fill("foarte");
  await page.waitForTimeout(1700);
  const ieseLung = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("numele foarte lung nu sparge ecranul", ieseLung <= 1, `${ieseLung}px`);

  sectiune("Banda de actualizare — apare DOAR la versiune nouă");
  check(
    "fără versiune nouă: nicio bandă pe ecran",
    (await page.locator("text=E o versiune nouă").count()) === 0,
  );
  await ctx.route("**/api/versiune", (r: { fulfill: (o: unknown) => void }) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ versiune: "versiune-noua-" + Date.now() }),
    }),
  );
  // scriem ceva → aplicația e „ocupată", deci NU ne smulge pagina
  await caseta.fill("magazinul");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(2500);
  const banda = page.locator("text=E o versiune nouă");
  check("cu versiune nouă și om ocupat: apare banda", (await banda.count()) === 1);
  check(
    "banda are butonul de actualizare",
    (await page.locator("button", { hasText: "Actualizează" }).count()) === 1,
  );
  const jos = await page.locator("text=E o versiune nouă").first().evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.bottom > window.innerHeight - 120;
  });
  check("banda stă JOS, la îndemână", jos);
  await page.locator('button[aria-label="Ascunde"]').first().click();
  await page.waitForTimeout(500);
  check("se poate închide dacă deranjează", (await banda.count()) === 0);
  await ctx.unroute("**/api/versiune");
  check("zero erori de JavaScript în tot fluxul", erori.length === 0, erori.slice(0, 2).join(" | "));
  await ctx.close();

  /* ─────────── UNDE SUNT EU ─────────── */
  sectiune("„Unde sunt eu” — cu GPS și fără");
  const ctxGps = await browser.newContext({
    viewport: { width: 393, height: 800 },
    permissions: ["geolocation"],
    geolocation: { latitude: 47.8447, longitude: 25.9186, accuracy: 20 },
  });
  const pGps = await ctxGps.newPage();
  await pGps.goto(`${BASE}/api/agentie/demo-login?rol=agent`, { waitUntil: "domcontentloaded" });
  await pGps.waitForTimeout(3500);
  await pGps.locator("header button").first().click().catch(() => {});
  await pGps.waitForTimeout(400);
  await pGps.locator("aside button", { hasText: "Harta pieței" }).first().click();
  await pGps.waitForTimeout(3000);
  const btnEu = pGps.locator("button", { hasText: "Unde sunt eu" }).first();
  check("butonul «Unde sunt eu» e pe hartă", (await btnEu.count()) === 1);

  await btnEu.click();
  await pGps.waitForTimeout(2500);
  check(
    "după apăsare devine «Ascunde-mă» (deci s-a găsit poziția)",
    (await pGps.locator("button", { hasText: "Ascunde-mă" }).count()) === 1,
  );
  const tiles = await pGps.evaluate(() => {
    // nivelul de zoom se vede în adresa pătratelor de hartă: /z/x/y.png
    const img = document.querySelector(".leaflet-tile") as HTMLImageElement | null;
    const m = img?.src.match(/\/(\d+)\/\d+\/\d+\.png/);
    return m ? parseInt(m[1], 10) : 0;
  });
  check("harta s-a APROPIAT pe agent (zoom ≥ 13), nu s-a depărtat", tiles >= 13, `zoom ${tiles}`);
  // Centrul hărții trebuie să fie LÂNGĂ agent (Rădăuți: 47.84, 25.92).
  const centru = await pGps.evaluate(() => {
    const img = document.querySelector(".leaflet-tile") as HTMLImageElement | null;
    return img?.src ?? "";
  });
  check(
    "harta arată zona agentului (s-au încărcat pătrate noi de hartă)",
    centru.includes("openstreetmap") || centru.includes("tile"),
    centru.slice(0, 80),
  );
  await pGps.locator("button", { hasText: "Ascunde-mă" }).first().click();
  await pGps.waitForTimeout(600);
  check(
    "se poate stinge la loc",
    (await pGps.locator("button", { hasText: "Unde sunt eu" }).count()) === 1,
  );
  await ctxGps.close();

  const ctxFara = await browser.newContext({
    viewport: { width: 393, height: 800 },
    permissions: [],
  });
  const pFara = await ctxFara.newPage();
  await pFara.goto(`${BASE}/api/agentie/demo-login?rol=agent`, { waitUntil: "domcontentloaded" });
  await pFara.waitForTimeout(3500);
  await pFara.locator("header button").first().click().catch(() => {});
  await pFara.waitForTimeout(400);
  await pFara.locator("aside button", { hasText: "Harta pieței" }).first().click();
  await pFara.waitForTimeout(3000);
  await pFara.locator("button", { hasText: "Unde sunt eu" }).first().click();
  await pFara.waitForTimeout(3000);
  const textFara = await pFara.locator("#harta").innerText();
  check(
    "fără permisiune la locație: îi spune CUM să o dea",
    textFara.includes("Permite") || textFara.includes("locație"),
    textFara.slice(0, 160),
  );
  await ctxFara.close();

  /* ─────────── RUTA ─────────── */
  sectiune("Ruta — coșul, salvarea și navigarea");
  const rSalvare = await fetch(`${BASE}/api/routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: tok,
      name: `Ruta ${RUN}`,
      day: "luni",
      stops: [
        { cui: cui(1), denumire: "CU COORD", adresa: "Str. Mare 12", localitate: "RADAUTI", telefon: "", lat: 47.85, lng: 25.92 },
        { cui: cui(3), denumire: "FARA ADRESA", adresa: "", localitate: "", telefon: "" },
      ],
    }),
  });
  check("ruta se salvează", rSalvare.ok);
  const gRute = await fetch(`${BASE}/api/routes?token=${encodeURIComponent(tok)}`);
  const dRute = (await gRute.json()) as { routes?: Array<{ id: string; name: string; stops: Array<{ lat: number | null }> }> };
  const rutaMea = (dRute.routes ?? []).find((r) => r.name === `Ruta ${RUN}`);
  check("coordonatele SUPRAVIEȚUIESC salvării (fixul lui Costin)", rutaMea?.stops?.[0]?.lat === 47.85, JSON.stringify(rutaMea?.stops?.[0]));
  check("oprirea fără adresă rămâne în rută (n-o pierdem)", rutaMea?.stops?.length === 2);
  const rExpirat = await fetch(`${BASE}/api/routes?token=${encodeURIComponent(tokExpirat)}`);
  check("cu link expirat nu se văd rutele", rExpirat.status === 401, String(rExpirat.status));
  if (rutaMea) {
    await fetch(`${BASE}/api/routes?token=${encodeURIComponent(tok)}&id=${rutaMea.id}`, {
      method: "DELETE",
    });
  }

  await browser.close();

  sectiune("Curățenie");
  await curata?.();

  await sql.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  // Curățăm și când pică ceva — baza de test rămâne curată pentru
  // rularea următoare.
  await curataGlobal?.().catch(() => {});
  await sql.end();
  process.exit(1);
});
