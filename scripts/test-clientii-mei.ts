/**
 * „UNDE SUNT RESTUL DE CLIENȚI?" (întrebarea agentului de teren, 25.08)
 *
 * Lista localității și bulele hărții filtrau pe domeniu (CAEN) și pe
 * „activ" — clienții reali ai agentului cu alt cod CAEN (sau marcați
 * inactiv în registrul MF) dispăreau. Suita verifică regula nouă:
 * CLIENȚII MEI apar MEREU, peste orice filtru de domeniu/stare:
 *   1. /api/prospects cu aiMei=1: clientul cu CAEN de IT apare în lista
 *      localității deși filtrul cere doar alimentare (4711);
 *   2. clientul inactiv în MF apare și el;
 *   3. fără aiMei, comportamentul vechi rămâne neschimbat;
 *   4. aiMei NU aduce clienții COLEGULUI, nici pe ai altei firme;
 *   5. /api/prospects/geo: localitatea în care am DOAR clienți (nicio
 *      firmă pe domeniul cerut) primește bulă, cu clienti > 0;
 *   6. izolare: agentul altei firme nu vede acești clienți nici cu aiMei.
 *
 * Rulare:
 *   BASE_URL=http://127.0.0.1:3131 DATABASE_URL=... TOKEN_SECRET=... \
 *   npx tsx scripts/test-clientii-mei.ts
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

interface Firm {
  cui: string;
  denumire: string;
  status: string;
  assignedAgent: string;
}
interface Loc {
  localitate: string;
  count: number;
  clienti: number;
}

async function main() {
  const RUN = `cm${Date.now().toString(36).slice(-6)}`;
  const orgId = `org-${RUN}`;
  const orgId2 = `org2-${RUN}`;
  const idA = `ag-${RUN}-a`;
  const idB = `ag-${RUN}-b`;
  const idC = `ag-${RUN}-c`;
  const numeA = `Agent CM A ${RUN}`;
  const numeB = `Agent CM B ${RUN}`;
  const numeC = `Agent CM C ${RUN}`;
  const baza = Date.now().toString().slice(-7);
  const cui = (i: number) => `88${baza}${i}`;
  const SAT = `SAT TEST ${RUN.toUpperCase()}`;
  const SAT_GOL = `SAT DOARCLIENTI ${RUN.toUpperCase()}`;

  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgId}, 'CM TEST SRL', ${RUN + "@test.ro"}, 'trial', 5),
                   (${orgId2}, 'CM STRAIN SRL', ${RUN + "2@test.ro"}, 'trial', 5)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"agt-" + RUN + "-a"}, ${orgId}, ${idA}, ${numeA}),
                   (${"agt-" + RUN + "-b"}, ${orgId}, ${idB}, ${numeB}),
                   (${"agt-" + RUN + "-c"}, ${orgId2}, ${idC}, ${numeC})`;

  // În SAT: o firmă pe domeniu (4711 activă), clientul MEU cu CAEN de IT
  // (6202) și INACTIV în MF, clientul COLEGULUI (4711) și al ALTEI firme.
  // În SAT_GOL: DOAR clientul meu (transport, 4941) — nimic pe domeniu.
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
            VALUES
    (${cui(1)}, ${"ALIMENTARA PE DOMENIU " + RUN}, 'Str. 1', ${SAT}, 'SV', '4711', 'nou', '', TRUE),
    (${cui(2)}, ${"CLIENTUL MEU IT INACTIV " + RUN}, 'Str. 2', ${SAT}, 'SV', '6202', 'client', ${numeA}, FALSE),
    (${cui(3)}, ${"CLIENTUL COLEGULUI " + RUN}, 'Str. 3', ${SAT}, 'SV', '4711', 'client', ${numeB}, TRUE),
    (${cui(4)}, ${"CLIENT FIRMA STRAINA " + RUN}, 'Str. 4', ${SAT}, 'SV', '6202', 'client', ${numeC}, TRUE),
    (${cui(5)}, ${"CLIENTUL MEU TRANSPORT " + RUN}, 'Str. 5', ${SAT_GOL}, 'SV', '4941', 'client', ${numeA}, TRUE)`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('SV', ${SAT}, 47.61, 26.21, FALSE), ('SV', ${SAT_GOL}, 47.62, 26.22, FALSE)
            ON CONFLICT (judet, localitate) DO NOTHING`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokA = await signToken({ agentId: idA, agentName: numeA, exp }, SECRET);
  const tokC = await signToken({ agentId: idC, agentName: numeC, exp }, SECRET);

  const lista = async (token: string, localitate: string, aiMei: boolean) => {
    const p = new URLSearchParams({
      token, judet: "SV", localitate, limit: "100",
      onlyActive: "1", caenIn: "4711,4719,4725,4726,5630",
    });
    if (aiMei) p.set("aiMei", "1");
    const r = await fetch(`${BASE}/api/prospects?${p}`);
    const d = (await r.json()) as { prospects?: Firm[] };
    return d.prospects ?? [];
  };

  console.log("\n══ Lista localității cu aiMei=1 (agentul A) ══");
  const cuAiMei = await lista(tokA, SAT, true);
  check(
    "firma pe domeniu e în listă (comportamentul vechi rămâne)",
    cuAiMei.some((f) => f.cui === cui(1)),
  );
  check(
    "clientul MEU cu CAEN de IT și inactiv în MF APARE (asta era paguba)",
    cuAiMei.some((f) => f.cui === cui(2) && f.status === "client"),
    JSON.stringify(cuAiMei.map((f) => f.denumire)),
  );
  check(
    "clientul COLEGULUI cu CAEN pe domeniu apare (era și înainte, activ+4711)",
    cuAiMei.some((f) => f.cui === cui(3)),
  );
  check(
    "clientul colegului cu alt CAEN NU e adus de aiMei (doar AI MEI)",
    !cuAiMei.some((f) => f.cui === cui(4) && f.status === "client"),
  );

  console.log("\n══ Fără aiMei — comportamentul vechi neschimbat ══");
  const faraAiMei = await lista(tokA, SAT, false);
  check(
    "clientul meu cu CAEN de IT NU apare fără aiMei",
    !faraAiMei.some((f) => f.cui === cui(2)),
  );
  check(
    "firma pe domeniu apare în continuare",
    faraAiMei.some((f) => f.cui === cui(1)),
  );

  console.log("\n══ Bulele hărții (/api/prospects/geo) ══");
  const g = await fetch(
    `${BASE}/api/prospects/geo?token=${encodeURIComponent(tokA)}&judet=SV&geocode=0&caenIn=4711,4719,4725,4726,5630`,
  );
  const gd = (await g.json()) as { localities?: Loc[] };
  const locs = gd.localities ?? [];
  const satGol = locs.find((l) => l.localitate === SAT_GOL);
  check(
    "satul unde am DOAR clienți (nimic pe domeniu) PRIMEȘTE bulă",
    !!satGol,
    `localități: ${locs.length}`,
  );
  check("…și serverul numără clientul meu acolo (clienti=1)", satGol?.clienti === 1);
  const sat = locs.find((l) => l.localitate === SAT);
  check("satul mixt are bulă cu clienti=1 (doar AL MEU numărat)", sat?.clienti === 1, JSON.stringify(sat));

  console.log("\n══ Izolare între firme ══");
  const strainVede = await lista(tokC, SAT, true);
  const alMeuLaStrain = strainVede.find((f) => f.cui === cui(2));
  check(
    "agentul ALTEI firme nu-mi vede clientul nici cu aiMei (mascat sau absent)",
    !alMeuLaStrain || (alMeuLaStrain.status === "nou" && alMeuLaStrain.assignedAgent === ""),
    JSON.stringify(alMeuLaStrain),
  );
  const gC = await fetch(
    `${BASE}/api/prospects/geo?token=${encodeURIComponent(tokC)}&judet=SV&geocode=0&caenIn=4711`,
  );
  const gdC = (await gC.json()) as { localities?: Loc[] };
  const satGolC = (gdC.localities ?? []).find((l) => l.localitate === SAT_GOL);
  check(
    "satul cu doar clienții MEI nu apare pe harta firmei străine",
    !satGolC,
    JSON.stringify(satGolC),
  );

  console.log("\n══ Clientul apare în satul lui REAL, nu doar cel din registru ══");
  // Client înregistrat pe COMUNĂ, dar adresa pomenește SATUL cerut.
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
            VALUES (${cui(6)}, ${"MAGAZIN PE COMUNA " + RUN}, ${"SAT " + SAT_GOL + " NR. 12"}, ${"COMUNA MARE " + RUN.toUpperCase()}, 'SV', '4711', 'client', ${numeA}, TRUE)`;
  const dupaAdresa = await lista(tokA, SAT_GOL, true);
  check(
    "clientul cu sediul pe comună apare în satul din ADRESA lui",
    dupaAdresa.some((f) => f.cui === cui(6)),
    JSON.stringify(dupaAdresa.map((f) => f.denumire)),
  );
  // Client înregistrat AIUREA, dar cu pin GPS exact lângă satul cerut.
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
            VALUES (${cui(7)}, ${"MAGAZIN CU PIN GPS " + RUN}, '', ${"ALT SAT " + RUN.toUpperCase()}, 'SV', '4711', 'client', ${numeA}, TRUE)`;
  await sql`INSERT INTO geo_firme (cui, lat, lng, aprox, failed)
            VALUES (${cui(7)}, 47.625, 26.225, FALSE, FALSE)
            ON CONFLICT (cui) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, aprox = FALSE`;
  const dupaGps = await lista(tokA, SAT_GOL, true);
  check(
    "clientul cu PIN GPS lângă sat apare în lista satului (harta învață terenul)",
    dupaGps.some((f) => f.cui === cui(7)),
    JSON.stringify(dupaGps.map((f) => f.denumire)),
  );

  console.log("\n══ „Închis” din teren scoate firma moartă de pe hartă ══");
  await sql`INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen, status, assigned_agent, activ)
            VALUES (${cui(8)}, ${"PENSIUNE MOARTA " + RUN}, '', ${SAT}, 'SV', '4711', 'nou', '', TRUE)`;
  const rInchis = await fetch(`${BASE}/api/visits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokA, cui: cui(8), denumire: "PENSIUNE MOARTA", result: "inchis", note: "nu mai există de 10 ani" }),
  });
  check("vizita „închis” se salvează", rInchis.ok);
  // Firma NEALOCATĂ (prospect din registrul comun) nu se stinge global —
  // registrul e al tuturor agențiilor. Se ascunde DOAR la noi.
  const [moarta] = await sql<Array<{ activ: boolean }>>`SELECT activ FROM prospects WHERE cui = ${cui(8)}`;
  check(
    "prospectul nealocat NU se stinge global (harta altor agenții rămâne întreagă)",
    moarta?.activ === true,
    JSON.stringify(moarta),
  );
  const [ascunsa] = await sql<Array<{ org_id: string }>>`
    SELECT org_id FROM prospect_inchis WHERE cui = ${cui(8)}
  `;
  check("închiderea e trecută pe firma agentului care a apăsat", !!ascunsa?.org_id);
  const listaFaraMoarta = await lista(tokA, SAT, true);
  check("…și chiar nu mai apare în lista satului", !listaFaraMoarta.some((f) => f.cui === cui(8)));
  // Izolare: agentul firmei străine nu poate stinge clientul ACTIV al nostru.
  const [alMeu5] = await sql<Array<{ activ: boolean | null }>>`SELECT activ FROM prospects WHERE cui = ${cui(5)}`;
  await fetch(`${BASE}/api/visits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokC, cui: cui(5), denumire: "x", result: "inchis", note: "" }),
  });
  const [alMeu5dupa] = await sql<Array<{ activ: boolean | null }>>`SELECT activ FROM prospects WHERE cui = ${cui(5)}`;
  check(
    "clientul MEU activ rămâne activ după „închis” de la firma străină",
    alMeu5?.activ === true && alMeu5dupa?.activ === true,
    JSON.stringify({ inainte: alMeu5, dupa: alMeu5dupa }),
  );

  console.log("\n══ Pinul învață poziția EXACTĂ din GPS la „Am fost” ══");
  const vizita = (extra: Record<string, unknown>) =>
    fetch(`${BASE}/api/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: tokA, cui: cui(5), denumire: "CLIENTUL MEU TRANSPORT",
        result: "client", note: "", ...extra,
      }),
    });
  const rGps = await vizita({ lat: 47.6512, lng: 26.2534, acc: 18 });
  const dGps = (await rGps.json()) as { ok?: boolean; pinExact?: boolean };
  check("vizita cu fix GPS bun răspunde pinExact=true", dGps.ok === true && dGps.pinExact === true, JSON.stringify(dGps));
  const [gf] = await sql<Array<{ lat: number; lng: number; aprox: boolean }>>`
    SELECT lat, lng, aprox FROM geo_firme WHERE cui = ${cui(5)}
  `;
  check(
    "geo_firme are coordonatele exacte, aprox=false",
    !!gf && Math.abs(gf.lat - 47.6512) < 1e-6 && Math.abs(gf.lng - 26.2534) < 1e-6 && gf.aprox === false,
    JSON.stringify(gf),
  );
  const rSlab = await vizita({ lat: 47.7, lng: 26.3, acc: 800 });
  const dSlab = (await rSlab.json()) as { pinExact?: boolean };
  check("fix GPS SLAB (800m) NU suprascrie pinul", dSlab.pinExact === false);
  const rAfara = await vizita({ lat: 51.5, lng: -0.12, acc: 10 });
  const dAfara = (await rAfara.json()) as { pinExact?: boolean };
  check("coordonate din afara României respinse", dAfara.pinExact === false);
  const [gf2] = await sql<Array<{ lat: number }>>`
    SELECT lat FROM geo_firme WHERE cui = ${cui(5)}
  `;
  check("pinul exact a rămas neatins după fixurile proaste", !!gf2 && Math.abs(gf2.lat - 47.6512) < 1e-6);
  const rFara = await vizita({});
  const dFara = (await rFara.json()) as { ok?: boolean; pinExact?: boolean };
  check("vizita FĂRĂ poziție merge normal (GPS opțional)", dFara.ok === true && dFara.pinExact === false);

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM geo_firme WHERE cui IN (${cui(5)}, ${cui(7)})`;
  await sql`DELETE FROM prospect_inchis WHERE cui = ${cui(8)}`;
  await sql`DELETE FROM visits WHERE cui IN (${cui(5)}, ${cui(8)})`;
  await sql`DELETE FROM prospects WHERE cui LIKE ${"88" + baza + "%"}`;
  await sql`DELETE FROM geo_localitati WHERE localitate IN (${SAT}, ${SAT_GOL})`;
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgId}, ${orgId2})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgId}, ${orgId2})`;
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
