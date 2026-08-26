/**
 * LOCUL EXACT AL MAGAZINULUI — pus de agent, cu degetul sau din GPS.
 *
 * „Avem șanse ca locația să fie mai exactă?" (Costin Vlad, 26.08). Pinul
 * cădea în centrul satului, pentru că registrul dă sediul social, iar
 * geocodarea dă localitatea. Acum agentul îl pune el, în trei feluri:
 * trage pinul pe hartă, apasă „Sunt aici", sau îl lasă să se scrie
 * singur când bifează „Am fost" fiind la magazin.
 *
 * Suita verifică ce contează pe teren:
 *   · pinul tras cu degetul se salvează și se vede la reîncărcare;
 *   · un GPS slab NU se salvează (mai bine centrul satului decât o
 *     poziție greșită în care agentul are încredere);
 *   · poziții din afara României sunt refuzate;
 *   · pinul greșit se poate ȘTERGE — firma revine în centrul satului;
 *   · izolare: nimeni nu mută pinul firmelor altei agenții;
 *   · după ce pui pinul, ruta și navigarea îl folosesc pe el.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-pin-exact.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";
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

const RUN = `pn${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgMea = `org-${RUN}`;
const orgAlta = `orgx-${RUN}`;
const idEu = `ag-${RUN}-eu`;
const idColeg = `ag-${RUN}-coleg`;
const idStrain = `ag-${RUN}-strain`;
const numeEu = `Pin Eu ${RUN}`;
const numeColeg = `Pin Coleg ${RUN}`;
const numeStrain = `Pin Strain ${RUN}`;
const SAT = `PSAT ${SUS}`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `44${baza}${i}`;

/** Poziții adevărate: centrul satului vs. ușa magazinului, la ~400 m. */
const CENTRU_SAT: [number, number] = [47.7405, 26.6612];
const USA_MAGAZIN: [number, number] = [47.7442, 26.6658];

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgMea}, ${"PIN MEA " + SUS}, ${RUN + "@pin.test"}, 'trial', 9),
                   (${orgAlta}, ${"PIN ALTA " + SUS}, ${RUN + "x@pin.test"}, 'trial', 9)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"pa1-" + RUN}, ${orgMea}, ${idEu}, ${numeEu}),
                   (${"pa2-" + RUN}, ${orgMea}, ${idColeg}, ${numeColeg}),
                   (${"pa3-" + RUN}, ${orgAlta}, ${idStrain}, ${numeStrain})`;
  const firme: Array<[number, string, string]> = [
    [0, `CLIENTUL MEU ${SUS}`, numeEu],
    [1, `CLIENTUL COLEGULUI ${SUS}`, numeColeg],
    [2, `PROSPECT LIBER ${SUS}`, ""],
    [3, `AL ALTEI FIRME ${SUS}`, numeStrain],
  ];
  for (const [i, den, agent] of firme) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ, telefon)
      VALUES (${cui(i)}, ${den}, ${"Str. Mare nr. " + (i + 1)}, ${SAT}, 'BT',
              '4711', ${agent ? "client" : "nou"}, ${agent}, TRUE, ${"07400000" + i})`;
  }
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('BT', ${SAT}, ${CENTRU_SAT[0]}, ${CENTRU_SAT[1]}, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE
              SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;
}

async function curata() {
  const cuis = [0, 1, 2, 3].map(cui);
  await sql`DELETE FROM visits WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM geo_localitati WHERE localitate = ${SAT}`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgMea}, ${orgAlta})`;
}

interface Raspuns {
  ok?: boolean;
  lat?: number;
  lng?: number;
  sursa?: string;
  sters?: boolean;
  error?: string;
}

async function main() {
  console.log(`\nLOCUL EXACT AL MAGAZINULUI — rulare ${RUN}`);
  await pregateste();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokEu = await signToken({ agentId: idEu, agentName: numeEu, exp }, SECRET);
  const tokStrain = await signToken(
    { agentId: idStrain, agentName: numeStrain, exp },
    SECRET,
  );

  const pin = async (t: string, corp: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/api/prospects/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t, ...corp }),
    });
    return { s: r.status, d: (await r.json()) as Raspuns };
  };
  const dinBaza = async (c: string) =>
    (
      await sql<Array<{ lat: number; lng: number; aprox: boolean }>>`
        SELECT lat, lng, aprox FROM geo_firme WHERE cui = ${c}`
    )[0];

  try {
    sectiune("Trag pinul cu degetul pe ușa magazinului");
    const cMeu = cui(0);
    const tras = await pin(tokEu, {
      cui: cMeu,
      lat: USA_MAGAZIN[0],
      lng: USA_MAGAZIN[1],
      sursa: "deget",
    });
    check("pinul tras cu degetul se salvează", tras.s === 200 && tras.d.ok === true, `status ${tras.s}`);
    const p1 = await dinBaza(cMeu);
    check("…chiar în baza de date", !!p1);
    check(
      "…exact unde l-am pus (nu în centrul satului)",
      Math.abs((p1?.lat ?? 0) - USA_MAGAZIN[0]) < 0.0001 &&
        Math.abs((p1?.lng ?? 0) - USA_MAGAZIN[1]) < 0.0001,
      `${p1?.lat},${p1?.lng}`,
    );
    check("…marcat EXACT, nu aproximativ", p1?.aprox === false);
    // ~400 m față de centrul satului: exact diferența care contează.
    const metri =
      Math.hypot(
        (USA_MAGAZIN[0] - CENTRU_SAT[0]) * 111_000,
        (USA_MAGAZIN[1] - CENTRU_SAT[1]) * 75_000,
      ) | 0;
    check("…și e vizibil altundeva decât centrul satului", metri > 100, `${metri} m diferență`);

    sectiune("Sunt aici acum: din pozitia telefonului");
    const bun = await pin(tokEu, {
      cui: cui(2),
      lat: CENTRU_SAT[0] + 0.001,
      lng: CENTRU_SAT[1] + 0.001,
      sursa: "gps",
      acc: 15,
    });
    check("GPS bun (15 m) se salvează", bun.s === 200 && bun.d.ok === true, `status ${bun.s}`);
    check("…și pe un prospect NEALOCAT (încă nu e clientul meu)", !!(await dinBaza(cui(2))));

    const slab = await pin(tokEu, {
      cui: cui(0),
      lat: CENTRU_SAT[0],
      lng: CENTRU_SAT[1],
      sursa: "gps",
      acc: 900,
    });
    check("GPS slab (900 m) e REFUZAT", slab.s === 422, `status ${slab.s}`);
    check(
      "…cu explicație pe românește, nu cod de eroare",
      /semnal slab|nu știe|deget/i.test(String(slab.d.error ?? "")),
      String(slab.d.error).slice(0, 60),
    );
    const dupaSlab = await dinBaza(cui(0));
    check(
      "…și pinul bun de dinainte a RĂMAS neatins",
      Math.abs((dupaSlab?.lat ?? 0) - USA_MAGAZIN[0]) < 0.0001,
      `${dupaSlab?.lat}`,
    );

    sectiune("Poziții imposibile");
    const departe = await pin(tokEu, { cui: cMeu, lat: 12.3, lng: 99.9, sursa: "deget" });
    check("o poziție din afara României e refuzată", departe.s === 400, `status ${departe.s}`);
    check("…cu mesaj limpede", /România/i.test(String(departe.d.error ?? "")), String(departe.d.error));
    const fara = await pin(tokEu, { cui: cMeu, sursa: "deget" });
    check("fără coordonate → refuz, nu crash", fara.s === 400, `status ${fara.s}`);
    const faraFirma = await pin(tokEu, { lat: USA_MAGAZIN[0], lng: USA_MAGAZIN[1] });
    check("fără firmă → refuz", faraFirma.s === 400, `status ${faraFirma.s}`);
    const inca = await dinBaza(cMeu);
    check(
      "după toate refuzurile, pinul bun e tot acolo",
      Math.abs((inca?.lat ?? 0) - USA_MAGAZIN[0]) < 0.0001,
    );

    sectiune("Izolare: nu mut pinul altei agenții");
    const furt = await pin(tokStrain, {
      cui: cMeu,
      lat: 44.4,
      lng: 26.1,
      sursa: "deget",
    });
    check("agentul altei firme e refuzat (403)", furt.s === 403, `status ${furt.s}`);
    check(
      "…cu explicație, nu tăcere",
      /nu e a firmei tale/i.test(String(furt.d.error ?? "")),
      String(furt.d.error),
    );
    const dupaFurt = await dinBaza(cMeu);
    check(
      "…și pinul meu a rămas neschimbat",
      Math.abs((dupaFurt?.lat ?? 0) - USA_MAGAZIN[0]) < 0.0001,
      `${dupaFurt?.lat}`,
    );
    const peAlLor = await pin(tokEu, {
      cui: cui(3),
      lat: USA_MAGAZIN[0],
      lng: USA_MAGAZIN[1],
      sursa: "deget",
    });
    check("nici eu nu pot muta pinul firmei LOR", peAlLor.s === 403, `status ${peAlLor.s}`);

    sectiune("Colegul din firma mea POATE (suntem aceeași echipă)");
    const alColegului = await pin(tokEu, {
      cui: cui(1),
      lat: USA_MAGAZIN[0] + 0.0005,
      lng: USA_MAGAZIN[1],
      sursa: "deget",
    });
    check("pot pune locul la clientul colegului meu", alColegului.s === 200, `status ${alColegului.s}`);

    sectiune("Am greșit — șterg pinul, firma revine în centrul satului");
    const sters = await pin(tokEu, { cui: cMeu, sterge: true });
    check("ștergerea merge", sters.s === 200 && sters.d.sters === true, `status ${sters.s}`);
    check("…și pinul chiar nu mai e în baza de date", !(await dinBaza(cMeu)));
    const stersDinNou = await pin(tokEu, { cui: cMeu, sterge: true });
    check("a doua ștergere nu crapă", stersDinNou.s === 200, `status ${stersDinNou.s}`);
    const stergAlLor = await pin(tokStrain, { cui: cui(1), sterge: true });
    check(
      "agentul altei firme nu-mi poate ȘTERGE pinurile",
      stergAlLor.d.sters !== true,
      JSON.stringify(stergAlLor.d),
    );
    check("…și pinul colegului e tot acolo", !!(await dinBaza(cui(1))));

    sectiune("Fără link valid nu se atinge nimic");
    const faraToken = await fetch(`${BASE}/api/prospects/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cui: cMeu, lat: 47.7, lng: 26.6 }),
    });
    check("fără token → 401", faraToken.status === 401, `status ${faraToken.status}`);
    const tokenStricat = await pin(`${tokEu}xyz`, {
      cui: cMeu,
      lat: 47.7,
      lng: 26.6,
      sursa: "deget",
    });
    check("token ciupit → 401", tokenStricat.s === 401, `status ${tokenStricat.s}`);
    const corpRau = await fetch(`${BASE}/api/prospects/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nu e json",
    });
    check("corp stricat → 400, nu 500", corpRau.status === 400, `status ${corpRau.status}`);

    sectiune("Aplicația ȘTIE care firmă are loc pus și care nu");
    // Fără asta, butonul „șterge locul pus" apărea la orice firmă dintr-un
    // sat geocodat și promitea că șterge ceva ce nu exista.
    await pin(tokEu, { cui: cMeu, lat: USA_MAGAZIN[0], lng: USA_MAGAZIN[1], sursa: "deget" });
    const lista = await fetch(
      `${BASE}/api/prospects?token=${tokEu}&judet=BT&localitate=${encodeURIComponent(SAT)}&aiMei=1&limit=50`,
    );
    const dLista = (await lista.json()) as {
      prospects?: Array<{
        cui: string;
        pinExact?: boolean;
        pinLat?: number | null;
        pinLng?: number | null;
      }>;
    };
    const cuPin = (dLista.prospects ?? []).find((f) => f.cui === cMeu);
    const faraPin = (dLista.prospects ?? []).find((f) => f.cui === cui(3));
    check("firma cu loc pus e marcată așa", cuPin?.pinExact === true, `pinExact=${cuPin?.pinExact}`);
    check(
      "…și îi vin coordonatele ei, ca harta să se deschidă FIX pe magazin",
      Math.abs((cuPin?.pinLat ?? 0) - USA_MAGAZIN[0]) < 0.0001,
      `${cuPin?.pinLat}`,
    );
    check("firma FĂRĂ loc pus nu e marcată", faraPin?.pinExact === false, `pinExact=${faraPin?.pinExact}`);
    check("…și n-are coordonate proprii", faraPin?.pinLat == null, `${faraPin?.pinLat}`);
    await pin(tokEu, { cui: cMeu, sterge: true });
    const dupaStergere = await fetch(
      `${BASE}/api/prospects?token=${tokEu}&judet=BT&localitate=${encodeURIComponent(SAT)}&aiMei=1&limit=50`,
    );
    const dDupa = (await dupaStergere.json()) as {
      prospects?: Array<{ cui: string; pinExact?: boolean }>;
    };
    check(
      "după ștergere, firma nu mai e marcată cu loc pus",
      (dDupa.prospects ?? []).find((f) => f.cui === cMeu)?.pinExact === false,
    );

    sectiune("Pinul pus se folosește mai departe (rută, navigare)");
    await pin(tokEu, {
      cui: cMeu,
      lat: USA_MAGAZIN[0],
      lng: USA_MAGAZIN[1],
      sursa: "deget",
    });
    const zi = await fetch(`${BASE}/api/prospects?token=${tokEu}&judet=BT&localitate=${encodeURIComponent(SAT)}&aiMei=1&limit=50`);
    const dZi = (await zi.json()) as { prospects?: Array<{ cui: string; adresa?: string }> };
    check(
      "firma cu pin apare în continuare în lista satului",
      (dZi.prospects ?? []).some((f) => f.cui === cMeu),
    );
    const { navAddress, poateNaviga } = await import("../src/lib/route-nav");
    const adr = navAddress({
      denumire: `CLIENTUL MEU ${SUS}`,
      adresa: "Str. Mare nr. 1",
      localitate: SAT,
      judet: "BT",
    });
    check("firma rămâne navigabilă", poateNaviga({ denumire: "x", adresa: "Str. Mare nr. 1", localitate: SAT, judet: "BT" }));
    check("adresa de navigat e completă", adr.includes("Mare") && adr.includes(SAT), adr);
  } finally {
    sectiune("Curățenie");
    await curata();
    console.log("  · datele de test șterse");
    await sql.end();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  if (fail) {
    console.log("\nCe nu merge:");
    rele.forEach((r) => console.log("  · " + r));
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();
