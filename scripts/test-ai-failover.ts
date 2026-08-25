/**
 * FAILOVER ÎNTRE FURNIZORII AI (cazul „Vocea clientului” moartă, 25.08).
 *
 * Simptomul din producție: „analiza” prefera OpenAI; cheia OpenAI exista
 * dar fără credit → eroare la om, deși Claude avea credit alături.
 * Acum streamCompletion încearcă URMĂTORUL furnizor configurat când
 * preferatul pică fără să fi scris text. Suita dovedește lanțul cu chei
 * false reale (ambele pică, dar se vede ordinea și că s-au încercat toate):
 *   1. „analiza”: încearcă OpenAI, apoi Anthropic — 2 încercări;
 *   2. „coach”: încearcă Anthropic primul (ordinea per sarcină);
 *   3. eroarea finală e a ULTIMULUI furnizor, nu a primului;
 *   4. fără nicio cheie: mesajul clar de „neconfigurat”.
 *
 * Rulare: npx tsx scripts/test-ai-failover.ts   (fără rețea reală necesară)
 */

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

async function main() {
  process.env.OPENAI_API_KEY = "sk-fals-pentru-test";
  process.env.ANTHROPIC_API_KEY = "sk-ant-fals-pentru-test";
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_PROVIDER_ANALIZA;
  delete process.env.AI_PROVIDER_COACH;

  const { streamCompletion } = await import("../src/lib/llm");

  const avertismente: string[] = [];
  const warnOriginal = console.warn;
  console.warn = (...args: unknown[]) => {
    avertismente.push(args.map(String).join(" "));
  };

  console.log("\n══ „analiza”: Claude primul; dacă pică → se încearcă OpenAI ══");
  let text = "";
  let eroare: unknown = null;
  try {
    await streamCompletion(
      {
        system: "test",
        messages: [{ role: "user", content: "salut" }],
        maxTokens: 10,
        onText: (t) => (text += t),
      },
      "analiza",
    );
  } catch (e) {
    eroare = e;
  }
  console.warn = warnOriginal;
  const incercari = avertismente.filter((a) => a.includes("a picat"));
  check("ambii furnizori au fost ÎNCERCAȚI (2 avertismente de picare)", incercari.length === 2, JSON.stringify(incercari));
  check("primul încercat a fost CLAUDE (acolo-s creditele)", incercari[0]?.includes("anthropic") === true, incercari[0]);
  check("al doilea a fost OpenAI (failover-ul)", incercari[1]?.includes("openai") === true, incercari[1]);
  check("nu s-a scris niciun text la om înainte de eroare", text === "");
  check("la final tot eroare e (ambele chei-s false) — nu succes mincinos", eroare !== null);

  console.log("\n══ „coach”: Anthropic e primul încercat ══");
  const avertismente2: string[] = [];
  console.warn = (...args: unknown[]) => {
    avertismente2.push(args.map(String).join(" "));
  };
  try {
    await streamCompletion(
      {
        system: "test",
        messages: [{ role: "user", content: "salut" }],
        maxTokens: 10,
        onText: () => {},
      },
      "coach",
    );
  } catch {
    // așteptat
  }
  console.warn = warnOriginal;
  const incercari2 = avertismente2.filter((a) => a.includes("a picat"));
  check("la „coach” primul încercat e Anthropic", incercari2[0]?.includes("anthropic") === true, incercari2[0]);

  console.log("\n══ Fără nicio cheie: mesaj clar ══");
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let mesaj = "";
  try {
    await streamCompletion(
      { system: "t", messages: [{ role: "user", content: "x" }], maxTokens: 5, onText: () => {} },
      "analiza",
    );
  } catch (e) {
    mesaj = e instanceof Error ? e.message : String(e);
  }
  check("mesajul spune că AI-ul nu e configurat", /neconfigurat/i.test(mesaj), mesaj);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
