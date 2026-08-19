/**
 * ANTI-ECRAN-ALB: panoul agentului nu are voie să rămână niciodată gol.
 *
 * Bugul real din teren: secțiunile de analiză se randează doar după ce
 * firma urcă fișierul de vânzări, dar meniul lăsa „Harta pieței" apăsabilă
 * fără el. Agentul apăsa harta → nicio secțiune vizibilă → ANTET + ALB.
 * Iar panoul ține minte ultima secțiune, deci rămânea alb la fiecare
 * deschidere, pe veci.
 *
 * Suita asta: agent FĂRĂ fișier de vânzări, pe telefon, apasă fiecare
 * meniu disponibil și verifică de fiecare dată că se vede conținut. Plus
 * autovindecarea: o secțiune inexistentă ținută minte cade pe „Acasă".
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 npx tsx scripts/test-ecran-alb.ts
 */
const PW_PATH =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pwMod = (await import(PW_PATH)) as any;
const chromium = pwMod.chromium ?? pwMod.default?.chromium;

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

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

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  // Telefon, ca la agenți.
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 830 },
    isMobile: true,
    hasTouch: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await ctx.newPage();

  // Agent demo = fără fișier de vânzări urcat (exact ca UVERTURA azi).
  await page.goto(`${BASE}/api/agentie/demo-login?rol=agent`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(3500);
  check("panoul agentului se deschide", page.url().includes("/a/"));

  const continutVizibil = async (): Promise<number> =>
    page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      // text vizibil, fără bara laterală/antet
      const sectiuni = Array.from(
        main.querySelectorAll("section, div[id]"),
      ).filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return sectiuni.reduce(
        (n, el) => n + ((el as HTMLElement).innerText || "").trim().length,
        0,
      );
    });

  console.log("══ Fiecare meniu apăsabil arată conținut (fără fișier de vânzări) ══");
  const meniuri = ["Acasă", "Harta pieței", "Prospecți", "Tot pe o pagină"];
  for (const eticheta of meniuri) {
    // deschide meniul mobil
    await page
      .locator("header button")
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    const buton = page.locator("aside button", { hasText: eticheta }).first();
    const exista = (await buton.count()) > 0;
    if (!exista) {
      check(`meniul ${eticheta} exista`, false);
      continue;
    }
    const dezactivat = await buton.evaluate(
      (el: HTMLElement) => getComputedStyle(el).pointerEvents === "none",
    );
    if (dezactivat) {
      console.log(`  · ${eticheta} e dezactivat fara date - sar`);
      continue;
    }
    await buton.click();
    await page.waitForTimeout(eticheta === "Harta pieței" ? 3500 : 1500);
    const n = await continutVizibil();
    check(`${eticheta} NU lasa ecranul alb`, n > 60, `doar ${n} caractere vizibile`);
  }

  console.log("══ Autovindecare: secțiune ținută minte care nu există ══");
  await page.evaluate(() =>
    localStorage.setItem("bcagent:view", "sectiune-care-nu-exista"),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const dupaReload = await continutVizibil();
  check("panoul se vindecă singur (nu rămâne alb)", dupaReload > 60, `${dupaReload} caractere`);
  const memorieCurata = await page.evaluate(() =>
    localStorage.getItem("bcagent:view"),
  );
  check(
    "memoria stricată e ștearsă (nu se repetă la următoarea intrare)",
    memorieCurata === null || memorieCurata === "acasa",
    String(memorieCurata),
  );

  console.log("══ Memoria pe Harta nu mai produce ecran alb la redeschidere ══");
  await page.evaluate(() => localStorage.setItem("bcagent:view", "harta"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const cuHarta = await continutVizibil();
  check("deschidere directă pe Hartă arată conținut", cuHarta > 60, `${cuHarta} caractere`);

  await browser.close();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
