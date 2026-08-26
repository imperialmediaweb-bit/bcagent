/**
 * SUPORTUL SE UITĂ ÎN DATELE LOR, NU DĂ SCENARII.
 *
 * Costin a scris din teren, 25.08: „sc ancavit tonic srl, nu găsesc pe
 * hartă". A primit înapoi pași cu butoane care NU EXISTĂ — „Salvează
 * locația curentă", „Setează GPS aici" — și le-a căutat pe telefon, în
 * mașină, degeaba. AI-ul nu știa aplicația, așa că a inventat-o.
 *
 * Un om de la suport care merită plătit s-ar fi uitat în baza LUI:
 * „ANCAVIT TONIC SRL — o ai, la Broscăuți, CUI …, alocată ție, dar
 * n-are loc pus pe hartă".
 *
 * Aici verificăm că faptele alea se scot corect — și, mai important, că
 * se scot DOAR din datele firmei care întreabă. Registrul e comun
 * tuturor firmelor de pe platformă: dacă am scăpa aici, i-am arăta unei
 * agenții clienții alteia.
 */

import { ensureSchema, getDB } from "../src/lib/db";
import {
  cuvinteDeCautat,
  fapteDinDate,
} from "../src/modules/platform/fapte-pentru-suport";
import { CE_ARE_APLICATIA } from "../src/modules/platform/ce-are-aplicatia";

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

const ORG = "test-sup-org";
const ALTORG = "test-sup-alt";
const AG = "test-sup-ag";
const N = "Costin Suport";
const AGSTRAIN = "test-sup-strain";
const NSTRAIN = "Strain Suport";
const CUI_FARA_LOC = "14758812";
const CUI_CU_PIN = "18584450";
const CUI_STRAIN = "29130998";
const TOATE = [CUI_FARA_LOC, CUI_CU_PIN, CUI_STRAIN];

async function curata() {
  await db!`DELETE FROM geo_firme WHERE cui = ANY(${TOATE})`;
  await db!`DELETE FROM prospects WHERE cui = ANY(${TOATE})`;
  await db!`DELETE FROM org_agents WHERE org_id IN (${ORG}, ${ALTORG})`;
  await db!`DELETE FROM organizations WHERE id IN (${ORG}, ${ALTORG})`;
}

async function main() {
  await ensureSchema();
  await curata();

  console.log("\n══ Ce cuvinte căutăm din mesajul lui ══");
  {
    const c = cuvinteDeCautat("sc ancavit tonic srl,nu găsesc pe harta");
    ok("prinde numele firmei", c.includes("ancavit") && c.includes("tonic"), JSON.stringify(c));
    ok("nu cauta dupa srl sau harta", !c.includes("srl") && !c.includes("harta"), JSON.stringify(c));
    const c2 = cuvinteDeCautat("La Broscauti nu am firma Aghiorghitoaie Costel Vlad");
    ok("prinde și satul, și numele omului",
       c2.includes("broscauti") && c2.includes("aghiorghitoaie"), JSON.stringify(c2));
    ok("mesaj gol nu crapă", cuvinteDeCautat("").length === 0);
  }

  console.log("\n══ Pregătesc două firme ══");
  for (const [id, nume] of [[ORG, "Firma Suport"], [ALTORG, "Vecina Suport"]]) {
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
    INSERT INTO prospects (cui, denumire, judet, localitate, status, assigned_agent, adresa)
    VALUES (${CUI_FARA_LOC}, 'ANCAVIT TONIC SRL', 'BT', 'Broscăuți', 'client', ${N}, ''),
           (${CUI_CU_PIN}, 'AGHIORGHIŢOAIE COSTEL VLAD II', 'BT', 'Broscăuți', 'client', ${N}, 'STR PRINCIPALA 12'),
           (${CUI_STRAIN}, 'ANCAVIT VECINUL SRL', 'BT', 'Dorohoi', 'client', ${NSTRAIN}, '')
  `;
  await db!`
    INSERT INTO geo_firme (cui, lat, lng, sursa, pus_de)
    VALUES (${CUI_CU_PIN}, 47.9, 26.5, 'gps', ${N})
  `;

  console.log("\n══ Nu gasesc ANCAVIT TONIC pe harta ══");
  {
    const f = await fapteDinDate(db!, ORG, [N], "sc ancavit tonic srl,nu găsesc pe harta");
    ok("a găsit-o în bază", f.gasite >= 1, `gasite ${f.gasite}`);
    ok("spune cum se cheamă", f.text.includes("ANCAVIT TONIC SRL"), f.text);
    ok("spune unde e", f.text.includes("Broscăuți"), f.text);
    ok("spune al cui e", f.text.includes(`alocată lui ${N}`), f.text);
    ok("SPUNE DE CE NU APARE: n-are loc pe hartă", f.text.includes("FĂRĂ loc pe hartă"), f.text);
    ok("și că n-are adresă în acte", f.text.includes("FĂRĂ adresă"), f.text);
    ok(
      "NU-i arată firma vecinului, desi are ANCAVIT in nume",
      !f.text.includes("ANCAVIT VECINUL"),
      f.text,
    );
  }

  console.log("\n══ Diacriticele nu ascund firma ══");
  {
    // Omul a scris fără diacritice; în bază e „AGHIORGHIŢOAIE" cu ţ cedilă.
    const f = await fapteDinDate(db!, ORG, [N], "La Broscauti nu am firma Aghiorghitoaie Costel Vlad");
    ok("o găsește oricum", f.text.includes("AGHIORGHI"), f.text);
    ok(
      "și spune că locul ei e pus de agent la fața locului",
      f.text.includes("pus de un agent"),
      f.text,
    );
  }

  console.log("\n══ Cifrele firmei ══");
  {
    const f = await fapteDinDate(db!, ORG, [N], "ceva");
    ok("spune câți clienți are firma", /Firma are 2 clienți/.test(f.text), f.text);
    ok("și câți au loc pe hartă", /1 au loc pe hartă/.test(f.text), f.text);
  }

  console.log("\n══ IZOLARE: vecinul nu vede clienții noștri ══");
  {
    const f = await fapteDinDate(db!, ALTORG, [NSTRAIN], "ancavit tonic");
    ok("vede doar firma lui", f.text.includes("ANCAVIT VECINUL"), f.text);
    ok("NU vede ANCAVIT TONIC al nostru", !f.text.includes("ANCAVIT TONIC"), f.text);
  }
  {
    const f = await fapteDinDate(db!, "", [], "ancavit");
    ok("fără firmă, fără date", f.text === "" && f.gasite === 0);
  }

  console.log("\n══ Firma care CHIAR nu există ══");
  {
    const f = await fapteDinDate(db!, ORG, [N], "Mirdak Design srl,nu îl am pe harta");
    ok(
      "spune limpede că nu e în bază deloc",
      f.text.includes("NICIO") && f.text.includes("nu e în bază"),
      f.text,
    );
  }

  console.log("\n══ Ghidul aplicației e adevărat ══");
  {
    // Numele butoanelor din ghid trebuie să existe în ecrane, altfel îi
    // dăm omului iar instrucțiuni false — exact greșeala de la care am
    // pornit.
    ok("pomeneste butonul real Pune locul", CE_ARE_APLICATIA.includes("Pune locul"));
    ok("si Sunt aici acum", CE_ARE_APLICATIA.includes("Sunt aici acum"));
    ok("si Porneste ruta de azi", CE_ARE_APLICATIA.includes("Pornește ruta de azi"));
    ok(
      "SPUNE CE NU EXISTĂ, ca să nu se mai inventeze",
      CE_ARE_APLICATIA.includes("Salvează locația curentă") &&
        CE_ARE_APLICATIA.includes("NU EXISTĂ"),
    );
    ok("e destul de bogat ca să folosească la ceva", CE_ARE_APLICATIA.length > 2000);
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
