/**
 * TOT CE S-A FĂCUT AZI, VERIFICAT DE TREI ORI.
 *
 * Ziua a început la 7 dimineața cu notele lui Robert scrise păsărește și
 * s-a terminat cu suportul care inventa butoane. Între ele: harta lui
 * Bogdan citită pe CUI, 1073 de firme aduse în bază, magazinele
 * clienților, zonele citite de pe WhatsApp, învățarea per firmă.
 *
 * Aici trec peste toate, cu trei perechi de ochi:
 *
 *   1. CA OM CARE CITEȘTE CODUL — caut ce poate strica date: scrieri
 *      fără pază, liste inventate de mine, capcane pe care le-am mai
 *      călcat o dată azi (ghilimele românești în cod, backtick în SQL).
 *   2. CA OM CARE SE UITĂ LA ECRAN — pe telefon mic, pe telefon normal
 *      și pe calculator: intră tot în ecran, butoanele sunt cât degetul,
 *      nimic nu iese, zero erori.
 *   3. CA AGENT DE TEREN — pe API-ul adevărat, cu tokenul lui, exact ce
 *      apasă el: adaugă un magazin, confirmă unul, își scrie zonele,
 *      întreabă suportul.
 *
 * Nimic inventat: fiecare probă atinge cod adevărat sau date adevărate.
 */

import { readFileSync } from "node:fs";
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
  } else {
    fail++;
    rele.push(`${n}${extra ? ` — ${extra}` : ""}`);
    console.log(`  ✗ ${n}${extra ? ` — ${extra}` : ""}`);
  }
}
function sectiune(t: string) {
  console.log(`\n══ ${t} ══`);
}
const citeste = (f: string) => readFileSync(f, "utf8");

// ─────────────────────────────────────────────────────────────────────
// 1. CA OM CARE CITEȘTE CODUL
// ─────────────────────────────────────────────────────────────────────
function caCodeReview() {
  sectiune("1. CA OM CARE CITEȘTE CODUL");

  // ── Capcanele pe care le-am călcat AZI, de mai multe ori ──
  {
    // Backtick într-un comentariu SQL rupe template literal-ul.
    const cuSql = [
      "src/lib/db.ts",
      "src/modules/prospects/harta-aplica.ts",
      "src/modules/prospects/osm-import.ts",
      "src/modules/zone/aplica.ts",
      "src/app/api/prospects/pin/route.ts",
      "src/app/api/agentie/balances/route.ts",
      "src/app/api/issues/route.ts",
    ];
    for (const f of cuSql) {
      const rau = citeste(f)
        .split("\n")
        .filter((l) => /^\s*--/.test(l) && l.includes("`"));
      check(`${f}: fără backtick în comentariile SQL`, rau.length === 0, rau[0]);
    }
  }
  {
    // Ghilimele românești într-un literal JS închid șirul.
    const scripturi = [
      "scripts/test-suport-fapte.ts",
      "scripts/test-zona-invata.ts",
      "scripts/test-firme-din-harta.ts",
      "scripts/test-magazine-client.ts",
      "scripts/test-solduri-izolate.ts",
      "scripts/test-zona-whatsapp.ts",
      "scripts/test-kml-cui.ts",
      "scripts/test-dictare.ts",
      "scripts/test-adresa-livrare.ts",
    ];
    for (const f of scripturi) {
      // ATENȚIE la ce căutăm: ghilimeaua românească e periculoasă DOAR
      // într-un șir cu ghilimele drepte, unde „…" se închide cu un `"`
      // adevărat și taie șirul în două. Într-un template literal (cu
      // backtick) e nevinovată. De-aia cerem un `"` ÎNAINTE de ea.
      const rau = citeste(f)
        .split("\n")
        .filter(
          (l) => {
            if (/^\s*(\*|\/\/|\/\*)/.test(l)) return false;
            // Scoatem întâi bucățile dintre backticks: acolo ghilimeaua
            // românească e nevinovată. Ce rămâne e cod cu ghilimele
            // drepte — iar acolo „…" taie șirul în două.
            const faraSabloane = l.replace(/`[^`]*`/g, "``");
            return /"[^"]*„/.test(faraSabloane);
          },
        );
      check(`${f}: fără ghilimele românești în cod`, rau.length === 0, rau[0]?.trim().slice(0, 60));
    }
  }

  // ── Ce am scos, fiindcă era din capul meu ──
  {
    const osm = citeste("src/modules/prospects/osm-import.ts");
    check("lista fixa de judete Moldova e scoasa", !/MOLDOVA\s*=/.test(osm));
    check("județele vecine se CALCULEAZĂ", osm.includes("judeteVecine"));
    check("...din mijlocul geografic al județelor", osm.includes("AVG(lat)"));
    const cart = citeste("src/modules/zone/cartiere.ts");
    check("raza inventată de 30 km e scoasă", !/km:\s*30/.test(cart));
    check("nu mai e nicio listă de sate scrisă de mine", !cart.includes("DORNA CANDRENILOR"));
    check("cartierele Botoșaniului (inventate) sunt scoase", !cart.includes('"BOTOSANI"'));
    check("Vatra (nume de sat!) nu mai e cartier", !/\bvatra:/.test(cart));
    check("scrie de ce nu ghicim zonele", cart.includes("PARE_ZONA"));
  }

  // ── Nicio scriere de date fără pază ──
  {
    const fisiere = [
      "src/modules/prospects/harta-aplica.ts",
      "src/modules/prospects/osm-import.ts",
      "src/app/api/prospects/pin/route.ts",
      "src/app/api/prospects/pins/route.ts",
      "src/app/api/agentie/harta-import/route.ts",
      "src/app/api/agentie/balances/route.ts",
    ];
    for (const f of fisiere) {
      const t = citeste(f);
      const bucati = t.split(/INSERT INTO geo_firme|UPDATE prospects/).slice(1);
      const fara = bucati.filter(
        (b) => !/assigned_agent|sursa NOT IN|org_id/.test(b.slice(0, 1400)),
      );
      check(`${f}: toate scrierile au pază`, fara.length === 0, `${fara.length} fără`);
    }
    const bal = citeste("src/app/api/agentie/balances/route.ts");
    check("soldurile se scriu DOAR pe clienții agenției", bal.includes("agentiiNostri"));
    const pins = citeste("src/app/api/prospects/pins/route.ts");
    check(
      "geocoderul nu poate acoperi pinul agentului",
      pins.includes("sursa NOT IN ('deget', 'gps')"),
    );
    check("și își scrie sursa, ca să se știe ce e", pins.includes("'geocod'"));
  }

  // ── Regulile scrise, ca să nu se piardă ──
  {
    const h = citeste("src/modules/prospects/harta-aplica.ts");
    check("CUI-ul din pin bate numele", h.includes("CUI-ul din pin bate orice"));
    check("ce a pus agentul nu se atinge", h.includes("NU se atinge niciodată"));
    check("ce e deja la locul lui nu se rescrie", h.includes("acelasiLoc"));
    check("cifra de control la CUI, înainte de registru", h.includes("cuiValid"));
    check("firmă existentă: DO NOTHING", h.includes("ON CONFLICT (cui) DO NOTHING"));
  }

  // ── Fără scurtături urâte ──
  {
    const noi = [
      "src/modules/prospects/harta-aplica.ts",
      "src/modules/prospects/cui.ts",
      "src/modules/zone/aplica.ts",
      "src/modules/platform/fapte-pentru-suport.ts",
      "src/lib/dictare.ts",
      "src/components/CautaSat.tsx",
    ];
    for (const f of noi) {
      const t = citeste(f);
      check(`${f}: fara any`, !/:\s*any\b|as any/.test(t));
      check(`${f}: fără catch gol`, !/catch\s*\{\s*\}/.test(t));
      check(`${f}: e explicat, nu doar scris`, (t.match(/\/\*\*/g) ?? []).length >= 2);
    }
  }

  // ── Tabelele noi au index și cheie ──
  {
    const db = citeste("src/lib/db.ts");
    check("zona_alias are cheie primară", /zona_alias[\s\S]{0,900}PRIMARY KEY/.test(db));
    check("zona_alias are index de căutare", db.includes("zona_alias_org"));
    check("osm_sweep are coadă indexată", db.includes("osm_sweep_coada"));
    check("magazinele au index pe CUI", db.includes("magazin_harta_cui"));
    check("adresa de livrare stă pe coloana ei", db.includes("adresa_livrare"));
    check("se știe cine a pus pinul", db.includes("pus_de"));
    check("problemele au fel (întrebare/problemă)", /issues[\s\S]{0,600}fel TEXT/.test(db));
  }

  // ── Suportul nu mai poate inventa ──
  {
    const g = citeste("src/modules/platform/ce-are-aplicatia.ts");
    for (const buton of [
      "Pune locul",
      "Sunt aici acum",
      "Pornește ruta de azi",
      "Adu locațiile",
      "Magazine",
      "Navighează",
    ]) {
      check(`ghidul pomeneste butonul real: ${buton}`, g.includes(buton));
    }
    check("și spune limpede CE NU EXISTĂ", g.includes("CE NU EXISTĂ"));
    for (const inventat of ["Salvează locația curentă", "Setează GPS aici"]) {
      check(`butonul inventat (${inventat}) e trecut la ce NU exista`, g.includes(inventat));
    }
    const iss = citeste("src/app/api/issues/route.ts");
    check("triajul primește ghidul aplicației", iss.includes("CE_ARE_APLICATIA"));
    check("...și faptele din datele lor", iss.includes("fapteDinDate"));
    check("i se interzice să inventeze", iss.includes("NU INVENTA"));
    check("clasifică întrebare/problemă", iss.includes('"problema" : "intrebare"'));
    check("poza se criptează", iss.includes("encryptData"));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Date de probă pentru trecerile 2 și 3
// ─────────────────────────────────────────────────────────────────────
const RUN = `az${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgId = `org-${RUN}`;
const agentId = `ag-${RUN}`;
const numeAgent = `Agent Azi ${RUN}`;
const SAT = `AZISAT ${SUS}`;
const baza = Date.now().toString().slice(-7);
const cuiClient = `41${baza}1`;
const CENTRU: [number, number] = [47.7411, 26.6622];
let token = "";

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, ${"AZI " + SUS}, ${RUN + "@azi.test"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"aza-" + RUN}, ${orgId}, ${agentId}, ${numeAgent})`;
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
            VALUES (${cuiClient}, ${"CLIENTUL MEU " + SUS}, 'Str. Test 1', ${SAT}, 'IS',
                    '4711', 'client', ${numeAgent}, TRUE)`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('IS', ${SAT}, ${CENTRU[0]}, ${CENTRU[1]}, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
  // Un magazin AL CLIENTULUI (verde) și unul de prospectat (mov).
  await sql`INSERT INTO magazin_harta (id, org_id, nume, cui, lat, lng, strat)
            VALUES (${orgId + ":mc"}, ${orgId}, ${"MAGAZINUL CLIENTULUI " + SUS},
                    ${cuiClient}, ${CENTRU[0] + 0.001}, ${CENTRU[1] + 0.001}, 'harta')`;
  await sql`INSERT INTO magazin_harta (id, org_id, nume, cui, lat, lng, strat)
            VALUES (${orgId + ":mp"}, ${orgId}, ${"DE PROSPECTAT " + SUS},
                    '', ${CENTRU[0] + 0.002}, ${CENTRU[1] + 0.002}, 'OpenStreetMap')`;
  token = await signToken(
    { agentId, agentName: numeAgent, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
}

async function curata() {
  await sql`DELETE FROM zona_alias WHERE org_id = ${orgId}`;
  await sql`DELETE FROM agent_zone WHERE org_id = ${orgId}`;
  await sql`DELETE FROM magazin_harta WHERE org_id = ${orgId}`;
  await sql`DELETE FROM issues WHERE org_id = ${orgId}`;
  await sql`DELETE FROM geo_firme WHERE cui = ${cuiClient}`;
  await sql`DELETE FROM prospects WHERE cui = ${cuiClient}`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id = ${orgId}`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
}

// ─────────────────────────────────────────────────────────────────────
// 3. CA AGENT DE TEREN (API adevărat)
// ─────────────────────────────────────────────────────────────────────
async function caAgent() {
  sectiune("3. CA AGENT DE TEREN, pe API-ul adevărat");

  const magazine = async () => {
    const r = await fetch(
      `${BASE}/api/prospects/magazine-harta?token=${encodeURIComponent(token)}`,
    );
    return (await r.json()) as {
      magazine?: Array<{ id: string; nume: string; eAlClientului?: boolean; firma?: string }>;
    };
  };

  // ── Ce vede pe hartă ──
  {
    const d = await magazine();
    const m = d.magazine ?? [];
    check("își vede magazinele", m.length === 2, `sunt ${m.length}`);
    const alClientului = m.find((x) => x.eAlClientului);
    check("unul e al clientului lui", alClientului !== undefined);
    check("și scrie a cui e", (alClientului?.firma ?? "").includes("CLIENTUL MEU"), alClientului?.firma);
    check("celălalt rămâne de prospectat", m.filter((x) => !x.eAlClientului).length === 1);
  }

  // ── Adaugă un magazin de pe teren ──
  const adauga = async (a: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/api/prospects/magazine-harta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, adauga: a }),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  {
    const r = await adauga({
      nume: `LUNCA BAR ${SUS}`,
      cui: cuiClient,
      lat: CENTRU[0] + 0.003,
      lng: CENTRU[1] + 0.003,
    });
    check("poate adăuga un magazin de pe teren", r.status < 300, String(r.status));
    check("și l-a legat de firma clientului", r.body.cui === cuiClient, String(r.body.cui));
    const d = await magazine();
    check("apare imediat pe hartă", (d.magazine ?? []).some((x) => x.nume.includes("LUNCA BAR")));
    check(
      "acum are două magazine ale clientului",
      (d.magazine ?? []).filter((x) => x.eAlClientului).length === 2,
    );
  }
  {
    const r = await adauga({ nume: "IN AFRICA", lat: -1.2, lng: 36.8 });
    check("un loc din afara României e respins", r.status === 400, String(r.status));
    const r2 = await adauga({ nume: "X", lat: CENTRU[0], lng: CENTRU[1] });
    check("un nume de o literă e respins", r2.status === 400, String(r2.status));
    const r3 = await fetch(`${BASE}/api/prospects/magazine-harta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "stricat", adauga: { nume: "ORICE", lat: 47, lng: 26 } }),
    });
    check("fără token bun, nimic", r3.status === 401, String(r3.status));
  }
  {
    // Două apăsări nervoase pe același loc.
    await adauga({ nume: `DE DOUA ORI ${SUS}`, lat: CENTRU[0] + 0.004, lng: CENTRU[1] + 0.004 });
    await adauga({ nume: `DE DOUA ORI ${SUS}`, lat: CENTRU[0] + 0.004, lng: CENTRU[1] + 0.004 });
    const d = await magazine();
    check(
      "două apăsări = un magazin",
      (d.magazine ?? []).filter((x) => x.nume.includes("DE DOUA ORI")).length === 1,
    );
  }

  // ── Confirmă un magazin ──
  {
    const r = await fetch(`${BASE}/api/prospects/magazine-harta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, id: `${orgId}:mp`, stare: "inchis" }),
    });
    check("poate tăia un magazin închis", r.status < 300, String(r.status));
    const d = await magazine();
    check(
      "cel tăiat nu mai vine la nimeni",
      !(d.magazine ?? []).some((x) => x.nume.includes("DE PROSPECTAT")),
    );
  }

  // ── Zonele lui, de pe WhatsApp ──
  const zona = async (body: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/api/routes/zona`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    });
    return (await r.json()) as {
      gasite?: Array<{ zi: string; localitate: string; cum?: string }>;
      negasite?: Array<{ scris: string; zona?: boolean }>;
      localitati?: string[];
      salvate?: number;
    };
  };
  {
    const text = [
      `[18:04, 26.08.2026] +40 749 714 955: LUNI`,
      "",
      SAT,
      "Țara Dornelor (toate locațiile)",
    ].join("\n");
    const d = await zona({ text, verificaDoar: true });
    check(
      "antetul de WhatsApp nu mai intră ca localitate",
      !(d.negasite ?? []).some((x) => x.scris.includes("749")),
      JSON.stringify(d.negasite),
    );
    check("satul lui e recunoscut", (d.gasite ?? []).some((g) => g.localitate === SAT));
    check("și e pus la LUNI", (d.gasite ?? []).some((g) => g.zi === "luni"));
    const tara = (d.negasite ?? []).find((x) => x.scris.startsWith("Țara Dornelor"));
    check("Tara Dornelor e semnalata ca ZONA", tara?.zona === true, JSON.stringify(tara));
    check(
      "și NU i-am inventat niciun sat",
      !(d.gasite ?? []).some((g) => g.localitate.toUpperCase().includes("DORNA")),
    );
  }
  {
    const d = await zona({ cauta: SAT.slice(0, 5) });
    check("căutarea de sate merge", (d.localitati ?? []).some((l) => l === SAT), JSON.stringify(d.localitati));
    const gol = await zona({ cauta: "x" });
    check("sub două litere nu caută", (gol.localitati ?? []).length === 0);
  }
  {
    // Alege un sat pentru ceva nerecunoscut — și ÎNVAȚĂ.
    await zona({
      text: `Marti\nCartierul Meu`,
      alese: [{ zi: "marti", localitate: SAT, pentru: "Cartierul Meu" }],
    });
    const inv = await sql<Array<{ localitate: string }>>`
      SELECT localitate FROM zona_alias
      WHERE org_id = ${orgId} AND scris = 'cartierul meu'
    `;
    check("a învățat alegerea lui", inv.length === 1 && inv[0].localitate === SAT, JSON.stringify(inv));
    const d2 = await zona({ text: `Marti\nCartierul Meu`, verificaDoar: true });
    check(
      "a doua oară merge singur",
      (d2.gasite ?? []).some((g) => g.localitate === SAT),
      JSON.stringify(d2),
    );
    check(
      "și-i spune că a ales el",
      ((d2.gasite ?? []).find((g) => g.localitate === SAT)?.cum ?? "").includes("ați ales"),
    );
  }
  {
    // Un sat care nu e în listele noastre: îl ia cum l-a scris.
    const d = await zona({
      text: "Joi\nUn sat fara firme",
      alese: [{ zi: "joi", localitate: `SAT NOU ${SUS}`, pentru: "Un sat fara firme" }],
    });
    check("un sat necunoscut se salvează cum l-a scris", (d.salvate ?? 0) >= 1, JSON.stringify(d));
    const z = await sql<Array<{ localitate: string }>>`
      SELECT localitate FROM agent_zone WHERE org_id = ${orgId} AND zi = 'joi'
    `;
    check("și chiar e în zona lui", z.some((x) => x.localitate.includes("SAT NOU")), JSON.stringify(z));
  }

  // ── Izolare: alt agent nu vede nimic de-al lui ──
  {
    const strain = await signToken(
      { agentId: "ag-strain-azi", agentName: "Strain Azi", exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    );
    const r = await fetch(
      `${BASE}/api/prospects/magazine-harta?token=${encodeURIComponent(strain)}`,
    );
    const d = (await r.json()) as { magazine?: unknown[] };
    check("un agent străin nu vede magazinele noastre", (d.magazine ?? []).length === 0);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. CA OM CARE SE UITĂ LA ECRAN
// ─────────────────────────────────────────────────────────────────────
const ECRANE = [
  { nume: "telefon mic + font mare", lat: 320, font: "22px", mobil: true },
  { nume: "telefon obișnuit", lat: 393, font: "16px", mobil: true },
  { nume: "calculator", lat: 1280, font: "16px", mobil: false },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

async function iese(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
async function butoaneMici(page: Page, mobil: boolean): Promise<string[]> {
  return page.evaluate((m: boolean) => {
    const out: string[] = [];
    const minim = m ? 30 : 22;
    for (const el of Array.from(document.querySelectorAll("button"))) {
      const e = el as HTMLElement;
      if (e.offsetParent === null) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < minim) {
        // Un buton cu iconiță n-are text: fără eticheta lui sau clasa lui
        // nu-l poate găsi nimeni în cod. Spunem tot ce știm despre el.
        const nume =
          (e.textContent ?? "").trim() ||
          e.getAttribute("aria-label") ||
          e.getAttribute("title") ||
          `«${(e.className || "").toString().slice(0, 60)}»`;
        out.push(`${nume} ${Math.round(r.height)}px`);
      }
    }
    return out.slice(0, 3);
  }, mobil);
}

async function caDesigner() {
  sectiune("2. CA OM CARE SE UITĂ LA ECRAN");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = (await import(PW)) as any;
  const chromium = pw.chromium ?? pw.default?.chromium;
  const b = await chromium.launch({ executablePath: CHROME });
  try {
    for (const ecran of ECRANE) {
      const ctx = await b.newContext({
        viewport: { width: ecran.lat, height: 780 },
        isMobile: ecran.mobil,
        hasTouch: ecran.mobil,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      const erori: string[] = [];
      page.on("pageerror", (e: Error) => erori.push(String(e.message).slice(0, 120)));
      page.on(
        "console",
        (m: { type: () => string; text: () => string; location: () => { url?: string } }) => {
          if (m.type() !== "error") return;
          const t = m.text();
          // Dalele de hartă și favicon-ul vin de pe alt server: dacă n-au
          // semnal, nu e vina aplicației noastre.
          const dinAfara = !(m.location()?.url ?? "").startsWith(BASE);
          if (dinAfara && /Failed to load resource|net::ERR_/i.test(t)) return;
          if (/favicon|tile\.openstreetmap/i.test(t)) return;
          erori.push(t.slice(0, 120));
        },
      );
      await page.goto(`${BASE}/a/${token}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(3200);
      // Fontul se mărește DUPĂ ce pagina există: la `addInitScript` nu e
      // încă niciun `documentElement` de care să te atingi.
      await page.evaluate((f: string) => {
        document.documentElement.style.fontSize = f;
      }, ecran.font);
      await page.waitForTimeout(400);
      // Dacă linkul cere PIN, îl dăm — altfel nu vedem nimic din panou.
      const pinuri = page.locator('input[type="password"], input[inputmode="numeric"]');
      if ((await pinuri.count()) > 0) {
        await pinuri.nth(0).fill("5150");
        if ((await pinuri.count()) >= 2) await pinuri.nth(1).fill("5150");
        await page.locator("button[type=submit]").first().click().catch(() => {});
        await page.waitForTimeout(3500);
        erori.length = 0;
      }
      const N = ecran.nume;

      check(`[${N}] panoul agentului se deschide`, (await page.locator("body").innerText()).length > 60);
      check(`[${N}] nimic nu iese din ecran`, (await iese(page)) <= 1, `${await iese(page)}px`);

      // Drumul până la hartă, exact ca al agentului: meniul din colț →
      // „Harta pieței" → alege județul. Fără județ, harta n-are ce
      // magazine să încarce: le cere pe cele din chenarul de pe ecran.
      await page.locator("header button").first().click().catch(() => {});
      await page.waitForTimeout(600);
      await page
        .locator("button, a")
        .filter({ hasText: "Harta pieței" })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(4000);
      const alegJudet = page.locator("select").first();
      if ((await alegJudet.count()) > 0) {
        await alegJudet.selectOption("IS").catch(() => {});
        await page.waitForTimeout(3500);
      }
      const btnMag = page.locator("button", { hasText: "Magazine" }).first();
      const areBtn = (await btnMag.count()) > 0;
      check(
        `[${N}] butonul de magazine există`,
        areBtn,
        areBtn ? "" : (await page.evaluate(() => document.body.innerText)).slice(0, 140).replace(/\s+/g, " "),
      );
      if ((await btnMag.count()) > 0) {
        const txt = await btnMag.innerText();
        check(
          `[${N}] spune câte sunt ale clienților`,
          /ale clienților/.test(txt) || /de prospectat/.test(txt),
          txt.slice(0, 50),
        );
        await btnMag.click();
        await page.waitForTimeout(1200);
        check(`[${N}] harta nu iese din ecran după apăsare`, (await iese(page)) <= 1);
      }
      check(`[${N}] butoanele sunt cât degetul`, (await butoaneMici(page, ecran.mobil)).length === 0,
            (await butoaneMici(page, ecran.mobil)).join(" · "));
      check(`[${N}] zero erori JavaScript`, erori.length === 0, erori[0]);
      await ctx.close();
    }
  } finally {
    await b.close();
  }
}

async function main() {
  caCodeReview();
  await pregateste();
  try {
    await caDesigner();
    await caAgent();
  } finally {
    await curata();
  }
  console.log(`\n${"═".repeat(52)}`);
  console.log(`${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  if (rele.length > 0) {
    console.log("\nCe nu merge:");
    for (const r of rele) console.log(`  · ${r}`);
  }
  await sql.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await sql.end();
  process.exit(1);
});
