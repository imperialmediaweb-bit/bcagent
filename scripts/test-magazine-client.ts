/**
 * UN CLIENT = UN MAGAZIN, NU O FIRMĂ.
 *
 * „Da, așa ar trebui. Magazinele." (Bogdan, 26.08, 19:28)
 *
 * Ovi Tacomax e o firmă — un rând în listă, un punct pe hartă. Dar sunt
 * ȘASE magazine: Cernești, Iurești, două în Zlatunoaia, magazinul din
 * Lunca și barul din Lunca. Gavrileț vedea un punct și avea de intrat în
 * șase. Iar cele 30 „UVERTURA - …" sunt SIS-urile lui Bogdan — standurile
 * lui, cu casele lui de marcat, în magazinele altora.
 *
 * Aici verificăm, pe API-ul adevărat, ca de pe telefonul agentului:
 *   · magazinele unui CLIENT se văd altfel decât cele de prospectat;
 *   · agentul poate adăuga unul de pe teren („Lunca bar" nu era în fișier);
 *   · nu poate lipi un magazin de firma ALTEI agenții;
 *   · nu poate pune un magazin în Africa;
 *   · două apăsări pe același loc nu fac două magazine.
 */

import { signToken } from "../src/lib/signed-token";
import { ensureSchema, getDB } from "../src/lib/db";

const BAZA = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";

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

const ORG = "test-mc-org";
const ALTORG = "test-mc-alt";
const AG = "test-mc-ag";
const N = "Gavrilet Proba";
const AGSTRAIN = "test-mc-strain";
const NSTRAIN = "Strain Proba";
const CUI_CLIENT = "18584450"; // Ovi Tacomax
const CUI_STRAIN = "29130998";
const CUI_PROSPECT = "14758812";
const TOATE = [CUI_CLIENT, CUI_STRAIN, CUI_PROSPECT];

async function curata() {
  await db!`DELETE FROM magazin_harta WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM prospects WHERE cui = ANY(${TOATE})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG}, ${ALTORG})`;
}

async function cere(token: string, param = "") {
  const r = await fetch(`${BAZA}/api/prospects/magazine-harta?token=${encodeURIComponent(token)}${param}`);
  return (await r.json()) as {
    magazine?: Array<{
      id: string;
      nume: string;
      cui?: string;
      firma?: string;
      eAlClientului?: boolean;
    }>;
  };
}
async function adauga(token: string, a: Record<string, unknown>) {
  const r = await fetch(`${BAZA}/api/prospects/magazine-harta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, adauga: a }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

async function main() {
  await ensureSchema();
  await curata();

  console.log("\n══ Pregătesc ══");
  for (const [id, nume] of [[ORG, "Firma MC"], [ALTORG, "Vecina MC"]]) {
    await db!`INSERT INTO organizations (id, name, status) VALUES (${id}, ${nume}, 'activ')
              ON CONFLICT (id) DO UPDATE SET status = 'activ'`;
  }
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG}, ${ORG}, ${AG}, ${N}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ORG}, name = ${N}`;
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AGSTRAIN}, ${ALTORG}, ${AGSTRAIN}, ${NSTRAIN}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ALTORG}, name = ${NSTRAIN}`;
  await db!`
    INSERT INTO prospects (cui, denumire, judet, localitate, status, assigned_agent)
    VALUES (${CUI_CLIENT}, 'OVI-TACOMAX SRL', 'BT', 'Zlatunoaia', 'client', ${N}),
           (${CUI_PROSPECT}, 'O FIRMA NEATINSA SRL', 'BT', 'Zlatunoaia', 'nou', ''),
           (${CUI_STRAIN}, 'AL VECINULUI SRL', 'BT', 'Zlatunoaia', 'client', ${NSTRAIN})
  `;
  // Magazinele venite din harta lui Bogdan: patru ale clientului, unul fără firmă.
  await db!`
    INSERT INTO magazin_harta (id, org_id, nume, cui, lat, lng, strat)
    VALUES
      ('mc-1', ${ORG}, 'OVI-TACOMAX SRL CERNESTI', ${CUI_CLIENT}, 47.80, 26.90, 'harta'),
      ('mc-2', ${ORG}, 'OVI-TACOMAX SRL IURESTI', ${CUI_CLIENT}, 47.81, 26.91, 'harta'),
      ('mc-3', ${ORG}, 'OVI-TACOMAX SRL ZLATUNOAIA 1', ${CUI_CLIENT}, 47.82, 26.92, 'harta'),
      ('mc-4', ${ORG}, 'OVI-TACOMAX SRL ZLATUNOAIA 2', ${CUI_CLIENT}, 47.83, 26.93, 'harta'),
      ('mc-5', ${ORG}, 'ALIMENTARA NECUNOSCUTA', '', 47.84, 26.94, 'harta'),
      ('mc-6', ${ORG}, 'MAGAZIN DE PROSPECTAT', ${CUI_PROSPECT}, 47.85, 26.95, 'harta')
  `;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tok = await signToken({ agentId: AG, agentName: N, exp }, SECRET);
  const tokStrain = await signToken(
    { agentId: AGSTRAIN, agentName: NSTRAIN, exp },
    SECRET,
  );

  console.log("\n══ Ce vede Gavrilet pe hartă ══");
  {
    const d = await cere(tok);
    const m = d.magazine ?? [];
    ok("vede toate cele 6 magazine", m.length === 6, `sunt ${m.length}`);
    const aleClientului = m.filter((x) => x.eAlClientului);
    ok(
      "PATRU sunt ale clientului lui, nu de prospectat",
      aleClientului.length === 4,
      JSON.stringify(m.map((x) => `${x.nume}=${x.eAlClientului}`)),
    );
    ok(
      "si scrie a cui sunt",
      aleClientului.every((x) => x.firma === "OVI-TACOMAX SRL"),
      JSON.stringify(aleClientului.map((x) => x.firma)),
    );
    const deProspectat = m.filter((x) => !x.eAlClientului);
    ok("doua raman de prospectat", deProspectat.length === 2);
    ok(
      "cel cu firma nou-nouta e tot de prospectat, nu al clientului",
      deProspectat.some((x) => x.nume === "MAGAZIN DE PROSPECTAT"),
      JSON.stringify(deProspectat.map((x) => x.nume)),
    );
  }

  console.log("\n══ Adauga Lunca bar, care nu era in fisier ══");
  {
    const r = await adauga(tok, {
      nume: "OVI-TACOMAX LUNCA BAR",
      cui: CUI_CLIENT,
      lat: 47.86,
      lng: 26.96,
    });
    ok("s-a adăugat", r.status < 300, `${r.status} ${JSON.stringify(r.body)}`);
    const d = await cere(tok);
    const bar = (d.magazine ?? []).find((x) => x.nume === "OVI-TACOMAX LUNCA BAR");
    ok("apare imediat pe hartă", bar !== undefined);
    ok("si e legat de firma clientului", bar?.eAlClientului === true, JSON.stringify(bar));
    ok("acum sunt 5 ale clientului", (d.magazine ?? []).filter((x) => x.eAlClientului).length === 5);
  }

  console.log("\n══ Ce NU are voie ══");
  {
    // Firma ALTEI agenții: magazinul se face, dar FĂRĂ să fie al lor.
    const r = await adauga(tok, {
      nume: "INCERC LA VECINUL",
      cui: CUI_STRAIN,
      lat: 47.87,
      lng: 26.97,
    });
    ok("nu crapă", r.status < 300, String(r.status));
    ok(
      "dar NU l-a lipit de firma vecinului",
      r.body.cui === "",
      `cui = ${JSON.stringify(r.body.cui)}`,
    );
  }
  {
    const r = await adauga(tok, { nume: "IN AFRICA", lat: -1.2, lng: 36.8 });
    ok("un loc din afara Romaniei e respins", r.status === 400, String(r.status));
  }
  {
    const r = await adauga(tok, { nume: "X", lat: 47.9, lng: 26.9 });
    ok("un nume de o litera e respins", r.status === 400, String(r.status));
  }
  {
    const r = await adauga("token-stricat", { nume: "ORICE", lat: 47.9, lng: 26.9 });
    ok("fara token bun, nimic", r.status === 401, String(r.status));
  }
  {
    // Două apăsări pe același loc, cu același nume: un singur magazin.
    await adauga(tok, { nume: "APASAT DE DOUA ORI", lat: 47.88, lng: 26.98 });
    await adauga(tok, { nume: "APASAT DE DOUA ORI", lat: 47.88, lng: 26.98 });
    const d = await cere(tok);
    ok(
      "doua apasari = un magazin",
      (d.magazine ?? []).filter((x) => x.nume === "APASAT DE DOUA ORI").length === 1,
      JSON.stringify((d.magazine ?? []).map((x) => x.nume)),
    );
  }

  console.log("\n══ Agentul altei agenții nu vede nimic de-al nostru ══");
  {
    const d = await cere(tokStrain);
    ok("zero magazine la vecin", (d.magazine ?? []).length === 0, `sunt ${(d.magazine ?? []).length}`);
  }

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
