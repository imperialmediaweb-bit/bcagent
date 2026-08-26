/**
 * FIRMELE ADUSE ÎN REGISTRU DIN HARTĂ.
 *
 * Din harta lui Bogdan, 1634 de pinuri au CUI-uri care nu-s nicăieri în
 * registrul nostru. Nu-s greșeli: sunt firme adevărate, cu nume, cod
 * fiscal, adresă cu număr de casă și loc pus de mână de cineva care a
 * fost acolo. Registrul de la Finanțe nu le-a adus.
 *
 * Le aducem noi. Dar registrul e COMUN tuturor agențiilor de pe
 * platformă: un rând stricat aici îl vede toată lumea și nu-l mai scoate
 * nimeni. De-aia verificăm aici, la sânge, TOT ce poate strica:
 *
 *   · un CUI cu cifra de control greșită NU intră;
 *   · o firmă care există deja NU se atinge — nici denumirea, nici
 *     adresa, nici alocarea pe agent;
 *   · pinul pus de agent pe teren NU se pierde;
 *   · aceeași firmă pe două pinuri intră o dată;
 *   · ce a devenit firmă nu mai apare și ca punct mov pe hartă;
 *   · a doua apăsare nu adaugă nimic în plus.
 */

import { ensureSchema, getDB } from "../src/lib/db";
import { aplicaHarta } from "../src/modules/prospects/harta-aplica";
import { citesteKML } from "../src/modules/prospects/kml";
import { cuiValid } from "../src/modules/prospects/cui";

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

const ORG = "test-fh-org";
const ALTORG = "test-fh-alt";
const AG = "test-fh-ag";
const AGSTRAIN = "test-fh-strain";
const N = "Costin FH";
const NSTRAIN = "Strain FH";

// CUI-uri ADEVĂRATE (cifra de control corectă), luate din datele reale.
const CUI_NOU = "14758812";
const CUI_NOU2 = "18109370";
const CUI_EXISTENT = "18584450";
const CUI_AL_MEU = "6704005";
const CUI_STRAIN = "29130998";
const CUI_STRICAT = "12345678"; // cifra de control greșită
const TOATE = [CUI_NOU, CUI_NOU2, CUI_EXISTENT, CUI_AL_MEU, CUI_STRAIN, CUI_STRICAT];

function pin(o: {
  nume: string;
  cui?: string;
  numeLegal?: string;
  adresa?: string;
  localitate?: string;
  judet?: string;
  lat: number;
  lng: number;
}): string {
  const camp = (n: string, v?: string) =>
    v ? `<Data name="${n}"><value>${v}</value></Data>` : "";
  return `<Placemark><name>${o.nume}</name><ExtendedData>
    ${camp("Cod Fiscal", o.cui)}${camp("Nume Legal", o.numeLegal)}
    ${camp("Adresa", o.adresa)}${camp("Localitate", o.localitate)}${camp("Judet", o.judet)}
  </ExtendedData><Point><coordinates>${o.lng},${o.lat},0</coordinates></Point></Placemark>`;
}
const harta = (p: string[]) => `<kml><Document>${p.join("")}</Document></kml>`;

async function curata() {
  await db!`DELETE FROM geo_firme WHERE cui = ANY(${TOATE})`;
  await db!`DELETE FROM prospects WHERE cui = ANY(${TOATE})`;
  await db!`DELETE FROM magazin_harta WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG}, ${ALTORG})`;
}

async function firma(cui: string) {
  const [r] = await db!<
    Array<{
      denumire: string;
      adresa: string;
      localitate: string;
      judet: string;
      status: string;
      assigned_agent: string;
    }>
  >`
    SELECT denumire, COALESCE(adresa, '') AS adresa,
           COALESCE(localitate, '') AS localitate, COALESCE(judet, '') AS judet,
           status, COALESCE(assigned_agent, '') AS assigned_agent
    FROM prospects WHERE cui = ${cui}
  `;
  return r ?? null;
}
async function loc(cui: string) {
  const [r] = await db!<Array<{ lat: number; lng: number; sursa: string }>>`
    SELECT lat, lng, sursa FROM geo_firme WHERE cui = ${cui}
  `;
  return r ?? null;
}

async function main() {
  await ensureSchema();
  await curata();

  console.log("\n══ Pregătesc terenul ══");
  for (const [id, nume] of [[ORG, "Firma FH"], [ALTORG, "Firma Vecina FH"]]) {
    await db!`INSERT INTO organizations (id, name, status) VALUES (${id}, ${nume}, 'activ')
              ON CONFLICT (id) DO UPDATE SET status = 'activ'`;
  }
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AG}, ${ORG}, ${AG}, ${N}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ORG}, name = ${N}`;
  await db!`INSERT INTO org_agents (id, org_id, agent_id, name, active)
            VALUES (${AGSTRAIN}, ${ALTORG}, ${AGSTRAIN}, ${NSTRAIN}, TRUE)
            ON CONFLICT (id) DO UPDATE SET org_id = ${ALTORG}, name = ${NSTRAIN}`;
  // O firmă care EXISTĂ deja, cu denumirea ei de la Finanțe.
  await db!`
    INSERT INTO prospects (cui, denumire, adresa, localitate, judet, status, assigned_agent)
    VALUES (${CUI_EXISTENT}, 'DENUMIRE DE LA FINANTE SRL', 'ADRESA VECHE', 'Zlatunoaia', 'BT', 'nou', '')
  `;
  // Un client al firmei, cu pinul pus de agent pe teren.
  await db!`
    INSERT INTO prospects (cui, denumire, judet, localitate, status, assigned_agent)
    VALUES (${CUI_AL_MEU}, 'CLIENTUL MEU SRL', 'SV', 'Siret', 'client', ${N})
  `;
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, sursa, pus_de)
    VALUES (${CUI_AL_MEU}, 47.9500, 26.0700, 'gps', ${N})
  `;
  // O firmă a ALTEI agenții.
  await db!`
    INSERT INTO prospects (cui, denumire, judet, localitate, status, assigned_agent)
    VALUES (${CUI_STRAIN}, 'AL VECINULUI SRL', 'SV', 'Siret', 'client', ${NSTRAIN})
  `;

  const puncte = citesteKML(
    harta([
      pin({
        nume: "MAGAZIN VOROBCHEVICI",
        cui: CUI_NOU,
        numeLegal: "VOROBCHEVICI I ADRIAN VASILE AF",
        adresa: "STR PRINCIPALA 183A",
        localitate: "Humoreni",
        judet: "Suceava",
        lat: 47.6252,
        lng: 26.0660,
      }),
      pin({ nume: "AL DOILEA NOU", cui: CUI_NOU2, adresa: "STR GARII 4", localitate: "Siret", judet: "SV", lat: 47.95, lng: 26.07 }),
      // aceeași firmă nouă, pe al doilea pin — nu trebuie băgată de două ori
      pin({ nume: "VOROBCHEVICI PUNCT 2", cui: CUI_NOU, adresa: "STR MORII 2", localitate: "Humoreni", judet: "SV", lat: 47.63, lng: 26.07 }),
      pin({ nume: "EXISTENTA", cui: CUI_EXISTENT, numeLegal: "NUME DE PE HARTA SRL", adresa: "ADRESA DE PE HARTA 5", localitate: "Zlatunoaia", judet: "BT", lat: 47.80, lng: 26.90 }),
      pin({ nume: "CLIENTUL MEU", cui: CUI_AL_MEU, adresa: "STR NOUA 1", localitate: "Siret", judet: "SV", lat: 47.10, lng: 26.10 }),
      pin({ nume: "AL VECINULUI", cui: CUI_STRAIN, adresa: "STR LOR 9", localitate: "Siret", judet: "SV", lat: 47.20, lng: 26.20 }),
      pin({ nume: "CU CUI STRICAT", cui: CUI_STRICAT, adresa: "STR X 1", localitate: "Siret", judet: "SV", lat: 47.30, lng: 26.30 }),
      pin({ nume: "FARA NICIUN CUI", adresa: "STR Y 2", localitate: "Siret", judet: "SV", lat: 47.40, lng: 26.40 }),
    ]),
  );
  ok("harta de probă s-a citit", puncte.length === 8, `sunt ${puncte.length}`);

  console.log("\n══ Verificarea nu scrie nimic ══");
  {
    await aplicaHarta(db!, ORG, [N], puncte, true);
    ok("firma nouă n-a fost creată la simpla verificare", (await firma(CUI_NOU)) === null);
    const [c] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM magazin_harta WHERE org_id = ${ORG}
    `;
    ok("și niciun magazin n-a fost salvat", c.n === "0", c.n);
  }

  console.log("\n══ Aducem firmele ══");
  const r = await aplicaHarta(db!, ORG, [N], puncte);
  ok("două firme noi aduse în registru", r.firmeNoi === 2, `sunt ${r.firmeNoi}`);
  ok("CUI-ul stricat a fost oprit", r.cuiStricat === 1, `sunt ${r.cuiStricat}`);

  {
    const f = await firma(CUI_NOU);
    ok("firma nouă există acum", f !== null);
    ok("cu denumirea din acte, nu cu numele de pe pin", f?.denumire === "VOROBCHEVICI I ADRIAN VASILE AF", f?.denumire);
    ok("cu adresa CU NUMĂR din pin", f?.adresa === "STR PRINCIPALA 183A", f?.adresa);
    ok("cu localitatea ei", f?.localitate === "Humoreni", f?.localitate);
    ok("cu judetul adus la cod: Suceava devine SV", f?.judet === "SV", f?.judet);
    ok("ca PROSPECT, nu ca și client", f?.status === "nou", f?.status);
    ok("NEALOCATĂ — nu i-o luăm nimănui", f?.assigned_agent === "", f?.assigned_agent);
    const l = await loc(CUI_NOU);
    ok("și cu locul exact de pe hartă", l !== null && Math.abs(l.lat - 47.6252) < 0.001, JSON.stringify(l));
  }

  console.log("\n══ CE NU TREBUIE ATINS ══");
  {
    const f = await firma(CUI_EXISTENT);
    ok("firma care exista deja și-a păstrat denumirea de la Finanțe", f?.denumire === "DENUMIRE DE LA FINANTE SRL", f?.denumire);
    ok("și adresa ei veche", f?.adresa === "ADRESA VECHE", f?.adresa);
  }
  {
    const l = await loc(CUI_AL_MEU);
    ok("pinul pus de agent pe teren e NEATINS", l?.sursa === "gps", l?.sursa);
    ok("și n-a fost mutat de hartă", l !== null && Math.abs(l.lat - 47.95) < 0.001, JSON.stringify(l));
  }
  {
    const f = await firma(CUI_STRAIN);
    ok("firma altei agenții e tot a lor", f?.assigned_agent === NSTRAIN, f?.assigned_agent);
    ok("harta noastră nu i-a pus loc", (await loc(CUI_STRAIN)) === null);
  }
  ok("CUI-ul stricat n-a intrat în registru", (await firma(CUI_STRICAT)) === null);
  ok("cifra de control chiar îl respinge", !cuiValid(CUI_STRICAT));

  console.log("\n══ FĂRĂ DUBLURI ══");
  {
    const [c] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE cui = ${CUI_NOU}
    `;
    ok("aceeași firmă pe două pinuri = un singur rând", c.n === "1", c.n);
    const mag = await db!<Array<{ nume: string; cui: string }>>`
      SELECT nume, COALESCE(cui, '') AS cui FROM magazin_harta WHERE org_id = ${ORG}
    `;
    // PRIMUL pin i-a devenit firmei locul pe hartă, deci nu mai apare și
    // ca punct mov. AL DOILEA pin al aceleiași firme rămâne punct —
    // dinadins: e al doilea ei magazin. Ovi Tacomax are șase, iar unul
    // dintre clienții lui Bogdan are treizeci; dacă n-am ține punctele
    // astea, agentul ar crede că are o oprire când are șase.
    ok(
      "primul pin a devenit locul firmei, nu mai e si punct mov",
      !mag.some((m) => m.nume === "MAGAZIN VOROBCHEVICI"),
      JSON.stringify(mag.map((m) => m.nume)),
    );
    ok(
      "al doilea magazin al aceleiasi firme RAMANE pe harta",
      mag.some((m) => m.nume === "VOROBCHEVICI PUNCT 2" && m.cui === CUI_NOU),
      JSON.stringify(mag.map((m) => `${m.nume}/${m.cui}`)),
    );
    ok(
      "dar pinul fără CUI rămâne punct de prospectat",
      mag.some((m) => m.nume === "FARA NICIUN CUI"),
      JSON.stringify(mag.map((m) => m.nume)),
    );
    ok(
      "și cel cu CUI stricat rămâne tot punct, nu se pierde",
      mag.some((m) => m.nume === "CU CUI STRICAT"),
      JSON.stringify(mag.map((m) => m.nume)),
    );
  }

  console.log("\n══ A DOUA APĂSARE nu mai adaugă nimic ══");
  {
    const r2 = await aplicaHarta(db!, ORG, [N], puncte);
    ok("zero firme noi a doua oară", r2.firmeNoi === 0, `sunt ${r2.firmeNoi}`);
    ok("și zero locuri rescrise degeaba", r2.scrise === 0, `sunt ${r2.scrise}`);
    ok("dar spune că le-a găsit, nu că n-a făcut nimic", r2.neatinse > 0, `neatinse ${r2.neatinse}`);
    const [c] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM prospects WHERE cui = ANY(${TOATE})
    `;
    ok("în registru sunt tot 5 firme, nu 7", c.n === "5", c.n);
  }

  console.log("\n══ ALTĂ AGENȚIE nu vede munca noastră ca fiind a ei ══");
  {
    // Firma nouă e nealocată, deci apare în registrul comun — asta e
    // regula platformei. Dar nu e clientul nimănui.
    const f = await firma(CUI_NOU);
    ok("firma adusă nu e clientul nimănui", f?.assigned_agent === "", f?.assigned_agent);
    const [c] = await db!<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM magazin_harta WHERE org_id = ${ALTORG}
    `;
    ok("magazinele rămân doar la firma care le-a adus", c.n === "0", c.n);
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
