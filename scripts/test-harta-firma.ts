/**
 * HARTA FIRMEI (cererea lui Bogdan, 25.08: „situația centralizată").
 *
 * Managerul trebuie să vadă pe un singur ecran: toți clienții firmei, ai
 * cui sunt, pe unde s-a trecut și cine a rămas nevizitat. Verificăm pe
 * serverul REAL, în browser REAL:
 *   1. API-ul dă clienții TUTUROR agenților firmei, cu agentul lor;
 *   2. restanții sunt calculați corect (fără vizită sau prea veche);
 *   3. pragul de zile chiar schimbă cine e restant;
 *   4. filtrul pe agent întoarce doar clienții lui;
 *   5. IZOLARE: firma străină nu vede niciun client de-al nostru;
 *   6. pagina desenează punctele, are legenda cu agenții și acoperirea.
 *
 * Rulare: BASE_URL=... DATABASE_URL=... npx tsx scripts/test-harta-firma.ts
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

interface ClientHarta {
  cui: string;
  agent: string;
  restant: boolean;
  lat: number | null;
}
interface Raspuns {
  clienti?: ClientHarta[];
  agenti?: Array<{ nume: string; clienti: number; restanti: number }>;
  rezumat?: { total: number; cuPozitie: number; restanti: number; localitati: number };
}

async function main() {
  const RUN = `hf${Date.now().toString(36).slice(-6)}`;
  const baza = Date.now().toString().slice(-7);
  const cui = (i: number) => `44${baza}${i}`;
  const emailA = `${RUN}-a@test.ro`;
  const emailB = `${RUN}-b@test.ro`;
  const PAROLA = "ParolaTest123!";
  const SAT = `SAT HARTA ${RUN.toUpperCase()}`;

  // Conturile se fac DIRECT (nu prin înregistrarea publică, care are
  // limită de 5 pe oră — bună în producție, dar ne-ar bloca testele).
  const inreg = async (email: string, firma: string) => {
    const org = await createOrg({ name: firma, email });
    await createOrgUser(org.id, email, PAROLA, "Owner", "owner");
    return org.id;
  };
  const orgAId = await inreg(emailA, `HARTA A ${RUN}`);
  const orgBId = await inreg(emailB, `HARTA B ${RUN}`);
  check("firma A creată", !!orgAId);
  check("firma B creată", !!orgBId);

  const orgIdPentru = async (email: string) => {
    const [r] = await sql<Array<{ id: string }>>`
      SELECT o.id FROM organizations o JOIN org_users u ON u.org_id = o.id
      WHERE u.email = ${email} LIMIT 1
    `;
    return r?.id ?? "";
  };
  const orgA = await orgIdPentru(emailA);
  const orgB = await orgIdPentru(emailB);
  if (!orgA || !orgB) {
    console.log("❌ nu s-au creat firmele de test");
    await sql.end();
    process.exit(1);
  }

  const numeIon = `Ion Harta ${RUN}`;
  const numeVasile = `Vasile Harta ${RUN}`;
  const numeStrain = `Strain Harta ${RUN}`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"ag1-" + RUN}, ${orgA}, ${"agid1-" + RUN}, ${numeIon}),
                   (${"ag2-" + RUN}, ${orgA}, ${"agid2-" + RUN}, ${numeVasile}),
                   (${"ag3-" + RUN}, ${orgB}, ${"agid3-" + RUN}, ${numeStrain})`;

  // Clienți: 2 ai lui Ion (unul vizitat ieri, unul niciodată), 1 al lui
  // Vasile (vizitat acum 20 de zile), 1 al firmei străine.
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
    VALUES
    (${cui(1)}, ${"CLIENT ION PROASPAT " + RUN}, 'Str. 1', ${SAT}, 'SV', '4711', 'client', ${numeIon}, TRUE),
    (${cui(2)}, ${"CLIENT ION UITAT " + RUN}, 'Str. 2', ${SAT}, 'SV', '4711', 'client', ${numeIon}, TRUE),
    (${cui(3)}, ${"CLIENT VASILE VECHI " + RUN}, 'Str. 3', ${SAT}, 'SV', '4711', 'client', ${numeVasile}, TRUE),
    (${cui(4)}, ${"CLIENT FIRMA STRAINA " + RUN}, 'Str. 4', ${SAT}, 'SV', '4711', 'client', ${numeStrain}, TRUE)`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${SAT}, 47.75, 26.15, FALSE)
            ON CONFLICT (judet, localitate) DO NOTHING`;
  // Poziție exactă doar pentru unul (restul cad pe centrul satului).
  await sql`INSERT INTO geo_firme (cui, lat, lng, aprox, failed)
            VALUES (${cui(1)}, 47.7512, 26.1523, FALSE, FALSE)
            ON CONFLICT (cui) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng`;
  await sql`INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, visited_at)
    VALUES
    (${"agid1-" + RUN}, ${numeIon}, ${cui(1)}, 'x', 'client', '', NOW() - INTERVAL '1 day'),
    (${"agid2-" + RUN}, ${numeVasile}, ${cui(3)}, 'x', 'gandeste', '', NOW() - INTERVAL '20 days')`;

  const login = async (email: string) => {
    const r = await fetch(`${BASE}/api/agentie/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PAROLA }),
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0];
  };
  const ckA = await login(emailA);
  const ckB = await login(emailB);

  const harta = async (cookie: string, q = "") => {
    const r = await fetch(`${BASE}/api/agentie/harta${q}`, { headers: { cookie } });
    return (await r.json()) as Raspuns;
  };

  sectiune("Situația centralizată — toți agenții firmei");
  const dA = await harta(ckA);
  const aiMei = (dA.clienti ?? []).filter((c) => c.cui.startsWith(`44${baza}`));
  check("apar clienții AMBILOR agenți ai firmei", aiMei.length === 3, String(aiMei.length));
  check(
    "fiecare client vine cu agentul lui",
    aiMei.filter((c) => c.agent === numeIon).length === 2 &&
      aiMei.filter((c) => c.agent === numeVasile).length === 1,
  );
  check(
    "clientul FIRMEI STRĂINE nu apare",
    !(dA.clienti ?? []).some((c) => c.cui === cui(4)),
  );
  check(
    "clientul cu poziție exactă are coordonate",
    aiMei.find((c) => c.cui === cui(1))?.lat !== null,
  );
  check(
    "cei fără poziție exactă cad pe centrul satului (tot pe hartă)",
    aiMei.every((c) => c.lat !== null),
  );

  sectiune("Cine e restant (banii care se răcesc)");
  check(
    "vizitat ieri → NU e restant",
    aiMei.find((c) => c.cui === cui(1))?.restant === false,
  );
  check(
    "nevizitat niciodată → restant",
    aiMei.find((c) => c.cui === cui(2))?.restant === true,
  );
  check(
    "vizitat acum 20 de zile → restant la pragul de 7 zile",
    aiMei.find((c) => c.cui === cui(3))?.restant === true,
  );
  const d30 = await harta(ckA, "?zile=30");
  const cei30 = (d30.clienti ?? []).filter((c) => c.cui.startsWith(`44${baza}`));
  check(
    "la pragul de 30 de zile, cel vizitat acum 20 NU mai e restant",
    cei30.find((c) => c.cui === cui(3))?.restant === false,
  );

  sectiune("Filtrul pe agent și numărătorile");
  const dIon = await harta(ckA, `?agent=${encodeURIComponent(numeIon)}`);
  const aiLuiIon = (dIon.clienti ?? []).filter((c) => c.cui.startsWith(`44${baza}`));
  check("filtrat pe Ion: doar clienții lui", aiLuiIon.length === 2 && aiLuiIon.every((c) => c.agent === numeIon));
  const linieIon = (dA.agenti ?? []).find((a) => a.nume === numeIon);
  check("acoperirea pe agenți e corectă", linieIon?.clienti === 2 && linieIon?.restanti === 1, JSON.stringify(linieIon));
  check("rezumatul numără localitățile", (dA.rezumat?.localitati ?? 0) >= 1);

  sectiune("Izolare între firme");
  const dB = await harta(ckB);
  check(
    "firma B nu vede NICIUN client de-al firmei A",
    !(dB.clienti ?? []).some((c) => [cui(1), cui(2), cui(3)].includes(c.cui)),
  );
  const fara = await fetch(`${BASE}/api/agentie/harta`);
  check("fără cont, harta firmei nu se deschide", fara.status === 401, String(fara.status));

  sectiune("Pagina, cu ochii");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const [numeCk, valCk] = ckA.split("=");
  await ctx.addCookies([
    { name: numeCk, value: valCk, domain: "127.0.0.1", path: "/" },
  ]);
  const page = await ctx.newPage();
  const erori: string[] = [];
  page.on("pageerror", (e: Error) => erori.push(e.message));
  await page.goto(`${BASE}/agentie/harta`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const text = await page.locator("body").innerText();
  check("pagina se deschide cu titlul ei", text.includes("Harta firmei"));
  check("arată cifrele de sus (restanți, localități)", text.includes("Restanți") && text.includes("Localități"));
  const puncte = await page.locator("path.leaflet-interactive").count();
  check("clienții sunt desenați ca puncte pe hartă", puncte >= 3, `${puncte} forme`);
  check("legenda arată agenții cu culorile lor", text.includes(numeIon) && text.includes(numeVasile));
  check("există secțiunea de acoperire pe agenți", text.includes("Acoperirea pe agenți"));
  // filtrul „doar restanții"
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(1500);
  const dupaFiltru = await page.locator("path.leaflet-interactive").count();
  check("filtrul «doar restanții» reduce punctele", dupaFiltru < puncte, `${dupaFiltru} vs ${puncte}`);
  const iese = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("nimic nu iese din ecran", iese <= 1, `${iese}px`);
  await page.setViewportSize({ width: 393, height: 800 });
  await page.waitForTimeout(800);
  const ieseTel = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("merge și pe telefon (fără scroll orizontal)", ieseTel <= 1, `${ieseTel}px`);
  check("zero erori de JavaScript", erori.length === 0, erori.slice(0, 2).join(" | "));
  await browser.close();

  sectiune("Curățenie");
  await sql`DELETE FROM visits WHERE cui LIKE ${"44" + baza + "%"}`;
  await sql`DELETE FROM geo_firme WHERE cui LIKE ${"44" + baza + "%"}`;
  await sql`DELETE FROM prospects WHERE cui LIKE ${"44" + baza + "%"}`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgA}, ${orgB})`;
  await sql`DELETE FROM org_users WHERE email IN (${emailA}, ${emailB})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
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
