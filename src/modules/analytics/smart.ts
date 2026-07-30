import type { NormalizedRow } from "@/lib/parse-xls";
import { periodKey, type Metric } from "@/lib/analytics";

/**
 * Analiza „smart" — nivelul 1 din planul de analize:
 *  - scor de performanță per agent (0–100, compus)
 *  - detecție de tendințe periculoase (agent×brand în scădere susținută)
 *  - clienți adormiți (cadență de comandă ruptă)
 *  - oportunități de coș (cross-sell: brand A fără B unde alții au ambele)
 *
 * Toate funcțiile sunt pure — primesc rândurile normalizate din XLS și
 * întorc structuri gata de afișat. „Acum" e ultima dată din date, nu ceasul
 * de perete: analizele rămân corecte și pe fișiere istorice.
 */

export interface AgentScore {
  agent: string;
  /** Scor compus 0–100. */
  score: number;
  components: {
    volum: number;
    clienti: number;
    regularitate: number;
    diversitate: number;
  };
  value: number;
  volume: number;
  uniqueClients: number;
  producers: number;
  trend: "up" | "down" | "flat";
  /** Variația ultimei luni față de precedenta, în %. */
  trendPct: number;
  monthly: Array<{ period: string; metric: number }>;
}

export interface TrendAlert {
  type: "agent-brand" | "echipa";
  agent: string;
  producer: string;
  /** Valorile ultimelor perioade în scădere (vechi → nou). */
  points: Array<{ period: string; metric: number }>;
  dropPct: number;
  note: string;
}

export interface DormantClient {
  client: string;
  /** Agentul cu cele mai multe vânzări la clientul ăsta. */
  agent: string;
  lastDate: string;
  daysSince: number;
  /** Cadența istorică: o comandă la ~N zile. */
  expectedEveryDays: number;
  purchaseDays: number;
  value: number;
  volume: number;
}

export interface BasketOpportunity {
  client: string;
  agent: string;
  /** Brandul pe care clientul ÎL cumpără deja (cel mai puternic al lui). */
  has: string;
  /** Brandul care lipsește din coș. */
  missing: string;
  /** Ce procent din clienții brandului `has` cumpără și `missing`. */
  adoptionPct: number;
  /** Estimare: media pe client a brandului lipsă. */
  estMetric: number;
}

export interface SmartAnalysis {
  referenceDate: string;
  metric: Metric;
  scores: AgentScore[];
  alerts: TrendAlert[];
  dormant: DormantClient[];
  basket: BasketOpportunity[];
}

const DAY = 86_400_000;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function metricOf(r: NormalizedRow, metric: Metric): number {
  return metric === "value" ? r.value : r.volume;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function maxDate(rows: NormalizedRow[]): Date {
  let max = rows[0].date;
  for (const r of rows) if (r.date > max) max = r.date;
  return max;
}

/* ─────────────────────────── scor per agent ───────────────────────── */

/**
 * Scor compus, relativ la echipă:
 *   40% volum/valoare (raportat la cel mai bun agent)
 *   25% clienți unici (raportat la cel mai bun)
 *   20% regularitate (vinde constant lună de lună, nu în valuri)
 *   15% diversitate de branduri (entropie normalizată a mixului)
 */
export function agentScores(
  rows: NormalizedRow[],
  metric: Metric,
): AgentScore[] {
  if (rows.length === 0) return [];

  const agents = new Map<
    string,
    {
      total: number;
      value: number;
      volume: number;
      clients: Set<string>;
      byProducer: Map<string, number>;
      byMonth: Map<string, number>;
    }
  >();
  const allMonths = new Set<string>();

  for (const r of rows) {
    const key = r.agent || "(necunoscut)";
    let a = agents.get(key);
    if (!a) {
      a = {
        total: 0,
        value: 0,
        volume: 0,
        clients: new Set(),
        byProducer: new Map(),
        byMonth: new Map(),
      };
      agents.set(key, a);
    }
    const m = metricOf(r, metric);
    const month = periodKey(r.date, "month");
    allMonths.add(month);
    a.total += m;
    a.value += r.value;
    a.volume += r.volume;
    if (r.client) a.clients.add(r.client);
    if (r.producer && m > 0) {
      a.byProducer.set(r.producer, (a.byProducer.get(r.producer) ?? 0) + m);
    }
    a.byMonth.set(month, (a.byMonth.get(month) ?? 0) + m);
  }

  const months = Array.from(allMonths).sort();
  const maxTotal = Math.max(...Array.from(agents.values(), (a) => a.total), 1);
  const maxClients = Math.max(
    ...Array.from(agents.values(), (a) => a.clients.size),
    1,
  );
  const totalProducers = new Set(
    rows.filter((r) => r.producer).map((r) => r.producer),
  ).size;

  const out: AgentScore[] = [];
  for (const [agent, a] of agents) {
    const volum = (a.total / maxTotal) * 100;
    const clienti = (a.clients.size / maxClients) * 100;

    // Regularitate: coeficient de variație pe lunile în care echipa a activat.
    // Lunile lipsă contează ca 0 — cine dispare o lună e penalizat.
    const series = months.map((m) => a.byMonth.get(m) ?? 0);
    let regularitate = 100;
    if (series.length >= 2) {
      const mean = series.reduce((s, v) => s + v, 0) / series.length;
      if (mean > 0) {
        const variance =
          series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
        const cv = Math.sqrt(variance) / mean;
        regularitate = clamp(100 * (1 - cv), 0, 100);
      } else {
        regularitate = 0;
      }
    }

    // Diversitate: entropie Shannon normalizată pe mixul de branduri.
    let diversitate = 0;
    if (totalProducers > 1 && a.byProducer.size > 0) {
      const sum = Array.from(a.byProducer.values()).reduce((s, v) => s + v, 0);
      if (sum > 0) {
        let h = 0;
        for (const v of a.byProducer.values()) {
          const p = v / sum;
          if (p > 0) h -= p * Math.log(p);
        }
        diversitate = clamp((h / Math.log(totalProducers)) * 100, 0, 100);
      }
    }

    const score =
      0.4 * volum + 0.25 * clienti + 0.2 * regularitate + 0.15 * diversitate;

    // Tendința: ultima lună vs precedenta.
    let trend: AgentScore["trend"] = "flat";
    let trendPct = 0;
    if (months.length >= 2) {
      const last = a.byMonth.get(months[months.length - 1]) ?? 0;
      const prev = a.byMonth.get(months[months.length - 2]) ?? 0;
      if (prev > 0) {
        trendPct = ((last - prev) / prev) * 100;
        if (trendPct > 10) trend = "up";
        else if (trendPct < -10) trend = "down";
      } else if (last > 0) {
        trend = "up";
        trendPct = 100;
      }
    }

    out.push({
      agent,
      score: Math.round(score),
      components: {
        volum: Math.round(volum),
        clienti: Math.round(clienti),
        regularitate: Math.round(regularitate),
        diversitate: Math.round(diversitate),
      },
      value: a.value,
      volume: a.volume,
      uniqueClients: a.clients.size,
      producers: a.byProducer.size,
      trend,
      trendPct: Math.round(trendPct * 10) / 10,
      monthly: months.map((m) => ({
        period: m,
        metric: Math.round(a.byMonth.get(m) ?? 0),
      })),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ──────────────────────── tendințe periculoase ────────────────────── */

/**
 * Steaguri roșii pe seriile lunare:
 *  - un agent scade pe un brand 3 luni la rând (și brandul contează la el)
 *  - toată echipa scade 3 luni la rând
 */
export function trendAlerts(
  rows: NormalizedRow[],
  metric: Metric,
): TrendAlert[] {
  if (rows.length === 0) return [];
  const alerts: TrendAlert[] = [];

  const months = Array.from(
    new Set(rows.map((r) => periodKey(r.date, "month"))),
  ).sort();
  if (months.length < 3) return alerts;
  const lastThree = months.slice(-3);

  // agent×brand
  const pair = new Map<string, Map<string, number>>(); // "agent||brand" → month → metric
  const agentTotals = new Map<string, number>();
  for (const r of rows) {
    if (!r.agent || !r.producer) continue;
    const m = metricOf(r, metric);
    agentTotals.set(r.agent, (agentTotals.get(r.agent) ?? 0) + m);
    const key = `${r.agent}||${r.producer}`;
    let inner = pair.get(key);
    if (!inner) {
      inner = new Map();
      pair.set(key, inner);
    }
    const month = periodKey(r.date, "month");
    inner.set(month, (inner.get(month) ?? 0) + m);
  }

  for (const [key, byMonth] of pair) {
    const [agent, producer] = key.split("||");
    const points = lastThree.map((m) => ({
      period: m,
      metric: Math.round(byMonth.get(m) ?? 0),
    }));
    const [a, b, c] = points.map((p) => p.metric);
    // Scădere strictă pe 3 luni, pornind de la ceva ce contează:
    // brandul e ≥5% din totalul agentului și prima lună are volum real.
    const pairTotal = Array.from(byMonth.values()).reduce((s, v) => s + v, 0);
    const agentTotal = agentTotals.get(agent) ?? 0;
    if (
      a > b &&
      b > c &&
      a > 0 &&
      agentTotal > 0 &&
      pairTotal / agentTotal >= 0.05
    ) {
      const dropPct = Math.round(((a - c) / a) * 100);
      if (dropPct >= 20) {
        alerts.push({
          type: "agent-brand",
          agent,
          producer,
          points,
          dropPct,
          note: `${agent} scade pe ${producer} de 3 luni la rând (−${dropPct}%)`,
        });
      }
    }
  }

  // echipa întreagă
  const teamByMonth = new Map<string, number>();
  for (const r of rows) {
    const month = periodKey(r.date, "month");
    teamByMonth.set(month, (teamByMonth.get(month) ?? 0) + metricOf(r, metric));
  }
  const teamPoints = lastThree.map((m) => ({
    period: m,
    metric: Math.round(teamByMonth.get(m) ?? 0),
  }));
  const [ta, tb, tc] = teamPoints.map((p) => p.metric);
  if (ta > tb && tb > tc && ta > 0) {
    const dropPct = Math.round(((ta - tc) / ta) * 100);
    if (dropPct >= 10) {
      alerts.push({
        type: "echipa",
        agent: "(toată echipa)",
        producer: "",
        points: teamPoints,
        dropPct,
        note: `Vânzările totale scad de 3 luni la rând (−${dropPct}%)`,
      });
    }
  }

  return alerts.sort((x, y) => y.dropPct - x.dropPct);
}

/* ─────────────────────────── clienți adormiți ─────────────────────── */

/**
 * Un client e „adormit" când tăcerea lui e mai lungă decât dublul cadenței
 * lui istorice (minim 21 de zile). Referința e ultima zi din date.
 */
export function dormantClients(
  rows: NormalizedRow[],
  metric: Metric,
  limit = 25,
): DormantClient[] {
  if (rows.length === 0) return [];
  const now = maxDate(rows).getTime();

  const clients = new Map<
    string,
    {
      days: Set<string>;
      last: number;
      value: number;
      volume: number;
      byAgent: Map<string, number>;
    }
  >();
  for (const r of rows) {
    if (!r.client) continue;
    let c = clients.get(r.client);
    if (!c) {
      c = { days: new Set(), last: 0, value: 0, volume: 0, byAgent: new Map() };
      clients.set(r.client, c);
    }
    c.days.add(dayKey(r.date));
    if (r.date.getTime() > c.last) c.last = r.date.getTime();
    c.value += r.value;
    c.volume += r.volume;
    if (r.agent) {
      c.byAgent.set(
        r.agent,
        (c.byAgent.get(r.agent) ?? 0) + metricOf(r, metric),
      );
    }
  }

  const out: DormantClient[] = [];
  for (const [client, c] of clients) {
    // Cu o singură comandă nu putem vorbi de cadență ruptă.
    if (c.days.size < 2) continue;

    const stamps = Array.from(c.days)
      .map((d) => new Date(d + "T00:00:00").getTime())
      .sort((x, y) => x - y);
    const gaps: number[] = [];
    for (let i = 1; i < stamps.length; i++) {
      gaps.push((stamps[i] - stamps[i - 1]) / DAY);
    }
    gaps.sort((x, y) => x - y);
    const medianGap = gaps[Math.floor(gaps.length / 2)] || 30;

    const daysSince = Math.floor((now - c.last) / DAY);
    const threshold = Math.max(21, medianGap * 2);
    if (daysSince <= threshold) continue;

    let agent = "";
    let best = -1;
    for (const [a, v] of c.byAgent) {
      if (v > best) {
        best = v;
        agent = a;
      }
    }

    out.push({
      client,
      agent,
      lastDate: dayKey(new Date(c.last)),
      daysSince,
      expectedEveryDays: Math.round(medianGap),
      purchaseDays: c.days.size,
      value: Math.round(c.value),
      volume: Math.round(c.volume),
    });
  }

  return out
    .sort((x, y) =>
      metric === "value" ? y.value - x.value : y.volume - x.volume,
    )
    .slice(0, limit);
}

/* ───────────────────────── oportunități de coș ────────────────────── */

/**
 * Cross-sell concret: clientul cumpără brandul A dar nu B, deși majoritatea
 * clienților care cumpără A cumpără și B. Oportunitatea = media pe client
 * a brandului lipsă.
 */
export function basketOpportunities(
  rows: NormalizedRow[],
  metric: Metric,
  limit = 25,
  minAdoptionPct = 50,
  minClientsForBrand = 4,
): BasketOpportunity[] {
  if (rows.length === 0) return [];

  const byClient = new Map<
    string,
    { producers: Map<string, number>; byAgent: Map<string, number> }
  >();
  const brandBuyers = new Map<string, Set<string>>();
  const brandTotal = new Map<string, number>();

  for (const r of rows) {
    if (!r.client || !r.producer) continue;
    const m = metricOf(r, metric);
    if (m <= 0) continue;
    let c = byClient.get(r.client);
    if (!c) {
      c = { producers: new Map(), byAgent: new Map() };
      byClient.set(r.client, c);
    }
    c.producers.set(r.producer, (c.producers.get(r.producer) ?? 0) + m);
    if (r.agent) c.byAgent.set(r.agent, (c.byAgent.get(r.agent) ?? 0) + m);
    let buyers = brandBuyers.get(r.producer);
    if (!buyers) {
      buyers = new Set();
      brandBuyers.set(r.producer, buyers);
    }
    buyers.add(r.client);
    brandTotal.set(r.producer, (brandTotal.get(r.producer) ?? 0) + m);
  }

  // Adopție B printre cumpărătorii lui A.
  const brands = Array.from(brandBuyers.keys());
  const adoption = new Map<string, number>(); // "A||B" → %
  for (const a of brands) {
    const buyersA = brandBuyers.get(a)!;
    if (buyersA.size < minClientsForBrand) continue;
    for (const b of brands) {
      if (a === b) continue;
      let both = 0;
      for (const cl of buyersA) {
        if (brandBuyers.get(b)!.has(cl)) both++;
      }
      adoption.set(`${a}||${b}`, (both / buyersA.size) * 100);
    }
  }

  const out: BasketOpportunity[] = [];
  for (const [client, c] of byClient) {
    // Brandul cel mai puternic al clientului = ancora.
    let has = "";
    let hasMetric = -1;
    for (const [p, v] of c.producers) {
      if (v > hasMetric) {
        hasMetric = v;
        has = p;
      }
    }
    if (!has) continue;

    let agent = "";
    let best = -1;
    for (const [a, v] of c.byAgent) {
      if (v > best) {
        best = v;
        agent = a;
      }
    }

    // Cel mai adoptat brand pe care clientul NU îl are.
    let missing = "";
    let missingAdoption = 0;
    for (const b of brands) {
      if (c.producers.has(b)) continue;
      const pct = adoption.get(`${has}||${b}`) ?? 0;
      if (pct > missingAdoption) {
        missingAdoption = pct;
        missing = b;
      }
    }
    if (!missing || missingAdoption < minAdoptionPct) continue;

    const buyers = brandBuyers.get(missing)!.size;
    const estMetric = buyers > 0 ? (brandTotal.get(missing) ?? 0) / buyers : 0;

    out.push({
      client,
      agent,
      has,
      missing,
      adoptionPct: Math.round(missingAdoption),
      estMetric: Math.round(estMetric),
    });
  }

  return out.sort((x, y) => y.estMetric - x.estMetric).slice(0, limit);
}

/* ────────────────────────────── pachet ────────────────────────────── */

export function smartAnalysis(
  rows: NormalizedRow[],
  metric: Metric,
): SmartAnalysis | null {
  if (rows.length === 0) return null;
  return {
    referenceDate: dayKey(maxDate(rows)),
    metric,
    scores: agentScores(rows, metric),
    alerts: trendAlerts(rows, metric),
    dormant: dormantClients(rows, metric),
    basket: basketOpportunities(rows, metric),
  };
}
