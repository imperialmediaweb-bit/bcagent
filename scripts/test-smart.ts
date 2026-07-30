/**
 * Teste pentru analiza smart (scor agent, tendințe, adormiți, coș).
 *   pnpm dlx tsx scripts/test-smart.ts
 *
 * Datele sintetice sunt construite ca să aibă răspunsuri CUNOSCUTE —
 * fiecare verificare confirmă o proprietate a algoritmului.
 */

import type { NormalizedRow } from "../src/lib/parse-xls";
import {
  agentScores,
  basketOpportunities,
  dormantClients,
  smartAnalysis,
  trendAlerts,
} from "../src/modules/analytics/smart";

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

function row(
  date: string,
  agent: string,
  producer: string,
  client: string,
  volume: number,
): NormalizedRow {
  return { date: new Date(date + "T00:00:00"), agent, producer, client, volume, value: 0 };
}

function main() {
  console.log("\n── Scor per agent ──");
  // Ana: mare, constantă, diversă. Bogdan: jumătate, într-o singură lună, un brand.
  const scoreRows: NormalizedRow[] = [];
  for (const luna of ["2026-01", "2026-02", "2026-03"]) {
    for (const brand of ["BAT", "PMI", "JTI"]) {
      scoreRows.push(row(`${luna}-10`, "Ana", brand, `client-${brand}`, 100));
    }
  }
  scoreRows.push(row("2026-03-15", "Bogdan", "BAT", "client-b1", 450));

  const scores = agentScores(scoreRows, "volume");
  const ana = scores.find((s) => s.agent === "Ana")!;
  const bogdan = scores.find((s) => s.agent === "Bogdan")!;
  check("Ana are scor mai mare decât Bogdan", ana.score > bogdan.score);
  check("Ana e prima în clasament", scores[0].agent === "Ana");
  check("scorurile sunt în [0, 100]", scores.every((s) => s.score >= 0 && s.score <= 100));
  check("Ana are regularitate maximă (aceeași cifră lunar)", ana.components.regularitate === 100);
  check(
    "Bogdan are regularitate slabă (o singură lună din trei)",
    bogdan.components.regularitate < 40,
    `a ieșit ${bogdan.components.regularitate}`,
  );
  check("Ana are diversitate maximă (toate cele 3 branduri egal)", ana.components.diversitate === 100);
  check("Bogdan are diversitate 0 (un singur brand)", bogdan.components.diversitate === 0);
  check("Ana vinde 900 în total", ana.volume === 900);
  check("seria lunară are 3 puncte", ana.monthly.length === 3);
  check(
    "tendința lui Bogdan e up (0 → 450)",
    bogdan.trend === "up",
  );
  check(
    "tendința Anei e flat (300 → 300)",
    ana.trend === "flat",
  );

  console.log("\n── Tendințe periculoase ──");
  // Radu scade pe BAT: 1000 → 700 → 400. Pe PMI e constant.
  const alertRows: NormalizedRow[] = [
    row("2026-01-05", "Radu", "BAT", "c1", 1000),
    row("2026-02-05", "Radu", "BAT", "c1", 700),
    row("2026-03-05", "Radu", "BAT", "c1", 400),
    row("2026-01-06", "Radu", "PMI", "c2", 500),
    row("2026-02-06", "Radu", "PMI", "c2", 500),
    row("2026-03-06", "Radu", "PMI", "c2", 500),
    // Vlad crește exact cât pierde Radu — echipa rămâne constantă.
    row("2026-01-07", "Vlad", "BAT", "c3", 100),
    row("2026-02-07", "Vlad", "BAT", "c3", 400),
    row("2026-03-07", "Vlad", "BAT", "c3", 700),
  ];
  const alerts = trendAlerts(alertRows, "volume");
  const raduAlert = alerts.find((a) => a.agent === "Radu" && a.producer === "BAT");
  check("scăderea lui Radu pe BAT e detectată", !!raduAlert);
  check("procentul de scădere e 60%", raduAlert?.dropPct === 60);
  check("punctele sunt în ordine cronologică", raduAlert?.points[0].metric === 1000 && raduAlert?.points[2].metric === 400);
  check("Radu pe PMI (constant) NU apare", !alerts.some((a) => a.producer === "PMI"));
  check("Vlad (în creștere) NU apare", !alerts.some((a) => a.agent === "Vlad"));
  check(
    "echipa per total nu scade (Vlad compensează)",
    !alerts.some((a) => a.type === "echipa"),
  );

  // Toată echipa în scădere.
  const teamDown: NormalizedRow[] = [
    row("2026-01-05", "A", "B1", "c", 1000),
    row("2026-02-05", "A", "B1", "c", 800),
    row("2026-03-05", "A", "B1", "c", 600),
  ];
  check(
    "scăderea întregii echipe e detectată",
    trendAlerts(teamDown, "volume").some((a) => a.type === "echipa"),
  );
  check(
    "cu doar 2 luni de date nu se emit alerte",
    trendAlerts(
      [row("2026-01-05", "A", "B", "c", 100), row("2026-02-05", "A", "B", "c", 50)],
      "volume",
    ).length === 0,
  );

  console.log("\n── Clienți adormiți ──");
  const dormantRows: NormalizedRow[] = [];
  // „Fidel": cumpără săptămânal tot anul, până la final — NU e adormit.
  for (let w = 0; w < 20; w++) {
    const d = new Date(new Date("2026-01-05T00:00:00").getTime() + w * 7 * 86400000);
    dormantRows.push(row(d.toISOString().slice(0, 10), "Ana", "BAT", "Fidel", 50));
  }
  // „Pierdut": cumpăra săptămânal în ianuarie–februarie, apoi tăcere totală.
  for (let w = 0; w < 8; w++) {
    const d = new Date(new Date("2026-01-06T00:00:00").getTime() + w * 7 * 86400000);
    dormantRows.push(row(d.toISOString().slice(0, 10), "Bogdan", "PMI", "Pierdut", 200));
  }
  // „Nou": o singură comandă — prea puține date, nu poate fi „adormit".
  dormantRows.push(row("2026-02-01", "Ana", "JTI", "Nou", 30));

  const dormant = dormantClients(dormantRows, "volume");
  check("clientul Pierdut e detectat ca adormit", dormant.some((d) => d.client === "Pierdut"));
  check("clientul Fidel NU e adormit", !dormant.some((d) => d.client === "Fidel"));
  check("clientul cu o singură comandă NU e adormit", !dormant.some((d) => d.client === "Nou"));
  const pierdut = dormant.find((d) => d.client === "Pierdut")!;
  check("agentul responsabil e Bogdan", pierdut.agent === "Bogdan");
  check("cadența istorică detectată e ~7 zile", pierdut.expectedEveryDays === 7);
  check(
    "tăcerea e măsurată față de ultima dată din DATE (nu ceasul de azi)",
    pierdut.daysSince > 60 && pierdut.daysSince < 120,
    `a ieșit ${pierdut.daysSince}`,
  );
  check("volumul istoric e păstrat (8×200)", pierdut.volume === 1600);

  console.log("\n── Oportunități de coș ──");
  const basketRows: NormalizedRow[] = [];
  // 5 clienți cumpără BAT; 4 din 5 cumpără și PMI. „Magazinul-5" doar BAT.
  for (let i = 1; i <= 5; i++) {
    basketRows.push(row("2026-03-01", "Ana", "BAT", `Magazinul-${i}`, 100));
    if (i < 5) basketRows.push(row("2026-03-02", "Ana", "PMI", `Magazinul-${i}`, 80));
  }
  const basket = basketOpportunities(basketRows, "volume");
  const opp = basket.find((b) => b.client === "Magazinul-5");
  check("Magazinul-5 primește recomandare", !!opp);
  check("brandul ancoră e BAT", opp?.has === "BAT");
  check("brandul lipsă e PMI", opp?.missing === "PMI");
  check("adopția e 80% (4 din 5)", opp?.adoptionPct === 80);
  check("estimarea = media PMI per client (80)", opp?.estMetric === 80);
  check(
    "clienții care au deja ambele branduri NU primesc recomandare",
    !basket.some((b) => b.client === "Magazinul-1"),
  );

  // Adopție sub prag → nicio recomandare.
  const weakRows: NormalizedRow[] = [];
  for (let i = 1; i <= 10; i++) {
    weakRows.push(row("2026-03-01", "Ana", "BAT", `M-${i}`, 100));
    if (i <= 2) weakRows.push(row("2026-03-02", "Ana", "PMI", `M-${i}`, 80));
  }
  check(
    "adopție 20% < prag 50% → fără recomandări",
    basketOpportunities(weakRows, "volume").length === 0,
  );

  console.log("\n── Pachetul complet ──");
  const full = smartAnalysis(dormantRows, "volume");
  check("pachetul se construiește", !!full);
  check("data de referință = ultima zi din date", full!.referenceDate === "2026-05-18");
  check("pachetul pe date goale întoarce null", smartAnalysis([], "volume") === null);

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
