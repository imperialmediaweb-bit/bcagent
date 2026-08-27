/**
 * BUTONUL „ADAUGĂ MAGAZIN", verificat cu degetul, nu pe cuvânt.
 *
 * De ieri, ghidul și AI-ul de suport promit: „apasă pe hartă unde e
 * magazinul și scrie-i numele". API-ul era gata; BUTONUL nu exista.
 * Exact golul care l-a trimis pe Costin să caute prin aplicație butoane
 * inexistente. Aici umblăm prin ecran ca el: pornim modul, apăsăm pe
 * hartă, scriem numele, salvăm — și verificăm că magazinul chiar ajunge
 * în bază, la firma lui, nu la vecini.
 */
import postgres from "postgres";
import { ensureSchema } from "../src/lib/db";
import { ensurePlatformSchema } from "../src/modules/platform/schema";
import { signToken } from "../src/lib/signed-token";

const PW = process.env.PLAYWRIGHT_MODULE ?? "";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const sql = postgres(process.env.DATABASE_URL!, { ssl: false });

let treceri = 0;
const caderi: string[] = [];
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
    console.log(`  ✓ ${nume}`);
  } else {
    caderi.push(nume);
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

const ORG = "test-admag-org";
const AG = "test-admag-ag";
const NUME = "Costin De Probă";
const SAT = "ADMAGSAT";
const CUI = "18584450";

async function curata() {
  await sql`DELETE FROM magazin_harta WHERE org_id = ${ORG}`;
  await sql`DELETE FROM geo_firme WHERE cui = ${CUI}`;
  await sql`DELETE FROM prospects WHERE cui = ${CUI}`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
}

async function main() {
  await ensureSchema();
  await ensurePlatformSchema();
  await curata();
  await sql`INSERT INTO organizations (id, name, status) VALUES (${ORG}, 'Firma AdMag', 'activ')`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG}, ${ORG}, ${AG}, ${NUME}, TRUE)`;
  await sql`INSERT INTO prospects (cui, denumire, judet, localitate, status, assigned_agent, assigned_org, activ)
            VALUES (${CUI}, 'CLIENTUL DIN SAT SRL', 'SV', ${SAT}, 'client', ${NUME}, ${ORG}, TRUE)`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${SAT}, 47.65, 26.25, FALSE)`;

  const tok = await signToken(
    { agentId: AG, agentName: NUME, exp: Math.floor(Date.now() / 1000) + 3600 },
    process.env.TOKEN_SECRET!,
  );

  const pw = (await import(PW)) as {
    chromium?: { launch: (o: object) => Promise<never> };
    default?: { chromium: { launch: (o: object) => Promise<never> } };
  };
  const chromium = (pw.chromium ?? pw.default?.chromium)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser: any = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // Suntem „în sat": harta primește o poziție ca de la GPS.
    geolocation: { latitude: 47.65, longitude: 26.25 },
    permissions: ["geolocation"],
  });
  const page = await ctx.newPage();
  const erori: string[] = [];
  page.on("pageerror", (e: unknown) => erori.push(String(e)));

  console.log("\n══ Ca agentul, pe telefon ══");
  await page.goto(`${BASE}/a/${tok}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // Poarta de PIN, la prima deschidere a linkului.
  const pinuri = page.locator('input[type="password"], input[inputmode="numeric"]');
  if ((await pinuri.count()) > 0) {
    await pinuri.nth(0).fill("4711");
    if ((await pinuri.count()) >= 2) await pinuri.nth(1).fill("4711");
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

  const btn = page.locator("button", { hasText: "Adaugă magazin" }).first();
  await btn.waitFor({ timeout: 10_000 }).catch(() => {});
  ok("butonul de adăugat magazin există pe hartă", (await btn.count()) > 0);
  if ((await btn.count()) === 0) {
    const texte = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 40),
    );
    console.log("   BUTOANE PE ECRAN:", JSON.stringify(texte));
    throw new Error("butonul lipsește");
  }
  await btn.click();
  await page.waitForTimeout(400);
  const indrumare = await page.evaluate(() =>
    document.body.innerText.includes("Apasă pe hartă exact unde e magazinul"),
  );
  ok("pornit, îi SPUNE omului ce să facă", indrumare);

  // Apăs pe mijlocul hărții.
  const harta = page.locator(".leaflet-container").first();
  ok("harta e pe ecran", (await harta.count()) > 0);
  await harta.click({ position: { x: 180, y: 200 }, force: true });
  await page.waitForTimeout(600);
  const intrebare = await page.evaluate(() =>
    document.body.innerText.includes("Cum se cheamă magazinul de aici?"),
  );
  ok("după apăsare, întreabă numele", intrebare);

  await page.locator('input[placeholder*="Magazin Mixt"]').fill("Bar La Probă");
  await page.locator("button", { hasText: "Salvează" }).first().click();
  await page.waitForTimeout(1500);
  const confirmare = await page.evaluate(() =>
    document.body.innerText.includes("e pe hartă"),
  );
  ok("confirmă pe ecran că s-a salvat", confirmare);

  console.log("\n══ Și în bază, adevărul ══");
  const [m] = await sql<
    Array<{ nume: string; adaugat_de: string; stare: string; lat: number }>
  >`
    SELECT nume, adaugat_de, stare, lat FROM magazin_harta
    WHERE org_id = ${ORG} AND nume = 'Bar La Probă'
  `;
  ok("magazinul e în bază", !!m, JSON.stringify(m ?? null));
  ok("scrie cine l-a pus", m?.adaugat_de === NUME, m?.adaugat_de ?? "");
  ok("e confirmat din prima (omul e acolo)", m?.stare === "exista", m?.stare ?? "");
  ok(
    "cu coordonate adevărate, în România",
    !!m && m.lat > 43.3 && m.lat < 48.4,
    String(m?.lat),
  );
  const [laVecin] = await sql<Array<{ n: string }>>`
    SELECT COUNT(*)::text AS n FROM magazin_harta
    WHERE org_id <> ${ORG} AND nume = 'Bar La Probă'
  `;
  ok("și DOAR la firma lui, nu la vecini", laVecin.n === "0", laVecin.n);
  ok("zero erori JavaScript pe drum", erori.length === 0, erori.join("; "));

  await browser.close();
  console.log("\n══ Curățenie ══");
  await curata();
  console.log("  · datele de test șterse");
  console.log(
    `\n${caderi.length === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi.length} eșuate\n`,
  );
  await sql.end();
  process.exit(caderi.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await sql.end();
  process.exit(1);
});
