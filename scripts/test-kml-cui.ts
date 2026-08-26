/**
 * PINURILE LUI BOGDAN AU TABEL, NU DOAR NUME.
 *
 * Poza din 26.08: apeși pe un pin din harta lui și-ți arată tot:
 *
 *   Nume Outlet   VOROBCHEVICI I ADRIAN VASILE AF
 *   Nume Legal    VOROBCHEVICI
 *   Tip Outlet    Bar/Pub
 *   Cod Fiscal    14758812          ← CUI-ul, scris acolo
 *   Adresa        STR PRINCIPALA 183A   ← CU NUMĂR DE CASĂ
 *   Localitate    Humoreni
 *   Judet         Suceava
 *
 * Noi citeam doar eticheta pinului și potriveam după NUME — adică
 * ghiceam, când răspunsul era scris în pin. De-aia au rămas 1756 de
 * pinuri nepotrivite din 2450.
 *
 * Aici verificăm că le citim, oricum le-ar scrie Google (ExtendedData,
 * SchemaData sau tabel în descriere), și că potrivirea se face pe CUI —
 * exact, fără ghicit.
 */

import { citesteKML } from "../src/modules/prospects/kml";
import { potriveștePuncte } from "../src/modules/prospects/potrivire";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) treceri++;
  else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}
function egal(nume: string, primit: unknown, asteptat: unknown) {
  ok(nume, primit === asteptat, `primit „${primit}", așteptat „${asteptat}"`);
}

/** Un pin cu câmpurile în ExtendedData — cum le dă My Maps de obicei. */
function pinExtendedData(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><kml><Document>
    <Placemark>
      <name>VOROBCHEVICI I ADRIAN VASILE AF</name>
      <ExtendedData>
        <Data name="Nume Outlet"><value>VOROBCHEVICI I ADRIAN VASILE AF</value></Data>
        <Data name="Nume Legal"><value>VOROBCHEVICI</value></Data>
        <Data name="Tip Outlet"><value>Bar/Pub</value></Data>
        <Data name="Cod Fiscal"><value>14758812</value></Data>
        <Data name="Adresa"><value>STR PRINCIPALA 183A</value></Data>
        <Data name="Localitate"><value>Humoreni</value></Data>
        <Data name="Judet"><value>Suceava</value></Data>
      </ExtendedData>
      <Point><coordinates>26.0660711,47.6252651,0</coordinates></Point>
    </Placemark>
  </Document></kml>`;
}

/** Același pin, dar cu SchemaData — cealaltă formă a My Maps. */
function pinSchemaData(): string {
  return `<kml><Document><Placemark>
      <name>pin fara nume bun</name>
      <ExtendedData><SchemaData schemaUrl="#s">
        <SimpleData name="Nume Outlet">MAGAZIN MIXT DOINA</SimpleData>
        <SimpleData name="Cod Fiscal">RO 23456789</SimpleData>
        <SimpleData name="Adresa">STR GARII 4</SimpleData>
        <SimpleData name="Localitate">Siret</SimpleData>
      </SchemaData></ExtendedData>
      <Point><coordinates>26.07,47.95,0</coordinates></Point>
  </Placemark></Document></kml>`;
}

/** Și forma în care totul e scris ca tabel HTML în descriere. */
function pinDescriere(): string {
  return `<kml><Document><Placemark>
      <name>BAR LA VALE</name>
      <description><![CDATA[
        <table>
          <tr><td>Nume Legal:</td><td>VALE COM SRL</td></tr>
          <tr><td>Tip Outlet:</td><td>Bar/Pub</td></tr>
          <tr><td>Cod Fiscal:</td><td>11223344</td></tr>
          <tr><td>Adresa:</td><td>STR MORII 12</td></tr>
          <tr><td>Localitate:</td><td>Zamostea</td></tr>
        </table>
      ]]></description>
      <Point><coordinates>26.10,47.90,0</coordinates></Point>
  </Placemark></Document></kml>`;
}

console.log("\n── CITIM TABELUL DIN PIN ──");
{
  const p = citesteKML(pinExtendedData())[0];
  ok("am citit pinul", p !== undefined);
  egal("numele de pe firmă", p?.nume, "VOROBCHEVICI I ADRIAN VASILE AF");
  egal("CUI-UL", p?.cui, "14758812");
  egal("adresa CU NUMĂR", p?.adresa, "STR PRINCIPALA 183A");
  egal("localitatea", p?.localitate, "Humoreni");
  egal("județul", p?.judet, "Suceava");
  egal("felul locului", p?.fel, "Bar/Pub");
  ok("locul", p?.lat === 47.6252651 && p?.lng === 26.0660711, `${p?.lat},${p?.lng}`);
}
{
  const p = citesteKML(pinSchemaData())[0];
  egal("SchemaData: numele bun bate eticheta pinului", p?.nume, "MAGAZIN MIXT DOINA");
  egal("SchemaData: CUI-ul, curatat de prefixul RO", p?.cui, "23456789");
  egal("SchemaData: adresa", p?.adresa, "STR GARII 4");
}
{
  const p = citesteKML(pinDescriere())[0];
  egal("descriere ca tabel: CUI-ul", p?.cui, "11223344");
  egal("descriere ca tabel: adresa", p?.adresa, "STR MORII 12");
  egal("descriere ca tabel: localitatea", p?.localitate, "Zamostea");
}

console.log("\n── POTRIVIREA SE FACE PE CUI, NU PE NUME ──");
{
  // Cazul din realitate: numele de pe pin („VOROBCHEVICI I ADRIAN VASILE
  // AF") nu seamănă mai deloc cu denumirea din registru. După nume, ar fi
  // rămas nepotrivit — sau, mai rău, lipit de altcineva.
  const puncte = citesteKML(pinExtendedData());
  const firme = [
    { cui: "14758812", denumire: "VOROBCHEVICI ADRIAN-VASILE INTREPRINDERE INDIVIDUALA", localitate: "Humoreni" },
    { cui: "99999999", denumire: "VOROBCHEVICI COM SRL", localitate: "Suceava" },
  ];
  const r = potriveștePuncte(puncte, firme, 0.7);
  egal("s-a legat de firma cu CUI-ul din pin", r[0]?.client?.cui, "14758812");
  egal("și e sigur, nu ghicit", r[0]?.scor, 1);
  ok("scrie de ce", (r[0]?.motiv ?? "").includes("CUI"), r[0]?.motiv);
}
{
  // CUI-ul din pin NU e în listele firmei: rămâne de prospectat. NU-l
  // legăm de o firmă cu nume asemănător — ȘTIM a cui e și știm că nu e al
  // nostru. Aici ghicitul ar trimite agentul la ușa greșită.
  const puncte = citesteKML(pinExtendedData());
  const firme = [
    { cui: "77777777", denumire: "VOROBCHEVICI ADRIAN VASILE AF", localitate: "Humoreni" },
  ];
  const r = potriveștePuncte(puncte, firme, 0.7);
  egal("CUI necunoscut → nu-l legăm de nimeni", r[0]?.client, null);
}
{
  // Pin FĂRĂ CUI: merge mai departe pe nume, ca înainte. Nu stricăm ce
  // funcționa pentru hărțile simple.
  const kml = `<kml><Document><Placemark><name>MAGAZIN MIXT DOINA</name>
    <Point><coordinates>26.07,47.95,0</coordinates></Point></Placemark></Document></kml>`;
  const r = potriveștePuncte(citesteKML(kml), [
    { cui: "23456789", denumire: "MAGAZIN MIXT DOINA SRL", localitate: "Siret" },
  ], 0.7);
  egal("fără CUI, tot se potrivește după nume", r[0]?.client?.cui, "23456789");
  ok("și rămâne sigur", (r[0]?.scor ?? 0) >= 0.9, String(r[0]?.scor));
}

console.log("\n── ȘASE MAGAZINE ALE ACELEIAȘI FIRME ──");
{
  // Ovi Tacomax are 6 puncte, toate cu ACELAȘI CUI. Primul ia firma;
  // celelalte se raportează ca puncte de lucru, nu se lipesc aiurea de
  // alte firme.
  const pinuri = [1, 2, 3, 4].map(
    (i) => `<Placemark><name>OVI-TACOMAX ${i}</name>
      <ExtendedData><Data name="Cod Fiscal"><value>18584450</value></Data></ExtendedData>
      <Point><coordinates>${26.0 + i / 100},47.9,0</coordinates></Point></Placemark>`,
  );
  const r = potriveștePuncte(
    citesteKML(`<kml><Document>${pinuri.join("")}</Document></kml>`),
    [
      { cui: "18584450", denumire: "OVI-TACOMAX SRL", localitate: "Zlatunoaia" },
      { cui: "55555555", denumire: "OVI COM SRL", localitate: "Zlatunoaia" },
    ],
    0.7,
  );
  egal("toate patru citite", r.length, 4);
  egal("una singură primește firma", r.filter((x) => x.client !== null).length, 1);
  ok(
    "celelalte sunt raportate ca puncte de lucru, nu legate de altcineva",
    r.filter((x) => x.client === null).every((x) => /punct de lucru/i.test(x.motiv)),
    JSON.stringify(r.filter((x) => x.client === null).map((x) => x.motiv)),
  );
  ok("niciuna n-a ajuns la OVI COM SRL", !r.some((x) => x.client?.cui === "55555555"));
}

console.log("\n── LUCRURI CARE NU TREBUIE SĂ CRAPE ──");
{
  const kml = `<kml><Document><Placemark><name>X</name>
    <ExtendedData><Data name="Cod Fiscal"><value>nu e un cui</value></Data></ExtendedData>
    <Point><coordinates>26.07,47.95,0</coordinates></Point></Placemark></Document></kml>`;
  egal("CUI fără cifre = fără CUI", citesteKML(kml)[0]?.cui, "");
}
{
  const kml = `<kml><Document><Placemark><name>X</name>
    <ExtendedData><Data name="Cod Fiscal"><value></value></Data></ExtendedData>
    <Point><coordinates>26.07,47.95,0</coordinates></Point></Placemark></Document></kml>`;
  egal("câmp gol nu strică nimic", citesteKML(kml)[0]?.cui, "");
}
{
  const kml = `<kml><Document><Placemark>
    <ExtendedData><Data name="Nume Outlet"><value>DOAR DIN TABEL</value></Data></ExtendedData>
    <Point><coordinates>26.07,47.95,0</coordinates></Point></Placemark></Document></kml>`;
  egal("pin fără etichetă, dar cu nume în tabel", citesteKML(kml)[0]?.nume, "DOAR DIN TABEL");
}
{
  const kml = `<kml><Document><Placemark><name>X</name>
    <ExtendedData><Data name="COD FISCAL"><value>12345678</value></Data></ExtendedData>
    <Point><coordinates>26.07,47.95,0</coordinates></Point></Placemark></Document></kml>`;
  egal("numele câmpului scris cu majuscule tot merge", citesteKML(kml)[0]?.cui, "12345678");
}
{
  const kml = `<kml><Document><Placemark><name>X</name>
    <ExtendedData><Data name="Judeţ"><value>Botoşani</value></Data></ExtendedData>
    <Point><coordinates>26.07,47.95,0</coordinates></Point></Placemark></Document></kml>`;
  egal("numele câmpului cu diacritice tot merge", citesteKML(kml)[0]?.judet, "Botoşani");
}
egal("KML gol nu crapă", citesteKML("").length, 0);
egal("gunoi nu crapă", citesteKML("<html>ups</html>").length, 0);

console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} căzute\n`);
process.exit(caderi === 0 ? 0 : 1);
