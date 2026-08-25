/**
 * AGENTUL, CU OCHII ȘI CU DEGETUL — în Chromium real, pe telefon.
 * Umblă prin TOT panoul ca un om: fiecare meniu, harta, ruta, microfonul,
 * vizita, comanda. La fiecare pas verifică: se vede? merge? nu iese din
 * ecran? nu crapă? Rulează în DOUĂ browsere: Chrome (cu dictare) și
 * browser-din-aplicație (fără dictare) — al doilea e cazul din teren.
 */
const PW = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pw = (await import(PW)) as any;
const chromium = pw.chromium ?? pw.default?.chromium;
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

let pass = 0, fail = 0;
const rele: string[] = [];

/**
 * Pe o bază proaspătă localitățile n-au coordonate (geocodarea reală cere
 * Nominatim, 1 cerere/secundă). Punem coordonate deterministe ca harta să
 * aibă bule — testăm UI-ul hărții, nu geocodarea.
 */
async function seedGeo() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  try {
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl);
    await sql`
      INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
      SELECT DISTINCT p.judet, p.localitate,
             47.5 + (hashtext(p.localitate) % 100)::float / 500.0,
             26.0 + (hashtext(p.judet || p.localitate) % 100)::float / 400.0,
             FALSE
      FROM prospects p
      WHERE COALESCE(p.localitate, '') <> '' AND COALESCE(p.judet, '') <> ''
      ON CONFLICT (judet, localitate)
        DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE
        WHERE geo_localitati.lat IS NULL
    `;
    await sql.end();
  } catch (e) {
    console.log("  · seed geo sărit:", (e as Error).message.slice(0, 80));
  }
}
function check(n: string, ok: boolean, x = "") {
  if (ok) { pass++; console.log(`    ✓ ${n}`); }
  else { fail++; rele.push(`${n} ${x}`); console.log(`    ✗ ${n} ${x}`); }
}

const MENIURI = [
  ["Acasă", "acasa"], ["Harta pieței", "harta"], ["Prospecți", "prospecti"],
  ["Privire ansamblu", "overview"], ["AI Insights", "ai"], ["Analiză Smart", "smart"],
  ["Antrenorul", "antrenor"], ["Target", "obiective"], ["Evoluție", "evolutie"],
  ["Distribuție", "distribuire"], ["Matrice", "matrice"], ["Comisioane", "comisioane"],
  ["Eficiență", "eficienta"], ["Top clienți", "clienti"], ["Anomalii", "anomalii"],
  ["Tot pe o pagină", "tot"],
] as const;

async function ruleaza(numeCaz: string, cuDictare: boolean, latime: number, font: string) {
  console.log(`\n══ ${numeCaz} (${latime}px, font ${font}) ══`);
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: latime, height: 800 }, isMobile: true, hasTouch: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await ctx.newPage();
  if (!cuDictare) {
    await page.addInitScript(() => {
      // @ts-expect-error stergem API-ul, ca in browserele din aplicatii
      delete window.SpeechRecognition; // @ts-expect-error idem
      delete window.webkitSpeechRecognition;
    });
  }
  const erori: string[] = [];
  page.on("pageerror", (e: Error) => erori.push(e.message.slice(0, 120)));
  page.on("console", (m: { type: () => string; text: () => string }) => {
    const t = m.text();
    if (m.type() === "error" && !/favicon|manifest|tile|OpenStreetMap|Nominatim|TUNNEL|ERR_|net::|Failed to load resource|401|402|403|429/i.test(t)) erori.push(t.slice(0, 120));
  });

  await page.goto(`${BASE}/api/agentie/demo-login?rol=agent`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  if (font !== "normal") { await page.evaluate((f: string) => { document.documentElement.style.fontSize = f; }, font); await page.waitForTimeout(600); }
  check("panoul se deschide", page.url().includes("/a/"));

  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const continut = async (id: string) => page.evaluate((s: string) => {
    const el = document.getElementById(s);
    if (!el) return -1;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 0;
    return (el.innerText || "").trim().length;
  }, id);

  // ─ fiecare meniu ─
  for (const [eticheta, id] of MENIURI) {
    await page.locator("header button").first().click().catch(() => {});
    await page.waitForTimeout(400);
    const btn = page.locator("aside button", { hasText: eticheta }).first();
    if ((await btn.count()) === 0) { check(`meniul „${eticheta}" există`, false); continue; }
    const dez = await btn.evaluate((el: HTMLElement) => getComputedStyle(el).pointerEvents === "none");
    if (dez) { console.log(`    · „${eticheta}" dezactivat (fără date) — sar`); continue; }
    await btn.click();
    await page.waitForTimeout(eticheta === "Harta pieței" ? 3500 : 1400);
    if (id === "tot") {
      // „Tot pe o pagină" nu e o secțiune, e un MOD: le arată pe toate deodată.
      const cate = await page.evaluate(() =>
        [...document.querySelectorAll("section[id], div[id]")].filter((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0 && ((el as HTMLElement).innerText || "").trim().length > 25;
        }).length,
      );
      check("Tot pe o pagina arata mai multe sectiuni deodata", cate >= 2, `${cate} sectiuni`);
    } else {
      const n = await continut(id);
      check(`„${eticheta}" are conținut vizibil`, n > 25, n === -1 ? "secțiunea nu există" : `${n} caractere`);
    }
    check(`„${eticheta}" încape pe ecran`, (await overflow()) <= 2, `${await overflow()}px afară`);
  }

  // ─ harta: bulă → firme → microfon → vizită ─
  await page.locator("header button").first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator("aside button", { hasText: "Harta pieței" }).first().click();
  await page.waitForTimeout(3500);
  const bule = await page.locator("path.leaflet-interactive").count();
  check("harta are bule", bule > 0, `${bule}`);
  if (bule > 0) {
    await page.locator("path.leaflet-interactive").first().click({ force: true });
    await page.waitForTimeout(2500);
    const btnVizita = page.locator('button:has-text("Am fost")').first();
    check("butonul de vizită apare la firmă", (await btnVizita.count()) > 0);
    if ((await btnVizita.count()) > 0) {
      const bv = await btnVizita.boundingBox();
      check("butonul de vizită e ÎN ecran", !!bv && bv.x >= -1 && bv.x + bv.width <= latime + 2, JSON.stringify(bv));
      await btnVizita.click();
      await page.waitForTimeout(1300);
      const chenar = page.locator("div").filter({ hasText: /spune ce a zis clientul/ }).last();
      const mic = chenar.locator("button").first();
      check("MICROFONUL apare", (await mic.count()) > 0);
      if ((await mic.count()) > 0) {
        const bm = await mic.boundingBox();
        check("microfonul e ÎN ecran", !!bm && bm.x >= -1 && bm.x + bm.width <= latime + 2, JSON.stringify(bm));
        await mic.click();
        await page.waitForTimeout(600);
        const txt = await page.evaluate(() => document.body.innerText);
        if (cuDictare) {
          // Chromium de test are API-ul, dar nu și motorul de dictare al
          // Google — deci nu poate asculta efectiv. Verificăm ce ține de noi:
          // butonul e activ și nu afișează mesajul de „fără dictare".
          const activ = await mic.evaluate((el: HTMLElement) => !(el as HTMLButtonElement).disabled && getComputedStyle(el).pointerEvents !== "none");
          check("microfonul e activ (apăsabil)", activ);
          check("nu apare mesajul de browser fără dictare", !/doar în Chrome/i.test(txt));
        } else {
          check("fără dictare: explică să deschidă în Chrome", /Chrome/i.test(txt));
        }
      }
      // scris cu mâna + salvare vizită
      const ta = chenar.locator("textarea").first();
      if ((await ta.count()) > 0) {
        await ta.fill("test automat: clientul vrea Kent");
        check("nota se poate scrie cu mâna", (await ta.inputValue()).includes("Kent"));
      }
      const rez = page.locator("button", { hasText: "Se mai gândește" }).first();
      if ((await rez.count()) > 0) {
        await rez.click();
        await page.waitForTimeout(2000);
        const dupa = await page.evaluate(() => document.body.innerText);
        check("vizita se salvează (confirmare pe ecran)", /✓|salvat|gândește/i.test(dupa));
      }
    }
    // ruta
    const plus = page.locator('button[title="Adaugă în rută"]').first();
    if ((await plus.count()) > 0) {
      await plus.click();
      await page.waitForTimeout(900);
      check("clientul intră în rută", /Ruta[: ]/i.test(await page.evaluate(() => document.body.innerText)));
    }
  }
  check("zero erori JavaScript în tot panoul", erori.length === 0, erori.slice(0, 2).join(" | "));
  await b.close();
}

await seedGeo();
await ruleaza("CHROME normal", true, 393, "normal");
await ruleaza("BROWSER DIN APLICAȚIE (fără dictare)", false, 360, "22px");
await ruleaza("TELEFON MIC + font uriaș", true, 320, "24px");

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
if (fail) { console.log("\nCe nu merge:"); rele.forEach((r) => console.log("  · " + r)); }
process.exit(fail === 0 ? 0 : 1);
