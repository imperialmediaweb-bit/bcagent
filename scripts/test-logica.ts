/**
 * LOGICA PLATFORMEI, VERIFICATĂ LA SÂNGE.
 *
 * Nu stilul codului, nu numele butoanelor: LOGICA. Adică lucrurile care,
 * dacă nu se leagă, mint fără să crape nimic — și tocmai de-aia nu le
 * prinde nimeni. Un raport verde care ascunde cinci magazine nevizitate
 * e mai periculos decât o pagină care dă eroare: eroarea se vede.
 *
 * Fiecare verificare de aici răspunde la o întrebare de bun-simț, pusă
 * ca un om care ține firma, nu ca un programator:
 *   · Dacă am șase magazine, îmi cere aplicația șase drumuri sau unul?
 *   · Dacă doi agenți de la două firme diferite se cheamă la fel, cine
 *     vede clienții cui?
 *   · Când apăs „anulează", chiar se anulează, sau doar pe jumătate?
 *   · Când un client îmi zice azi „nu iau nimic", îl pierd din listă?
 *   · Poate să iasă o cifră mai mare decât întregul din care vine?
 *
 * Ce nu trece aici NU e o preferință de-a mea. E o cifră care ar ajunge
 * pe masa unui patron și l-ar pune să ia o hotărâre pe o minciună.
 */

import { ensureSchema, getDB } from "../src/lib/db";
import { anuleazaImportul } from "../src/modules/prospects/harta-aplica";
import {
  aliasuriInvatate,
  citesteZone,
  invataAlias,
  listaAliasuri,
  uitaAlias,
} from "../src/modules/zone/aplica";
import { orgAgentNamesForAgent } from "../src/lib/org-scope";

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

// Două firme de distribuție, vecine, fiecare cu agenții ei.
const ORG_A = "test-log-a";
const ORG_B = "test-log-b";
// ACELAȘI NUME la două firme diferite. Nu e o răutate de test: „Popescu
// Ion" e cel mai obișnuit nume din țară, iar platforma e făcută pentru
// multe firme deodată.
const NUME_COMUN = "Popescu Ion";
const AG_A = "test-log-ag-a";
const AG_B = "test-log-ag-b";
const AG_A2 = "test-log-ag-a2";
const NUME_A2 = "Vasile Costin";

// CUI-uri reale ca formă (cifră de control validă), dar din plajă de test.
const CUI_A = "18584450";
const CUI_B = "14758812";
const CUI_C = "29130998";
const CUIURI = [CUI_A, CUI_B, CUI_C];

const MAG = ["test-log-m1", "test-log-m2", "test-log-m3"];
/** Al patrulea: adus de import și neatins de nimeni — ăsta TREBUIE să iasă. */
const MAG_CURAT = "test-log-m4";

async function curata() {
  await db!`DELETE FROM visits WHERE agent_id LIKE 'test-log-%'`;
  await db!`DELETE FROM van_stock WHERE agent_id LIKE 'test-log-%'`;
  await db!`DELETE FROM magazin_harta WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM magazin_harta WHERE id LIKE 'test-log-%'`;
  await db!`DELETE FROM zona_alias WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM geo_firme WHERE cui = ANY(${CUIURI})`;
  await db!`DELETE FROM prospect_inchis WHERE cui = ANY(${CUIURI})`;
  await db!`DELETE FROM prospects WHERE cui = ANY(${CUIURI})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG_A}, ${ORG_B})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
}

async function pregateste() {
  for (const [id, nume] of [
    [ORG_A, "Firma A Logica"],
    [ORG_B, "Firma B Logica"],
  ]) {
    await db!`
      INSERT INTO organizations (id, name, status) VALUES (${id}, ${nume}, 'activ')
      ON CONFLICT (id) DO UPDATE SET status = 'activ'
    `;
  }
  const agenti: Array<[string, string, string]> = [
    [AG_A, ORG_A, NUME_COMUN],
    [AG_B, ORG_B, NUME_COMUN],
    [AG_A2, ORG_A, NUME_A2],
  ];
  for (const [id, org, nume] of agenti) {
    await db!`
      INSERT INTO org_agents (id, org_id, agent_id, name, active)
      VALUES (${id}, ${org}, ${id}, ${nume}, TRUE)
      ON CONFLICT (id) DO UPDATE SET org_id = ${org}, name = ${nume}, active = TRUE
    `;
  }
}

async function main() {
  await ensureSchema();
  await curata();
  await pregateste();

  /* ═══════════════════════════════════════════════════════════════════
     1. DOI AGENȚI CU ACELAȘI NUME, LA DOUĂ FIRME DIFERITE.
     Toată izolarea dintre firme se sprijină pe `assigned_agent`, care e
     un NUME scris cu litere, nu un id. Dacă numele se repetă la două
     firme, întrebarea „ai cui sunt clienții ăștia?" n-are răspuns.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 1. Doi agenți, același nume, firme diferite ══");
  {
    // Firma B își ia un client și scrie pe el ce a vorbit cu omul.
    // Alocarea poartă firma care a făcut-o — așa scrie platforma acum.
    await db!`
      INSERT INTO prospects (cui, denumire, judet, localitate, status,
                             assigned_agent, assigned_org, note, sold_cents)
      VALUES (${CUI_A}, 'CLIENTUL FIRMEI B SRL', 'BT', 'Dorohoi', 'client',
              ${NUME_COMUN}, ${ORG_B}, 'ce am vorbit cu el, secret comercial', 250000)
    `;
    const aleLuiA = await orgAgentNamesForAgent(AG_A);
    ok(
      "numele singur NU deosebește firmele (de-aia nu ne bizuim pe el)",
      aleLuiA.includes(NUME_COMUN),
      JSON.stringify(aleLuiA),
    );

    // Ce vede CU ADEVĂRAT agentul firmei A, prin API-ul lui.
    const f = await firmaVazutaDe(AG_A, CUI_A);
    ok("agentul firmei A o vede (registrul e comun — și trebuie)", f !== null);
    ok(
      "dar NU-i vede starea de client a firmei B",
      f?.status !== "client",
      `vede status=${f?.status}`,
    );
    ok(
      "NU-i vede nota (ce s-a vorbit cu omul)",
      !String(f?.note ?? "").includes("secret comercial"),
      String(f?.note ?? ""),
    );
    ok(
      "NU-i vede agentul alocat",
      String(f?.assignedAgent ?? "") === "",
      String(f?.assignedAgent ?? ""),
    );
    ok(
      "NU-i vede soldul (banii pe care-i are omul de dat firmei B)",
      f?.soldCents === null || f?.soldCents === undefined,
      String(f?.soldCents),
    );

    // Și nu poate SCRIE pe ea.
    const cod = await incearcaSaScrie(AG_A, CUI_A);
    ok("iar dacă încearcă să scrie, e refuzat (403)", cod === 403, `a primit ${cod}`);
    const [dupa] = await db!<[{ note: string; status: string }]>`
      SELECT note, status FROM prospects WHERE cui = ${CUI_A}
    `;
    ok(
      "și în bază nu s-a schimbat nimic",
      dupa.status === "client" && dupa.note.includes("secret comercial"),
      JSON.stringify(dupa),
    );
  }

  console.log("\n══ 1b. Alocările vechi capătă firma lor la pornire ══");
  {
    // Un rând scris înainte de coloană: fără firmă pe el. La pornire,
    // schema o completează — dar DOAR unde numele duce la o singură
    // firmă. „Vasile Costin" e doar la firma A, deci se poate ști.
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent, assigned_org)
      VALUES (${CUI_C}, 'CLIENT VECHI FARA FIRMA SRL', 'BT', 'client', ${NUME_A2}, '')
      ON CONFLICT (cui) DO UPDATE SET assigned_agent = ${NUME_A2}, assigned_org = ''
    `;
    // „Popescu Ion" e la două firme: acolo NU se poate ghici, și n-are voie.
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent, assigned_org)
      VALUES (${CUI_B}, 'CLIENT VECHI AMBIGUU SRL', 'BT', 'client', ${NUME_COMUN}, '')
      ON CONFLICT (cui) DO UPDATE SET assigned_agent = ${NUME_COMUN}, assigned_org = ''
    `;
    await ruleazaCompletarea();
    const [a] = await db!<[{ o: string }]>`
      SELECT assigned_org AS o FROM prospects WHERE cui = ${CUI_C}
    `;
    ok("un nume care e la o singură firmă se completează singur", a.o === ORG_A, a.o);
    const [b] = await db!<[{ o: string }]>`
      SELECT assigned_org AS o FROM prospects WHERE cui = ${CUI_B}
    `;
    ok(
      "un nume care e la două firme NU se ghicește (rămâne gol)",
      b.o === "",
      `a ghicit „${b.o}" — ar fi mutat clienți dintr-o firmă în alta`,
    );
    await db!`DELETE FROM prospects WHERE cui IN (${CUI_B}, ${CUI_C})`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     2. UN CLIENT CU ȘASE MAGAZINE = ȘASE DRUMURI.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 2. Un client cu mai multe magazine ══");
  {
    await db!`DELETE FROM prospects WHERE cui = ${CUI_A}`;
    await db!`
      INSERT INTO prospects (cui, denumire, judet, localitate, status, assigned_agent)
      VALUES (${CUI_A}, 'OVI-TACOMAX SRL', 'BT', 'Cernești', 'client', ${NUME_A2})
    `;
    for (const [i, id] of MAG.entries()) {
      await db!`
        INSERT INTO magazin_harta (id, org_id, nume, lat, lng, cui, fel)
        VALUES (${id}, ${ORG_A}, ${`Magazinul ${i + 1}`},
                ${47.9 + i * 0.01}, ${26.5 + i * 0.01}, ${CUI_A}, 'magazin')
        ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_A}, cui = ${CUI_A}
      `;
    }
    const opriri = await scadente(AG_A2);
    ok(
      "trei magazine ale aceluiași client = trei opriri, nu una",
      opriri.length === 3,
      `am primit ${opriri.length}`,
    );
    ok(
      "fiecare oprire spune LA CARE magazin e",
      new Set(opriri.map((o) => o.magazinId)).size === 3,
      JSON.stringify(opriri.map((o) => o.magazinId)),
    );
    ok(
      "și are locul MAGAZINULUI, nu al sediului",
      opriri.length > 0 && opriri.every((o) => o.lat !== null && o.lng !== null),
      JSON.stringify(opriri.map((o) => o.lat)),
    );

    // Vizita la unul dintre ele stinge DOAR pe el.
    await db!`
      INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, magazin_id)
      VALUES (${AG_A2}, ${NUME_A2}, ${CUI_A}, 'Magazinul 1', 'client', '', ${MAG[0]})
    `;
    const dupa = await scadente(AG_A2);
    ok(
      "după o vizită la primul magazin, rămân DOUĂ de făcut",
      dupa.length === 2,
      `am primit ${dupa.length} — dacă e 0, o vizită stinge toată firma`,
    );
    ok(
      "și tocmai cel vizitat a ieșit din listă",
      dupa.length > 0 && !dupa.some((o) => o.magazinId === MAG[0]),
      JSON.stringify(dupa.map((o) => o.magazinId)),
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     3. DOUĂ MAGAZINE ÎN ACELAȘI MINUT NU SUNT O DUBLARE.
     Paza contra apăsatului dublu n-are voie să înghită a doua vizită
     adevărată, când agentul trece prin două magazine alăturate.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 3. Apăsat dublu vs. două magazine alăturate ══");
  {
    const inainte = await nrVizite(CUI_A);
    // Aceeași vizită, retrimisă (telefon slab): NU trebuie să se dubleze.
    await inserVizitaCuPaza(MAG[0]);
    ok(
      "aceeași vizită, trimisă din nou, rămâne una singură",
      (await nrVizite(CUI_A)) === inainte,
      `a devenit ${await nrVizite(CUI_A)}`,
    );
    // Alt magazin, la un minut: e o vizită NOUĂ.
    await inserVizitaCuPaza(MAG[1]);
    ok(
      "magazinul de alături, la un minut, se scrie ca vizită nouă",
      (await nrVizite(CUI_A)) === inainte + 1,
      `am ${await nrVizite(CUI_A)}, așteptam ${inainte + 1}`,
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     4. UN MAGAZIN TĂIAT PE TEREN NU MAI E O OPRIRE.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 4. Ce a tăiat agentul nu se mai trimite nimănui ══");
  {
    await db!`UPDATE magazin_harta SET stare = 'inchis' WHERE id = ${MAG[2]}`;
    const o = await scadente(AG_A2);
    ok(
      "magazinul tăiat de agent iese din opriri",
      !o.some((x) => x.magazinId === MAG[2]),
      JSON.stringify(o.map((x) => x.magazinId)),
    );
    await db!`UPDATE magazin_harta SET stare = '' WHERE id = ${MAG[2]}`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     5. „ANULEAZĂ CE AM ADUS" — cât anulează, de fapt.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 5. Anularea importului spune adevărul ══");
  {
    // Un loc pus de import, unul pus de agent cu degetul.
    await db!`
      INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa, pus_de)
      VALUES (${CUI_A}, 47.9, 26.5, FALSE, FALSE, 'import', '')
      ON CONFLICT (cui) DO UPDATE SET sursa = 'import'
    `;
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent, adus_de_org)
      VALUES (${CUI_B}, 'FIRMA ADUSA DIN HARTA SRL', 'BT', 'nou', '', ${ORG_A})
      ON CONFLICT (cui) DO UPDATE SET adus_de_org = ${ORG_A}
    `;
    await db!`
      INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
      VALUES (${CUI_B}, 47.8, 26.4, FALSE, FALSE, 'deget')
      ON CONFLICT (cui) DO UPDATE SET sursa = 'deget'
    `;
    // Trei magazine: unul curat (de import), unul confirmat de agent,
    // unul cu vizită scrisă pe el.
    await db!`UPDATE magazin_harta SET stare = 'exista', confirmat_de = ${NUME_A2}
              WHERE id = ${MAG[2]}`;
    // Și unul adus de import pe care nu l-a atins nimeni: ăsta trebuie să iasă.
    await db!`
      INSERT INTO magazin_harta (id, org_id, nume, lat, lng, cui)
      VALUES (${MAG_CURAT}, ${ORG_A}, 'Magazin neatins', 47.95, 26.55, '')
      ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_A}, stare = '', adaugat_de = ''
    `;

    const r = await anuleazaImportul(db!, ORG_A, [NUME_A2, NUME_COMUN]);
    ok("scoate locul adus de import", r.locuri >= 1, `locuri=${r.locuri}`);
    const [gDeget] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM geo_firme WHERE cui = ${CUI_B} AND sursa = 'deget'
    `;
    ok("dar NU locul pus de agent cu degetul", gDeget.n === "1", gDeget.n);
    const ramase = await db!<Array<{ id: string }>>`
      SELECT id FROM magazin_harta WHERE org_id = ${ORG_A} ORDER BY id
    `;
    const idRamase = ramase.map((x) => x.id);
    ok(
      "scoate magazinul adus de import pe care nu l-a atins nimeni",
      !idRamase.includes(MAG_CURAT),
      JSON.stringify(idRamase),
    );
    ok(
      "și îl numără ca scos",
      r.magazine >= 1,
      `magazine=${r.magazine}`,
    );
    ok(
      "dar păstrează magazinul confirmat de un agent",
      idRamase.includes(MAG[2]),
      JSON.stringify(idRamase),
    );
    ok(
      "și magazinul la care s-a înregistrat o vizită",
      idRamase.includes(MAG[0]),
      JSON.stringify(idRamase),
    );
    ok("numără ce a păstrat, ca să nu pară că n-a mers", r.pastrate >= 2, `${r.pastrate}`);
    ok(
      "și spune câte firme rămân în registrul comun",
      r.firmeRamase >= 1,
      `${r.firmeRamase}`,
    );
    const [inca] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE cui = ${CUI_B}
    `;
    ok(
      "firma adusă din hartă NU se șterge pe furiș din registrul comun",
      inca.n === "1",
      inca.n,
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     6. CE A ÎNVĂȚAT GREȘIT, SE POATE UITA.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 6. O învățătură greșită nu e pe viață ══");
  {
    const REG = ["SUCEAVA", "Sadova"];
    await invataAlias(db!, ORG_A, "Centru", "SUCEAVA", "cineva grabit");
    let a = await aliasuriInvatate(db!, ORG_A);
    ok(
      "greșeala chiar lucrează (de-aia e periculoasă)",
      citesteZone("Luni\nCentru", REG, a).gasite.some((g) => g.localitate === "SUCEAVA"),
    );
    const lista = await listaAliasuri(db!, ORG_A);
    ok(
      "se VEDE ce a învățat, cu cine a pus-o",
      lista.some((x) => x.localitate === "SUCEAVA" && x.pusDe === "cineva grabit"),
      JSON.stringify(lista),
    );
    const sters = await uitaAlias(db!, ORG_A, "Centru", "SUCEAVA");
    ok("se poate scoate", sters === 1, `sters=${sters}`);
    a = await aliasuriInvatate(db!, ORG_A);
    const dupa = citesteZone("Luni\nCentru", REG, a);
    ok(
      "și aplicația se întoarce la «nu știu, spune-mi tu»",
      dupa.gasite.length === 0 && dupa.negasite.length === 1,
      JSON.stringify(dupa),
    );
    ok(
      "ce uită o firmă nu atinge cealaltă firmă",
      (await uitaAlias(db!, ORG_B, "Centru", "SUCEAVA")) === 0,
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     7. CIFRELE NU AU VOIE SĂ FIE MAI MARI DECÂT ÎNTREGUL.
     Verificăm invarianți pe datele CHIAR EXISTENTE în bază, nu pe date
     inventate de mine: dacă platforma a scris vreodată ceva imposibil,
     aici se vede.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 7. Invarianți peste datele adevărate din bază ══");
  {
    const [v] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM visits WHERE visited_at > NOW() + INTERVAL '1 hour'
    `;
    ok("nicio vizită înregistrată în viitor", v.n === "0", `${v.n} vizite`);

    const [g] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM geo_firme
      WHERE lat < -90 OR lat > 90 OR lng < -180 OR lng > 180
    `;
    ok("niciun loc în afara Pământului", g.n === "0", `${g.n} locuri`);

    const [m] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM magazin_harta
      WHERE lat < -90 OR lat > 90 OR lng < -180 OR lng > 180
    `;
    ok("niciun magazin în afara Pământului", m.n === "0", `${m.n} magazine`);

    const [s] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM geo_firme g
      WHERE NOT EXISTS (SELECT 1 FROM prospects p WHERE p.cui = g.cui)
    `;
    ok("niciun loc rămas orfan, fără firma lui", s.n === "0", `${s.n} orfane`);

    // Un agent nu poate fi în două firme deodată: toată izolarea pleacă
    // de la „firma agentului", iar două răspunsuri înseamnă niciunul.
    const [d] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM (
        SELECT agent_id FROM org_agents GROUP BY agent_id HAVING COUNT(DISTINCT org_id) > 1
      ) x
    `;
    ok("niciun agent înscris la două firme deodată", d.n === "0", `${d.n} agenți`);
  }

  /* ═══════════════════════════════════════════════════════════════════
     8. STAREA CLIENTULUI DUPĂ O VIZITĂ.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 8. Ce pățește un client când zice azi «nu iau nimic» ══");
  {
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent)
      VALUES (${CUI_C}, 'CLIENT VECHI SRL', 'BT', 'client', ${NUME_A2})
      ON CONFLICT (cui) DO UPDATE SET status = 'client', assigned_agent = ${NUME_A2}
    `;
    // Regula din cod: rezultatul „nu_vrea" duce starea la „respins".
    const { STATUS_DUPA_VIZITA } = await import(
      "../src/modules/crm/stare-vizita"
    );
    ok(
      "un client care refuză azi o comandă rămâne CLIENT",
      STATUS_DUPA_VIZITA("client", "nu_vrea") === "client",
      `starea devine „${STATUS_DUPA_VIZITA("client", "nu_vrea")}" — clientul dispare din listele lui`,
    );
    ok(
      "dar un PROSPECT care refuză devine respins",
      STATUS_DUPA_VIZITA("nou", "nu_vrea") === "respins",
      `${STATUS_DUPA_VIZITA("nou", "nu_vrea")}`,
    );
    ok(
      "«a devenit client» face client dintr-un prospect",
      STATUS_DUPA_VIZITA("nou", "client") === "client",
    );
    ok(
      "«închis / n-a fost nimeni» nu schimbă nimic",
      STATUS_DUPA_VIZITA("client", "inchis") === null,
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     9. DOI AGENȚI CU ACELAȘI NUME ÎN ACEEAȘI FIRMĂ.
     Vânzările vin din fișierul SAGA, unde agentul e scris CU NUMELE.
     Două nume la fel înseamnă o cheie dublă: vânzările se adună la un
     loc, targetul e unul pentru doi oameni, clasamentul minte.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 9. Două nume la fel în aceeași firmă ══");
  {
    const { addOrgAgent, NumeAgentFolosit } = await import(
      "../src/modules/platform"
    );
    let refuzat = false;
    let vorba = "";
    try {
      await addOrgAgent(ORG_A, "test-log-ag-a3", NUME_A2);
    } catch (e) {
      refuzat = e instanceof NumeAgentFolosit;
      vorba = e instanceof Error ? e.message : String(e);
    }
    ok("al doilea agent cu același nume e refuzat", refuzat, vorba);
    ok(
      "și i se spune de ce, cu o vorbă de om",
      vorba.includes("Scrie-l altfel"),
      vorba,
    );
    // Dar ACELAȘI agent poate fi redenumit oricând.
    let mers = true;
    try {
      await addOrgAgent(ORG_A, AG_A2, NUME_A2);
    } catch {
      mers = false;
    }
    ok("același agent, reemis pe numele lui, merge ca înainte", mers);
    // Iar la ALTĂ firmă, numele e liber: nu-i treaba noastră cum îi
    // cheamă angajații pe vecini.
    let laVecin = true;
    try {
      await addOrgAgent(ORG_B, "test-log-ag-b2", NUME_A2);
    } catch {
      laVecin = false;
    }
    ok("la altă firmă, același nume e liber", laVecin);
    await db!`DELETE FROM org_agents WHERE agent_id = 'test-log-ag-b2'`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     10. MARFA DIN DUBĂ. Un „gata" pe un retur care n-a scăzut nimic îl
     lasă pe agent cu marfa scrisă pe el.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 10. Retur din dubă ══");
  {
    await db!`DELETE FROM van_stock WHERE agent_id = ${AG_A2}`;
    await db!`
      INSERT INTO van_stock (agent_id, produs, um, cantitate)
      VALUES (${AG_A2}, 'Kent 4', 'buc', 10)
    `;
    // Numele scris cu un spațiu la coadă — cum vine dintr-o listă lipită.
    const r1 = await retur(AG_A2, "Kent 4 ", 4);
    ok(
      "returul nimerește produsul chiar cu spațiu la coadă",
      (await cantitateInDuba(AG_A2, "Kent 4")) === 6,
      `au rămas ${await cantitateInDuba(AG_A2, "Kent 4")}`,
    );
    ok("și nu se plânge de nimic", (r1.neatinse ?? []).length === 0);
    // Un produs care nu e în dubă: se SPUNE, nu se tace.
    const r2 = await retur(AG_A2, "Marlboro Gold", 2);
    ok(
      "un produs care nu-i în dubă e spus pe nume",
      (r2.neatinse ?? []).includes("Marlboro Gold"),
      JSON.stringify(r2.neatinse),
    );
    await db!`DELETE FROM van_stock WHERE agent_id = ${AG_A2}`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     11. „CONTINUĂ RUTA" nu are voie să sară peste magazine nevăzute.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 11. Continuarea rutei, cu mai multe magazine ══");
  {
    const { cheieOprire, remainingStops } = await import(
      "../src/lib/route-nav"
    );
    const opriri = [
      { cui: CUI_A, magazinId: "m1", denumire: "Ovi · Cernești" },
      { cui: CUI_A, magazinId: "m2", denumire: "Ovi · Iurești" },
      { cui: CUI_A, magazinId: "m3", denumire: "Ovi · Lunca" },
      { cui: CUI_C, magazinId: "", denumire: "O firmă cu un singur magazin" },
    ];
    // Agentul a fost la primul magazin.
    const facut = [cheieOprire(opriri[0])];
    const ramase = remainingStops(opriri, facut);
    ok(
      "după primul magazin rămân TREI opriri, nu una",
      ramase.length === 3,
      `au rămas ${ramase.length}`,
    );
    ok(
      "și celelalte două magazine ale aceleiași firme sunt printre ele",
      ramase.some((o) => o.magazinId === "m2") &&
        ramase.some((o) => o.magazinId === "m3"),
      JSON.stringify(ramase.map((o) => o.magazinId)),
    );
    // Firma fără magazine cunoscute se stinge pe CUI, ca înainte.
    const ramase2 = remainingStops(opriri, [
      cheieOprire(opriri[0]),
      cheieOprire(opriri[3]),
    ]);
    ok(
      "firma fără magazine se bifează pe CUI, ca înainte",
      !ramase2.some((o) => o.cui === CUI_C),
      JSON.stringify(ramase2.map((o) => o.denumire)),
    );
    // Linkurile vechi trimit doar CUI-uri: nu se strică nimic.
    const ramase3 = remainingStops(opriri, [CUI_C]);
    ok(
      "un link vechi, care trimite doar CUI-uri, merge ca înainte",
      ramase3.length === 3 && !ramase3.some((o) => o.cui === CUI_C),
      JSON.stringify(ramase3.map((o) => o.denumire)),
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     12. „ÎNCHIS AZI" NU E „NU MAI EXISTĂ".
     Erau un singur buton, iar apăsatul ștergea firma din toată agenția,
     pentru totdeauna, fără drum înapoi.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 12. Ușa închisă la prânz vs. firma desființată ══");
  {
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent,
                             assigned_org, activ, inchis_teren)
      VALUES (${CUI_C}, 'CLIENT VECHI DE ZECE ANI SRL', 'BT', 'client',
              ${NUME_A2}, ${ORG_A}, TRUE, FALSE)
      ON CONFLICT (cui) DO UPDATE SET activ = TRUE, inchis_teren = FALSE,
        status = 'client', assigned_agent = ${NUME_A2}, assigned_org = ${ORG_A}
    `;
    // Agentul trece la prânz, găsește ușa închisă.
    await vizita(AG_A2, CUI_C, "inchis");
    const dupaPranz = await stareFirmei(CUI_C);
    ok(
      "«închis azi» NU stinge clientul",
      dupaPranz.activ === true && dupaPranz.inchis_teren === false,
      JSON.stringify(dupaPranz),
    );
    ok("și rămâne client", dupaPranz.status === "client", dupaPranz.status);

    // Peste o lună, firma chiar s-a desființat.
    await vizita(AG_A2, CUI_C, "nu_mai_exista");
    const stins = await stareFirmei(CUI_C);
    ok(
      "«nu mai există» o scoate din liste",
      stins.activ === false && stins.inchis_teren === true,
      JSON.stringify(stins),
    );

    // Dar agentul a greșit: managerul o aduce înapoi.
    const vazute = await scoaseDeTeren();
    ok(
      "managerul VEDE ce s-a scos de pe teren",
      vazute.some((x) => x.cui === CUI_C),
      JSON.stringify(vazute.map((x) => x.cui)),
    );
    ok(
      "și cine a scos-o",
      vazute.find((x) => x.cui === CUI_C)?.agent === NUME_A2,
      JSON.stringify(vazute),
    );
    const cod = await redeschide(CUI_C);
    ok("o poate aduce înapoi", cod === 200, `cod ${cod}`);
    const inviat = await stareFirmei(CUI_C);
    ok(
      "și chiar se întoarce în liste",
      inviat.activ === true && inviat.inchis_teren === false,
      JSON.stringify(inviat),
    );
    ok(
      "iar verificarea de la ANAF nu mai e blocată pe ea",
      inviat.inchis_teren === false,
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     13. CE SCRIE ÎN GHID TREBUIE SĂ EXISTE ÎN APLICAȚIE.
     De aici a pornit toată povestea cu suportul: AI-ul i-a dat lui Costin
     pași cu butoane care nu există, iar el le-a căutat pe telefon, în
     mașină, degeaba. Un ghid care rămâne în urmă face exact același rău,
     doar mai încet.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 13. Ghidul spune ce e în aplicație, nu altceva ══");
  {
    const { readFileSync } = await import("node:fs");
    const harta = readFileSync("src/app/a/[token]/MapPanel.tsx", "utf8");
    const { CE_ARE_APLICATIA } = await import(
      "../src/modules/platform/ce-are-aplicatia"
    );
    const ghid = readFileSync("src/app/ghid/page.tsx", "utf8");
    const { REZULTATE } = await import("../src/modules/crm/stare-vizita");

    // Butoanele scrise pe ecran, luate CHIAR din ecran.
    const idIn = [...harta.matchAll(/\{ id: "([a-z_]+)", label: "([^"]+)"/g)];
    ok("am găsit butoanele de rezultat în ecran", idIn.length >= 6, `${idIn.length}`);
    for (const [, id] of idIn) {
      ok(
        `butonul „${id}" e un rezultat pe care serverul îl cunoaște`,
        (REZULTATE as readonly string[]).includes(id),
      );
    }
    ok(
      "iar fiecare rezultat cunoscut de server are butonul lui pe ecran",
      REZULTATE.every((r) => idIn.some(([, id]) => id === r)),
      JSON.stringify(REZULTATE.filter((r) => !idIn.some(([, id]) => id === r))),
    );
    // Cele două butoane noi trebuie explicate ACOLO UNDE se caută
    // răspunsul: în ghid și în ce știe AI-ul de suport.
    for (const [unde, text] of [
      ["ce știe AI-ul de suport", CE_ARE_APLICATIA],
      ["ghidul", ghid],
    ] as const) {
      ok(
        `${unde} spune că „închis azi" nu strică nimic`,
        /[Îî]nchis azi/.test(text),
      );
      ok(
        `${unde} spune ce face „nu mai există"`,
        /nu mai există|Nu mai există/.test(text),
      );
      ok(
        `${unde} spune că se poate da înapoi`,
        /napoi/.test(text),
      );
    }
    ok(
      "ce știe AI-ul de suport pomenește și ștergerea unei învățături",
      CE_ARE_APLICATIA.includes("Scoate"),
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
     14. TELEFONUL ȘI TABLOUL ȘEFULUI SPUN ACELAȘI LUCRU.
     Cel mai rău fel de a greși: două cifre diferite pentru același lucru,
     și amândouă „corecte". Agentul vede 23 de opriri, patronul vede 9,
     iar discuția dintre ei nu se mai poate încheia.
     ═══════════════════════════════════════════════════════════════════ */
  console.log("\n══ 14. Aceleași cifre pe telefon și la șef ══");
  {
    // Un client cu trei magazine (unul vizitat) + un client nedistribuit.
    await db!`DELETE FROM visits WHERE agent_id LIKE 'test-log-%'`;
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent, assigned_org)
      VALUES (${CUI_A}, 'OVI-TACOMAX SRL', 'BT', 'client', ${NUME_A2}, ${ORG_A})
      ON CONFLICT (cui) DO UPDATE SET status = 'client',
        assigned_agent = ${NUME_A2}, assigned_org = ${ORG_A},
        activ = TRUE, inchis_teren = FALSE
    `;
    for (const [i, id] of MAG.entries()) {
      await db!`
        INSERT INTO magazin_harta (id, org_id, nume, lat, lng, cui, fel, stare)
        VALUES (${id}, ${ORG_A}, ${`Magazinul ${i + 1}`},
                ${47.9 + i * 0.01}, ${26.5 + i * 0.01}, ${CUI_A}, 'magazin', '')
        ON CONFLICT (id) DO UPDATE SET org_id = ${ORG_A}, cui = ${CUI_A},
          stare = '', fel = 'magazin'
      `;
    }
    // Un client pe care nu l-a luat încă niciun agent.
    await db!`
      INSERT INTO prospects (cui, denumire, judet, status, assigned_agent, assigned_org)
      VALUES (${CUI_B}, 'CLIENT NEDISTRIBUIT SRL', 'BT', 'client', '', '')
      ON CONFLICT (cui) DO UPDATE SET status = 'client', assigned_agent = '',
        assigned_org = '', activ = TRUE, inchis_teren = FALSE
    `;

    const peTelefon = await scadente(AG_A2);
    const laSef = await tabloulSefului();
    ok(
      "telefonul numără magazine, nu firme (trei opriri pentru o firmă)",
      peTelefon.filter((o) => o.cui === CUI_A).length === 3,
      `pentru Ovi Tacomax: ${peTelefon.filter((o) => o.cui === CUI_A).length}`,
    );
    ok(
      "și clientul nedistribuit e și el o oprire",
      peTelefon.some((o) => o.cui === CUI_B),
      JSON.stringify(peTelefon.map((o) => o.cui)),
    );
    ok(
      "iar tabloul șefului spune EXACT aceeași cifră",
      laSef.due === peTelefon.length,
      `șef: ${laSef.due}, telefon: ${peTelefon.length}`,
    );
    ok(
      "și numără și clientul nedistribuit la «clienți»",
      laSef.clienti >= 2,
      `clienți: ${laSef.clienti}`,
    );

    // O vizită la un magazin scade cifra cu UNU la amândoi, nu cu trei.
    await vizitaLaMagazin(AG_A2, CUI_A, MAG[0]);
    const telefon2 = await scadente(AG_A2);
    const sef2 = await tabloulSefului();
    ok(
      "o vizită la un magazin scade cifra cu UNU pe telefon",
      telefon2.length === peTelefon.length - 1,
      `${peTelefon.length} → ${telefon2.length}`,
    );
    ok(
      "și tot cu unu la șef — nu cu trei",
      sef2.due === telefon2.length,
      `șef: ${sef2.due}, telefon: ${telefon2.length}`,
    );
  }

  console.log("\n══ Curățenie ══");
  await curata();
  console.log("  · datele de test șterse");
  console.log(
    `\n${caderi.length === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi.length} eșuate\n`,
  );
  if (caderi.length > 0) {
    console.log("Ce nu se leagă:");
    for (const c of caderi) console.log(`  · ${c}`);
    console.log("");
  }
  await db!.end();
  process.exit(caderi.length === 0 ? 0 : 1);
}

/* ── unelte ── */

/** Numărul de vizite scrise pe o firmă. */
async function nrVizite(cui: string): Promise<number> {
  const [r] = await db!<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM visits WHERE cui = ${cui}
  `;
  return parseInt(r.n, 10);
}

/** Scrie o vizită exact cum o scrie ruta, cu paza contra apăsatului dublu. */
async function inserVizitaCuPaza(magazinId: string) {
  await db!`
    INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, magazin_id)
    SELECT ${AG_A2}, ${NUME_A2}, ${CUI_A}, 'x', 'client', '', ${magazinId}
    WHERE NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.agent_id = ${AG_A2} AND v.cui = ${CUI_A}
        AND v.result = 'client' AND v.note = ''
        AND COALESCE(v.magazin_id, '') = ${magazinId}
        AND v.visited_at > NOW() - INTERVAL '2 minutes'
    )
  `;
}

interface Oprire {
  cui: string;
  magazinId: string;
  denumire: string;
  lat: number | null;
  lng: number | null;
  lastVisit: string | null;
}

/**
 * Opririle scadente ale unui agent, citite prin API-ul adevărat.
 * Nu refac interogarea aici: dacă o rescriu, testez ce am scris eu, nu
 * ce vede agentul pe telefon.
 */
async function scadente(agentId: string): Promise<Oprire[]> {
  const t = await tokenPentru(agentId);
  const { GET } = await import("../src/app/api/visits/route");
  const res = await GET(
    new Request(`http://x/api/visits?token=${encodeURIComponent(t)}&due=1&limit=100`),
  );
  const d = (await res.json()) as { due?: Oprire[] };
  return d.due ?? [];
}


/** Ce vede agentul despre o firmă, prin API-ul LUI (nu prin SQL de-al meu). */
async function firmaVazutaDe(
  agentId: string,
  cui: string,
): Promise<{
  status: string;
  note: string;
  assignedAgent: string;
  soldCents: number | null;
} | null> {
  const t = await tokenPentru(agentId);
  const { GET } = await import("../src/app/api/prospects/route");
  const res = await GET(
    new Request(
      `http://x/api/prospects?token=${encodeURIComponent(t)}&search=${cui}&limit=20`,
    ),
  );
  const d = (await res.json()) as {
    prospects?: Array<{
      cui: string;
      status: string;
      note: string;
      assignedAgent: string;
      soldCents: number | null;
    }>;
  };
  return (d.prospects ?? []).find((p) => p.cui === cui) ?? null;
}

/** Încearcă să scrie pe firmă; întoarce codul HTTP primit. */
async function incearcaSaScrie(agentId: string, cui: string): Promise<number> {
  const t = await tokenPentru(agentId);
  const { PATCH } = await import("../src/app/api/prospects/route");
  const res = await PATCH(
    new Request("http://x/api/prospects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: t,
        cui,
        note: "am scris eu peste, de la firma A",
        status: "respins",
      }),
    }),
  );
  return res.status;
}

/** Completarea de la pornire, exact cum o face schema. */
async function ruleazaCompletarea() {
  await db!`
    UPDATE prospects p
    SET assigned_org = x.org_id
    FROM (
      SELECT name, MIN(org_id) AS org_id
      FROM org_agents
      GROUP BY name
      HAVING COUNT(DISTINCT org_id) = 1
    ) x
    WHERE p.assigned_org = ''
      AND COALESCE(p.assigned_agent,'') <> ''
      AND p.assigned_agent = x.name
  `;
}

async function tokenPentru(agentId: string): Promise<string> {
  const { signToken } = await import("../src/lib/signed-token");
  return signToken(
    {
      agentId,
      agentName: numePentru(agentId),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    process.env.TOKEN_SECRET ?? "",
  );
}


/** Dă retur prin API-ul adevărat al agentului. */
async function retur(
  agentId: string,
  produs: string,
  cantitate: number,
): Promise<{ neatinse?: string[] }> {
  const t = await tokenPentru(agentId);
  const { POST } = await import("../src/app/api/van/route");
  const res = await POST(
    new Request("http://x/api/van", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: t,
        kind: "retur",
        lines: [{ produs, cantitate, um: "buc" }],
      }),
    }),
  );
  return (await res.json()) as { neatinse?: string[] };
}

async function cantitateInDuba(agentId: string, produs: string): Promise<number> {
  const [r] = await db!<Array<{ c: number }>>`
    SELECT cantitate AS c FROM van_stock
    WHERE agent_id = ${agentId} AND lower(btrim(produs)) = ${produs.toLowerCase()}
  `;
  return r?.c ?? 0;
}


/** Scrie o vizită prin API-ul adevărat al agentului. */
async function vizita(agentId: string, cui: string, result: string) {
  const t = await tokenPentru(agentId);
  const { POST } = await import("../src/app/api/visits/route");
  await POST(
    new Request("http://x/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t, cui, result, note: "" }),
    }),
  );
}

async function stareFirmei(cui: string) {
  const [r] = await db!<
    [{ activ: boolean | null; inchis_teren: boolean; status: string }]
  >`
    SELECT activ, inchis_teren, status FROM prospects WHERE cui = ${cui}
  `;
  return r;
}

/**
 * Panoul firmei se cheamă prin HTTP: sesiunea managerului stă într-un
 * cookie, iar cookie-ul se citește din cererea adevărată, nu din aer.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3131";
let cookieManager = "";
async function cookieFirmei(): Promise<string> {
  if (cookieManager) return cookieManager;
  const { semneazaSesiuneTest, COOKIE_NAME } = await import("./_sesiune-test");
  const t = await semneazaSesiuneTest({
    userId: "test-log-user",
    orgId: ORG_A,
    email: "manager@test-logica.ro",
    name: "Managerul lor",
    role: "owner",
  });
  cookieManager = `${COOKIE_NAME}=${t}`;
  return cookieManager;
}

/** Ce vede managerul în panoul firmei, prin API-ul lui. */
async function scoaseDeTeren(): Promise<
  Array<{ cui: string; denumire: string; agent: string }>
> {
  const res = await fetch(`${BASE}/api/agentie/clients?limit=5`, {
    headers: { cookie: await cookieFirmei() },
  });
  const d = (await res.json()) as {
    scoaseDeTeren?: Array<{ cui: string; denumire: string; agent: string }>;
  };
  return d.scoaseDeTeren ?? [];
}

async function redeschide(cui: string): Promise<number> {
  const res = await fetch(`${BASE}/api/agentie/clients`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: await cookieFirmei() },
    body: JSON.stringify({ cui, redeschide: true }),
  });
  return res.status;
}


/** Vizita la un magazin anume, prin API-ul adevărat. */
async function vizitaLaMagazin(agentId: string, cui: string, magazinId: string) {
  const t = await tokenPentru(agentId);
  const { POST } = await import("../src/app/api/visits/route");
  await POST(
    new Request("http://x/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t, cui, magazinId, result: "client", note: "" }),
    }),
  );
}

/** Cifrele de pe tabloul managerului, prin API-ul lui. */
async function tabloulSefului(): Promise<{ due: number; clienti: number }> {
  const res = await fetch(`${BASE}/api/agentie/overview`, {
    headers: { cookie: await cookieFirmei() },
  });
  const d = (await res.json()) as {
    due?: number;
    clients?: { total?: number };
  };
  return { due: d.due ?? -1, clienti: d.clients?.total ?? -1 };
}

function numePentru(agentId: string): string {
  if (agentId === AG_A2) return NUME_A2;
  return NUME_COMUN;
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await db!.end();
  process.exit(1);
});
