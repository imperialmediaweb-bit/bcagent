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

  console.log("\n══ Curățenie ══");
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
