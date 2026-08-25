/**
 * HARTA FIRMEI — QA de DESIGN și de FRONT-END.
 *
 * Nu „răspunde API-ul", ci „arată bine și se poate folosi": pe telefon
 * mic și pe monitor mare, cu font mărit, cu multe sau zero date, cu
 * nume lungi, cu rețeaua căzută, cu degetul (nu cu mouse-ul).
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... npx tsx scripts/test-harta-design.ts
 */
import postgres from "postgres";
import { createOrg, createOrgUser } from "../src/modules/platform/repo";

const PW =
  process.env.PLAYWRIGHT_MODULE ??
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pwModule = (await import(PW)) as any;
const chromium = pwModule.chromium ?? pwModule.default?.chromium;

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

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
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}

/** Contrastul între două culori (WCAG) — text citibil sau nu. */
function contrast(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const m = hex.replace("#", "");
    const c = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
    const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const a = lum(hex1);
  const b = lum(hex2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function main() {
  const RUN = `hd${Date.now().toString(36).slice(-6)}`;
  const baza = Date.now().toString().slice(-7);
  const cui = (i: number) => `39${baza}${String(i).padStart(2, "0")}`;
  const email = `${RUN}@test.ro`;
  const PAROLA = "ParolaTest123!";
  const SAT = `SAT DESIGN ${RUN.toUpperCase()}`;

  const org = await createOrg({ name: `DESIGN SRL ${RUN}`, email });
  await createOrgUser(org.id, email, PAROLA, "Bogdan", "owner");
  // 12 agenți: mai mulți decât culorile din paletă (10) — verificăm că se
  // reiau curat, nu se strică legenda. Unul cu nume foarte lung.
  const agenti = [
    ...Array.from({ length: 11 }, (_, i) => `Agent Numarul ${i + 1} ${RUN}`),
    `Agent Cu Nume Extrem De Lung Care Nu Incape Nicaieri Pe Un Telefon ${RUN}`,
  ];
  for (let i = 0; i < agenti.length; i++) {
    await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
              VALUES (${"a" + i + RUN}, ${org.id}, ${"ag" + i + RUN}, ${agenti[i]})`;
  }
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${SAT}, 47.7, 26.1, FALSE)
            ON CONFLICT (judet, localitate) DO NOTHING`;
  // 36 de clienți: unii vizitați, alții nu; unii cu restanță de plată;
  // unul cu nume foarte lung; unul fără poziție deloc.
  for (let i = 0; i < 36; i++) {
    const ag = agenti[i % agenti.length];
    const c = cui(i);
    const numeLung =
      i === 5
        ? `MAGAZINUL CU CEL MAI LUNG NUME DIN TOATA BAZA DE DATE SRL ${RUN}`
        : `MAGAZIN ${i + 1} ${RUN}`;
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon, sold_cents)
      VALUES (${c}, ${numeLung}, ${"Str. " + (i + 1)}, ${SAT}, 'SV', '4711', 'client', ${ag}, TRUE,
              ${i % 4 === 0 ? "0740" + String(100000 + i) : ""}, ${i % 6 === 0 ? 125000 : null})`;
    if (i !== 7) {
      // clientul 7 rămâne fără poziție exactă (cade pe centrul satului)
      await sql`INSERT INTO geo_firme (cui, lat, lng, aprox, failed)
                VALUES (${c}, ${47.7 + (i % 6) * 0.01}, ${26.1 + (i % 5) * 0.012}, FALSE, FALSE)
                ON CONFLICT (cui) DO NOTHING`;
    }
    if (i % 3 !== 0) {
      await sql`INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, visited_at)
                VALUES (${"ag" + (i % agenti.length) + RUN}, ${ag}, ${c}, 'x', 'client', '',
                        NOW() - (${i % 12} || ' days')::interval)`;
    }
  }

  // Sesiunea se face DIRECT (nu prin login-ul public, limitat la 10
  // încercări/5 min pe IP — corect în producție, dar ne-ar pica rularea
  // repetată a suitei).
  const { COOKIE_NAME, semneazaSesiuneTest } = await import("./_sesiune-test");
  const numeCk = COOKIE_NAME;
  const valCk = await semneazaSesiuneTest({
    userId: `usr-${RUN}`,
    orgId: org.id,
    email,
    name: "Bogdan",
    role: "owner",
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  const cuCont = async (opts: Record<string, unknown> = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 800 }, ...opts });
    await ctx.addCookies([{ name: numeCk, value: valCk, domain: "127.0.0.1", path: "/" }]);
    return ctx;
  };

  sectiune("Se vede bine pe orice ecran (telefon mic → monitor mare)");
  const ctx = await cuCont();
  const page = await ctx.newPage();
  const erori: string[] = [];
  page.on("pageerror", (e: Error) => erori.push(e.message));
  await page.goto(`${BASE}/agentie/harta`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  for (const w of [320, 360, 393, 430, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.waitForTimeout(700);
    // Când iese ceva, spunem și CE anume — altfel căutăm vinovatul cu ora.
    const raport = await page.evaluate(() => {
      const lim = document.documentElement.clientWidth;
      const iese = document.documentElement.scrollWidth - lim;
      const vinovati: string[] = [];
      document.querySelectorAll("*").forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.right > lim + 1 && r.width > 30) {
          const st = getComputedStyle(el as HTMLElement);
          if (st.overflow === "visible" && st.position !== "fixed") {
            vinovati.push(
              `${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)} (w=${Math.round(r.width)}, right=${Math.round(r.right)})`,
            );
          }
        }
      });
      return { iese, vinovati: vinovati.slice(0, 3) };
    });
    check(
      `la ${w}px nu iese nimic din ecran`,
      raport.iese <= 1,
      `${raport.iese}px · ${raport.vinovati.join(" | ")}`,
    );
  }

  sectiune("Harta însăși");
  await page.setViewportSize({ width: 393, height: 800 });
  await page.waitForTimeout(1200);
  const h = await page.evaluate(() => {
    const el = document.querySelector(".leaflet-container") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      lat: Math.round(r.width),
      inalt: Math.round(r.height),
      patrate: el.querySelectorAll(".leaflet-tile").length,
      puncte: el.querySelectorAll("path.leaflet-interactive").length,
      inEcran: r.width <= window.innerWidth + 1,
    };
  });
  check("harta există și are dimensiune reală", !!h && h.inalt > 200 && h.lat > 200, JSON.stringify(h));
  check("harta încape în lățimea telefonului", h?.inEcran === true, JSON.stringify(h));
  check("s-au încărcat pătratele de hartă (nu ecran gri)", (h?.patrate ?? 0) > 0, `${h?.patrate} pătrate`);
  check("clienții sunt desenați", (h?.puncte ?? 0) >= 30, `${h?.puncte} forme`);
  const zoomBtn = await page.evaluate(() => {
    const b = document.querySelector(".leaflet-control-zoom-in") as HTMLElement | null;
    if (!b) return 0;
    const r = b.getBoundingClientRect();
    return Math.min(r.width, r.height);
  });
  check("butoanele de zoom se pot apăsa cu degetul (≥26px)", zoomBtn >= 26, `${zoomBtn}px`);

  sectiune("Legenda și culorile agenților");
  const legenda = await page.evaluate(() => {
    const puncte = Array.from(document.querySelectorAll("span[style*='background']"));
    return puncte
      .map((p) => (p as HTMLElement).style.background)
      .filter((c) => c.startsWith("rgb"));
  });
  check("fiecare agent are pastila lui de culoare în legendă", legenda.length >= 12, `${legenda.length}`);
  const culoriUnice = new Set(legenda);
  check(
    "la 12 agenți culorile se reiau curat (paleta are 10)",
    culoriUnice.size >= 10,
    `${culoriUnice.size} culori distincte`,
  );
  const CULORI = ["#2563eb","#059669","#d97706","#7c3aed","#db2777","#0891b2","#65a30d","#dc2626","#4f46e5","#0f766e"];
  const slabe = CULORI.filter((c) => contrast(c, "#ffffff") < 3);
  check(
    "toate culorile se văd pe fundal alb (contrast ≥ 3)",
    slabe.length === 0,
    slabe.join(", "),
  );
  const textLegenda = await page.locator("body").innerText();
  check("legenda explică inelul roșu", textLegenda.includes("inel roșu"));

  sectiune("Numele lungi nu sparg nimic");
  check(
    "agentul cu nume foarte lung apare în legendă",
    textLegenda.includes("Agent Cu Nume Extrem"),
  );
  const ieseCuNumeLung = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("cu numele lungi tot nu apare scroll orizontal", ieseCuNumeLung <= 1, `${ieseCuNumeLung}px`);

  sectiune("Filtrele — se pot folosi cu degetul și chiar filtrează");
  // Ținta de apăsat e ZONA (eticheta din jurul bifei), nu pătrățelul.
  const tinte = await page.evaluate(() =>
    Array.from(document.querySelectorAll("select, input[type=checkbox], button")).map((el) => {
      const zona = (el.closest("label") as HTMLElement | null) ?? (el as HTMLElement);
      const r = zona.getBoundingClientRect();
      return { h: Math.round(r.height), ce: `${el.tagName}.${String((el as HTMLElement).className).slice(0, 30)}` };
    }),
  );
  const preaMici = tinte.filter((t) => t.h > 0 && t.h < 24);
  check(
    "nu există controale prea mici pentru deget",
    preaMici.length === 0,
    preaMici.map((t) => `${t.ce}=${t.h}px`).join(", "),
  );
  const inainte = await page.locator("path.leaflet-interactive").count();
  await page.locator("select").first().selectOption({ index: 1 });
  await page.waitForTimeout(2500);
  const dupaAgent = await page.locator("path.leaflet-interactive").count();
  check("filtrul pe agent reduce punctele", dupaAgent < inainte, `${dupaAgent} vs ${inainte}`);
  await page.locator("select").first().selectOption({ index: 0 });
  await page.waitForTimeout(2000);
  await page.locator("select").nth(1).selectOption({ index: 2 });
  await page.waitForTimeout(2500);
  const textDupaPrag = await page.locator("body").innerText();
  check("pragul de zile schimbă textul explicativ", textDupaPrag.includes("30"), "");
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(2000);
  const doarRestanti = await page.locator("path.leaflet-interactive").count();
  check("«doar restanții» arată mai puțini", doarRestanti <= inainte, `${doarRestanti} vs ${inainte}`);
  await page.locator('input[type="checkbox"]').first().uncheck();
  await page.waitForTimeout(1500);

  sectiune("Schimbări rapide de filtre (nu se încurcă)");
  for (let i = 0; i < 6; i++) {
    await page.locator("select").first().selectOption({ index: i % 3 });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(3000);
  const dupaRafala = await page.locator("path.leaflet-interactive").count();
  check("după 6 schimbări rapide, harta tot desenează", dupaRafala > 0, `${dupaRafala}`);
  check("fără erori de JavaScript după rafală", erori.length === 0, erori.slice(0, 2).join(" | "));

  sectiune("Ce se apasă pe un client");
  await page.locator("select").first().selectOption({ index: 0 });
  await page.waitForTimeout(2500);
  await page.locator("path.leaflet-interactive").first().click({ force: true });
  await page.waitForTimeout(1200);
  const popup = await page.locator(".leaflet-popup-content").innerText().catch(() => "");
  check("apeși pe punct și se deschide fișa lui", popup.length > 10, popup.slice(0, 80));
  check("fișa spune al cui e clientul", popup.includes("Agent"));
  check("fișa spune ultima vizită", popup.toLowerCase().includes("ultima vizită"));
  const latimePopup = await page.evaluate(() => {
    const el = document.querySelector(".leaflet-popup") as HTMLElement | null;
    return el ? el.getBoundingClientRect().width : 0;
  });
  check("fișa încape pe ecranul telefonului", latimePopup <= 393, `${latimePopup}px`);

  sectiune("Font mărit (oameni care nu văd bine)");
  const ctxFont = await cuCont({ viewport: { width: 393, height: 800 }, deviceScaleFactor: 2 });
  const pFont = await ctxFont.newPage();
  await pFont.addInitScript(`document.addEventListener("DOMContentLoaded",()=>{document.documentElement.style.fontSize="20px"})`);
  await pFont.goto(`${BASE}/agentie/harta`, { waitUntil: "domcontentloaded" });
  await pFont.waitForTimeout(6000);
  const ieseFont = await pFont.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("cu font mărit nu apare scroll orizontal", ieseFont <= 1, `${ieseFont}px`);
  const hartaFont = await pFont.locator(".leaflet-container").count();
  check("harta rămâne pe ecran și cu font mărit", hartaFont === 1);
  await ctxFont.close();

  sectiune("Când rețeaua cade");
  const ctxErr = await cuCont();
  await ctxErr.route("**/api/agentie/harta*", (r: { abort: (s: string) => void }) => r.abort("failed"));
  const pErr = await ctxErr.newPage();
  await pErr.goto(`${BASE}/agentie/harta`, { waitUntil: "domcontentloaded" });
  await pErr.waitForTimeout(4000);
  const textErr = await pErr.locator("body").innerText();
  check(
    "fără rețea: mesaj pe ecran, nu pagină moartă",
    textErr.length > 60 && /eroare|nu am|încearcă|failed|fetch/i.test(textErr),
    textErr.slice(0, 120),
  );
  check("pagina nu rămâne cu schelet infinit", !textErr.includes("undefined"));
  await ctxErr.close();

  sectiune("Firmă FĂRĂ clienți (prima zi)");
  const emailGol = `${RUN}-gol@test.ro`;
  const orgGol = await createOrg({ name: `GOALA SRL ${RUN}`, email: emailGol });
  await createOrgUser(orgGol.id, emailGol, PAROLA, "Nou", "owner");
  const rGol = await fetch(`${BASE}/api/agentie/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailGol, password: PAROLA }),
  });
  const ckGol = (rGol.headers.get("set-cookie") ?? "").split(";")[0];
  const ctxGol = await browser.newContext({ viewport: { width: 393, height: 800 } });
  const [ng, vg] = ckGol.split("=");
  await ctxGol.addCookies([{ name: ng, value: vg, domain: "127.0.0.1", path: "/" }]);
  const pGol = await ctxGol.newPage();
  await pGol.goto(`${BASE}/agentie/harta`, { waitUntil: "domcontentloaded" });
  await pGol.waitForTimeout(4000);
  const textGol = await pGol.locator("body").innerText();
  check(
    "firma fără clienți primește îndrumare, nu ecran gol",
    /niciun client|adu/i.test(textGol),
    textGol.slice(0, 140),
  );
  const ieseGol = await pGol.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("pagina goală arată curat (fără scroll orizontal)", ieseGol <= 1);
  await ctxGol.close();

  sectiune("Meniul și navigarea");
  await page.setViewportSize({ width: 393, height: 800 });
  await page.goto(`${BASE}/agentie`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator("header button").last().click();
  await page.waitForTimeout(700);
  const inMeniu = await page.locator("a", { hasText: "Harta firmei" }).count();
  check("«Harta firmei» e în meniul de pe telefon", inMeniu >= 1);
  await page.locator("a", { hasText: "Harta firmei" }).first().click();
  await page.waitForTimeout(4000);
  check("se ajunge pe pagină din meniu", page.url().includes("/agentie/harta"));
  check("zero erori de JavaScript în tot parcursul", erori.length === 0, erori.slice(0, 2).join(" | "));

  await ctx.close();
  await browser.close();

  sectiune("Curățenie");
  await sql`DELETE FROM visits WHERE cui LIKE ${"39" + baza + "%"}`;
  await sql`DELETE FROM geo_firme WHERE cui LIKE ${"39" + baza + "%"}`;
  await sql`DELETE FROM prospects WHERE cui LIKE ${"39" + baza + "%"}`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id = ${org.id}`;
  await sql`DELETE FROM org_users WHERE email IN (${email}, ${emailGol})`;
  await sql`DELETE FROM organizations WHERE id IN (${org.id}, ${orgGol.id})`;
  console.log("  · datele de test șterse");

  await sql.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
