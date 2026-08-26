/**
 * SATELE PE CARE HARTA NU LE ȘTIE — nu mai dispar în tăcere.
 *
 * „în Păltiniș Centru am 3 locații, nu găsesc nici măcar unu pe hartă"
 * (Costin Vlad, 26.08). Un sat pe care OpenStreetMap nu-l recunoaște era
 * marcat `failed` și NU mai apărea niciodată — cu tot cu clienții
 * agentului din el. Suita verifică cele două plase de siguranță:
 *
 *   1. dacă agenții au pus pini pe magazinele din satul ăla, satul își ia
 *      poziția DE LA EI — mai bună decât orice geocodare;
 *   2. dacă tot n-are poziție, satul e RAPORTAT pe nume („faraLoc"), ca
 *      agentul să-l deschidă din listă și să pună el locurile.
 *
 * Plus ce nu are voie să se strice: izolarea între agenții și faptul că
 * satele care aveau deja poziție rămân neatinse.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... npx tsx scripts/test-sate-fara-loc.ts
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

const RUN = `fl${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgMea = `org-${RUN}`;
const orgAlta = `orgx-${RUN}`;
const idEu = `ag-${RUN}-eu`;
const idStrain = `ag-${RUN}-strain`;
const numeEu = `FL Eu ${RUN}`;
const numeStrain = `FL Strain ${RUN}`;
const baza = Date.now().toString().slice(-7);
const cui = (i: number) => `44${baza}${i}`;

/** Satul pe care harta nu-l știe — cazul „Păltiniș Centru". */
const SAT_NECUNOSCUT = `FLSAT NESTIUT ${SUS}`;
/** Satul cu poziție bună, ca să vedem că nu stricăm ce mergea. */
const SAT_STIUT = `FLSAT STIUT ${SUS}`;
/** Satul necunoscut ȘI fără niciun pin — rămâne pe lista de raportat. */
const SAT_ORB = `FLSAT ORB ${SUS}`;

const PIN_A: [number, number] = [47.8123, 26.4501];
const PIN_B: [number, number] = [47.8127, 26.4509];

interface Bula {
  localitate: string;
  lat: number | null;
  lng: number | null;
  clienti: number;
  count: number;
}
interface Raspuns {
  localities?: Bula[];
  faraLoc?: Array<{ localitate: string; count: number; clienti: number }>;
}

async function pregateste() {
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgMea}, ${"FL MEA " + SUS}, ${RUN + "@fl.test"}, 'trial', 5),
                   (${orgAlta}, ${"FL ALTA " + SUS}, ${RUN + "x@fl.test"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"fla-" + RUN}, ${orgMea}, ${idEu}, ${numeEu}),
                   (${"flb-" + RUN}, ${orgAlta}, ${idStrain}, ${numeStrain})`;

  const firme: Array<[number, string, string]> = [
    [0, `MAGAZIN NESTIUT UNU ${SUS}`, SAT_NECUNOSCUT],
    [1, `MAGAZIN NESTIUT DOI ${SUS}`, SAT_NECUNOSCUT],
    [2, `MAGAZIN NESTIUT TREI ${SUS}`, SAT_NECUNOSCUT],
    [3, `MAGAZIN STIUT ${SUS}`, SAT_STIUT],
    [4, `MAGAZIN ORB UNU ${SUS}`, SAT_ORB],
    [5, `MAGAZIN ORB DOI ${SUS}`, SAT_ORB],
  ];
  for (const [i, den, sat] of firme) {
    await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
      VALUES (${cui(i)}, ${den}, ${"Str. Test " + i}, ${sat}, 'BT', '4711',
              'client', ${numeEu}, TRUE)`;
  }
  // Satul „știut" are deja poziție; celelalte două sunt marcate ca
  // negăsite de hartă — exact starea în care ajunsese Păltiniș Centru.
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('BT', ${SAT_STIUT}, 47.7000, 26.6000, FALSE),
                   ('BT', ${SAT_NECUNOSCUT}, NULL, NULL, TRUE),
                   ('BT', ${SAT_ORB}, NULL, NULL, TRUE)
            ON CONFLICT (judet, localitate) DO UPDATE SET
              lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = EXCLUDED.failed`;
}

async function curata() {
  const cuis = Array.from({ length: 6 }, (_, i) => cui(i));
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuis})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuis})`;
  await sql`DELETE FROM geo_localitati WHERE localitate IN (${SAT_NECUNOSCUT}, ${SAT_STIUT}, ${SAT_ORB})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgMea}, ${orgAlta})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgMea}, ${orgAlta})`;
}

async function main() {
  console.log(`\nSATE FĂRĂ LOC PE HARTĂ — rulare ${RUN}`);
  await pregateste();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokEu = await signToken({ agentId: idEu, agentName: numeEu, exp }, SECRET);
  const tokStrain = await signToken(
    { agentId: idStrain, agentName: numeStrain, exp },
    SECRET,
  );

  // geocode=0: nu chemăm Nominatim în teste — ne interesează plasele
  // noastre de siguranță, nu rețeaua.
  const harta = async (t: string): Promise<Raspuns> => {
    const r = await fetch(`${BASE}/api/prospects/geo?token=${t}&judet=BT&geocode=0`);
    return (await r.json()) as Raspuns;
  };
  const bula = (d: Raspuns, sat: string) =>
    (d.localities ?? []).find((b) => b.localitate === sat);

  try {
    sectiune("Înainte: satul necunoscut chiar lipsește de pe hartă");
    const inainte = await harta(tokEu);
    check("satul știut are bulă", !!bula(inainte, SAT_STIUT)?.lat);
    const nest = bula(inainte, SAT_NECUNOSCUT);
    check("satul necunoscut apare în listă, dar fără poziție", !!nest && nest.lat === null);
    check(
      "…și e RAPORTAT pe nume, nu ascuns în tăcere",
      (inainte.faraLoc ?? []).some((f) => f.localitate === SAT_NECUNOSCUT),
      JSON.stringify(inainte.faraLoc),
    );
    const rap = (inainte.faraLoc ?? []).find((f) => f.localitate === SAT_NECUNOSCUT);
    check("…cu numărul de firme din el", rap?.count === 3, `count=${rap?.count}`);
    check("…și cu câți clienți de-ai mei sunt acolo", rap?.clienti === 3, `clienti=${rap?.clienti}`);
    check(
      "satul orb e și el raportat",
      (inainte.faraLoc ?? []).some((f) => f.localitate === SAT_ORB),
    );
    check(
      "satul cu poziție NU apare printre cele fără loc",
      !(inainte.faraLoc ?? []).some((f) => f.localitate === SAT_STIUT),
    );

    sectiune("Agentul pune pini pe două magazine din satul necunoscut");
    for (const [c, p] of [
      [cui(0), PIN_A],
      [cui(1), PIN_B],
    ] as const) {
      const r = await fetch(`${BASE}/api/prospects/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokEu, cui: c, lat: p[0], lng: p[1], sursa: "deget" }),
      });
      check(`pinul pe ${c} se salvează`, r.status === 200, `status ${r.status}`);
    }

    sectiune("Satul își ia poziția DE LA PINII agenților");
    const dupa = await harta(tokEu);
    const acum = bula(dupa, SAT_NECUNOSCUT);
    check("satul are acum poziție pe hartă", acum?.lat != null, `lat=${acum?.lat}`);
    const mij = (PIN_A[0] + PIN_B[0]) / 2;
    check(
      "…exact la mijlocul magazinelor puse de agent",
      Math.abs((acum?.lat ?? 0) - mij) < 0.0005,
      `${acum?.lat} vs ${mij}`,
    );
    check(
      "…și nu mai e pe lista celor fără loc",
      !(dupa.faraLoc ?? []).some((f) => f.localitate === SAT_NECUNOSCUT),
      JSON.stringify(dupa.faraLoc),
    );
    check(
      "satul orb, fără niciun pin, rămâne raportat",
      (dupa.faraLoc ?? []).some((f) => f.localitate === SAT_ORB),
    );
    check("satul știut a rămas neatins", bula(dupa, SAT_STIUT)?.lat === 47.7, `${bula(dupa, SAT_STIUT)?.lat}`);

    sectiune("Poziția rămâne salvată, nu se recalculează la fiecare cerere");
    const [salvat] = await sql<Array<{ lat: number; failed: boolean }>>`
      SELECT lat, failed FROM geo_localitati
      WHERE judet = 'BT' AND localitate = ${SAT_NECUNOSCUT}`;
    check("s-a scris în cache-ul de localități", salvat?.lat != null, `${salvat?.lat}`);
    check("…și nu mai e marcat «negăsit»", salvat?.failed === false);

    sectiune("Izolare: pinii mei nu mută satele altei agenții");
    const alLor = await harta(tokStrain);
    const laEi = bula(alLor, SAT_NECUNOSCUT);
    // Poziția localității e comună (e o localitate reală, nu date de firmă),
    // dar NUMĂRUL DE CLIENȚI trebuie să fie al lor, adică zero.
    check("firma vecină vede satul pe hartă (localitatea e a tuturor)", laEi?.lat != null);
    check("…dar cu 0 clienți de-ai ei", (laEi?.clienti ?? -1) === 0, `clienti=${laEi?.clienti}`);

    sectiune("Nu crapă când nu e nimic de făcut");
    const gol = await fetch(`${BASE}/api/prospects/geo?token=${tokEu}&judet=CJ&geocode=0`);
    const dGol = (await gol.json()) as Raspuns;
    check("un județ fără firme răspunde curat", gol.status === 200, `status ${gol.status}`);
    check("…cu listă goală, nu eroare", (dGol.localities ?? []).length === 0);
    check("…și fără sate raportate", (dGol.faraLoc ?? []).length === 0);
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
