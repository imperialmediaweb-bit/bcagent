import type { NormalizedRow } from "./parse-xls";

const AGENTS = [
  "Andrei Ionescu",
  "Maria Pop",
  "Ștefan Dumitrescu",
  "Elena Marin",
  "Radu Voicu",
];
const PRODUCERS = [
  "Heineken",
  "Coca-Cola",
  "Ursus Breweries",
  "Pepsi",
  "Tymbark",
  "Borsec",
];
const CLIENTS = [
  "Carrefour",
  "Lidl",
  "Kaufland",
  "Profi",
  "Mega Image",
  "Auchan",
  "Penny",
  "Selgros",
  "Metro",
  "Cora",
  "La Doi Pași",
  "Mic.ro",
  "HoReCa Local SRL",
  "DistribuPlus SA",
  "Express Market",
  "Family Shop",
  "Quick Mart",
  "City Store",
  "Vivo Hypermarket",
  "BestBuy RO",
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generateSampleData(): NormalizedRow[] {
  const rand = seededRandom(42);
  const rows: NormalizedRow[] = [];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const daysInMonth = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + 1,
      0,
    ).getDate();
    const monthGrowth = 1 + m * 0.04 + (rand() - 0.5) * 0.15;
    const txCount = Math.floor(40 + rand() * 30);

    for (let t = 0; t < txCount; t++) {
      const day = 1 + Math.floor(rand() * daysInMonth);
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const agent = AGENTS[Math.floor(rand() * AGENTS.length)];
      const producer = PRODUCERS[Math.floor(rand() * PRODUCERS.length)];
      const client = CLIENTS[Math.floor(rand() * CLIENTS.length)];
      const volume = Math.round((20 + rand() * 480) * monthGrowth);
      const value = Math.round(volume * (15 + rand() * 35));
      rows.push({ date, agent, producer, client, volume, value });
    }
  }
  return rows;
}
