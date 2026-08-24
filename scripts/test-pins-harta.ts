/**
 * CLIENȚII CA PUNCTE PE HARTĂ (cererea lui Bogdan).
 *
 * Agentul trebuie să vadă fiecare client ca punct, ca să știe cine e vecin
 * cu cine și să nu umble aiurea pe drum. Suita verifică: primește DOAR
 * clienții LUI (nu ai colegilor, nu ai altei firme), fiecare cu
 * coordonate, cele fără adresă găsită cad pe centrul localității marcate
 * „aprox" și NU se suprapun, iar filtrul pe localitate funcționează.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 DATABASE_URL=... TOKEN_SECRET=... \
 *   npx tsx scripts/test-pins-harta.ts
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
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

interface Pin {
  cui: string;
  denumire: string;
  lat: number;
  lng: number;
  aprox: boolean;
  telefon: string;
}

async function main() {
  const RUN = `pin${Date.now().toString(36).slice(-6)}`;
  const orgId = `org-${RUN}`;
  const idA = `ag-${RUN}-a`;
  const idB = `ag-${RUN}-b`;
  const numeA = `Agent Pin A ${RUN}`;
  const numeB = `Agent Pin B ${RUN}`;
  const cuiuri = [1, 2, 3, 4].map((i) => `77${RUN.replace(/\D/g, "").slice(-6)}${i}`.slice(0, 12));

  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, 'PIN TEST SRL', ${RUN + "@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN + "-a"}, ${orgId}, ${idA}, ${numeA}),
                   (${"agt-" + RUN + "-b"}, ${orgId}, ${idB}, ${numeB})`;

  // 3 clienți ai lui A (2 în Rădăuți, 1 în Suceava) + 1 al lui B
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, status, assigned_agent, telefon)
            VALUES
              (${cuiuri[0]}, ${"PIN MAGAZIN UNU " + RUN}, 'Str. Principala 1', 'RADAUTI', 'SV', 'client', ${numeA}, '0740111222'),
              (${cuiuri[1]}, ${"PIN MAGAZIN DOI " + RUN}, 'Str. Principala 2', 'RADAUTI', 'SV', 'client', ${numeA}, ''),
              (${cuiuri[2]}, ${"PIN BAR TREI " + RUN}, '', 'SUCEAVA', 'SV', 'client', ${numeA}, ''),
              (${cuiuri[3]}, ${"PIN AL COLEGULUI " + RUN}, '', 'RADAUTI', 'SV', 'client', ${numeB}, '')`;
  // centrul localităților (ca și cum ar fi fost geocodate deja)
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', 'RADAUTI', 47.845, 25.918, FALSE),
                   ('SV', 'SUCEAVA', 47.651, 26.255, FALSE)
            ON CONFLICT (judet, localitate) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, failed = FALSE`;

  const tokA = await signToken(
    { agentId: idA, agentName: numeA, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  const tokB = await signToken(
    { agentId: idB, agentName: numeB, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );

  const pinsFor = async (tok: string, extra = "") => {
    const r = await fetch(`${BASE}/api/prospects/pins?token=${encodeURIComponent(tok)}&judet=SV${extra}`);
    const d = (await r.json()) as { pins?: Pin[]; total?: number; aproximative?: number };
    return { status: r.status, pins: d.pins ?? [], total: d.total ?? 0, aprox: d.aproximative ?? 0 };
  };

  console.log("══ Agentul își vede clienții ca puncte ══");
  const a = await pinsFor(tokA);
  check("răspunde 200", a.status === 200);
  check("A are 3 puncte (clienții lui)", a.pins.length === 3, `${a.pins.length}`);
  check(
    "fiecare punct are coordonate reale",
    a.pins.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
  );
  check(
    "fiecare punct are numele firmei",
    a.pins.every((p) => p.denumire.includes("PIN")),
  );
  check(
    "telefonul vine la punct (pentru butonul Sună)",
    a.pins.some((p) => p.telefon === "0740111222"),
  );

  console.log("══ Punctele NU se suprapun (altfel nu poți apăsa pe ele) ══");
  const chei = new Set(a.pins.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`));
  check("toate punctele au poziții diferite", chei.size === a.pins.length, `${chei.size} din ${a.pins.length}`);
  const radauti = a.pins.filter((p) => p.denumire.includes("MAGAZIN"));
  check(
    "cei doi vecini din Rădăuți sunt aproape unul de altul (< 3 km)",
    radauti.length === 2 &&
      Math.abs(radauti[0].lat - radauti[1].lat) < 0.03 &&
      Math.abs(radauti[0].lng - radauti[1].lng) < 0.03,
    JSON.stringify(radauti.map((p) => [p.lat, p.lng])),
  );
  check("punctele fără adresă găsită sunt marcate „aproximativ\"", a.aprox >= 1, `${a.aprox}`);

  console.log("══ Izolare: nu vede clienții colegului ══");
  check(
    "A NU vede clientul lui B",
    !a.pins.some((p) => p.denumire.includes("AL COLEGULUI")),
    JSON.stringify(a.pins.map((p) => p.denumire)),
  );
  const b = await pinsFor(tokB);
  check("B vede doar clientul lui (1 punct)", b.pins.length === 1, `${b.pins.length}`);

  console.log("══ Filtrul pe localitate ══");
  const doarRadauti = await pinsFor(tokA, "&localitate=RADAUTI");
  check("filtrat pe Rădăuți → 2 puncte", doarRadauti.pins.length === 2, `${doarRadauti.pins.length}`);

  console.log("══ Fără token / token stricat ══");
  const faraToken = await fetch(`${BASE}/api/prospects/pins?judet=SV`);
  check("fără token → 401", faraToken.status === 401, `${faraToken.status}`);
  const tokRau = await fetch(`${BASE}/api/prospects/pins?token=gunoi&judet=SV`);
  check("token stricat → 401", tokRau.status === 401, `${tokRau.status}`);
  const faraJudet = await fetch(`${BASE}/api/prospects/pins?token=${encodeURIComponent(tokA)}`);
  check("fără județ → 400", faraJudet.status === 400, `${faraJudet.status}`);

  console.log("══ Curățenie ══");
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${cuiuri})`;
  await sql`DELETE FROM prospects WHERE cui = ANY(${cuiuri})`;
  await sql`DELETE FROM organizations WHERE id = ${orgId}`;
  await sql.end();

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
