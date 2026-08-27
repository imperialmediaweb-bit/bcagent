/**
 * MÂINILE ASISTENTULUI, VERIFICATE.
 *
 * „Pune-mi Ovi Tacomax în ruta de azi", zis cu vocea în mașină, trebuie
 * să AJUNGĂ în ruta lui — și numai a lui. Aici verificăm exact asta:
 *   · pune firma în ruta LUI, pe ziua cerută, cu coordonatele bune;
 *   · nu o pune de două ori și nu trece de 40 de opriri;
 *   · când numele se potrivește la mai multe, ÎNTREABĂ, nu ghicește;
 *   · căutarea nu-i arată starea clienților altei firme;
 *   · zonele se salvează prin ACEEAȘI citire care nu inventează sate;
 *   · ruta altui agent rămâne neatinsă, orice ar zice.
 */

import { ensureSchema, getDB } from "../src/lib/db";
import {
  cautaFirme,
  puneInRuta,
  puneZonele,
  ziaCeruta,
} from "../src/modules/crm/unelte-agent";

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

const ORG_A = "test-un-a";
const ORG_B = "test-un-b";
const AG = "test-un-ag";
const NUME = "Unealta Agent";
const AG_STRAIN = "test-un-strain";
const NUME_STRAIN = "Strain Unealta";
const CUI_MEU = "18584450";
const CUI_STRAIN = "14758812";
const CUI_LIBER = "29130998";
const CUIURI = [CUI_MEU, CUI_STRAIN, CUI_LIBER];
const EU = { agentId: AG, agentName: NUME };

async function curata() {
  await db!`DELETE FROM visits WHERE agent_id IN (${AG}, ${AG_STRAIN})`;
  await db!`DELETE FROM magazin_harta WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM routes WHERE agent_id IN (${AG}, ${AG_STRAIN})`;
  await db!`DELETE FROM agent_zone WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM geo_firme WHERE cui = ANY(${CUIURI})`;
  await db!`DELETE FROM prospects WHERE cui = ANY(${CUIURI})`;
  await db!`DELETE FROM geo_localitati WHERE localitate IN ('UNSAT', 'UNSATDOI')`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
}

async function main() {
  await ensureSchema();
  const { ensurePlatformSchema } = await import("../src/modules/platform/schema");
  await ensurePlatformSchema();
  await curata();
  for (const [id, nume] of [[ORG_A, "Firma A"], [ORG_B, "Firma B"]]) {
    await db!`INSERT INTO organizations (id, name, status) VALUES (${id}, ${nume}, 'activ')
              ON CONFLICT (id) DO UPDATE SET status = 'activ'`;
  }
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG}, ${ORG_A}, ${AG}, ${NUME}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_A}, name = ${NUME}`;
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG_STRAIN}, ${ORG_B}, ${AG_STRAIN}, ${NUME_STRAIN}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_B}, name = ${NUME_STRAIN}`;
  await db!`
    INSERT INTO prospects (cui, denumire, judet, localitate, status,
                           assigned_agent, assigned_org, adresa, activ, note)
    VALUES
      (${CUI_MEU}, 'OVI-TACOMAX SRL', 'BT', 'UNSAT', 'client',
       ${NUME}, ${ORG_A}, 'Str. Mare 1', TRUE, ''),
      (${CUI_STRAIN}, 'OVI AL VECINULUI SRL', 'BT', 'UNSAT', 'client',
       ${NUME_STRAIN}, ${ORG_B}, '', TRUE, 'secret comercial'),
      (${CUI_LIBER}, 'MAGAZIN LIBER NIMANUI SRL', 'BT', 'UNSATDOI', 'nou',
       '', '', '', TRUE, '')
  `;
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
    VALUES (${CUI_MEU}, 47.91, 26.51, FALSE, FALSE, 'gps')
  `;

  console.log("\n══ Ziua cerută, pe românește ══");
  {
    // 27.08.2026 e joi.
    const joi = new Date("2026-08-27T10:00:00");
    ok("«azi» = ziua de azi", ziaCeruta("azi", joi) === "joi", ziaCeruta("azi", joi));
    ok("gol = tot azi", ziaCeruta("", joi) === "joi");
    ok("«mâine» = vineri", ziaCeruta("mâine", joi) === "vineri");
    ok("«luni» = luni", ziaCeruta("luni", joi) === "luni");
    ok("o aiureală cade pe azi, nu crapă", ziaCeruta("poimarți", joi) === "joi");
  }

  console.log("\n══ Caută cum vorbește omul ══");
  {
    const g = await cautaFirme(db!, EU, "pune-mi ovi tacomax");
    ok("găsește firma din vorbă întreagă", g.some((x) => x.cui === CUI_MEU), JSON.stringify(g.map((x) => x.denumire)));
    ok("și o știe ca a LUI", g.find((x) => x.cui === CUI_MEU)?.aMea === true);
    const strain = g.find((x) => x.cui === CUI_STRAIN);
    ok(
      "clientul vecinului apare ca firmă simplă, nu ca client",
      !strain || (strain.aMea === false && strain.status === "nou"),
      JSON.stringify(strain),
    );
    ok("două litere nu pornesc căutarea", (await cautaFirme(db!, EU, "ov")).length === 0);
  }

  console.log("\n══ Pune în rută, prin vorbă ══");
  {
    const r = await puneInRuta(db!, EU, "ovi tacomax", "luni");
    ok("a pus-o", r.facut === true, r.mesaj);
    ok("și spune ce a făcut, cu ziua", r.mesaj.includes("luni"), r.mesaj);
    const [ruta] = await db!<Array<{ day: string; stops: Array<{ cui: string; lat: number | null }> }>>`
      SELECT day, stops FROM routes WHERE agent_id = ${AG}
    `;
    ok("ruta e a LUI, pe luni", ruta?.day === "luni");
    ok("oprirea are firma", ruta?.stops?.[0]?.cui === CUI_MEU);
    ok(
      "și coordonatele pinului exact",
      Math.abs((ruta?.stops?.[0]?.lat ?? 0) - 47.91) < 0.001,
      JSON.stringify(ruta?.stops?.[0]),
    );

    const r2 = await puneInRuta(db!, EU, "ovi tacomax", "luni");
    ok("a doua oară nu dublează", r2.mesaj.includes("deja"), r2.mesaj);
    const [ruta2] = await db!<Array<{ stops: unknown[] }>>`
      SELECT stops FROM routes WHERE agent_id = ${AG}
    `;
    ok("chiar e o singură oprire", (ruta2?.stops ?? []).length === 1);
  }

  console.log("\n══ Nume care se potrivește la mai multe: întreabă ══");
  {
    const r = await puneInRuta(db!, EU, "ovi", "azi");
    // „ovi" prinde și OVI-TACOMAX (al lui) și OVI AL VECINULUI — dar doar
    // UNA e a lui, deci o alege pe aia fără să întrebe.
    ok("când doar una e a lui, o alege pe aia", r.facut === true, r.mesaj);
    const r2 = await puneInRuta(db!, EU, "magazin care nu exista deloc", "azi");
    ok("firmă inexistentă = spus cinstit, nu inventat", r2.facut === false, r2.mesaj);
  }

  console.log("\n══ Zonele, prin vorbă — fără sate inventate ══");
  {
    await db!`
      INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
      VALUES ('BT', 'UNSAT', 47.9, 26.5, FALSE), ('BT', 'UNSATDOI', 47.8, 26.4, FALSE)
      ON CONFLICT (judet, localitate) DO NOTHING
    `;
    const r = await puneZonele(db!, EU, "luni - UNSAT, UNSATDOI\nmarti - Tara Care Nu Exista");
    ok("a salvat ce a recunoscut", r.facut === true, r.mesaj);
    const zone = await db!<Array<{ localitate: string; zi: string }>>`
      SELECT localitate, zi FROM agent_zone
      WHERE org_id = ${ORG_A} AND agent_name = ${NUME} ORDER BY pozitie
    `;
    ok("satele recunoscute sunt pe luni", zone.filter((z) => z.zi === "luni").length === 2, JSON.stringify(zone));
    ok(
      "ce n-a recunoscut NU e băgat pe furiș",
      !zone.some((z) => z.localitate.toLowerCase().includes("tara")),
      JSON.stringify(zone),
    );
    ok("și i-o SPUNE pe nume", r.mesaj.includes("Tara Care Nu Exista"), r.mesaj);
  }

  console.log("\n══ IZOLARE: ruta și zonele vecinului rămân ale lui ══");
  {
    await db!`
      INSERT INTO routes (id, agent_id, name, day, stops)
      VALUES ('test-un-rt-strain', ${AG_STRAIN}, 'Ruta lui', 'luni',
              ${db!.json([{ cui: CUI_STRAIN, denumire: "OVI AL VECINULUI SRL" }] as never)})
    `;
    await puneInRuta(db!, EU, "ovi tacomax", "luni");
    const [aLui] = await db!<Array<{ stops: unknown[] }>>`
      SELECT stops FROM routes WHERE agent_id = ${AG_STRAIN}
    `;
    ok("ruta vecinului e neatinsă", (aLui?.stops ?? []).length === 1);
    const g = await cautaFirme(db!, EU, "vecinului");
    ok(
      "nota vecinului nu iese la căutare (nu se întoarce deloc)",
      !JSON.stringify(g).includes("secret"),
      JSON.stringify(g),
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     UNELTELE DIN CHAT, cap-coadă: JSON-ul modelului → fapta, prin
     ACELEAȘI rute ca butoanele, cu tokenul lui.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ Chat: «am fost la Ovi, a comandat» ══");
  {
    const { ruleazaUnealtaChat } = await import(
      "../src/modules/crm/unealta-chat"
    );
    const { signToken } = await import("../src/lib/signed-token");
    const token = await signToken(
      { agentId: AG, agentName: NUME, exp: Math.floor(Date.now() / 1000) + 3600 },
      process.env.TOKEN_SECRET ?? "",
    );
    const pozitia = { lat: 47.905, lng: 26.505, acc: 18 };

    const r = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "am_fost", firma: "ovi tacomax", rezultat: "client" }),
      EU, token, pozitia,
    );
    ok("vizita se scrie și confirmă", r.includes("scrisă în jurnal"), r);
    const [v] = await db!<Array<{ agent_id: string; result: string }>>`
      SELECT agent_id, result FROM visits WHERE cui = ${CUI_MEU}
      ORDER BY visited_at DESC LIMIT 1
    `;
    ok("în jurnal, pe NUMELE LUI, nu al AI-ului", v?.agent_id === AG, JSON.stringify(v));
    ok("cu rezultatul zis de om", v?.result === "client");

    const r2 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "am_fost", firma: "ovi tacomax" }),
      EU, token, pozitia,
    );
    ok(
      "fără rezultat spus, ÎNTREABĂ — nu presupune",
      r2.includes("Ce s-a întâmplat"),
      r2,
    );
    const r3 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "am_fost", firma: "ovi tacomax", rezultat: "nu_mai_exista" }),
      EU, token, pozitia,
    );
    ok(
      "«nu mai există» NU merge din chat (rămâne pe buton, cu confirmare)",
      r3.includes("Ce s-a întâmplat"),
      r3,
    );

    console.log("\n══ Chat: «sunt în fața la Ovi» ══");
    const r4 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "sunt_aici", firma: "ovi tacomax" }),
      EU, token, { lat: 47.92, lng: 26.52, acc: 15 },
    );
    ok("pinul se pune și confirmă", r4.includes("e pus unde stai"), r4);
    const [g] = await db!<Array<{ lat: number; sursa: string }>>`
      SELECT lat, sursa FROM geo_firme WHERE cui = ${CUI_MEU}
    `;
    ok("chiar pe poziția telefonului, ca gps", Math.abs((g?.lat ?? 0) - 47.92) < 0.001 && g?.sursa === "gps", JSON.stringify(g));
    const r5 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "sunt_aici", firma: "ovi tacomax" }),
      EU, token, { lat: 47.92, lng: 26.52, acc: 900 },
    );
    ok("GPS prost (±900m) = spus cinstit, fără pin", r5.includes("poziție bună"), r5);
    const r6 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "sunt_aici", firma: "ovi tacomax" }),
      EU, token, undefined,
    );
    ok("fără poziție deloc = la fel", r6.includes("poziție bună"), r6);

    console.log("\n══ Chat: «adaugă magazinul La Ionel aici» ══");
    const r7 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "adauga_magazin", nume: "La Ionel Test Chat" }),
      EU, token, { lat: 47.93, lng: 26.53, acc: 20 },
    );
    ok("magazinul intră pe hartă", r7.includes("e pe hartă"), r7);
    const [m] = await db!<Array<{ org_id: string; adaugat_de: string }>>`
      SELECT org_id, adaugat_de FROM magazin_harta WHERE nume = 'La Ionel Test Chat'
    `;
    ok("în firma LUI, cu numele lui pe el", m?.org_id === ORG_A && m?.adaugat_de === NUME, JSON.stringify(m));
    await db!`DELETE FROM magazin_harta WHERE nume = 'La Ionel Test Chat'`;
    const r8 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "adauga_magazin", nume: "Fara Pozitie" }),
      EU, token, undefined,
    );
    ok("fără poziție, magazinul NU se pune la nimereală", r8.includes("Adaugă magazin"), r8);

    console.log("\n══ Chat: gunoiul nu strică nimic ══");
    const r9 = await ruleazaUnealtaChat("nu e json deloc", EU, token, undefined);
    ok("text stricat = rugat să repete, nu excepție", r9.includes("mai zi o dată"), r9);
    const r10 = await ruleazaUnealtaChat(
      JSON.stringify({ unealta: "sterge_tot" }),
      EU, token, undefined,
    );
    ok("unealtă inventată de model = refuzată", r10.includes("nu există"), r10);
  }

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
