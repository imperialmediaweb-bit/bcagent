/**
 * MUNCA DE TEREN, VĂZUTĂ DE PATRON.
 *
 * Costin bate satele, pune locul exact la magazine, confirmă că prăvălia
 * din harta veche mai există, taie una închisă. Toate se salvau — dar nu
 * le vedea nimeni. Bogdan n-avea ce arăta, iar Costin n-avea cu ce se
 * lăuda.
 *
 * Aici verificăm, pe date adevărate în baza de date:
 *   · fiecare faptă ajunge pe numele omului care a făcut-o;
 *   · un agent de la ALTĂ firmă nu apare și nu-i strică cifrele;
 *   · locul pus de agent NU se mai pierde la următorul import (bugul cu
 *     `sursa` care nu se rescria la suprascriere — cel mai urât dintre
 *     toate, fiindcă ștergea muncă adevărată în tăcere).
 */

import { ensureSchema, getDB } from "../src/lib/db";

const BAZA = process.env.BASE_URL ?? "http://127.0.0.1:3131";
let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
    console.log(`  ✓ ${nume}`);
  } else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

const db = getDB();
if (!db) {
  console.log("DATABASE_URL lipsește — nu pot rula.");
  process.exit(1);
}

const ORG = "test-teren-org";
const ALTORG = "test-teren-alt";
const AG1 = "test-teren-ag1";
const AG2 = "test-teren-ag2";
const AGSTRAIN = "test-teren-strain";
const N1 = "Costin Teren";
const N2 = "Vlad Teren";
const NSTRAIN = "Strain Teren";
const CUI1 = "990000101";
const CUI2 = "990000102";
const CUISTRAIN = "990000103";

async function curata() {
  await db!`DELETE FROM geo_firme WHERE cui IN (${CUI1}, ${CUI2}, ${CUISTRAIN})`;
  await db!`DELETE FROM prospects WHERE cui IN (${CUI1}, ${CUI2}, ${CUISTRAIN})`;
  await db!`DELETE FROM magazin_harta WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM agent_zone WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM visits WHERE agent_id IN (${AG1}, ${AG2}, ${AGSTRAIN})`;
  await db!`DELETE FROM orders WHERE agent_id IN (${AG1}, ${AG2}, ${AGSTRAIN})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG}, ${ALTORG})`;
}

async function main() {
  await ensureSchema();
  await curata();

  console.log("\n══ Pregătesc două firme, ca să se vadă izolarea ══");
  for (const [id, nume] of [[ORG, "Firma Teren"], [ALTORG, "Firma Vecina"]]) {
    await db!`
      INSERT INTO organizations (id, name, status)
      VALUES (${id}, ${nume}, 'activ')
      ON CONFLICT (id) DO UPDATE SET status = 'activ'
    `;
  }
  for (const [org, id, nume] of [
    [ORG, AG1, N1],
    [ORG, AG2, N2],
    [ALTORG, AGSTRAIN, NSTRAIN],
  ]) {
    await db!`
      INSERT INTO org_agents (id, org_id, agent_id, name, active)
      VALUES (${id}, ${org}, ${id}, ${nume}, TRUE)
      ON CONFLICT (id) DO UPDATE SET org_id = ${org}, name = ${nume}
    `;
  }
  await db!`
    INSERT INTO prospects (cui, denumire, judet, localitate, assigned_agent, status)
    VALUES
      (${CUI1}, 'MAGAZIN TEREN UNU SRL', 'SV', 'Siret', ${N1}, 'client'),
      (${CUI2}, 'MAGAZIN TEREN DOI SRL', 'SV', 'Siret', ${N2}, 'client'),
      (${CUISTRAIN}, 'MAGAZIN STRAIN SRL', 'SV', 'Siret', ${NSTRAIN}, 'client')
  `;

  console.log("\n══ Agenții muncesc ══");
  // Costin: pune două locuri la fața locului, confirmă un magazin, taie unul.
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, sursa, pus_de)
    VALUES (${CUI1}, 47.95, 26.07, 'gps', ${N1})
  `;
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, sursa, pus_de)
    VALUES (${CUI2}, 47.96, 26.08, 'deget', ${N1})
  `;
  await db!`
    INSERT INTO magazin_harta (id, org_id, nume, lat, lng, stare, confirmat_de, confirmat_la)
    VALUES
      ('t-mag-1', ${ORG}, 'Alimentara Deal', 47.9, 26.0, 'exista', ${N1}, NOW()),
      ('t-mag-2', ${ORG}, 'Bar Vale', 47.91, 26.01, 'inchis', ${N1}, NOW()),
      ('t-mag-3', ${ORG}, 'Chiosc Gara', 47.92, 26.02, '', '', NULL)
  `;
  // Vlad: își scrie zonele pe zile și face o vizită.
  await db!`
    INSERT INTO agent_zone (org_id, agent_name, localitate, zi, pus_de)
    VALUES
      (${ORG}, ${N2}, 'Siret', 'luni', ${N2}),
      (${ORG}, ${N2}, 'Zamostea', 'luni', ${N2}),
      (${ORG}, ${N2}, 'Calafindesti', 'marti', ${N2})
  `;
  await db!`
    INSERT INTO visits (agent_id, agent_name, cui, denumire, result)
    VALUES (${AG2}, ${N2}, ${CUI2}, 'MAGAZIN TEREN DOI SRL', 'comanda')
  `;
  // Agentul firmei vecine muncește și el — nu trebuie să apară la noi.
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, sursa, pus_de)
    VALUES (${CUISTRAIN}, 47.5, 26.5, 'gps', ${NSTRAIN})
  `;
  await db!`
    INSERT INTO magazin_harta (id, org_id, nume, lat, lng, stare, confirmat_de, confirmat_la)
    VALUES ('t-mag-strain', ${ALTORG}, 'Alimentara Vecina', 47.5, 26.5, 'exista', ${NSTRAIN}, NOW())
  `;

  console.log("\n══ Ce vede patronul ══");
  // Chemăm direct funcția din rută ar cere sesiune; verificăm interogările
  // pe aceleași reguli, apoi ruta prin HTTP pentru izolare.
  const pinuri = await db!<Array<{ agent: string; n: string }>>`
    SELECT COALESCE(NULLIF(g.pus_de, ''), p.assigned_agent) AS agent, COUNT(*)::text AS n
    FROM geo_firme g
    JOIN prospects p ON p.cui = g.cui
    JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${ORG}
    WHERE g.sursa IN ('deget', 'gps')
    GROUP BY 1
  `;
  const alCostin = pinuri.find((p) => p.agent === N1);
  ok("cele două locuri puse de Costin ajung pe numele lui", alCostin?.n === "2", JSON.stringify(pinuri));
  ok("agentul firmei vecine nu apare deloc", !pinuri.some((p) => p.agent === NSTRAIN));

  const mag = await db!<Array<{ agent: string; stare: string; n: string }>>`
    SELECT confirmat_de AS agent, stare, COUNT(*)::text AS n
    FROM magazin_harta WHERE org_id = ${ORG} AND confirmat_de <> ''
    GROUP BY 1, 2
  `;
  ok(
    "magazinul confirmat e trecut ca fiind confirmat",
    mag.find((m) => m.agent === N1 && m.stare === "exista")?.n === "1",
    JSON.stringify(mag),
  );
  ok(
    "cel închis e trecut separat, nu la un loc cu cele bune",
    mag.find((m) => m.agent === N1 && m.stare === "inchis")?.n === "1",
  );
  ok("magazinul neatins de nimeni nu se pune pe seama cuiva", mag.length === 2);

  const zone = await db!<Array<{ agent: string; n: string; zile: string[] }>>`
    SELECT agent_name AS agent, COUNT(*)::text AS n,
           ARRAY_AGG(DISTINCT zi) FILTER (WHERE zi <> '') AS zile
    FROM agent_zone WHERE org_id = ${ORG} AND pus_de = agent_name GROUP BY 1
  `;
  ok("zonele scrise de Vlad sunt ale lui Vlad", zone[0]?.agent === N2 && zone[0]?.n === "3");
  ok("și se știe pe câte zile le-a împărțit", (zone[0]?.zile ?? []).length === 2, JSON.stringify(zone[0]?.zile));

  const [acoperire] = await db!<[{ clienti: string; cu_loc: string; din_teren: string }]>`
    SELECT COUNT(*)::text AS clienti, COUNT(g.cui)::text AS cu_loc,
           COUNT(*) FILTER (WHERE g.sursa IN ('deget', 'gps'))::text AS din_teren
    FROM prospects p
    JOIN org_agents oa ON oa.name = p.assigned_agent AND oa.org_id = ${ORG}
    LEFT JOIN geo_firme g ON g.cui = p.cui
  `;
  ok("cei doi clienți ai firmei sunt numărați, nu și al vecinilor", acoperire.clienti === "2", acoperire.clienti);
  ok("amândoi au locul pus din teren", acoperire.din_teren === "2");

  console.log("\n══ Ruta cere sesiune — nu dă date pe degeaba ══");
  {
    const r = await fetch(`${BAZA}/api/agentie/teren`);
    ok("fără cont, nimic", r.status === 401 || r.status === 403, `a răspuns ${r.status}`);
  }

  console.log("\n══ BUGUL CEL URÂT: importul ștergea munca agentului ══");
  // Firma avea locul adus dintr-o hartă. Agentul se duce acolo și pune
  // pinul cu degetul. Dacă `sursa` rămâne „import", următorul import i-l
  // șterge peste — și nimeni nu află vreodată.
  await db!`DELETE FROM geo_firme WHERE cui = ${CUI1}`;
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, sursa) VALUES (${CUI1}, 47.0, 26.0, 'import')
  `;
  // exact ce face acum ruta de pin, cu ON CONFLICT-ul reparat
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa, pus_de)
    VALUES (${CUI1}, 47.95, 26.07, FALSE, FALSE, 'deget', ${N1})
    ON CONFLICT (cui) DO UPDATE
      SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, aprox = FALSE, failed = FALSE,
          sursa = EXCLUDED.sursa, pus_de = EXCLUDED.pus_de, updated_at = NOW()
  `;
  const [dupa] = await db!<[{ sursa: string; pus_de: string; lat: number }]>`
    SELECT sursa, pus_de, lat FROM geo_firme WHERE cui = ${CUI1}
  `;
  ok("dupa ce agentul pune pinul, locul e al LUI, nu adus din harta", dupa.sursa === "deget", dupa.sursa);
  ok("și se știe cine l-a pus", dupa.pus_de === N1, dupa.pus_de);

  // Acum vine importul peste. Paza „nu te atinge de ce a pus omul pe
  // teren" se uită la sursă — dacă ea rămăsese „import", munca se pierdea.
  const importul = await db!`
    INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
    SELECT p.cui, 47.0, 26.0, FALSE, FALSE, 'import'
    FROM prospects p
    WHERE p.cui = ${CUI1}
      AND NOT EXISTS (
        SELECT 1 FROM geo_firme g WHERE g.cui = p.cui AND g.sursa IN ('deget', 'gps')
      )
    ON CONFLICT (cui) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng
  `;
  const [final] = await db!<[{ sursa: string; lat: number }]>`
    SELECT sursa, lat FROM geo_firme WHERE cui = ${CUI1}
  `;
  ok("importul NU l-a atins", importul.count === 0, `a scris ${importul.count} rânduri`);
  ok("locul pus de Costin a rămas neatins", Math.abs(final.lat - 47.95) < 0.001, String(final.lat));

  console.log("\n══ Curățenie ══");
  await curata();
  console.log("  · datele de test șterse");

  console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} eșuate\n`);
  await db!.end();
  process.exit(caderi === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await db!.end();
  process.exit(1);
});
