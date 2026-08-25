/** GENERATORUL pozelor din ghid: rulează serverul local cu date demo,
 * parcurge panoul agentului ca un om și scrie public/ghid-poze/pasNN.jpg
 * + src/app/ghid/poze.json. Se re-rulează după orice schimbare de UI:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/genereaza-ghid-poze.ts */
import { signToken } from "../src/lib/signed-token";
import { writeFileSync } from "fs";
const PW = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pw = (await import(PW)) as any;
const chromium = pw.chromium ?? pw.default?.chromium;
const OUT = "public/ghid-poze";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 393, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.2 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page: any = await ctx.newPage();

let nr = 0;
const legende: Array<{ img: string; titlu: string; text: string }> = [];
async function cadru(titlu: string, text: string) {
  nr++;
  const img = `pas${String(nr).padStart(2, "0")}.jpg`;
  legende.push({ img, titlu, text });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${img}`, type: "jpeg", quality: 78 });
  console.log(`pas ${nr}: ${titlu}`);
}
async function marcheaza(text: string) {
  await page.evaluate((t: string) => {
    const el = [...document.querySelectorAll("button, a")].find((x) => (x.textContent || "").includes(t) || (x.getAttribute("title") || "").includes(t));
    if (el) { (el as HTMLElement).style.outline = "4px solid #e11d48"; (el as HTMLElement).style.outlineOffset = "2px"; el.scrollIntoView({ block: "center" }); }
  }, text);
  await page.waitForTimeout(250);
}
async function curata() { await page.evaluate(() => document.querySelectorAll("*").forEach((e) => ((e as HTMLElement).style.outline = ""))); }
async function sectiune(et: string, id: string) {
  await page.locator("header button").first().click().catch(() => {});
  await page.waitForTimeout(450);
  const btn = page.locator("aside button", { hasText: et }).first();
  if ((await btn.count()) === 0) return false;
  await btn.click();
  await page.waitForTimeout(1600);
  await page.evaluate((sid: string) => {
    const el = document.getElementById(sid);
    if (el) { const y = el.getBoundingClientRect().top + window.scrollY - 130; window.scrollTo(0, Math.max(0, y)); }
  }, id);
  await page.waitForTimeout(400);
  return true;
}
const scrollLa = async (text: string) => { await page.evaluate((t: string) => { const el = [...document.querySelectorAll("h2,h3,div,p")].find((x) => new RegExp(t, "i").test(x.textContent || "")); if (el) { const y = el.getBoundingClientRect().top + window.scrollY - 130; window.scrollTo(0, Math.max(0, y)); } }, text); await page.waitForTimeout(350); };

// A. INTRAREA
const tok = await signToken({ agentId: "ag-poze-1", agentName: "Ion Agentul", exp: Math.floor(Date.now() / 1000) + 3600 }, "test-secret-0123456789");
await page.goto(`http://127.0.0.1:3131/a/${tok}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await cadru("Deschizi linkul tău din WhatsApp", "Apeși pe linkul primit — e doar al tău, nu-l dai nimănui.");
const pin1 = page.locator("input").first();
if (await pin1.count()) { await pin1.fill("1234"); const p2 = page.locator("input").nth(1); if (await p2.count()) await p2.fill("1234"); }
await cadru("Îți pui un PIN de 4-6 cifre", "Ca la card. Doar prima dată ți-l cere — cu el intri de acum.");

await page.goto("http://127.0.0.1:3131/api/agentie/demo-login?rol=agent", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await cadru("Acasă — ziua ta", "Ruta de azi, clienții de vizitat, vizitele și comenzile de azi. Totul dintr-o privire.");
await page.locator("header button").first().click().catch(() => {});
await page.waitForTimeout(450);
await cadru("Meniul — cele 3 liniuțe", "De aici alegi orice. Cel mai des: Harta pieței.");

// B. RUTA
await page.locator("aside button", { hasText: "Harta pieței" }).first().click();
await page.waitForTimeout(2500);
await page.evaluate(() => { document.querySelector(".leaflet-container")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -120); });
await page.waitForTimeout(350);
await cadru("Harta pieței", "VERDE = ai clienți acolo. PORTOCALIU = zone de cucerit. Apeși pe o bulă.");
await page.locator("path.leaflet-interactive").first().click({ force: true });
await page.waitForTimeout(2000);
await marcheaza("Adaugă în rută");
await cadru("Apeși pe bulă → firmele tale", "Sub hartă apar firmele din localitate. Plusul (+) le pune în ruta ta.");
await curata();
await page.evaluate(() => { const els = [...document.querySelectorAll("button")].filter((x) => (x.getAttribute("title") || "") === "Adaugă în rută"); els[0]?.click(); });
await page.waitForTimeout(600);
await page.evaluate(() => { const els = [...document.querySelectorAll("button")].filter((x) => (x.getAttribute("title") || "") === "Adaugă în rută"); els[0]?.click(); });
await page.waitForTimeout(700);
await marcheaza("Ruta mea");
await cadru("Aduni clienții zilei cu PLUSUL", "Jos se strâng în RUTA MEA — vezi câte opriri ai.");
await curata();
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Ruta mea/.test(x.textContent || "")); el?.click(); });
await page.waitForTimeout(1200);
await marcheaza("Pornește ruta");
await cadru("PORNEȘTE RUTA", "Ordinea cea mai scurtă + navigația Google Maps. SALVEAZĂ o păstrează pe mâine.");
await curata();
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Pornește ruta/.test(x.textContent || "")); el?.click(); });
await page.waitForTimeout(2000);
await page.evaluate(() => { document.querySelector(".leaflet-container")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -120); });
await page.waitForTimeout(500);
await cadru("Opririle, numerotate pe hartă", "Mergi la 1, apoi 2, apoi 3. Navigația te duce de la unul la altul.");
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Fă-mi ruta din ei/.test(x.textContent || "")); el?.scrollIntoView({ block: "center" }); });
await marcheaza("Fă-mi ruta din ei");
await cadru("Ruta din restanțe, cu UN click", "Clienții nevizitați de 7 zile stau la De vizitat. FĂ-MI RUTA DIN EI și ziua e gata plănuită.");
await curata();
// pinii clientilor
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Arată clienții pe hartă/.test(x.textContent || "")); el?.click(); });
await page.waitForTimeout(3500);
await page.evaluate(() => { document.querySelector(".leaflet-container")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -120); });
await page.waitForTimeout(400);
await cadru("Clienții tăi, puncte pe hartă", "Apeși ARATĂ CLIENȚII PE HARTĂ: vezi cine e vecin cu cine. Apeși pe punct → numele + Sună / Navighează / în rută.");

// C. VIZITA
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(250);
if ((await page.locator('button:has-text("Am fost — spune ce a zis")').count()) === 0) {
  await page.locator("path.leaflet-interactive").first().click({ force: true });
  await page.waitForTimeout(1800);
}
await marcheaza("Am fost — spune ce a zis");
await cadru("La client: butonul mare albastru", "Ai vorbit cu clientul? Apeși AM FOST — SPUNE CE A ZIS.");
await curata();
await page.locator('button:has-text("Am fost — spune ce a zis")').first().click();
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const ta = document.querySelector('textarea[placeholder*="dictezi"]');
  const btn = ta?.parentElement?.querySelector("button") as HTMLElement | null;
  if (btn) { btn.style.outline = "4px solid #e11d48"; btn.scrollIntoView({ block: "center" }); }
});
await page.waitForTimeout(250);
await cadru("Apeși MICROFONUL și vorbești", "Vorbești normal, ca la telefon. Nu scrii nimic.");
await curata();
await page.evaluate(() => {
  const ta = [...document.querySelectorAll("textarea")].find((t) => (t.getAttribute("placeholder") || "").includes("dictezi"));
  if (ta) {
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(ta, "vrea Kent lung două baxuri, se plânge că Marlboro e scump, comandă marți");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.scrollIntoView({ block: "center" });
  }
});
await page.waitForTimeout(350);
await cadru("Textul se scrie singur", "Cuvânt cu cuvânt. Corectezi cu mâna dacă vrei. Nota o vede și șeful.");
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Se mai gândește/.test(x.textContent || "")); el?.scrollIntoView({ block: "center" }); });
await page.waitForTimeout(250);
await cadru("Alegi ce s-a întâmplat — GATA", "A cumpărat / Se mai gândește / Ne sună / Nu vrea / Închis. Nota se salvează odată cu alegerea.");

// D. COMANDA
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Comandă/.test(x.textContent || "")); el?.click(); });
await page.waitForTimeout(1300);
await cadru("Clientul comandă? Apeși COMANDĂ", "Se deschide formularul comenzii.");
await page.locator('input[placeholder*="rodus" i], input[placeholder*="Kent" i]').first().fill("Kent Core Blue").catch(() => {});
await page.locator('input[placeholder*="ant" i]').first().fill("5").catch(() => {});
await page.waitForTimeout(300);
await cadru("Scrii produsele...", "Produs, cantitate, bax/cartuș/bucată. Rânduri noi cu + MAI ADAUGĂ.");
await page.evaluate(() => { const el = [...document.querySelectorAll("button,label")].find((x) => /poz|factur/i.test(x.textContent || "")); if (el) { (el as HTMLElement).style.outline = "4px solid #e11d48"; el.scrollIntoView({ block: "center" }); } });
await page.waitForTimeout(250);
await cadru("...SAU faci POZĂ LA FACTURĂ", "Se completează singură — produse, cantități, prețuri. Tu doar VERIFICI cifrele.");
await curata();
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /van|mașin|numerar|depozit/i.test(x.textContent || "")); el?.scrollIntoView({ block: "center" }); });
await page.waitForTimeout(250);
await cadru("Din dubă sau de la depozit", "VÂNZARE DIN MAȘINĂ = dai marfa pe loc, stocul scade singur. COMANDĂ LA DEPOZIT = o pregătesc ei. Apoi TRIMITE.");
await page.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /Renunț|Închide/.test((x.textContent || "").trim())); el?.click(); });
await page.waitForTimeout(600);

// E. RESTUL
await scrollLa("Marfa din mașină");
await cadru("Marfa din mașină (van)", "Dimineața încarci duba. Fiecare vânzare pe loc scade stocul. Seara vezi banii și marfa de predat.");
await scrollLa("zone neacoperite");
await cadru("Petele albe", "Localități fără niciun client — de aici crești. Apeși pe una și îți faci ruta de cucerire.");
if (await sectiune("Antrenorul", "antrenor")) await cadru("Antrenorul AI", "Îi scrii sau îi VORBEȘTI: mi-a zis că e scump, ce fac? Îți dă replica exactă. Merge și cu poză de la raft.");
if (await sectiune("Target", "obiective")) await cadru("Target și decont", "Cât ai făcut din target + clasamentul echipei. Cheltuielile cu poză la bon.");
if (await sectiune("Prospecți", "prospecti")) await cadru("Firme noi de cucerit", "Toate firmele din zonă care NU-s clienții noștri, cu telefon și adresă.");
if (await sectiune("AI Insights", "ai")) await cadru("Analiza AI a cifrelor tale", "Apeși Generează: unde crești, unde pierzi, pe cine suni azi.");
if (await sectiune("Analiză Smart", "smart")) await cadru("Analiza Smart", "Scorul tău, brandurile slabe, clienții adormiți, ce să vinzi în plus.");
if (await sectiune("Evoluție", "evolutie")) await cadru("Evoluția", "Graficul vânzărilor tale — urci sau cobori, dintr-o privire.");
if (await sectiune("Matrice", "matrice")) await cadru("Matricea brand × client", "Căsuțele GOALE = acolo vinzi în plus.");
if (await sectiune("Comisioane", "comisioane")) await cadru("Comisioanele tale", "Procentul tău + cât ai câștigat, pe total și pe brand.");
if (await sectiune("Top clienți", "clienti")) await cadru("Top clienții tăi", "Cine îți aduce banii — pe ăștia nu-i lași să răcească.");

writeFileSync("src/app/ghid/poze.json", JSON.stringify(legende, null, 1));
await b.close();
console.log("TOTAL poze:", nr);
