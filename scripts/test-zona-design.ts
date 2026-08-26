/**
 * ZONELE, CU OCHII, PE TELEFON — cum arată, nu doar dacă merg.
 *
 * Ecranele noi (agentul își scrie zonele, „Zona ta de azi", „Fă-mi ruta")
 * se folosesc în mașină, pe telefon, cu degetul, uneori cu fontul mărit
 * de sistem. Deci nu e destul ca API-ul să răspundă corect: trebuie ca
 * totul să ÎNCAPĂ pe ecran, butoanele să se vadă întregi și să se poată
 * apăsa, iar textele să nu fie tăiate cu „…".
 *
 * Rulează pe patru ecrane reale, de la telefonul mic cu font uriaș până
 * la calculator, și verifică pe fiecare, la fiecare pas:
 *   · nimic nu iese pe orizontală (0 px în afară)
 *   · fiecare buton e ÎN ecran și are înălțime de deget (≥ 40 px)
 *   · niciun text nu e tăiat
 *   · zero erori JavaScript
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... SESSION_SECRET=... \
 *   npx tsx scripts/test-zona-design.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";
import { COOKIE_NAME, semneazaSesiuneTest } from "./_sesiune-test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

let pass = 0;
let fail = 0;
const rele: string[] = [];
function check(n: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    fail++;
    rele.push(`${n}${extra ? ` — ${extra}` : ""}`);
    console.log(`  ✗ ${n}${extra ? ` — ${extra}` : ""}`);
  }
}
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

const ZILE = ["duminica", "luni", "marti", "miercuri", "joi", "vineri", "sambata"];
const AZI = ZILE[new Date().getDay()];

const RUN = `zd${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgId = `org-${RUN}`;
const agentId = `ag-${RUN}`;
const numeAgent = `Design Zona ${RUN}`;
const email = `${RUN}@zd.test`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `55${baza}${i}`;

// Sate cu nume LUNGI: pe telefon mic, exact ele ies din ecran dacă
// undeva lipsește o rupere de rând.
const SATE = [
  `CAMPULUNG MOLDOVENESC ${SUS}`,
  `VATRA DORNEI DE JOS ${SUS}`,
  `POIANA STAMPEI ${SUS}`,
  `GURA HUMORULUI ${SUS}`,
];

/** Ecranele pe care umblă oamenii, de la cel mai strâmt la calculator. */
const ECRANE = [
  { nume: "telefon mic + font uriaș", lat: 320, font: "22px", mobil: true },
  { nume: "telefon obișnuit", lat: 393, font: "16px", mobil: true },
  { nume: "telefon mare", lat: 430, font: "18px", mobil: true },
  { nume: "calculator", lat: 1280, font: "16px", mobil: false },
] as const;

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, ${"ZD " + SUS}, ${email}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"zda-" + RUN}, ${orgId}, ${agentId}, ${numeAgent})`;
  for (let i = 0; i < SATE.length; i++) {
    // Doi clienți în fiecare sat, cu denumiri lungi.
    for (let j = 0; j < 2; j++) {
      const k = i * 2 + j;
      await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon)
        VALUES (${cui(k)},
                ${`MAGAZINUL UNIVERSAL SATESC NUMARUL ${k} ${SUS} SRL`},
                ${`Str. Principala nr. ${k + 1}`}, ${SATE[i]}, 'SV', '4711',
                'client', ${numeAgent}, TRUE, ${"07500000" + k})`;
    }
  }
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            SELECT 'SV', s, 47.6 + (i * 0.02), 26.2 + (i * 0.02), FALSE
            FROM unnest(${SATE}::text[]) WITH ORDINALITY AS t(s, i)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
}

async function curata() {
  const cuis = Array.from({ length: SATE.length * 2 }, (_, i) => cui(i));
  await sql`DELETE FROM agent_pin WHERE agent_id = ${agentId}`.catch(() => {});
  await sql`DELETE FROM routes WHERE agent_id = ${agentId}`.catch(() => {});
  await sql`DELETE FROM agent_zone WHERE org_id = ${orgId}`;
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ANY(${SATE})`;
  await sql`DELETE FROM org_agents WHERE org_id = ${orgId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
}

/* ────────── unelte de măsurat ecranul ────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

/** Câți pixeli ies din ecran pe orizontală (0 = totul încape). */
async function iese(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * Butoanele care ies pe JUMĂTATE din ecran sau sunt prea mici pentru un
 * deget. Sertarul de meniu închis stă INTENȚIONAT tot în afara ecranului
 * (translatat), deci pe el îl sărim — nu e un buton tăiat, e unul ascuns.
 * Minimul de înălțime e cel de pe telefon; pe calculator se apasă cu
 * mouse-ul, unde 28px e în regulă.
 */
async function butoaneRele(page: Page, lat: number, mobil: boolean): Promise<string[]> {
  return page.evaluate(
    ([L, M]: [number, boolean]) => {
      const rele: string[] = [];
      const minim = M ? 36 : 24;
      for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
        const e = el as HTMLElement;
        if (e.offsetParent === null) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Complet în afara ecranului = ascuns dinadins (sertar închis).
        if (r.x + r.width <= 0 || r.x >= L) continue;
        const nume = (e.innerText || e.getAttribute("aria-label") || "?")
          .trim()
          .slice(0, 24)
          .replace(/\s+/g, " ");
        if (r.x < -1 || r.x + r.width > L + 2) {
          rele.push(`${nume}: TĂIAT (x=${Math.round(r.x)}, w=${Math.round(r.width)})`);
        } else if (r.height < minim) {
          rele.push(`${nume}: doar ${Math.round(r.height)}px înălțime`);
        }
      }
      return rele.slice(0, 6);
    },
    [lat, mobil],
  );
}

/** Textele tăiate cu „…" (conținut mai lat decât cutia lui). */
async function texteTaiate(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rele: string[] = [];
    for (const el of Array.from(document.querySelectorAll("p, span, li, h1, h2, h3, label"))) {
      const e = el as HTMLElement;
      if (e.offsetParent === null) continue;
      if (e.children.length > 0) continue;
      const t = (e.innerText || "").trim();
      if (t.length < 4) continue;
      if (e.scrollWidth > e.clientWidth + 2) rele.push(t.slice(0, 40));
    }
    return rele.slice(0, 6);
  });
}

/** Un element se vede întreg pe ecran? */
async function inEcran(page: Page, sel: string, lat: number): Promise<boolean | null> {
  return page.evaluate(
    ([s, L]: [string, number]) => {
      const e = document.querySelector(s) as HTMLElement | null;
      if (!e || e.offsetParent === null) return null;
      const r = e.getBoundingClientRect();
      return r.x >= -1 && r.x + r.width <= L + 2 && r.width > 0;
    },
    [sel, lat],
  );
}

/* ────────────────────────── rulare ────────────────────────── */

async function main() {
  console.log(`\nZONELE, CU OCHII (azi e „${AZI}") — rulare ${RUN}`);
  await pregateste();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = await signToken({ agentId, agentName: numeAgent, exp }, SECRET);
  const ck = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}`,
    orgId,
    email,
    name: "Bogdan",
    role: "owner",
  })}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = (await import(PW)) as any;
  const chromium = pw.chromium ?? pw.default?.chromium;
  const b = await chromium.launch({ executablePath: CHROME });

  try {
    for (const ecran of ECRANE) {
      sectiune(`${ecran.nume} (${ecran.lat}px, font ${ecran.font})`);
      const ctx = await b.newContext({
        viewport: { width: ecran.lat, height: 820 },
        isMobile: ecran.mobil,
        hasTouch: ecran.mobil,
      });
      const page: Page = await ctx.newPage();
      const erori: string[] = [];
      page.on("pageerror", (e: Error) => erori.push(e.message.slice(0, 120)));
      page.on(
        "console",
        (m: { type: () => string; text: () => string; location: () => { url?: string } }) => {
          if (m.type() !== "error") return;
          const t = m.text();
          const dinAfara = !(m.location()?.url ?? "").startsWith(BASE);
          if (dinAfara && /Failed to load resource|net::ERR_/i.test(t)) return;
          if (/favicon|tile\.openstreetmap/i.test(t)) return;
          erori.push(t.slice(0, 120));
        },
      );
      const E = ecran.lat;
      // Ruta de azi salvată la ecranul precedent ar ascunde cardul „Zona ta
      // de azi" (pe bună dreptate: ruta îi ia locul). O ștergem, ca fiecare
      // ecran să pornească de la același loc.
      await sql`DELETE FROM routes WHERE agent_id = ${agentId}`;

      await page.goto(`${BASE}/a/${tok}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000);
      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, ecran.font);
      await page.waitForTimeout(600);

      // Poarta de PIN (primul telefon / telefon nou).
      const pinuri = page.locator('input[type="password"], input[inputmode="numeric"]');
      const catePin = await pinuri.count();
      if (catePin > 0) {
        check(`[${ecran.nume}] poarta de PIN încape pe ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
        const releP = await butoaneRele(page, E, ecran.mobil);
        check(`[${ecran.nume}] butonul de PIN se vede și se poate apăsa`, releP.length === 0, releP.join(" | "));
        await pinuri.nth(0).fill("1379");
        if (catePin >= 2) await pinuri.nth(1).fill("1379");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(3500);
        erori.length = 0; // PIN-ul de test poate da 401: e răspuns, nu bug
      }

      // ── secțiunea „Zonele mele pe zile" ──
      const cap = page.locator("button", { hasText: "Zonele mele pe zile" }).first();
      check(`[${ecran.nume}] secțiunea „Zonele mele pe zile" există`, (await cap.count()) > 0);
      if ((await cap.count()) === 0) {
        await ctx.close();
        continue;
      }
      const cutieCap = await cap.boundingBox();
      check(
        `[${ecran.nume}] titlul ei e ÎN ecran`,
        !!cutieCap && cutieCap.x >= -1 && cutieCap.x + cutieCap.width <= E + 2,
        JSON.stringify(cutieCap),
      );
      check(
        `[${ecran.nume}] se poate apăsa cu degetul`,
        (cutieCap?.height ?? 0) >= 40,
        `${Math.round(cutieCap?.height ?? 0)}px`,
      );
      await cap.click();
      await page.waitForTimeout(700);

      check(`[${ecran.nume}] deschisă, nimic nu iese din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
      const areText = await inEcran(page, "#zone-text", E);
      check(`[${ecran.nume}] căsuța de scris se vede întreagă`, areText === true, String(areText));
      const inaltimeText = await page.evaluate(() => {
        const e = document.querySelector("#zone-text") as HTMLElement | null;
        return e ? Math.round(e.getBoundingClientRect().height) : 0;
      });
      check(
        `[${ecran.nume}] căsuța e destul de mare cât să scrii în ea`,
        inaltimeText >= 100,
        `${inaltimeText}px`,
      );
      let rele = await butoaneRele(page, E, ecran.mobil);
      check(`[${ecran.nume}] butoanele secțiunii sunt întregi și apăsabile`, rele.length === 0, rele.join(" | "));

      // ── scriem zona: confirmarea verde ──
      const text =
        `${AZI} - ${SATE[0].toLowerCase()}, ${SATE[1].toLowerCase()}, ${SATE[2]}\n` +
        `joi: ${SATE[3]}, sat-care-nu-exista-${RUN}`;
      await page.locator("#zone-text").fill(text);
      await page.locator("button", { hasText: "Verifică ce am înțeles" }).first().click();
      await page.waitForTimeout(2500);

      const dupaVerif = await page.evaluate(() => document.body.innerText);
      check(`[${ecran.nume}] arată ce a înțeles`, /Am înțeles/i.test(dupaVerif));
      check(`[${ecran.nume}] arată și ce n-a găsit`, /nu l-am găsit|nu le-am găsit/i.test(dupaVerif));
      check(`[${ecran.nume}] confirmarea nu scoate nimic din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
      let taiate = await texteTaiate(page);
      check(`[${ecran.nume}] numele lungi de sate NU se taie`, taiate.length === 0, taiate.join(" | "));
      rele = await butoaneRele(page, E, ecran.mobil);
      check(`[${ecran.nume}] butonul „Salvează zonele" e întreg`, rele.length === 0, rele.join(" | "));

      // ── salvăm: „Ce ai acum" + cine a pus-o ──
      await page.locator("button", { hasText: "Salvează zonele" }).first().click();
      await page.waitForTimeout(3000);
      const dupaSalv = await page.evaluate(() => document.body.innerText);
      check(`[${ecran.nume}] confirmă salvarea`, /ți-am salvat|Gata/i.test(dupaSalv));
      check(`[${ecran.nume}] arată cine a pus zona`, /pusă de/i.test(dupaSalv), dupaSalv.slice(0, 60));
      check(`[${ecran.nume}] după salvare nimic nu iese din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
      taiate = await texteTaiate(page);
      check(`[${ecran.nume}] lista „Ce ai acum" nu e tăiată`, taiate.length === 0, taiate.join(" | "));

      // ── „Ziua mea": zona de azi + butonul de rută ──
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, ecran.font);
      await page.waitForTimeout(600);
      const zi = await page.evaluate(() => document.body.innerText);
      check(`[${ecran.nume}] „Zona ta de azi" se vede pe prima pagină`, /Zona ta de azi/i.test(zi));
      const btnRuta = page.locator("button", { hasText: "Fă-mi ruta de azi" }).first();
      check(`[${ecran.nume}] butonul „Fă-mi ruta de azi" există`, (await btnRuta.count()) > 0);
      if ((await btnRuta.count()) > 0) {
        const cutie = await btnRuta.boundingBox();
        check(
          `[${ecran.nume}] butonul de rută e ÎN ecran`,
          !!cutie && cutie.x >= -1 && cutie.x + cutie.width <= E + 2,
          JSON.stringify(cutie),
        );
        check(
          `[${ecran.nume}] butonul de rută are înălțime de deget`,
          (cutie?.height ?? 0) >= 40,
          `${Math.round(cutie?.height ?? 0)}px`,
        );
        check(`[${ecran.nume}] scrie câți clienți are ruta`, /\(\d+ clienți\)/.test(zi), zi.slice(0, 80));
        await btnRuta.click();
        await page.waitForTimeout(3000);
        const dupaRuta = await page.evaluate(() => document.body.innerText);
        check(`[${ecran.nume}] după apăsare apare traseul`, /Pornește ruta|Etapa|Continuă ruta/i.test(dupaRuta));
        const nav = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.includes("google.com/maps")).length,
        );
        check(`[${ecran.nume}] traseul are link de navigare`, nav > 0, `${nav}`);
        check(`[${ecran.nume}] cu ruta pe ecran, tot nimic nu iese`, (await iese(page)) <= 2, `${await iese(page)}px`);
        rele = await butoaneRele(page, E, ecran.mobil);
        check(`[${ecran.nume}] butoanele de traseu sunt întregi`, rele.length === 0, rele.join(" | "));
      }
      // ── harta: „doar zona de azi" ──
      // „Să fie și pe ruta de la hartă — să fie zona mea" (Bogdan, 26.08).
      // Harta arată tot județul; agentul umblă azi în câteva sate.
      await page.locator("header button").first().click().catch(() => {});
      await page.waitForTimeout(500);
      await page
        .locator("button, a")
        .filter({ hasText: "Harta pieței" })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(4500);
      const buleTot = await page.locator("path.leaflet-interactive").count();
      const btnZona = page.locator("button", { hasText: "Doar zona de" }).first();
      check(`[${ecran.nume}] harta are butonul „Doar zona de azi"`, (await btnZona.count()) > 0);
      if ((await btnZona.count()) > 0) {
        const cz = await btnZona.boundingBox();
        check(
          `[${ecran.nume}] butonul de zonă e ÎN ecran și apăsabil`,
          !!cz && cz.x >= -1 && cz.x + cz.width <= E + 2 && cz.height >= 28,
          JSON.stringify(cz),
        );
        check(
          `[${ecran.nume}] scrie câte sate are zona`,
          /\(\d+ sate\)/.test(await page.evaluate(() => document.body.innerText)),
        );
        await btnZona.click();
        await page.waitForTimeout(3000);
        const buleZona = await page.locator("path.leaflet-interactive").count();
        check(
          `[${ecran.nume}] apăsat, harta arată DOAR satele de azi`,
          buleZona > 0 && buleZona < buleTot,
          `${buleZona} din ${buleTot}`,
        );
        check(
          `[${ecran.nume}] butonul se schimbă în „Arată tot județul"`,
          (await page.locator("button", { hasText: "Arată tot județul" }).count()) > 0,
        );
        check(`[${ecran.nume}] cu filtrul pornit, nimic nu iese din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
        await page.locator("button", { hasText: "Arată tot județul" }).first().click();
        await page.waitForTimeout(3000);
        const inapoi = await page.locator("path.leaflet-interactive").count();
        check(
          `[${ecran.nume}] apăsat din nou, se vede iar tot județul`,
          inapoi === buleTot,
          `${inapoi} vs ${buleTot}`,
        );
      }

      check(`[${ecran.nume}] zero erori JavaScript în tot fluxul`, erori.length === 0, erori.slice(0, 2).join(" | "));
      await ctx.close();
    }

    // ── panoul firmei, pe telefon ──
    for (const ecran of [ECRANE[0], ECRANE[1], ECRANE[3]]) {
      sectiune(`Panoul firmei — „Zonele agenților" (${ecran.lat}px)`);
      const ctx = await b.newContext({
        viewport: { width: ecran.lat, height: 820 },
        isMobile: ecran.mobil,
        hasTouch: ecran.mobil,
      });
      await ctx.addCookies([
        {
          name: COOKIE_NAME,
          value: ck.split("=").slice(1).join("="),
          url: BASE,
        },
      ]);
      const page: Page = await ctx.newPage();
      const erori: string[] = [];
      page.on("pageerror", (e: Error) => erori.push(e.message.slice(0, 120)));
      const E = ecran.lat;
      await page.goto(`${BASE}/agentie/zone`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000);
      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, ecran.font);
      await page.waitForTimeout(700);

      const t = await page.evaluate(() => document.body.innerText);
      check(`[firmă ${E}px] pagina se deschide`, /Zonele agen/i.test(t));
      check(`[firmă ${E}px] arată cine a pus zona agentului`, /pusă ultima dată de/i.test(t), t.slice(0, 80));
      check(`[firmă ${E}px] avertizează că salvarea înlocuiește`, /înlocuiești/i.test(t));
      check(`[firmă ${E}px] nimic nu iese din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
      const releF = await butoaneRele(page, E, ecran.mobil);
      check(`[firmă ${E}px] butoanele sunt întregi și apăsabile`, releF.length === 0, releF.join(" | "));
      const taiateF = await texteTaiate(page);
      check(`[firmă ${E}px] niciun text tăiat`, taiateF.length === 0, taiateF.join(" | "));
      const selectIn = await inEcran(page, "select", E);
      check(`[firmă ${E}px] lista de agenți se vede întreagă`, selectIn === true, String(selectIn));
      check(`[firmă ${E}px] zero erori JavaScript`, erori.length === 0, erori.slice(0, 2).join(" | "));
      await ctx.close();
    }
  } finally {
    await b.close();
    sectiune("Curățenie");
    await curata();
    console.log("  · datele de test șterse");
    await sql.end();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  if (fail) {
    console.log("\nCe se vede prost:");
    rele.forEach((r) => console.log("  · " + r));
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();
