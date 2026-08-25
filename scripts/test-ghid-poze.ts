/**
 * TESTUL GHIDULUI ÎN IMAGINI — verifică, în browser real, exact ce vede
 * omul pe /ghid și /ghid?rol=agent:
 *   1. toate cele 30 de poze există pe disc și răspund cu 200;
 *   2. fiecare poză se ÎNCARCĂ efectiv în pagină (naturalWidth > 0) —
 *      inclusiv cele lazy, derulând pagina până jos;
 *   3. fiecare pas are numărul, titlul și textul lui vizibile;
 *   4. capitolele acoperă TOȚI pașii 1..30, fără găuri și fără dubluri;
 *   5. nicio lățime de ecran (360/393/768/1440) nu produce scroll orizontal;
 *   6. varianta ?rol=agent ascunde capitolele firmei, dar ARE pozele;
 *   7. alt-texte pe toate pozele (accesibilitate) + numerotarea corectă.
 *
 * Rulare: server pe :3000, apoi
 *   npx tsx scripts/test-ghid-poze.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLAYWRIGHT_MODULE =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pwModule = (await import(PLAYWRIGHT_MODULE)) as any;
const chromium = pwModule.chromium ?? pwModule.default?.chromium;

const BAZA = process.env.BASE_URL ?? "http://localhost:3000";
let treceri = 0;
let picari = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
    console.log(`  ✅ ${nume}`);
  } else {
    picari++;
    console.log(`  ❌ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

async function main() {
  const radacina = process.cwd();
  const poze = JSON.parse(
    readFileSync(join(radacina, "src/app/ghid/poze.json"), "utf8"),
  ) as Array<{ img: string; titlu: string; text: string }>;

  console.log("\n— Fișierele de pe disc —");
  ok("poze.json are exact 30 de pași", poze.length === 30, `are ${poze.length}`);
  const peDisc = new Set(readdirSync(join(radacina, "public/ghid-poze")));
  const lipsa = poze.filter((p) => !peDisc.has(p.img)).map((p) => p.img);
  ok("toate pozele din poze.json există în public/ghid-poze", lipsa.length === 0, lipsa.join(", "));
  const orfane = [...peDisc].filter((f) => f.endsWith(".jpg") && !poze.some((p) => p.img === f));
  ok("nicio poză orfană (pe disc dar nefolosită)", orfane.length === 0, orfane.join(", "));
  ok(
    "fiecare pas are titlu și text nevide",
    poze.every((p) => p.titlu.trim().length > 3 && p.text.trim().length > 3),
  );

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });

  for (const varianta of ["/ghid", "/ghid?rol=agent"] as const) {
    console.log(`\n— ${varianta} —`);
    const ctx = await browser.newContext({ viewport: { width: 393, height: 800 } });
    const page = await ctx.newPage();
    const raspunsuriPoze = new Map<string, number>();
    page.on("response", (r) => {
      const m = r.url().match(/\/ghid-poze\/(pas\d+\.jpg)/);
      if (m) raspunsuriPoze.set(m[1], r.status());
    });
    await page.goto(BAZA + varianta, { waitUntil: "networkidle" });

    // Secțiunea există și e prima după antet
    ok("secțiunea #poze există", (await page.locator("#poze").count()) === 1);
    ok(
      "chip de navigare „📷 În imagini” prezent",
      (await page.locator('nav a[href="#poze"]').count()) === 1,
    );

    // MOBIL: capitolele închise nu-și descarcă pozele — pagina pornește
    // ușoară. Doar primul capitol (4 poze) are voie să fi cerut ceva.
    await page.waitForTimeout(600);
    ok(
      `pornire ușoară: doar pozele primului capitol se descarcă (${raspunsuriPoze.size} ≤ 4)`,
      raspunsuriPoze.size <= 4 && raspunsuriPoze.size >= 1,
      `${raspunsuriPoze.size} poze cerute`,
    );
    const capitole = await page.locator("#poze details").count();
    ok("6 capitole pliabile", capitole === 6, `sunt ${capitole}`);
    ok(
      "primul capitol e deschis din start",
      await page.locator("#poze details").first().evaluate((d: HTMLDetailsElement) => d.open),
    );
    // Bara de capitol e ușor de apăsat cu degetul (≥44px)
    const hSummary = await page
      .locator("#poze summary")
      .first()
      .evaluate((s: HTMLElement) => s.getBoundingClientRect().height);
    ok(`bara capitolului e apăsabilă cu degetul (${Math.round(hSummary)}px ≥ 44px)`, hSummary >= 44);

    // Deschidem TOATE capitolele (ca un agent curios) și derulăm până jos
    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLDetailsElement>("#poze details")
        .forEach((d) => (d.open = true));
    });
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1200);

    const stariImg = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>('#poze img')).map((i) => ({
        src: i.getAttribute("src") ?? "",
        alt: i.getAttribute("alt") ?? "",
        incarcata: i.complete && i.naturalWidth > 0,
      })),
    );
    ok("30 de poze în pagină", stariImg.length === 30, `sunt ${stariImg.length}`);
    const neincarcate = stariImg.filter((s) => !s.incarcata).map((s) => s.src);
    ok("TOATE pozele s-au încărcat efectiv (naturalWidth > 0)", neincarcate.length === 0, neincarcate.join(", "));
    const status404 = [...raspunsuriPoze.entries()].filter(([, s]) => s !== 200);
    ok(
      `serverul a răspuns 200 la toate pozele cerute (${raspunsuriPoze.size})`,
      raspunsuriPoze.size > 0 && status404.length === 0,
      status404.map(([f, s]) => `${f}:${s}`).join(", "),
    );
    ok(
      "fiecare poză are alt-text cu numărul pasului",
      stariImg.every((s, idx) => s.alt.startsWith(`Pasul ${idx + 1}:`)),
    );

    // Numerotare 1..30 vizibilă, fără găuri
    const numere = await page
      .locator("#poze figure span")
      .allInnerTexts();
    const caNumere = numere.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    ok(
      "numerele pașilor sunt exact 1..30, în ordine",
      caNumere.length === 30 && caNumere.every((n, i) => n === i + 1),
      caNumere.join(","),
    );

    // Titlurile din poze.json apar în pagină
    const textPagina = await page.locator("#poze").innerText();
    const titluriLipsa = poze.filter((p) => !textPagina.includes(p.titlu)).map((p) => p.titlu);
    ok("toate titlurile pașilor apar în pagină", titluriLipsa.length === 0, titluriLipsa.join(" | "));
    ok("cele 6 capitole apar", ["Intri prima dată", "Harta și ruta zilei", "vizita pe voce", "Comanda", "Antrenorul", "Cifrele tale"].every((c) => textPagina.includes(c)));

    // Varianta pe roluri
    const eAgent = varianta.includes("rol=agent");
    const areTraining = (await page.locator("#training").count()) > 0;
    const areFirma = (await page.locator("#firma").count()) > 0;
    if (eAgent) {
      ok("agentul NU vede trainingul administratorului", !areTraining);
      ok("agentul NU vede panoul firmei", !areFirma);
    } else {
      ok("administratorul vede trainingul", areTraining);
      ok("administratorul vede panoul firmei", areFirma);
    }

    // Fără scroll orizontal la nicio lățime
    for (const w of [360, 393, 768, 1440]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(150);
      const depaseste = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      ok(`fără scroll orizontal la ${w}px`, depaseste <= 1, `depășește cu ${depaseste}px`);
    }

    await ctx.close();
  }

  await browser.close();
  console.log(`\n${picari === 0 ? "🟢" : "🔴"} Ghidul în imagini: ${treceri} treceri, ${picari} picări\n`);
  process.exit(picari === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
