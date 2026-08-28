/**
 * RAPORTUL DE ACOPERIRE, VERIFICAT PE CIFRE — nu „arată frumos", ci
 * „iese socoteala".
 *
 * Cerut de Bogdan (28.08): vizitele efectuate vs. universul posibil de
 * pe hartă, pe agenți. Aici punem o firmă cu 4 opriri (1 firmă simplă +
 * 1 firmă cu 3 magazine — din care unul tăiat, deci 2 valabile) și
 * vizite cunoscute, și cerem procente EXACTE:
 *   · universul numără magazine, nu firme;
 *   · magazinul tăiat și SIS-ul nu intră;
 *   · 5 vizite la aceeași oprire = 1 acoperită, 5 la „vizite totale";
 *   · vizita colegului nu se pune la agentul nostru;
 *   · prospectarea se leagă de satele ZONELOR lui, cu diacritice cu tot;
 *   · firma vecină nu apare nicăieri.
 */

import { ensureSchema, getDB } from "../src/lib/db";
import { acoperireTeren } from "../src/modules/crm/acoperire";

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

const db = getDB();
if (!db) {
  console.log("DATABASE_URL lipsește — nu pot rula.");
  process.exit(1);
}

const ORG = "test-acop-org";
const ORG_B = "test-acop-b";
const AG = "test-acop-ag";
const NUME = "Acoperire Agent";
const AG2 = "test-acop-coleg";
const NUME2 = "Coleg Acoperire";
const CUI_SIMPLU = "18584450";
const CUI_MULTI = "14758812";
const CUI_STRAIN = "29130998";
const CUIURI = [CUI_SIMPLU, CUI_MULTI, CUI_STRAIN];
const MAG = ["test-acop-m1", "test-acop-m2", "test-acop-m3"];
const MOV = ["test-acop-mov1", "test-acop-mov2"];

async function curata() {
  await db!`DELETE FROM visits WHERE agent_id IN (${AG}, ${AG2})`;
  await db!`DELETE FROM magazin_harta WHERE org_id IN (${ORG}, ${ORG_B})`;
  await db!`DELETE FROM agent_zone WHERE org_id IN (${ORG}, ${ORG_B})`;
  await db!`DELETE FROM prospects WHERE cui = ANY(${CUIURI})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG}, ${ORG_B})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG}, ${ORG_B})`;
}

async function main() {
  await ensureSchema();
  const { ensurePlatformSchema } = await import("../src/modules/platform/schema");
  await ensurePlatformSchema();
  await curata();

  for (const [id, nume] of [[ORG, "Firma Acoperire"], [ORG_B, "Vecina"]]) {
    await db!`INSERT INTO organizations (id, name, status) VALUES (${id}, ${nume}, 'activ')
              ON CONFLICT (id) DO UPDATE SET status = 'activ'`;
  }
  for (const [id, nume] of [[AG, NUME], [AG2, NUME2]]) {
    await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
              VALUES (${id}, ${ORG}, ${id}, ${nume}, TRUE)
              ON CONFLICT (id) DO UPDATE SET org_id = ${ORG}, name = ${nume}`;
  }
  await db!`
    INSERT INTO prospects (cui, denumire, judet, localitate, status,
                           assigned_agent, assigned_org, activ)
    VALUES
      (${CUI_SIMPLU}, 'FIRMA SIMPLA SRL', 'BT', 'ACOPSAT', 'client', ${NUME}, ${ORG}, TRUE),
      (${CUI_MULTI}, 'FIRMA CU MAGAZINE SRL', 'BT', 'ACOPSAT', 'client', ${NUME}, ${ORG}, TRUE),
      (${CUI_STRAIN}, 'CLIENTUL VECINEI SRL', 'BT', 'ACOPSAT', 'client', 'Alt Om', ${ORG_B}, TRUE)
  `;
  // 3 magazine ale firmei multi: unul tăiat pe teren → NU e oprire.
  for (const [i, id] of MAG.entries()) {
    await db!`
      INSERT INTO magazin_harta (id, org_id, nume, lat, lng, cui, fel, stare)
      VALUES (${id}, ${ORG}, ${"Mag " + (i + 1)}, ${47.9 + i * 0.01}, 26.5,
              ${CUI_MULTI}, 'magazin', ${i === 2 ? "inchis" : ""})
    `;
  }
  // Movuri de prospectat: unul în satul zonei lui (cu diacritice pe dos),
  // unul în alt sat — nu-i al lui.
  await db!`
    INSERT INTO magazin_harta (id, org_id, nume, lat, lng, cui, localitate)
    VALUES (${MOV[0]}, ${ORG}, 'Mov In Zona', 47.95, 26.55, '', 'HĂNEŞTI'),
           (${MOV[1]}, ${ORG}, 'Mov Aiurea', 47.96, 26.56, '', 'ALTSAT')
  `;
  await db!`
    INSERT INTO agent_zone (org_id, agent_name, localitate, zi, pozitie, pus_de)
    VALUES (${ORG}, ${NUME}, 'Hanesti', 'joi', 0, ${NUME})
  `;

  // Vizitele lui: firma simplă de 5 ori (aceeași oprire), magazinul 1 o
  // dată, movul din zonă o dată. Colegul vizitează magazinul 2 — a LUI
  // socoteală, nu a agentului nostru.
  for (let i = 0; i < 5; i++) {
    await db!`
      INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note)
      VALUES (${AG}, ${NUME}, ${CUI_SIMPLU}, 'FIRMA SIMPLA', 'client', ${"v" + i})
    `;
  }
  await db!`
    INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, magazin_id)
    VALUES (${AG}, ${NUME}, ${CUI_MULTI}, 'Mag 1', 'client', '', ${MAG[0]}),
           (${AG}, ${NUME}, '', 'Mov In Zona', 'client', '', ${MOV[0]}),
           (${AG2}, ${NUME2}, ${CUI_MULTI}, 'Mag 2', 'client', '', ${MAG[1]})
  `;

  console.log("\n══ Socoteala pe agentul nostru ══");
  const r = await acoperireTeren(db!, ORG, [
    { name: NUME, agentId: AG },
    { name: NUME2, agentId: AG2 },
  ], 30);
  const eu = r.agenti.find((x) => x.agent === NUME);
  ok("agentul e în raport", !!eu);
  ok(
    "universul numără OPRIRI: 1 firmă simplă + 2 magazine valabile = 3",
    eu?.universClienti === 3,
    `a ieșit ${eu?.universClienti}`,
  );
  ok(
    "magazinul tăiat NU e în univers",
    eu?.universClienti === 3,
  );
  ok(
    "vizitate: firma simplă + magazinul 1 = 2 (nu 6, nu 7)",
    eu?.vizitate === 2,
    `a ieșit ${eu?.vizitate}`,
  );
  ok("procentul iese exact: 2/3 = 67%", eu?.procent === 67, `${eu?.procent}%`);
  ok(
    "vizitele totale numără și revenirile: 5+1+1 = 7",
    eu?.vizite === 7,
    `a ieșit ${eu?.vizite}`,
  );
  ok(
    "vizita COLEGULUI la Mag 2 nu se pune la el",
    eu?.vizitate === 2,
  );

  console.log("\n══ Prospectarea, legată de zonele lui ══");
  ok(
    "movul din satul zonei (HĂNEŞTI vs Hanesti) e în universul lui",
    eu?.universProspectare === 1,
    `a ieșit ${eu?.universProspectare}`,
  );
  ok("și e atins (l-a vizitat)", eu?.prospectate === 1, `${eu?.prospectate}`);
  ok("movul din alt sat NU e al lui", eu?.universProspectare === 1);

  console.log("\n══ Colegul și vecina ══");
  const coleg = r.agenti.find((x) => x.agent === NUME2);
  ok("colegul fără clienți are universul 0", coleg?.universClienti === 0);
  ok("dar vizita lui la Mag 2 se vede la vizitele lui totale", coleg?.vizite === 1);
  ok("colegul n-are zone → prospectare nelegată", coleg?.areZone === false);
  ok(
    "clientul VECINEI nu apare în niciun univers",
    r.total.universClienti === 3,
    `total ${r.total.universClienti}`,
  );
  ok("totalul firmei: 2/3 = 67%", r.total.procent === 67, `${r.total.procent}%`);

  console.log("\n══ Ruta agentului: doar cifrele LUI ══");
  {
    const { signToken } = await import("../src/lib/signed-token");
    const { GET } = await import("../src/app/api/acoperire/route");
    const tok = await signToken(
      { agentId: AG, agentName: NUME, exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.TOKEN_SECRET ?? "",
    );
    const res = await GET(
      new Request(`http://x/api/acoperire?token=${encodeURIComponent(tok)}&zile=30`),
    );
    const d = (await res.json()) as {
      inOrg?: boolean;
      eu?: { agent: string; procent: number; universClienti: number };
    };
    ok("ruta răspunde pe tokenul lui", res.status === 200 && d.inOrg === true);
    ok("cu ACELEAȘI cifre ca raportul șefului", d.eu?.procent === 67 && d.eu?.universClienti === 3, JSON.stringify(d.eu));
    ok("și doar cu ale lui — un singur agent în răspuns", d.eu?.agent === NUME);

    const resFals = await GET(new Request("http://x/api/acoperire?token=stricat"));
    ok("token stricat = refuzat", resFals.status === 401);
  }

  console.log("\n══ Perioada taie corect ══");
  await db!`
    UPDATE visits SET visited_at = NOW() - INTERVAL '40 days'
    WHERE agent_id = ${AG} AND magazin_id = ${MAG[0]}
  `;
  const r7 = await acoperireTeren(db!, ORG, [{ name: NUME, agentId: AG }], 30);
  const eu7 = r7.agenti[0];
  ok(
    "vizita de acum 40 de zile iese din fereastra de 30",
    eu7?.vizitate === 1 && eu7?.procent === 33,
    `vizitate=${eu7?.vizitate}, ${eu7?.procent}%`,
  );

  console.log("\n══ Curățenie ══");
  await curata();
  console.log("  · datele de test șterse");
  console.log(
    `\n${caderi.length === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi.length} eșuate\n`,
  );
  await db!.end();
  process.exit(caderi.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await db!.end();
  process.exit(1);
});
