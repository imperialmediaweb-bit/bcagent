/**
 * MAGAZINELE DIN HARTA VECHE, CU OCHII ȘI CU DEGETUL.
 *
 * Cele 2373 de magazine aduse din harta veche nu-s cifre într-un raport:
 * agentul le vede pe telefon, în mașină, și apasă pe ele cu degetul. Deci
 * trebuie verificat exact ce vede el:
 *
 *   deschide harta → apasă „Magazine de prospectat" → apar punctele →
 *   apasă pe unul → citește ce e → „Navighează" sau „✅ Există" / „✕ Nu mai e"
 *
 * Plus ce ține de mână: nimic nu iese din ecran, butoanele sunt întregi și
 * de mărimea unui deget, harta nu rămâne gri, zero erori JavaScript.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-magazine-design.ts
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

const RUN = `md${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgId = `org-${RUN}`;
const agentId = `ag-${RUN}`;
const numeAgent = `Mag Design ${RUN}`;
const SAT = `MDSAT ${SUS}`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `31${baza}${i}`;
const CENTRU: [number, number] = [47.7411, 26.6622];

const ECRANE = [
  { nume: "telefon mic + font mare", lat: 320, font: "22px", mobil: true },
  { nume: "telefon obișnuit", lat: 393, font: "16px", mobil: true },
  { nume: "calculator", lat: 1280, font: "16px", mobil: false },
] as const;

/** Magazine cu nume LUNGI: exact alea rup un balonaș prost făcut. */
const MAGAZINE = [
  "MAGAZINUL MIXT DIN CAPUL SATULUI SRL",
  "ANDRONACHE FILOTIA ÎNTREPRINDERE INDIVIDUALĂ",
  "BAR LA VALE & FII SNC",
];

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, ${"MD " + SUS}, ${RUN + "@md.test"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"mda-" + RUN}, ${orgId}, ${agentId}, ${numeAgent})`;
  // Un client, ca harta să aibă și bule normale, nu doar magazine.
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
            VALUES (${cui(0)}, ${"CLIENT NORMAL " + SUS}, 'Str. Test 1', ${SAT}, 'IS',
                    '4711', 'client', ${numeAgent}, TRUE)`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('IS', ${SAT}, ${CENTRU[0]}, ${CENTRU[1]}, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
  for (let i = 0; i < MAGAZINE.length; i++) {
    await sql`INSERT INTO magazin_harta (id, org_id, nume, adresa, localitate, judet, lat, lng, strat)
      VALUES (${`${orgId}:m${i}`}, ${orgId}, ${MAGAZINE[i] + " " + SUS},
              ${"Nume Legal: " + MAGAZINE[i]}, '', '',
              ${CENTRU[0] + i / 1000}, ${CENTRU[1] + i / 1000}, ${"Strat " + i})`;
  }
}

async function curata() {
  await sql`DELETE FROM magazin_harta WHERE org_id = ${orgId}`;
  await sql`DELETE FROM agent_pin WHERE agent_id = ${agentId}`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ${cui(0)}`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ${cui(0)}`;
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
 * Butoanele dintr-o zonă anume. Când e deschis un balonaș, măsurăm DOAR
 * în el: butoanele paginii de dedesubt sunt acoperite, nu le apasă nimeni.
 * Sărim și „×"-ul de închidere, care e pus de Leaflet, nu de noi.
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
      const minim = m ? 30 : 22;
      const zona = document.querySelector(sel) ?? document.body;
      for (const el of Array.from(zona.querySelectorAll("button, a[href]"))) {
        const e = el as HTMLElement;
        if (e.offsetParent === null) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.x + r.width <= 0 || r.x >= lat) continue;
        const nume = (e.innerText || e.getAttribute("aria-label") || "?")
          .trim().slice(0, 22).replace(/\s+/g, " ");
        if (/^[+−-]$/.test(nume) || /^(Leaflet|OpenStreetMap|©)/i.test(nume)) continue;
        if (e.classList.contains("leaflet-popup-close-button")) continue;
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
  console.log(`\nMAGAZINELE DIN HARTA VECHE, CU OCHII — rulare ${RUN}`);
  await pregateste();
  const tok = await signToken(
    { agentId, agentName: numeAgent, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = (await import(PW)) as any;
  const chromium = pw.chromium ?? pw.default?.chromium;
  const b = await chromium.launch({ executablePath: CHROME });

  try {
    for (const ecran of ECRANE) {
      sectiune(`${ecran.nume} (${ecran.lat}px)`);
      // Fiecare ecran pornește curat.
      await sql`UPDATE magazin_harta SET stare = '', confirmat_de = '' WHERE org_id = ${orgId}`;

      const ctx = await b.newContext({
        viewport: { width: ecran.lat, height: 820 },
        isMobile: ecran.mobil,
        hasTouch: ecran.mobil,
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
      await page.waitForTimeout(3200);
      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, ecran.font);
      await page.waitForTimeout(500);

      const pinuri = page.locator('input[type="password"], input[inputmode="numeric"]');
      if ((await pinuri.count()) > 0) {
        await pinuri.nth(0).fill("5150");
        if ((await pinuri.count()) >= 2) await pinuri.nth(1).fill("5150");
        await page.locator("button[type=submit]").first().click();
        await page.waitForTimeout(3500);
        erori.length = 0;
      }

      await page.locator("header button").first().click().catch(() => {});
      await page.waitForTimeout(500);
      await page
        .locator("button, a")
        .filter({ hasText: "Harta pieței" })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(4000);
      // Selectorul de JUDEȚ, luat după ce are înăuntru — „primul select din
      // pagină" e acum lista de zile de la «Acoperirea mea», iar alegerea
      // județului cădea în gol.
      const alegJudet = page.locator('select:has(option[value="IS"])').first();
      if ((await alegJudet.count()) > 0) {
        await alegJudet.selectOption("IS").catch(() => {});
        await page.waitForTimeout(3500);
      }

      // ── butonul ──
      const btn = page.locator("button", { hasText: "Magazine de prospectat" }).first();
      check(`[${ecran.nume}] butonul „Magazine de prospectat" există`, (await btn.count()) > 0);
      if ((await btn.count()) === 0) {
        check(`[${ecran.nume}] restul fluxului`, false, "fără buton nu pot merge mai departe");
        await ctx.close();
        continue;
      }
      const cutieBtn = await btn.boundingBox();
      check(
        `[${ecran.nume}] butonul e ÎN ecran`,
        !!cutieBtn && cutieBtn.x >= -1 && cutieBtn.x + cutieBtn.width <= E + 2,
        JSON.stringify(cutieBtn),
      );
      check(
        `[${ecran.nume}] scrie câte magazine sunt`,
        /Magazine de prospectat \(\d+\)/.test(await page.evaluate(() => document.body.innerText)),
      );

      const inainte = await page.locator("path.leaflet-interactive").count();
      await btn.click();
      await page.waitForTimeout(2500);
      const dupa = await page.locator("path.leaflet-interactive").count();
      check(
        `[${ecran.nume}] apăsat, apar magazinele pe hartă`,
        dupa > inainte,
        `${inainte} → ${dupa}`,
      );
      check(`[${ecran.nume}] cu ele pe hartă, nimic nu iese din ecran`, (await iese(page)) <= 2, `${await iese(page)}px`);
      check(
        `[${ecran.nume}] butonul se schimbă în „Ascunde"`,
        (await page.locator("button", { hasText: "Ascunde magazinele" }).count()) > 0,
      );

      // ── balonașul unui magazin ──
      const puncte = page.locator("path.leaflet-interactive");
      let deschis = false;
      for (let i = 0; i < Math.min(await puncte.count(), 8); i++) {
        await puncte.nth(i).click({ force: true });
        await page.waitForTimeout(900);
        const t = await page.evaluate(() => document.body.innerText);
        if (/harta veche|OpenStreetMap|nimeni n-a trecut/i.test(t) && /MAGAZINUL MIXT|ANDRONACHE|BAR LA VALE/i.test(t)) {
          deschis = true;
          break;
        }
      }
      check(`[${ecran.nume}] apăsând un magazin se deschide fișa lui`, deschis);
      if (deschis) {
        const t = await page.evaluate(() => document.body.innerText);
        check(
          `[${ecran.nume}] spune că e din harta veche, nu client`,
          /nimeni n-a trecut încă|harta veche|OpenStreetMap/i.test(t),
        );
        check(
          `[${ecran.nume}] are „Navighează"`,
          (await page.locator("a", { hasText: "Navighează" }).count()) > 0,
        );
        const bExista = page.locator("button", { hasText: "Există" }).first();
        const bNu = page.locator("button", { hasText: "Nu mai e" }).first();
        check(`[${ecran.nume}] are butonul „✅ Există"`, (await bExista.count()) > 0);
        check(`[${ecran.nume}] are butonul „✕ Nu mai e"`, (await bNu.count()) > 0);
        for (const [nume, loc] of [["Există", bExista], ["Nu mai e", bNu]] as const) {
          if ((await loc.count()) === 0) continue;
          const c = await loc.boundingBox();
          check(
            `[${ecran.nume}] „${nume}" e ÎN ecran și apăsabil`,
            !!c && c.x >= -1 && c.x + c.width <= E + 2 && c.height >= 24,
            JSON.stringify(c),
          );
        }
        const releB = await butoaneRele(page, E, ecran.mobil, ".leaflet-popup");
        check(`[${ecran.nume}] butoanele din fișă sunt întregi`, releB.length === 0, releB.join(" | "));

        // ── confirm că există ──
        if ((await bExista.count()) > 0) {
          await bExista.click();
          // Confirmarea apare DUPĂ ce se salvează (așteptăm GPS-ul până la
          // 3 secunde) și stă 2,5 secunde pe ecran. O pândim, nu ghicim
          // momentul potrivit.
          let peEcran = "";
          for (let t = 0; t < 20; t++) {
            await page.waitForTimeout(500);
            const acum = await page.evaluate(() => document.body.innerText);
            if (/Confirmat|Mulțumesc/i.test(acum)) {
              peEcran = acum;
              break;
            }
          }
          await page.waitForTimeout(1500);
          const conf = await sql<Array<{ stare: string; confirmat_de: string }>>`
            SELECT stare, confirmat_de FROM magazin_harta
            WHERE org_id = ${orgId} AND stare = 'exista'`;
          check(`[${ecran.nume}] „Există" chiar se salvează`, conf.length === 1, `${conf.length}`);
          check(
            `[${ecran.nume}] …pe numele agentului`,
            conf[0]?.confirmat_de === numeAgent,
            conf[0]?.confirmat_de,
          );
          check(
            `[${ecran.nume}] …și îi confirmă pe ecran`,
            /Confirmat|Mulțumesc|Te caut|Se salvează/i.test(peEcran),
            peEcran.replace(/\s+/g, " ").slice(0, 80),
          );
        }
      }
      check(`[${ecran.nume}] zero erori JavaScript`, erori.length === 0, erori.slice(0, 2).join(" | "));
      await ctx.close();
    }

    sectiune("Magazinul tăiat dispare de pe hartă");
    await sql`UPDATE magazin_harta SET stare = 'inchis' WHERE id = ${`${orgId}:m0`}`;
    const r = await fetch(`${BASE}/api/prospects/magazine-harta?token=${tok}`);
    const d = (await r.json()) as { magazine?: Array<{ nume: string }> };
    check(
      "cel tăiat nu mai vine la agenți",
      !(d.magazine ?? []).some((m) => m.nume.includes("MAGAZINUL MIXT")),
      (d.magazine ?? []).map((m) => m.nume.slice(0, 20)).join(","),
    );
    check("ceilalți rămân", (d.magazine ?? []).length === MAGAZINE.length - 1, `${(d.magazine ?? []).length}`);
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
