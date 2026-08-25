/**
 * RUTA CHIAR SE DESCHIDE ÎN GOOGLE MAPS (reclamația lui Costin, 25.08:
 * „când vreau să merg pe rute noi (clienți de pe hartă) nu îmi dă niciun
 * traseu").
 *
 * Cauza: pe rută, punctele intermediare se trimiteau ca TEXT — iar de azi
 * chiar cu numele firmei în față („MAGAZIN X, SAT Y") pentru adresele fără
 * număr. La o singură destinație Google caută magazinul și-l găsește; la
 * DIRECȚII cu mai multe opriri, un punct nerezolvat face Google să refuze
 * TOT traseul. Regula nouă, verificată aici:
 *   1. dacă știm poziția exactă (pin geocodat / GPS de la „Am fost") →
 *      punctul pleacă drept COORDONATE (nu poate fi greșit înțeles);
 *   2. altfel → adresa simplă (stradă, sat, județ), FĂRĂ numele firmei;
 *   3. opririle fără nicio adresă utilă nu strică ruta celorlalte;
 *   4. ruta lungă se sparge în etape de 10, fără să piardă opriri;
 *   5. navigarea către UN client păstrează numele (acolo ajută).
 */
import { legMapsUrl, navAddress, planRoute } from "../src/lib/route-nav";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const cuPin = {
  cui: "111",
  denumire: "OLIVER MARKET SRL",
  adresa: "SAT PODU COSNEI",
  localitate: "PODU COSNEI",
  lat: 47.4321,
  lng: 25.1234,
};
const faraPin = {
  cui: "222",
  denumire: "MIHAI CEZICA MAGAZIN MIXT",
  adresa: "SAT HILISEU-CLOSCA",
  localitate: "HILISEU-CLOSCA",
};
const faraNimic = { cui: "333", denumire: "FIRMA FARA ADRESA", adresa: "", localitate: "" };

console.log("\n══ Punctele de pe rută ══");
const url1 = legMapsUrl([cuPin, faraPin], "SV");
const decodat = decodeURIComponent(url1);
check("ruta produce un link Google Maps", url1.startsWith("https://www.google.com/maps/dir/"));
check(
  "clientul cu poziție exactă pleacă drept COORDONATE",
  decodat.includes("47.4321,25.1234"),
  decodat,
);
check(
  "clientul fără poziție pleacă cu adresa, FĂRĂ numele firmei",
  decodat.includes("SAT HILISEU-CLOSCA") && !decodat.includes("MIHAI CEZICA"),
  decodat,
);
check("adresa are județul și țara (dezambiguizare sate omonime)", decodat.includes("Suceava") && decodat.includes("Romania"));

console.log("\n══ Opriri fără adresă utilă ══");
const url2 = legMapsUrl([cuPin, faraNimic], "SV");
check(
  "oprirea fără adresă NU strică ruta celorlalte",
  url2.includes("47.4321%2C25.1234") || decodeURIComponent(url2).includes("47.4321,25.1234"),
  url2,
);
check("ruta doar cu opriri fără adresă întoarce link gol (UI-ul explică)", legMapsUrl([faraNimic], "SV") === "");

console.log("\n══ Etape și continuare ══");
const multe = Array.from({ length: 23 }, (_, i) => ({
  cui: `9${i}`,
  denumire: `FIRMA ${i}`,
  adresa: `Str. ${i} nr. ${i + 1}`,
  localitate: "RADAUTI",
}));
const plan = planRoute(multe, [], "SV");
check("23 de opriri → 3 etape (limita Google = 10)", plan.legs.length === 3, String(plan.legs.length));
check("nicio oprire pierdută", plan.legs.flat().length === 23);
check("fiecare etapă are linkul ei", plan.urls.filter(Boolean).length === 3);
const planContinuat = planRoute(multe, ["90", "91", "92"], "SV");
check("continuarea sare peste cele bifate azi", planContinuat.remaining.length === 20 && planContinuat.done === 3);

console.log("\n══ Navigarea către UN singur client ══");
check(
  "la o singură destinație numele firmei RĂMÂNE (așa o găsește Google în sat)",
  navAddress({ ...faraPin, judet: "BT" }).startsWith("MIHAI CEZICA"),
  navAddress({ ...faraPin, judet: "BT" }),
);
check(
  "cu stradă și număr, numele nu mai e nevoie",
  !navAddress({ adresa: "Str. Mare nr. 12", localitate: "RADAUTI", judet: "SV", denumire: "X SRL" }).includes("X SRL"),
);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
process.exit(fail === 0 ? 0 : 1);
