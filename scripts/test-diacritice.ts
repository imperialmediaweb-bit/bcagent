/**
 * Diacritice + encoding-uri românești: fișierele reale vin în UTF-8,
 * Windows-1250 (Excel vechi/SAGA), cu ș/ț „comma-below" (corecte) sau
 * ş/ţ „cedilla" (moștenire Windows) — TOATE trebuie citite și potrivite.
 *
 *   npx tsx scripts/test-diacritice.ts
 */

import { normalizeName, variantsFor } from "../src/lib/name-match";
import { decodeTextSmart, parseClientsFile, parseXLSBuffer } from "../src/lib/parse-xls";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function utf8(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

/** Codăm de mână un string în Windows-1250 (doar literele care ne dor). */
function cp1250(s: string): ArrayBuffer {
  const map: Record<string, number> = {
    "Ă": 0xc3, "ă": 0xe3, "Â": 0xc2, "â": 0xe2, "Î": 0xce, "î": 0xee,
    "Ș": 0xaa, "ș": 0xba, "Ț": 0xde, "ț": 0xfe, // comma-below nu există în CP1250 — SAGA scrie cedilla
    "Ş": 0xaa, "ş": 0xba, "Ţ": 0xde, "ţ": 0xfe,
  };
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (map[ch] !== undefined) out.push(map[ch]);
    else if (code < 128) out.push(code);
    else out.push(0x3f); // '?'
  }
  return new Uint8Array(out).buffer as ArrayBuffer;
}

async function main() {
  console.log("\n══ normalizeName: diacritice ≡ fără diacritice ══");
  check("Ștefan ≡ Stefan (comma-below)", normalizeName("Ștefan") === normalizeName("Stefan"));
  check("Ţugui ≡ Tugui (cedilla)", normalizeName("Ţugui") === normalizeName("Tugui"));
  check("MĂGĂZIN ≡ MAGAZIN", normalizeName("MĂGĂZIN") === "MAGAZIN");
  check("Brânză ≡ Branza", normalizeName("Brânză") === normalizeName("Branza"));
  check("comma-below ≡ cedilla", normalizeName("Țânțar Ș.R.L") === normalizeName("Ţânţar Ş.R.L"));
  check("variante cu diacritice găsesc forma oficială",
    variantsFor("Măgăzinul Șătesc").includes("MAGAZINUL SATESC SRL"));

  console.log("\n══ decodeTextSmart: detecție encoding ══");
  check("UTF-8 curat trece neatins",
    decodeTextSmart(utf8("Denumire;Agent\nBrânză SRL;Ștefan"))?.includes("Brânză") === true);
  const win = decodeTextSmart(cp1250("Denumire;Agent\nBrânză ŞI Ţară SRL;Ştefan"));
  check("Windows-1250 redecodat corect (ş cedilla)", win?.includes("ŞI") === true, JSON.stringify(win?.slice(0, 40)));
  check("binar ZIP → null (nu-l stricăm)",
    decodeTextSmart(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]).buffer as ArrayBuffer) === null);
  check("binar OLE2 (xls) → null",
    decodeTextSmart(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]).buffer as ArrayBuffer) === null);

  console.log("\n══ parseClientsFile: fișiere românești reale ══");
  const r1 = await parseClientsFile(utf8(
    "Denumire client;CUI;Agent\nMĂGAZIN SĂTESC SRL;12345678;Ștefan Țugui\nBRÂNZĂRIA VECHE SRL;;Ioana\n"
  ));
  check("UTF-8 cu diacritice: 2 clienți", r1.clients.length === 2);
  check("numele păstrează diacriticele", r1.clients[0].name === "MĂGAZIN SĂTESC SRL");
  check("agentul cu diacritice extras", r1.clients[0].agent === "Ștefan Țugui");

  const r2 = await parseClientsFile(cp1250(
    "Denumire;CUI;Agent\nMĂGAZIN LA ŢARĂ SRL;99887766;Ştefan\nBĂCĂNIA NOUĂ SRL;;Mihai\n"
  ));
  check("Windows-1250: 2 clienți citiți", r2.clients.length === 2, JSON.stringify(r2.clients));
  check("diacriticele CP1250 nu ies gunoi",
    r2.clients[0].name.includes("ŢARĂ") || r2.clients[0].name.includes("ȚARĂ"));
  check("potrivirea normalizează cedilla din CP1250",
    normalizeName(r2.clients[0].name) === "MAGAZIN LA TARA SRL");

  // Antet cu diacritice pe coloana de agent („Vânzător")
  const r3 = await parseClientsFile(utf8("Client;Vânzător\nPROFIL M SRL;Elena\n"));
  check("antet cu diacritice (Vânzător) detectat", r3.clients[0]?.agent === "Elena");

  // BOM UTF-8 (Excel „CSV UTF-8")
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Denumire\nFIRMA CU BOM SRL\n")]);
  const r4 = await parseClientsFile(bom.buffer as ArrayBuffer);
  check("BOM UTF-8 nu strică antetul", r4.clients.length === 1);

  console.log("\n══ parseXLSBuffer (vânzări): CSV în CP1250 ══");
  const sales = await parseXLSBuffer(cp1250(
    "Data;Agent;Producător;Client;Cantitate\n2026-07-01;Ştefan Ţugui;BAT;BRÂNZĂRIA SRL;100\n2026-07-02;Ştefan Ţugui;JTI;MĂGAZIN SRL;50\n"
  ));
  check("vânzări CP1250: 2 rânduri", sales.rows.length === 2, `got ${sales.rows.length}`);
  check("agentul cu cedilla citit întreg",
    sales.rows[0]?.agent?.includes("tefan") === true, sales.rows[0]?.agent);

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
