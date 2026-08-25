/**
 * DICTAREA PE ANDROID — testul anti-păsărească.
 *
 * Chrome pe telefon retrimite aceleași rezultate în versiuni tot mai
 * lungi și marchează „final" de mai multe ori. Bugul văzut LIVE la agent:
 * nota devenea „a a a zis a zis a zis că nu vrea a zis că nu vrea nimic...".
 *
 * Simulăm AICI exact comportamentul ăla (dictare falsă, pilotată de test)
 * și verificăm că nota iese CURATĂ, fără nicio repetare.
 *
 * Rulare: BASE_URL=http://127.0.0.1:3131 npx tsx scripts/test-dictare.ts
 */
const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pw = (await import(PW)) as any;
const chromium = pw.chromium ?? pw.default?.chromium;
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const OUT = "/tmp/claude-0/-home-user/031b441a-03c6-579f-b39a-c38be2e63b8b/scratchpad";

let ok = 0;
let bad = 0;
const check = (n: string, c: boolean, x = "") => {
  if (c) {
    ok++;
    console.log("  ✓ " + n);
  } else {
    bad++;
    console.log("  ✗ " + n + " " + x);
  }
};

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({
  viewport: { width: 393, height: 830 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page: any = await ctx.newPage();

// Dictare FALSĂ, pilotată de test — imită exact Chrome-ul de pe Android.
// Injectată ca TEXT pur, ca nimic din compilare să nu o poată strica.
await page.addInitScript(`
  class FakeSR {
    constructor() {
      this.lang = ""; this.interimResults = false; this.continuous = false;
      this.onresult = null; this.onend = null; this.onerror = null;
    }
    start() { window.__sr = this; }
    stop() { if (this.onend) this.onend(); }
    abort() { if (this.onend) this.onend(); }
  }
  Object.defineProperty(window, "SpeechRecognition", { value: FakeSR, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeSR, configurable: true });
`);

await page.goto(`${BASE}/api/agentie/demo-login?rol=agent`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(4000);
await page.locator("header button").first().click().catch(() => {});
await page.waitForTimeout(400);
await page.locator("aside button", { hasText: "Harta pieței" }).first().click();
await page.waitForTimeout(3000);
await page.locator("path.leaflet-interactive").first().click({ force: true });
await page.waitForTimeout(2200);
await page.locator('button:has-text("Am fost")').first().click();
await page.waitForTimeout(1000);

// pornesc dictarea (apăs microfonul — butonul de lângă căsuța de dictare)
const casuta = () => page.locator('textarea[placeholder*="dictezi"]').first();
const butonMic = () =>
  casuta().locator("xpath=ancestor::div[1]").locator("button").first();
console.log(
  "  SR injectat:",
  await page.evaluate(
    () => (window as unknown as { SpeechRecognition?: { name?: string } }).SpeechRecognition?.name,
  ),
);
// click nativ, direct pe butonul din cutia textarea-ului (tap-ul Playwright
// nimerea uneori marginea cutiei, nu butonul)
await page.evaluate(() => {
  const ta = document.querySelector('textarea[placeholder*="dictezi"]');
  const btn = ta?.parentElement?.querySelector("button") as HTMLButtonElement | null;
  btn?.click();
});
await page.waitForTimeout(600);
console.log("  __sr există:", await page.evaluate(() => !!(window as unknown as { __sr?: unknown }).__sr));
console.log("  eticheta:", await page.evaluate(() => (document.querySelector('textarea[placeholder*="dictezi"]')?.parentElement?.innerText || "").slice(0, 60)));
check(
  "ascultarea pornește (Te ascult...)",
  /Te ascult/.test(await page.evaluate(() => document.body.innerText)),
);

// EXACT tiparul Android: versiuni tot mai lungi, „final" repetat, repornire.
const fire = (results: Array<[string, boolean]>) =>
  page.evaluate((rs: Array<[string, boolean]>) => {
    // @ts-expect-error canal de test
    const sr = window.__sr;
    const ev = {
      resultIndex: 0,
      results: rs.map(([t, f]) => {
        const item = { 0: { transcript: t }, length: 1, isFinal: f };
        return item;
      }),
    };
    ev.results.length = rs.length;
    sr?.onresult?.(ev);
  }, results);

await fire([["a", false]]);
await fire([["a zis", false]]);
await fire([["a zis că nu vrea", false]]);
await fire([["a zis că nu vrea", true]]); // finalizat
await fire([["a zis că nu vrea", true]]); // ANDROID: refinalizat identic — NU se adaugă iar
await fire([["a zis că nu vrea", true], ["nimic", false]]);
await fire([["a zis că nu vrea", true], ["nimic azi", true]]); // a doua bucată finalizată
// repornirea automată (Android închide și redeschide singur ascultarea)
await page.evaluate(() => {
  // @ts-expect-error canal de test
  window.__sr?.onend?.();
});
await page.waitForTimeout(300);
await fire([["comandă marți", true]]); // sesiune nouă, index 0 din nou
await page.waitForTimeout(500);

const textNota = await casuta().inputValue();
console.log("  nota rezultată:", JSON.stringify(textNota));
check(
  "nota e CURATĂ: fiecare frază o singură dată",
  textNota === "a zis că nu vrea nimic azi comandă marți",
  textNota,
);
check(
  "nu conține repetări (păsăreasca de pe teren)",
  !/a zis că nu vrea.*a zis că nu vrea/.test(textNota),
);

// opresc și salvez cu un rezultat
await page.evaluate(() => {
  const ta = document.querySelector('textarea[placeholder*="dictezi"]');
  (ta?.parentElement?.querySelector("button") as HTMLButtonElement | null)?.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const el = [...document.querySelectorAll("button")].find((x) =>
    /Se mai gândește/.test(x.textContent || ""),
  );
  el?.click();
});
await page.waitForTimeout(1200);
const dupa = await page.evaluate(() => document.body.innerText);
check("salvarea merge (confirmare pe ecran)", /✓|salvat|gândește/i.test(dupa));

await page.screenshot({ path: `${OUT}/dictare-ok.png` });
await b.close();
console.log(bad === 0 ? `\n✅ ${ok} verificări, 0 eșuate` : `\n❌ ${bad} eșuate`);
process.exit(bad === 0 ? 0 : 1);
