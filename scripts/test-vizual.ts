/**
 * TESTUL CU OCHII — ce VEDE omul pe ecran, în browser adevărat.
 *
 * Suitele celelalte întreabă serverul „îmi dai datele?”. Asta întreabă
 * ecranul „se vede?”. Bug-urile găsite de utilizator în teren (harta gri,
 * butonul care pare că nu face nimic, sigla peste buton) treceau de toate
 * testele de API pentru că API-ul răspundea corect — doar ochiul vedea
 * altceva. Suita asta acoperă exact stratul ăla.
 *
 * Ce verifică, pentru fiecare meniu din fiecare panou:
 *   · secțiunea chiar se VEDE (nu 0 pixeli, nu ascunsă)
 *   · are conținut, nu e goală
 *   · încape pe ecran (nimic tăiat pe orizontală)
 *   · nu aruncă erori în consola browserului
 * Plus fluxurile vizuale: harta desenată (nu gri), click pe bulă, click pe
 * zonă neacoperită, construirea rutei și linkul de navigare.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 npx tsx scripts/test-vizual.ts
 */
// playwright-core e instalat global în mediul de test; îl încărcăm la
// rulare ca să nu-l punem ca dependență a aplicației.
const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pwModule = (await import(PW)) as any;
const chromium = pwModule.chromium ?? pwModule.default?.chromium;
if (!chromium) {
  console.error(
    "Nu găsesc browserul de test (playwright-core). Setează PLAYWRIGHT_MODULE.",
  );
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const CHROME =
  process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string) {
  console.log(`\n══ ${t} ══`);
}

/** Erorile din consola browserului, strânse per pagină. */
function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`JS: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Zgomot de mediu, nu bug de aplicație: hărțile OpenStreetMap și
    // fonturile externe pot fi blocate în rețeaua de test.
    if (/tile\.openstreetmap|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/i.test(t)) return;
    errs.push(`CONSOLĂ: ${t.slice(0, 160)}`);
  });
  return errs;
}

/** Lățimea care iese din ecran (0 = totul încape). */
async function overflowX(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Textul vizibil dintr-o secțiune (ca să știm că nu e goală). */
async function textVizibil(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el || el.offsetParent === null) return "";
    return (el.innerText || "").trim();
  }, selector);
}

const MENIURI_AGENT = [
  ["acasa", "Acasă (ziua mea)"],
  ["overview", "Privire ansamblu"],
  ["harta", "Harta pieței"],
  ["antrenor", "Antrenorul meu"],
  ["obiective", "Target & decont"],
  ["prospecti", "Prospecți"],
] as const;

const PAGINI_FIRMA = [
  ["/agentie", "Dashboard"],
  ["/agentie/raport", "Raportul săptămânal"],
  ["/agentie/vanzari", "Vânzări"],
  ["/agentie/comenzi", "Comenzi"],
  ["/agentie/targete", "Targeturi"],
  ["/agentie/agenti", "Agenți"],
  ["/agentie/vizite", "Vizite"],
  ["/agentie/clienti", "Clienți"],
  ["/agentie/solduri", "Solduri"],
  ["/agentie/decont", "Decont"],
  ["/agentie/echipa", "Echipa"],
  ["/agentie/setari", "Setări"],
] as const;

async function panouAgent(browser: Browser) {
  section("PANOUL AGENTULUI — fiecare meniu, cu ochii");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);

  await page.goto(`${BASE}/api/agentie/demo-login?rol=agent`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  check("panoul agentului se deschide din demo", page.url().includes("/a/"));

  for (const [key, eticheta] of MENIURI_AGENT) {
    const buton = page.locator("button, a").filter({ hasText: eticheta }).first();
    if ((await buton.count()) === 0) {
      check(`meniul „${eticheta}” există`, false, "butonul nu e în bara laterală");
      continue;
    }
    await buton.click();
    await page.waitForTimeout(key === "harta" ? 3500 : 1200);

    const text = await textVizibil(page, `#${key}`);
    check(
      `„${eticheta}” se vede și are conținut`,
      text.length > 30,
      text.length === 0 ? "secțiunea e ascunsă sau goală" : `doar ${text.length} caractere`,
    );
    const of = await overflowX(page);
    check(`„${eticheta}” încape pe ecran`, of <= 2, `${of}px în afară`);
  }

  // „Tot pe o pagină” nu e o secțiune, ci un MOD: trebuie să se vadă mai
  // multe secțiuni deodată.
  const totBtn = page.locator("button, a").filter({ hasText: "Tot pe o pagină" }).first();
  if ((await totBtn.count()) > 0) {
    await totBtn.click();
    await page.waitForTimeout(1500);
    const vizibile = await page.evaluate(
      () =>
        ["overview", "harta", "antrenor", "obiective", "prospecti"].filter((id) => {
          const el = document.getElementById(id);
          return !!el && el.offsetParent !== null;
        }).length,
    );
    check(
      "„Tot pe o pagină” arată mai multe secțiuni deodată",
      vizibile >= 3,
      `doar ${vizibile} secțiuni vizibile`,
    );
  }

  section("PANOUL AGENTULUI — harta chiar se DESENEAZĂ (nu gri)");
  await page.locator("button, a").filter({ hasText: "Harta pieței" }).first().click();
  await page.waitForTimeout(4000);
  const harta = await page.evaluate(() => {
    const el = document.querySelector(".leaflet-container") as HTMLElement | null;
    if (!el) return null;
    return {
      latime: el.clientWidth,
      inaltime: el.clientHeight,
      patrate: el.querySelectorAll(".leaflet-tile").length,
      bule: el.querySelectorAll("path.leaflet-interactive").length,
    };
  });
  check("harta există în pagină", harta !== null);
  if (harta) {
    check(
      "harta are dimensiune reală (nu 0 pixeli)",
      harta.latime > 300 && harta.inaltime > 200,
      `${harta.latime}×${harta.inaltime}`,
    );
    // Bug-ul „hartă gri”: Leaflet calcula un singur pătrat, pentru un
    // chenar de 0×0. Cu chenarul corect cere multe pătrate.
    check(
      "harta cere pătrate pentru tot chenarul (nu rămâne gri)",
      harta.patrate > 1,
      `doar ${harta.patrate} pătrate`,
    );
  }

  section("PANOUL AGENTULUI — click pe bulă → firmele localității");
  const bule = await page.locator("path.leaflet-interactive").count();
  const areDate = await page.evaluate(() => {
    const t = document.getElementById("harta")?.innerText || "";
    return /\d/.test(t) && !/0 firme active/.test(t);
  });
  if (bule === 0 && !areDate) {
    console.log("  · baza asta n-are firme cu coordonate — sar peste hartă/rută");
  } else {
    check("există bule pe hartă", bule > 0, `${bule} bule`);
  }
  if (bule > 0) {
    await page.locator("path.leaflet-interactive").first().click({ force: true });
    await page.waitForTimeout(2000);
    const panou = await page.evaluate(() => {
      const cap = [...document.querySelectorAll("p")].find((e) =>
        /firme active/.test(e.textContent || ""),
      ) as HTMLElement | undefined;
      if (!cap) return null;
      const r = cap.getBoundingClientRect();
      return {
        text: (cap.parentElement?.innerText || "").slice(0, 60),
        inEcran: r.top >= 0 && r.top < window.innerHeight,
      };
    });
    check("panoul localității se deschide", panou !== null);
    check("panoul e vizibil pe ecran, nu ascuns sus", panou?.inEcran === true);
  }

  section("PANOUL AGENTULUI — ruta: adaug firme → linkul le are pe toate");
  const plusuri = page.locator('button[title*="rut"], button[aria-label*="rut"]');
  const nrPlus = await plusuri.count();
  if (bule === 0) {
    console.log("  · fără localitate deschisă (bază fără date) — sar peste rută");
  } else {
    check("firmele au buton de adăugare în rută", nrPlus > 0, `${nrPlus} butoane`);
  }
  const deAdaugat = Math.min(3, nrPlus);
  for (let i = 0; i < deAdaugat; i++) {
    await plusuri.nth(i).click();
    await page.waitForTimeout(400);
  }
  if (deAdaugat > 0) {
    const ruta = await page.evaluate(() => {
      const marker = [...document.querySelectorAll("span")].find((e) =>
        /^Ruta:\s*\d+\s*opriri/.test((e.textContent || "").trim()),
      );
      if (!marker) return null;
      const zona = marker.closest("div")?.parentElement;
      if (!zona) return null;
      const link = [...zona.querySelectorAll("a")].find((a) =>
        (a.href || "").includes("google.com/maps"),
      );
      const nrCos = parseInt(
        (marker.textContent || "").replace(/\D+/g, "") || "0",
        10,
      );
      if (!link) return { nrCos, nrLink: 0 };
      const u = new URL(link.href);
      const wp = u.searchParams.get("waypoints");
      const nrLink =
        (u.searchParams.get("destination") ? 1 : 0) +
        (wp ? wp.split("|").length : 0);
      return { nrCos, nrLink };
    });
    check("coșul de rută apare după adăugare", ruta !== null);
    if (ruta) {
      check(
        "coșul are exact firmele adăugate",
        ruta.nrCos === deAdaugat,
        `coș ${ruta.nrCos}, adăugate ${deAdaugat}`,
      );
      check(
        "linkul de navigare le trimite pe TOATE (niciuna pierdută)",
        ruta.nrLink === ruta.nrCos,
        `coș ${ruta.nrCos} vs link ${ruta.nrLink}`,
      );
    }
  }

  section("PANOUL AGENTULUI — zonele neacoperite duc la firme");
  const zona = page
    .locator("button")
    .filter({ hasText: /firme active · .* cu telefon/ })
    .first();
  if ((await zona.count()) > 0) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const inainte = await page.evaluate(() => window.scrollY);
    await zona.click();
    await page.waitForTimeout(2000);
    const dupa = await page.evaluate(() => window.scrollY);
    check(
      "clicul pe o zonă neacoperită urcă ecranul la hartă",
      dupa < inainte,
      `${inainte} → ${dupa}`,
    );
  } else {
    console.log("  · fără zone neacoperite în datele demo — sar peste");
  }

  section("PANOUL AGENTULUI — pe telefon și pe tabletă");
  for (const [w, h, nume] of [
    [390, 844, "telefon"],
    [768, 1024, "tabletă"],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1500);
    const of = await overflowX(page);
    check(`panoul agentului încape pe ${nume}`, of <= 2, `${of}px în afară`);
    const hartaMobil = await page.evaluate(() => {
      const el = document.querySelector(".leaflet-container") as HTMLElement | null;
      if (!el || el.offsetParent === null) return null;
      return { latime: el.clientWidth, patrate: el.querySelectorAll(".leaflet-tile").length };
    });
    if (hartaMobil) {
      check(
        `harta se redesenează pe ${nume}`,
        hartaMobil.latime > 200 && hartaMobil.patrate > 1,
        `${hartaMobil.latime}px, ${hartaMobil.patrate} pătrate`,
      );
    }
  }
  await page.setViewportSize({ width: 1400, height: 900 });

  check("zero erori JavaScript în tot panoul agentului", errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

async function panouFirma(browser: Browser) {
  section("PANOUL FIRMEI — fiecare pagină, cu ochii");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);

  await page.goto(`${BASE}/api/agentie/demo-login?rol=manager`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);
  check("panoul firmei se deschide din demo", page.url().includes("/agentie"));

  for (const [href, eticheta] of PAGINI_FIRMA) {
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1800);

    const stare = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement | null;
      const text = (main?.innerText || "").trim();
      // Mesaje roșii de eroare afișate utilizatorului
      const alerte = [...document.querySelectorAll("div,p")]
        .filter((e) => {
          const el = e as HTMLElement;
          const c = el.className;
          return (
            typeof c === "string" &&
            /rose-50|red-50/.test(c) &&
            el.offsetParent !== null &&
            (el.innerText || "").trim().length > 5
          );
        })
        .map((e) => (e as HTMLElement).innerText.trim().slice(0, 80));
      return { lungime: text.length, alerte: alerte.slice(0, 2) };
    });
    check(
      `„${eticheta}” are conținut pe ecran`,
      stare.lungime > 80,
      `${stare.lungime} caractere`,
    );
    check(
      `„${eticheta}” fără mesaj de eroare afișat`,
      stare.alerte.length === 0,
      stare.alerte.join(" | "),
    );
    const of = await overflowX(page);
    check(`„${eticheta}” încape pe ecran`, of <= 2, `${of}px în afară`);
  }

  section("PANOUL FIRMEI — pe telefon (meniul mobil)");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/agentie/comenzi`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const ofMobil = await overflowX(page);
  check("pagina Comenzi încape pe telefon", ofMobil <= 2, `${ofMobil}px în afară`);
  const meniu = page.locator('button[aria-label="Meniu"]').first();
  check("butonul de meniu există pe telefon", (await meniu.count()) > 0);
  if ((await meniu.count()) > 0) {
    await meniu.click();
    await page.waitForTimeout(800);
    const linkuriVizibile = await page.evaluate(
      () =>
        [...document.querySelectorAll("a")].filter((a) => {
          const el = a as HTMLElement;
          return (
            el.offsetParent !== null &&
            (a.getAttribute("href") || "").startsWith("/agentie")
          );
        }).length,
    );
    check("meniul mobil deschide lista de pagini", linkuriVizibile >= 5, `${linkuriVizibile} linkuri`);
  }

  check("zero erori JavaScript în tot panoul firmei", errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    await panouAgent(browser);
    await panouFirma(browser);
  } finally {
    await browser.close();
  }

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} ${passed} verificări vizuale trecute, ${failed} eșuate`,
  );
  if (failures.length) {
    console.log("\nCe se vede prost:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
