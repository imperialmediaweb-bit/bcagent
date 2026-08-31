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

/** Ziua de azi în cheile aplicației — aceleași ca în DayPanel. */
const ZI_AZI = [
  "duminica", "luni", "marti", "miercuri", "joi", "vineri", "sambata",
][new Date().getDay()];

/**
 * ZONA DE AZI, pusă pe linkul agentului cu API-ul LUI — exact cum și-o
 * scrie agentul de pe telefon (POST /api/routes/zona). Satul îl luăm din
 * ruta pe care demo-ul o face oricum pe ziua curentă: aia e sigur un sat
 * cu clienți de-ai lui, fără să inventăm date noi.
 *
 * Întoarce și dacă agentul ARE rută pe azi — de asta atârnă regresia
 * „lista dispărea de pe prima pagină când exista rută".
 */
async function puneZonaDeAzi(
  token: string,
): Promise<{ sat: string; client: string; areRuta: boolean } | null> {
  try {
    const r = await fetch(`${BASE}/api/routes?token=${encodeURIComponent(token)}`);
    if (!r.ok) return null;
    const d = (await r.json()) as {
      routes?: Array<{
        day: string;
        stops: Array<{ denumire?: string; localitate?: string }>;
      }>;
    };
    const rutaAzi = (d.routes ?? []).find((x) => x.day === ZI_AZI);
    const oprire = (rutaAzi?.stops ?? []).find(
      (s) => (s.localitate ?? "") !== "" && (s.denumire ?? "") !== "",
    );
    if (!oprire) return null;
    const w = await fetch(`${BASE}/api/routes/zona`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, text: `${ZI_AZI} - ${oprire.localitate}` }),
    });
    if (!w.ok) return null;
    const dw = (await w.json()) as { salvate?: number };
    if (!dw.salvate) return null;
    return {
      sat: String(oprire.localitate),
      client: String(oprire.denumire),
      areRuta: !!rutaAzi,
    };
  } catch {
    return null;
  }
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

  // ─ LISTA CLIENȚILOR ZILEI, de pe prima pagină ─
  // Cererea lui Răzvan: intră dimineața și are deja clienții din satele
  // de azi, grupați pe sat, de bifat direct — fără să-i caute pe hartă.
  const token = (page.url().split("/a/")[1] ?? "").split(/[?#]/)[0];
  const zona = token ? await puneZonaDeAzi(token) : null;
  if (!zona) {
    console.log("    · fără zonă/clienți de azi pentru agentul demo — sar peste lista zilei");
  } else {
    await page.goto(`${BASE}/a/${token}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    if (font !== "normal") {
      await page.evaluate((f: string) => { document.documentElement.style.fontSize = f; }, font);
      await page.waitForTimeout(600);
    }
    const textPagina = async (): Promise<string> =>
      page.evaluate(() => document.body.innerText);
    const t0 = await textPagina();
    check("cardul «Zona ta de azi» e pe prima pagină", t0.includes("Zona ta de azi"));
    check(`satul zilei are capul lui de listă (📍 ${zona.sat})`,
      t0.toUpperCase().includes(`📍 ${zona.sat.toUpperCase()}`), zona.sat);
    check("lista are titlul ei", t0.includes("Clienții tăi de azi"));
    check("…cu numărătoarea de bifați", /\d+\s+din\s+\d+\s+bifați/.test(t0),
      t0.split("\n").find((l: string) => l.includes("Clienții tăi de azi")) ?? "");
    check("lista încape pe ecran", (await overflow()) <= 2, `${await overflow()}px afară`);

    // REGRESIE: până acum cardul era `zona && !route` — cu rută salvată pe
    // ziua curentă (demo-ul face una), lista dispărea complet de pe prima
    // pagină, exact în ziua în care agentul avea nevoie de ea.
    if (zona.areRuta) {
      check("REGRESIE: cu rută salvată pe azi, lista TOT se vede",
        t0.includes("Zona ta de azi") && t0.includes("Clienții tăi de azi"));
      check("…iar butonul de făcut ruta nu se mai arată (are deja rută)",
        !/Fă-mi ruta de azi/.test(t0));
    } else {
      console.log("    · agentul demo n-are rută pe azi — regresia cu ruta nu se poate proba aici");
    }

    const rand = page.locator("li:visible").filter({ hasText: zona.client }).first();
    check("clientul din sat e un rând în lista zilei", (await rand.count()) > 0, zona.client);
    if ((await rand.count()) > 0) {
      const eraBifat = /✓ azi/.test(await rand.innerText().catch(() => ""));
      const amFost = rand.locator('button:has-text("Am fost")').first();
      check("rândul are butonul de vizită", (await amFost.count()) > 0);
      const comanda = rand.locator('button:has-text("Comandă")').first();
      check("rândul are butonul de comandă", (await comanda.count()) > 0);
      const navig = rand.locator('a:has-text("Navighează")').first();
      check("rândul are linkul de navigare", (await navig.count()) > 0);
      if ((await amFost.count()) > 0) {
        const ba = await amFost.boundingBox();
        check("butonul de vizită din listă e ÎN ecran",
          !!ba && ba.x >= -1 && ba.x + ba.width <= latime + 2, JSON.stringify(ba));
        await amFost.click();
        await page.waitForTimeout(1200);
        const rezultat = rand.locator("button", { hasText: "Se mai gândește" }).first();
        check("se deschid rezultatele vizitei sub rând", (await rezultat.count()) > 0);
        if ((await rezultat.count()) > 0) {
          await rezultat.click();
          // GPS-ul are 3 secunde, apoi pleacă POST-ul pe /api/visits.
          await page.waitForTimeout(5000);
          const dupa = await rand.innerText().catch(() => "");
          check("rândul se bifează cu ✓ azi", /✓ azi/.test(dupa),
            eraBifat ? "(era bifat și înainte de click)" : dupa.replace(/\n/g, " ").slice(0, 90));
        }
      }
    }
  }

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
    // Doar butoanele VĂZUTE acum: de când „Ziua mea" are și ea lista de
    // clienți cu «Am fost», primul buton din pagină e al ei — ascuns cât
    // timp ești pe hartă, deci fără poziție pe ecran.
    const btnVizita = page.locator('button:visible:has-text("Am fost")').first();
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
