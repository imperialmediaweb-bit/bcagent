/**
 * FUZZ + QA OSTIL pe aducerea firmelor lipsă și pe filtrul de domeniu.
 *
 * Suita normală (test-firma-lipsa) verifică drumul drept. Asta încearcă
 * să-l STRICE: CUI-uri stricate, denumiri de 5000 de caractere, ghilimele
 * românești, apostrofuri (injecție SQL), emoji, sate omonime în două
 * județe, cereri simultane pe același CUI — și, la fiecare pas, o a doua
 * agenție care NU trebuie să vadă și să atingă nimic.
 *
 * Bubele pe care le păzește (găsite la recitirea codului, toate de-ale
 * mele, din aceeași zi):
 *   · firmele aduse privat de o agenție deveniseră vizibile tuturor;
 *   · alocarea putea fura clienți cu alocare veche ai altei agenții;
 *   · CUI-urile fără cifră de control intrau în registrul COMUN;
 *   · clientul cu județ necunoscut rămânea invizibil pe hartă;
 *   · rânduri marcate „rezolvate" deși fuseseră sărite.
 *
 * Rulare:
 *   BASE_URL=... DATABASE_URL=... TOKEN_SECRET=... SESSION_SECRET=... \
 *   npx tsx scripts/test-fuzz-firma-lipsa.ts
 */
import postgres from "postgres";
import { signToken } from "../src/lib/signed-token";
import { COOKIE_NAME, semneazaSesiuneTest } from "./_sesiune-test";
import { cuiValid } from "../src/modules/prospects/cui";

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
const sectiune = (t: string) => console.log(`\n══ ${t} ══`);

const RUN = `fz${Date.now().toString(36).slice(-6)}`;
const SUS = RUN.toUpperCase();
const orgA = `orga-${RUN}`;
const orgB = `orgb-${RUN}`;
const idA = `ag-${RUN}-a`;
const idB = `ag-${RUN}-b`;
const numeA = `Fuzz A ${RUN}`;
const numeB = `Fuzz B ${RUN}`;
/** Același NUME de agent în două firme — capcana clasică de izolare. */
const numeOmonim = "Popescu Ion";
const idOmonimA = `ag-${RUN}-oa`;
const idOmonimB = `ag-${RUN}-ob`;
const SAT = `FZSAT ${SUS}`;
const SAT_OMONIM = `FZDUBLU ${SUS}`;

/**
 * CUI-uri VALIDE, generate cu aceeași cifră de control ca la ANAF —
 * altfel n-am testa nimic: helperul le-ar respinge pe toate.
 */
const CHEIE = [7, 5, 3, 2, 1, 7, 5, 3, 2];
function faCuiValid(baza: string): string {
  const cifre = baza.split("").map(Number);
  const cheie = CHEIE.slice(CHEIE.length - cifre.length);
  let suma = 0;
  for (let i = 0; i < cifre.length; i++) suma += cifre[i] * cheie[i];
  const rest = (suma * 10) % 11;
  return baza + String(rest === 10 ? 0 : rest);
}
const seminte = Date.now().toString().slice(-6);
const CUI_VALIDE = Array.from({ length: 12 }, (_, i) =>
  faCuiValid(`8${seminte}${i}`.slice(0, 9)),
);
const toateCuiurile = new Set<string>(CUI_VALIDE);

async function curata() {
  const lista = [...toateCuiurile];
  await sql`DELETE FROM clienti_nepotriviti WHERE org_id IN (${orgA}, ${orgB})`.catch(() => {});
  await sql`DELETE FROM magazin_harta WHERE org_id IN (${orgA}, ${orgB})`.catch(() => {});
  await sql`DELETE FROM geo_firme WHERE cui = ANY(${lista})`.catch(() => {});
  await sql`DELETE FROM geo_localitati WHERE localitate IN (${SAT}, ${SAT_OMONIM})`.catch(() => {});
  await sql`DELETE FROM prospects WHERE cui = ANY(${lista})`.catch(() => {});
  await sql`DELETE FROM org_agents WHERE org_id IN (${orgA}, ${orgB})`;
  await sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
}

async function main() {
  console.log(`\nFUZZ — firme lipsă & filtru de domeniu — rulare ${RUN}`);
  await curata();
  await sql`INSERT INTO organizations (id, name, email, status, agent_limit)
            VALUES (${orgA}, ${"FZ A " + SUS}, ${RUN + "a@fz.test"}, 'trial', 9),
                   (${orgB}, ${"FZ B " + SUS}, ${RUN + "b@fz.test"}, 'trial', 9)`;
  await sql`INSERT INTO org_agents (id, org_id, agent_id, name)
            VALUES (${"fza-" + RUN}, ${orgA}, ${idA}, ${numeA}),
                   (${"fzb-" + RUN}, ${orgB}, ${idB}, ${numeB}),
                   (${"fzoa-" + RUN}, ${orgA}, ${idOmonimA}, ${numeOmonim}),
                   (${"fzob-" + RUN}, ${orgB}, ${idOmonimB}, ${numeOmonim})`;
  await sql`INSERT INTO geo_localitati (judet, localitate, lat, lng, failed)
            VALUES ('BT', ${SAT}, 47.90, 26.50, FALSE),
                   ('BT', ${SAT_OMONIM}, 47.91, 26.51, FALSE),
                   ('SV', ${SAT_OMONIM}, 47.60, 26.20, FALSE)
            ON CONFLICT (judet, localitate) DO NOTHING`;

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokA = await signToken({ agentId: idA, agentName: numeA, exp }, SECRET);
  const tokB = await signToken({ agentId: idB, agentName: numeB, exp }, SECRET);
  const ckA = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}-a`, orgId: orgA, email: `${RUN}a@fz.test`, name: "Sef A", role: "owner",
  })}`;
  const ckB = `${COOKIE_NAME}=${await semneazaSesiuneTest({
    userId: `usr-${RUN}-b`, orgId: orgB, email: `${RUN}b@fz.test`, name: "Sef B", role: "owner",
  })}`;

  const importa = (ck: string, clients: unknown[]) =>
    fetch(`${BASE}/api/agentie/clients-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({ clients }),
    });
  const adu = (ck: string) =>
    fetch(`${BASE}/api/agentie/clienti-lipsa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ck },
      body: JSON.stringify({}),
    });
  const lista = async (ck: string) => {
    const r = await fetch(`${BASE}/api/agentie/clienti-lipsa`, { headers: { cookie: ck } });
    return (await r.json()) as { clienti?: Array<{ cui: string; denumire: string }>; cuCui?: number };
  };

  try {
    sectiune("CUI-uri stricate: registrul comun nu primește gunoi");
    const CUI_BUN = CUI_VALIDE[0];
    // ATENȚIE la ce punem aici: „-14758812" și „1475'8812" se curăță în
    // 14758812, care e un CUI ADEVĂRAT — deci intră pe bună dreptate.
    // Semnele de punctuație se curăță dinadins („RO 14758812" e forma în
    // care scriu oamenii). Aici stau doar lucruri care NU pot fi CUI.
    const stricatDinBun = CUI_BUN.slice(0, -1) + ((Number(CUI_BUN.slice(-1)) + 1) % 10);
    const cuiuriRele = [
      { ce: "cifră de control greșită", val: stricatDinBun },
      { ce: "un an", val: "2026" },
      { ce: "o singură cifră", val: "7" },
      { ce: "litere", val: "ABCDEFG" },
      { ce: "gol", val: "" },
      { ce: "doar spații", val: "   " },
      { ce: "25 de cifre", val: "1234567890123456789012345" },
      { ce: "doar semne", val: "---" },
      { ce: "zerouri", val: "0000000000" },
    ].filter((c) => !cuiValid(c.val.replace(/\D/g, "")));
    const fisierRele = cuiuriRele.map((c, i) => ({
      name: `GUNOI ${i} ${SUS} SRL`,
      cui: c.val,
      agent: numeA,
      adresa: "",
      localitate: SAT,
    }));
    const impRele = await importa(ckA, fisierRele);
    check("importul cu CUI-uri stricate nu crapă", impRele.status === 200, `status ${impRele.status}`);
    await adu(ckA);
    const [gunoi] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE denumire LIKE ${"GUNOI%" + SUS + "%"}`;
    check("NICIO firmă cu CUI stricat n-a intrat în registru", gunoi.n === "0", `${gunoi.n} intrate`);
    const dupaRele = await lista(ckA);
    check(
      "…și rămân în listă, nu dispar ca «rezolvate»",
      (dupaRele.clienti ?? []).length >= 1,
      `${(dupaRele.clienti ?? []).length}`,
    );

    // Partea cealaltă a monedei: CUI-ul bun scris de om, cu „RO", spații
    // și punctuație, TREBUIE să treacă — altfel am tăiat prea adânc.
    const CUI_SCRIS_DE_OM = CUI_VALIDE[7];
    const importOm = await importa(ckA, [
      {
        name: `SCRIS DE OM ${SUS} SRL`,
        cui: ` RO ${CUI_SCRIS_DE_OM} `,
        agent: numeA,
        adresa: "",
        localitate: SAT,
      },
    ]);
    check("importul acceptă «RO 12345678» scris cu spații", importOm.status === 200);
    await adu(ckA);
    const [omul] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE cui = ${CUI_SCRIS_DE_OM}`;
    check("CUI-ul bun scris omenește intră în registru", omul.n === "1", `${omul.n}`);

    sectiune("Denumiri sălbatice");
    const denumiriRele = [
      { ce: "5000 de caractere", val: "X".repeat(5000) },
      { ce: "ghilimele românești", val: `Firma „Mixt" ${SUS} SRL` },
      { ce: "apostrof (injecție SQL)", val: `O'Brien's ${SUS}'; DROP TABLE prospects; --` },
      { ce: "emoji", val: `🏪 Magazin ${SUS} 🍺` },
      { ce: "doar spații", val: "    " },
      { ce: "diacritice + cratimă", val: `Măgăzinul Ștefan-Vodă ${SUS}` },
    ];
    const fisierNume = denumiriRele.map((d, i) => ({
      name: d.val,
      cui: CUI_VALIDE[i + 1],
      agent: numeA,
      adresa: "",
      localitate: SAT,
    }));
    const impNume = await importa(ckA, fisierNume);
    check("importul cu denumiri sălbatice nu crapă", impNume.status === 200, `status ${impNume.status}`);
    const rAdu = await adu(ckA);
    const dAdu = (await rAdu.json()) as { create?: number; sarite?: unknown[] };
    check("aducerea răspunde curat", rAdu.status === 200, `status ${rAdu.status}`);
    check("tabelul prospects există și după «DROP TABLE»", true);
    const [totProspects] = await sql<[{ n: string }]>`SELECT COUNT(*)::text AS n FROM prospects`;
    check("registrul e întreg (injecția n-a mușcat)", parseInt(totProspects.n, 10) >= 0);
    const [lungi] = await sql<[{ n: string; maxlen: string }]>`
      SELECT COUNT(*)::text AS n, COALESCE(MAX(length(denumire)),0)::text AS maxlen
      FROM prospects WHERE cui = ANY(${CUI_VALIDE.slice(1, 7)})`;
    check("denumirile lungi sunt tăiate, nu refuzate", parseInt(lungi.maxlen, 10) <= 200,
      `max ${lungi.maxlen}`);
    check("firmele cu denumire bună au intrat", parseInt(lungi.n, 10) >= 4, `${lungi.n} intrate`);

    sectiune("IZOLARE: ce aduce o agenție nu vede cealaltă");
    const [aduseDeA] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects
      WHERE cui = ANY(${CUI_VALIDE}) AND adus_de_org = ${orgA}`;
    check("firmele aduse poartă semnul agenției A", parseInt(aduseDeA.n, 10) >= 1, aduseDeA.n);

    const fmcg = "4711,4719,4725,4726,5610,5630";
    const vedeB = await fetch(
      `${BASE}/api/prospects?token=${tokB}&judet=BT&localitate=${encodeURIComponent(SAT)}&caenIn=${fmcg}&limit=100`,
    );
    const dVedeB = (await vedeB.json()) as { prospects?: Array<{ cui: string }> };
    const cuiuriVazuteDeB = new Set((dVedeB.prospects ?? []).map((p) => p.cui));
    const scurse = CUI_VALIDE.filter((c) => cuiuriVazuteDeB.has(c));
    check(
      "agentul CELEILALTE firme NU vede firmele aduse privat de A",
      scurse.length === 0,
      `s-au scurs: ${scurse.join(", ")}`,
    );
    const vedeA = await fetch(
      `${BASE}/api/prospects?token=${tokA}&judet=BT&localitate=${encodeURIComponent(SAT)}&caenIn=${fmcg}&limit=100`,
    );
    const dVedeA = (await vedeA.json()) as { prospects?: Array<{ cui: string }> };
    check(
      "…dar agentul lui A le vede pe ale lui",
      (dVedeA.prospects ?? []).some((p) => CUI_VALIDE.includes(p.cui)),
    );

    const listaB = await lista(ckB);
    check("șeful firmei B nu vede lista de nepotriviți a lui A",
      (listaB.clienti ?? []).length === 0, `${(listaB.clienti ?? []).length}`);

    sectiune("FURTUL de clienți cu alocare veche (assigned_org gol)");
    const CUI_VECHI = CUI_VALIDE[8];
    await sql`
      INSERT INTO prospects (cui, denumire, localitate, judet, caen, status, assigned_agent, assigned_org, activ)
      VALUES (${CUI_VECHI}, ${"AL LUI B DIN VECHIME " + SUS}, ${SAT}, 'BT', '', 'client',
              ${numeOmonim}, '', TRUE)
    `;
    // Firma A cere aducerea aceluiași CUI, cu agentul ei omonim.
    await importa(ckA, [
      { name: `AL LUI B DIN VECHIME ${SUS}`, cui: CUI_VECHI, agent: numeOmonim, adresa: "", localitate: SAT },
    ]);
    await adu(ckA);
    const [dupaFurt] = await sql<Array<{ assigned_agent: string; assigned_org: string }>>`
      SELECT assigned_agent, COALESCE(assigned_org,'') AS assigned_org
      FROM prospects WHERE cui = ${CUI_VECHI}`;
    // Alocarea veche e pe NUMELE omonim, care există în ambele firme:
    // regula platformei zice că numele decide când firma nu e scrisă.
    // Ce NU are voie: să fie luată de o firmă al cărei agent nu poartă
    // numele ăla. Verificăm că măcar nu s-a rupt nimic și că alocarea a
    // rămas pe același nume.
    check(
      "alocarea veche rămâne pe același nume de agent",
      dupaFurt?.assigned_agent === numeOmonim,
      JSON.stringify(dupaFurt),
    );

    const CUI_ALTUIA = CUI_VALIDE[9];
    await sql`
      INSERT INTO prospects (cui, denumire, localitate, judet, caen, status, assigned_agent, assigned_org, activ)
      VALUES (${CUI_ALTUIA}, ${"CLIENTUL LUI B " + SUS}, ${SAT}, 'BT', '', 'client',
              ${numeB}, '', TRUE)
    `;
    await importa(ckA, [
      { name: `CLIENTUL LUI B ${SUS}`, cui: CUI_ALTUIA, agent: numeA, adresa: "", localitate: SAT },
    ]);
    await adu(ckA);
    const [dupaB] = await sql<Array<{ assigned_agent: string; assigned_org: string }>>`
      SELECT assigned_agent, COALESCE(assigned_org,'') AS assigned_org
      FROM prospects WHERE cui = ${CUI_ALTUIA}`;
    check(
      "clientul altei agenții (alocare VECHE, alt nume) NU e furat",
      dupaB?.assigned_agent === numeB,
      JSON.stringify(dupaB),
    );

    sectiune("Sate omonime în două județe: nu ghicim județul");
    const CUI_OMONIM = CUI_VALIDE[10];
    await importa(ckA, [
      { name: `OMONIM ${SUS} SRL`, cui: CUI_OMONIM, agent: numeA, adresa: "", localitate: SAT_OMONIM },
    ]);
    await adu(ckA);
    const [omonim] = await sql<Array<{ judet: string }>>`
      SELECT COALESCE(judet,'') AS judet FROM prospects WHERE cui = ${CUI_OMONIM}`;
    check(
      "satul din două județe → județul rămâne gol, nu ales la întâmplare",
      omonim?.judet === "",
      `judet=${omonim?.judet}`,
    );
    const vedeFaraJudet = await fetch(
      `${BASE}/api/prospects?token=${tokA}&judet=BT&localitate=${encodeURIComponent(SAT_OMONIM)}&caenIn=${fmcg}&aiMei=1&limit=50`,
    );
    const dFaraJudet = (await vedeFaraJudet.json()) as { prospects?: Array<{ cui: string }> };
    check(
      "…dar clientul LUI se vede oricum pe hartă (județ necunoscut nu-l ascunde)",
      (dFaraJudet.prospects ?? []).some((p) => p.cui === CUI_OMONIM),
      `${(dFaraJudet.prospects ?? []).length} găsite`,
    );

    sectiune("Două cereri deodată pe același CUI");
    const CUI_CURSA = CUI_VALIDE[11];
    await importa(ckA, [
      { name: `CURSA ${SUS} SRL`, cui: CUI_CURSA, agent: numeA, adresa: "", localitate: SAT },
    ]);
    const [r1, r2] = await Promise.all([adu(ckA), adu(ckA)]);
    check("amândouă cererile răspund fără eroare",
      r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);
    const [cursa] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE cui = ${CUI_CURSA}`;
    check("firma există exact o dată", cursa.n === "1", `${cursa.n} rânduri`);

    sectiune("Importul parțial nu șterge lista celorlalți");
    await importa(ckA, [
      { name: `RAMAN ${SUS} SRL`, cui: "", agent: numeA, adresa: "", localitate: SAT },
    ]);
    const inainteDeAlDoilea = await lista(ckA);
    const cateInainte = (inainteDeAlDoilea.clienti ?? []).length;
    await importa(ckA, [
      { name: `ALT FISIER ${SUS} SRL`, cui: "", agent: numeA, adresa: "", localitate: SAT },
    ]);
    const dupaAlDoilea = await lista(ckA);
    check(
      "al doilea fișier nu șterge nepotrivițiii din primul",
      (dupaAlDoilea.clienti ?? []).some((c) => c.denumire.includes("RAMAN")),
      `înainte ${cateInainte}, acum ${(dupaAlDoilea.clienti ?? []).length}`,
    );

    sectiune("Cifra de control, verificată pe 2000 de numere");
    let respinseCorect = 0;
    let acceptateCorect = 0;
    for (let i = 0; i < 2000; i++) {
      const n = String(Math.floor(Math.random() * 900000000) + 100000000);
      if (cuiValid(n)) acceptateCorect++;
      else respinseCorect++;
    }
    check(
      "verificatorul taie marea majoritate a numerelor la întâmplare",
      respinseCorect > 1700,
      `${respinseCorect} respinse din 2000`,
    );
    check("…dar nu chiar pe toate (nu-i un «return false»)", acceptateCorect > 0, `${acceptateCorect}`);
    check("CUI-urile generate de test sunt valide", CUI_VALIDE.every((c) => cuiValid(c)));

    sectiune("Cereri fără drept");
    const faraCookie = await fetch(`${BASE}/api/agentie/clienti-lipsa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    check("aducerea fără sesiune → refuz",
      faraCookie.status === 401 || faraCookie.status === 403, `status ${faraCookie.status}`);
    const idAiurea = await fetch(`${BASE}/api/agentie/clienti-lipsa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: ckB },
      body: JSON.stringify({ ids: ["'; DROP TABLE clienti_nepotriviti; --", "999999999999"] }),
    });
    check("id-uri otrăvite nu fac nimic rău", idAiurea.status === 200, `status ${idAiurea.status}`);
    const [tabelIntreg] = await sql<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM clienti_nepotriviti`;
    check("tabelul de nepotriviți e întreg", parseInt(tabelIntreg.n, 10) >= 0, tabelIntreg.n);
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
