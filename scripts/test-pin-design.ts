/**
 * PINUL, CU OCHII ȘI CU DEGETUL — cum îl folosește agentul pe telefon.
 *
 * Nu e destul ca API-ul să salveze corect: fereastra de „pune locul" se
 * deschide în mașină, pe un ecran mic, cu degetul gros și cu harta care
 * trebuie trasă. Suita umblă prin ea exact ca un om:
 *
 *   deschide satul → apasă „Pune locul" → harta se desenează → trage
 *   pinul → salvează → rândul scrie „Loc pus" → redeschide și vede
 *   harta pornind FIX pe magazin, nu în centrul satului.
 *
 * Pe fiecare ecran verifică și ce ține de mână: nimic nu iese din ecran,
 * butoanele sunt întregi și de mărimea unui deget, harta chiar are
 * dimensiune (nu 0 pixeli), zero erori JavaScript.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-pin-design.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";

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

const RUN = `pd${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgId = `org-${RUN}`;
const agentId = `ag-${RUN}`;
const numeAgent = `Pin Design ${RUN}`;
const SAT = `PDSAT ${SUS}`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `33${baza}${i}`;
const CENTRU: [number, number] = [47.7405, 26.6612];

const ECRANE = [
  { nume: "telefon mic + font mare", lat: 320, font: "22px", mobil: true },
  { nume: "telefon obișnuit", lat: 393, font: "16px", mobil: true },
  { nume: "calculator", lat: 1280, font: "16px", mobil: false },
] as const;

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, ${"PD " + SUS}, ${RUN + "@pd.test"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"pda-" + RUN}, ${orgId}, ${agentId}, ${numeAgent})`;
  for (let i = 0; i < 3; i++) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon)
      VALUES (${cui(i)},
              ${`MAGAZINUL MIXT DIN CAPUL SATULUI ${i} ${SUS} SRL`},
              ${`Str. Principala nr. ${i + 1}`}, ${SAT}, 'IS', '4711',
              'client', ${numeAgent}, TRUE, ${"07300000" + i})`;
  }
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('IS', ${SAT}, ${CENTRU[0]}, ${CENTRU[1]}, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
}

async function curata() {
  const cuis = [0, 1, 2].map(cui);
  await sql`DELETE FROM agent_pin WHERE agent_id = ${agentId}`.catch(() => {});
  await sql`DELETE FROM visits WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id = ${orgId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

async function iese(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
/**
 * Butoanele dintr-o zonă anume (implicit toată pagina). Când e deschisă o
 * fereastră, măsurăm DOAR în ea: butoanele paginii de dedesubt sunt
 * acoperite, nu le apasă nimeni, și n-au ce căuta în verdict.
 */
async function butoaneRele(
  page: Page,
  L: number,
  mobil: boolean,
  radacina = "body",
): Promise<string[]> {
  return page.evaluate(
    ([lat, m, sel]: [number, boolean, string]) => {
      const rele: string[] = [];
      const minim = m ? 36 : 24;
      const zona = document.querySelector(sel) ?? document.body;
      for (const el of Array.from(zona.querySelectorAll("button, a[href]"))) {
        const e = el as HTMLElement;
        if (e.offsetParent === null) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.x + r.width <= 0 || r.x >= lat) continue;
        const nume = (e.innerText || e.getAttribute("aria-label") || "?")
          .trim()
          .slice(0, 22)
          .replace(/\s+/g, " ");
        // Butoanele de zoom ale hărții (+ / −) sunt mici prin natura lor
        // și le pune Leaflet, nu noi.
        if (/^[+−-]$/.test(nume)) continue;
        if (/^(Leaflet|OpenStreetMap|©)/i.test(nume)) continue;
        if (r.x < -1 || r.x + r.width > lat + 2) {
          rele.push(`${nume}: TĂIAT (x=${Math.round(r.x)}, w=${Math.round(r.width)})`);
        } else if (r.height < minim) {
          rele.push(`${nume}: doar ${Math.round(r.height)}px`);
        }
      }
      return rele.slice(0, 6);
    },
    [L, mobil, radacina],
  );
}

async function main() {
  console.log(`\nPINUL, CU OCHII — rulare ${RUN}`);
  await pregateste();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = await signToken({ agentId, agentName: numeAgent, exp }, SECRET);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = (await import(PW)) as any;
  const chromium = pw.chromium ?? pw.default?.chromium;
  const b = await chromium.launch({ executablePath: CHROME });

  try {
    for (const ecran of ECRANE) {
      sectiune(`${ecran.nume} (${ecran.lat}px)`);
      // Fiecare ecran pornește de la zero: fără loc pus dinainte.
      await sql`DELETE FROM geo_firme WHERE cui = ANY(${[0, 1, 2].map(cui)})`;

      const ctx = await b.newContext({
        viewport: { width: ecran.lat, height: 820 },
        isMobile: ecran.mobil,
        hasTouch: ecran.mobil,
        permissions: [],
      });
      const page: Page = await ctx.newPage();
      const erori: string[] = [];
      page.on("pageerror", (e: Error) => erori.push(e.message.slice(0, 140)));
      page.on(
        "console",
        (m: { type: () => string; text: () => string; location: () => { url?: string } }) => {
          if (m.type() !== "error") return;
          const t = m.text();
          const dinAfara = !(m.location()?.url ?? "").startsWith(BASE);
          if (dinAfara && /Failed to load resource|net::ERR_/i.test(t)) return;
          if (/favicon|tile\.openstreetmap/i.test(t)) return;
          erori.push(t.slice(0, 140));
        },
      );
      const E = ecran.lat;

      await page.goto(`${BASE}/a/${tok}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000);
      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, ecran.font);
      await page.waitForTimeout(500);

      // Poarta de PIN.
      const pinuri = page.locator('input[type="password"], input[inputmode="numeric"]');
      if ((await pinuri.count()) > 0) {
        await pinuri.nth(0).fill("4711");
        if ((await pinuri.count()) >= 2) await pinuri.nth(1).fill("4711");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(3500);
        erori.length = 0;
      }

      // Harta pieței → satul nostru → lista firmelor.
      await page.locator("header button").first().click().catch(() => {});
      await page.waitForTimeout(500);
      await page
        .locator("button, a")
        .filter({ hasText: "Harta pieței" })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(4000);

      // Datele de test stau într-un județ CURAT (fără firmele demo din SV/BT),
      // deci singura bulă de pe hartă e satul meu. Altfel testul putea nimeri
      // firma altei agenții și ar fi raportat un refuz CORECT drept bug.
      // Panoul pornește pe județul cu cele mai multe date (SV, unde stau
      // firmele demo). Îl mut pe județul MEU — altfel testul se uită la
      // firmele altei agenții și „descoperă" un refuz corect drept bug.
      const alegJudet = page.locator("select").first();
      if ((await alegJudet.count()) > 0) {
        await alegJudet.selectOption("IS").catch(() => {});
        await page.waitForTimeout(4000);
      }
      const bule = page.locator("path.leaflet-interactive");
      const areSat = (await bule.count()) > 0;
      check(`[${ecran.nume}] satul meu are bulă pe hartă`, areSat, `${await bule.count()} bule`);
      if (!areSat) {
        await ctx.close();
        continue;
      }
      // DESCHIDEM SATUL NOSTRU PE NUME, nu „prima bulă de pe hartă".
      // Județul e comun: o firmă rămasă de la altă suită (sau de la o
      // rulare oprită la mijloc) punea o bulă înaintea noastră, testul
      // deschidea satul altcuiva și cădea pe butoane care nici n-aveau
      // ce căuta acolo. O probă n-are voie să atârne de vecini.
      const butonulSatului = page
        .locator("button", { hasText: SAT })
        .first();
      if ((await butonulSatului.count()) > 0) {
        await butonulSatului.click({ force: true });
      } else {
        await bule.first().click({ force: true });
      }
      await page.waitForTimeout(2500);
      const areFirmele = await page.evaluate(
        (s: string) => document.body.innerText.includes(s),
        "MAGAZINUL MIXT DIN CAPUL SATULUI",
      );
      check(`[${ecran.nume}] văd firmele din satul meu`, areFirmele);
      if (!areFirmele) {
        await ctx.close();
        continue;
      }

      const btnPin = page.locator("button", { hasText: "Pune locul" }).first();
      check(`[${ecran.nume}] butonul „Pune locul" e în lista firmelor`, (await btnPin.count()) > 0);
      const btnAici = page.locator("button", { hasText: "Sunt aici" }).first();
      check(`[${ecran.nume}] butonul „Sunt aici" e lângă el`, (await btnAici.count()) > 0);
      if ((await btnPin.count()) === 0) {
        await ctx.close();
        continue;
      }
      for (const [nume, loc] of [
        ["Pune locul", btnPin],
        ["Sunt aici", btnAici],
      ] as const) {
        const c = await loc.boundingBox();
        check(
          `[${ecran.nume}] „${nume}" e ÎN ecran`,
          !!c && c.x >= -1 && c.x + c.width <= E + 2,
          JSON.stringify(c),
        );
        check(
          `[${ecran.nume}] „${nume}" se poate apăsa cu degetul`,
          (c?.height ?? 0) >= (ecran.mobil ? 24 : 20),
          `${Math.round(c?.height ?? 0)}px`,
        );
      }

      // ── fereastra de pin ──
      await btnPin.click();
      await page.waitForTimeout(3000);
      const text = await page.evaluate(() => document.body.innerText);
      check(`[${ecran.nume}] fereastra se deschide`, /Unde e magazinul/i.test(text));
      check(`[${ecran.nume}] explică ce are de făcut`, /trage pinul/i.test(text));
      check(`[${ecran.nume}] fereastra nu scoate nimic din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);

      const hartaPin = await page.evaluate(() => {
        const toate = Array.from(document.querySelectorAll(".leaflet-container"));
        const el = toate[toate.length - 1] as HTMLElement | undefined;
        if (!el) return null;
        return {
          lat: el.clientWidth,
          inalt: el.clientHeight,
          patrate: el.querySelectorAll(".leaflet-tile").length,
          pinuri: el.querySelectorAll(".leaflet-marker-icon").length,
        };
      });
      check(`[${ecran.nume}] harta din fereastră există`, hartaPin !== null);
      check(
        `[${ecran.nume}] harta are dimensiune reală (nu 0 pixeli)`,
        (hartaPin?.lat ?? 0) > 200 && (hartaPin?.inalt ?? 0) > 150,
        JSON.stringify(hartaPin),
      );
      check(`[${ecran.nume}] harta nu rămâne gri`, (hartaPin?.patrate ?? 0) > 1, `${hartaPin?.patrate} pătrate`);
      check(`[${ecran.nume}] pinul 📍 e pe hartă`, (hartaPin?.pinuri ?? 0) > 0, `${hartaPin?.pinuri}`);

      const releF = await butoaneRele(page, E, ecran.mobil, ".fixed.inset-0");
      check(`[${ecran.nume}] butoanele ferestrei sunt întregi`, releF.length === 0, releF.join(" | "));
      const btnSalv = page.locator("button", { hasText: "Salvează locul" }).first();
      check(`[${ecran.nume}] butonul „Salvează locul" e acolo`, (await btnSalv.count()) > 0);
      const cSalv = await btnSalv.boundingBox();
      check(
        `[${ecran.nume}] „Salvează locul" e mare și în ecran`,
        !!cSalv && cSalv.x >= -1 && cSalv.x + cSalv.width <= E + 2 && cSalv.height >= 40,
        JSON.stringify(cSalv),
      );
      check(
        `[${ecran.nume}] la o firmă FĂRĂ loc pus nu apare „Șterge locul"`,
        (await page.locator("button", { hasText: "Șterge locul pus" }).count()) === 0,
      );

      // ── mut pinul cu degetul și salvez ──
      const cutieHarta = await page.evaluate(() => {
        const toate = Array.from(document.querySelectorAll(".leaflet-container"));
        const el = toate[toate.length - 1] as HTMLElement | undefined;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (cutieHarta) {
        // Apăs pe hartă puțin lateral: pinul trebuie să sară acolo.
        await page.mouse.click(
          cutieHarta.x + cutieHarta.w * 0.65,
          cutieHarta.y + cutieHarta.h * 0.4,
        );
        await page.waitForTimeout(900);
      }
      await btnSalv.click();
      // Confirmarea stă pe ecran 2,5 secunde — o citim CÂT E ACOLO, altfel
      // testul ar zice că lipsește doar pentru că a întârziat el.
      await page.waitForTimeout(1300);
      const dupa = await page.evaluate(() => document.body.innerText);
      await page.waitForTimeout(1700);
      check(`[${ecran.nume}] fereastra se închide după salvare`, !/Unde e magazinul/i.test(dupa));
      check(
        `[${ecran.nume}] confirmă pe ecran că locul e salvat`,
        /Locul magazinului e salvat/i.test(dupa),
        dupa.slice(0, 100).replace(/\n+/g, " | "),
      );

      const inBaza = await sql<Array<{ lat: number; lng: number; aprox: boolean }>>`
        SELECT lat, lng, aprox FROM geo_firme WHERE cui = ANY(${[0, 1, 2].map(cui)})`;
      check(`[${ecran.nume}] locul chiar s-a scris în baza de date`, inBaza.length === 1, `${inBaza.length} rânduri`);
      check(`[${ecran.nume}] …marcat EXACT, nu aproximativ`, inBaza[0]?.aprox === false);
      check(
        `[${ecran.nume}] …și e ALTUNDEVA decât centrul satului (l-am mutat)`,
        inBaza.length === 1 &&
          (Math.abs((inBaza[0]?.lat ?? 0) - CENTRU[0]) > 0.0002 ||
            Math.abs((inBaza[0]?.lng ?? 0) - CENTRU[1]) > 0.0002),
        `${inBaza[0]?.lat},${inBaza[0]?.lng} vs ${CENTRU[0]},${CENTRU[1]}`,
      );

      // ── redeschid: acum scrie „Loc pus" și pot șterge ──
      check(
        `[${ecran.nume}] rândul scrie acum „Loc pus"`,
        (await page.locator("button", { hasText: "Loc pus" }).count()) > 0,
      );
      await page.locator("button", { hasText: "Loc pus" }).first().click();
      await page.waitForTimeout(2500);
      check(
        `[${ecran.nume}] la o firmă CU loc pus apare „Șterge locul"`,
        (await page.locator("button", { hasText: "Șterge locul pus" }).count()) > 0,
      );
      check(`[${ecran.nume}] redeschisă, tot nimic nu iese din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
      await page.locator("button", { hasText: "Șterge locul pus" }).first().click();
      await page.waitForTimeout(2500);
      const dupaSters = await sql`SELECT 1 FROM geo_firme WHERE cui = ANY(${[0, 1, 2].map(cui)})`;
      check(`[${ecran.nume}] ștergerea din fereastră merge`, dupaSters.length === 0, `${dupaSters.length} rămase`);

      check(`[${ecran.nume}] zero erori JavaScript în tot fluxul`, erori.length === 0, erori.slice(0, 2).join(" | "));
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
