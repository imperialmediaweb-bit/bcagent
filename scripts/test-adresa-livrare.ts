/**
 * ADRESA DE LIVRARE DIN FIȘIERUL LOR.
 *
 * „Bogdan zice că în fișier sunt și adresele." Erau — dar noi citeam doar
 * numele, CUI-ul și agentul, iar restul coloanelor le aruncam. De-aia
 * „Navighează" îl ducea pe Costin la sediul social: la Andronache, acasă
 * la om, nu la magazin.
 *
 * Adresa de livrare e cea mai bună pe care o putem avea: scrisă de ei,
 * verificată de fiecare mașină care a dus marfă acolo în ultimii ani. Bate
 * și registrul Finanțelor, și OpenStreetMap.
 *
 * Aici verificăm citirea ei din fișiere așa cum ies din SAGA — cu antetele
 * lor, cu rândurile de total, cu coloane lipsă, cu diacritice.
 */

import { parseClientsFile } from "../src/lib/parse-xls";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
  } else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}
function egal(nume: string, primit: unknown, asteptat: unknown) {
  ok(nume, primit === asteptat, `primit „${primit}", așteptat „${asteptat}"`);
}

/** Un CSV ca fișier, cum ajunge din browser. */
function fisier(text: string): ArrayBuffer {
  const b = new TextEncoder().encode(text);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

async function main() {
  console.log("\n── FIȘIERUL CU ADRESA DE LIVRARE ──");
  {
    const p = await parseClientsFile(
      fisier(
        [
          "Denumire;CUI;Agent;Adresa livrare;Localitate livrare",
          "ANDRONACHE MARIA PFA;12345678;Costin Vlad;Strada Cucului 6;Darabani",
          "MAGAZIN MIXT DOINA SRL;23456789;Costin Vlad;Principala 12;Siret",
          "TOTAL;;;;",
        ].join("\n"),
      ),
    );
    egal("citește toți clienții, fără rândul de total", p.clients.length, 2);
    const a = p.clients[0];
    egal("numele", a.name, "ANDRONACHE MARIA PFA");
    egal("CUI-ul", a.cui, "12345678");
    egal("agentul", a.agent, "Costin Vlad");
    egal("ADRESA DE LIVRARE", a.adresa, "Strada Cucului 6");
    egal("localitatea de livrare", a.localitate, "Darabani");
    ok("spune pe ecran ce coloană a găsit", p.columns.adresa === "Adresa livrare", p.columns.adresa);
  }

  console.log("\n── LIVRAREA BATE SEDIUL, CÂND SUNT AMÂNDOUĂ ──");
  // În multe exporturi „Adresa" E sediul social — aia o avem deja de la
  // Finanțe și e fix cea care ne-a dus agentul aiurea. Dacă fișierul are și
  // livrarea, pe ea o luăm.
  {
    const p = await parseClientsFile(
      fisier(
        [
          "Denumire;CUI;Adresa;Adresa de livrare",
          "ANDRONACHE MARIA PFA;12345678;JUD. BOTOSANI ORS. DARABANI STR. PLOPILOR NR.3;Strada Cucului 6",
        ].join("\n"),
      ),
    );
    egal("ia livrarea, nu sediul", p.clients[0]?.adresa, "Strada Cucului 6");
  }

  console.log("\n── DACA E DOAR ADRESA SIMPLA, o luam pe aia ──");
  {
    const p = await parseClientsFile(
      fisier(["Client;CUI;Adresa", "STEJAR SRL;11112222;Strada Garii 4"].join("\n")),
    );
    egal("mai bine ceva decât nimic", p.clients[0]?.adresa, "Strada Garii 4");
  }

  console.log("\n── FIȘIERE FĂRĂ ADRESĂ: nu stricăm nimic ──");
  {
    const p = await parseClientsFile(
      fisier(["Denumire;CUI;Agent", "STEJAR SRL;11112222;Costin Vlad"].join("\n")),
    );
    egal("clientul intră normal", p.clients.length, 1);
    egal("adresa rămâne goală, nu inventată", p.clients[0]?.adresa, "");
    egal("localitatea la fel", p.clients[0]?.localitate, "");
    egal("nu scrie o coloană care nu există", p.columns.adresa, "");
  }

  console.log("\n── ANTETE CUM LE SCRIE LUMEA ──");
  for (const antet of [
    "Punct de lucru",
    "PUNCT LUCRU",
    "Adresa punct de lucru",
    "Loc livrare",
    "Adresă livrare",
    "Destinatie",
  ]) {
    const p = await parseClientsFile(
      fisier([`Denumire;CUI;${antet}`, "STEJAR SRL;11112222;Strada Garii 4"].join("\n")),
    );
    ok(`„${antet}" e recunoscut`, p.clients[0]?.adresa === "Strada Garii 4", p.clients[0]?.adresa);
  }
  for (const antet of ["Localitate", "Oras", "Comuna", "Municipiu"]) {
    const p = await parseClientsFile(
      fisier([`Denumire;CUI;${antet}`, "STEJAR SRL;11112222;Siret"].join("\n")),
    );
    ok(`„${antet}" e localitate`, p.clients[0]?.localitate === "Siret", p.clients[0]?.localitate);
  }

  console.log("\n── CAPCANE ──");
  {
    // O firmă care se cheamă chiar „ADRESA COM SRL" nu e un antet.
    const p = await parseClientsFile(
      fisier(["Denumire;CUI", "ADRESA COM SRL;33334444"].join("\n")),
    );
    egal("un nume de firmă nu e luat drept antet", p.clients[0]?.name, "ADRESA COM SRL");
  }
  {
    // Celule goale în coloana de adresă — nu trebuie să sară clientul.
    const p = await parseClientsFile(
      fisier(
        [
          "Denumire;CUI;Adresa livrare",
          "UNU SRL;11111111;Strada A 1",
          "DOI SRL;22222222;",
          "TREI SRL;33333333;Strada C 3",
        ].join("\n"),
      ),
    );
    egal("toți trei intră", p.clients.length, 3);
    egal("cel fără adresă rămâne cu adresa goală", p.clients[1]?.adresa, "");
    egal("ceilalți își păstrează adresa", p.clients[2]?.adresa, "Strada C 3");
  }
  {
    // Diacritice și separator cu virgulă.
    const p = await parseClientsFile(
      fisier(
        ["Denumire,CUI,Adresă livrare", "ȘTEFAN COM SRL,44445555,Strada Ștefan cel Mare 12"].join("\n"),
      ),
    );
    egal("diacriticele nu se strică", p.clients[0]?.adresa, "Strada Ștefan cel Mare 12");
  }
  {
    // Adresă foarte lungă — se taie, nu crapă.
    const lunga = "Strada ".repeat(100);
    const p = await parseClientsFile(
      fisier(["Denumire;CUI;Adresa livrare", `UNU SRL;11111111;${lunga}`].join("\n")),
    );
    ok("adresa prea lungă se taie la 300", (p.clients[0]?.adresa.length ?? 0) <= 300);
  }
  {
    const p = await parseClientsFile(fisier("Denumire;CUI\n"));
    egal("fișier fără rânduri nu crapă", p.clients.length, 0);
  }

  console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} căzute\n`);
  process.exit(caderi === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
