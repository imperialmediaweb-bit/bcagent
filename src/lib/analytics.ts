import type { NormalizedRow } from "./parse-xls";

export type Dimension = "agent" | "producer" | "client";
export type Period = "day" | "week" | "month" | "quarter" | "year";
export type Metric = "value" | "volume";

export interface Totals {
  volume: number;
  value: number;
  clients: number;
  transactions: number;
  returns: number;
}

export interface DimensionAggregate {
  key: string;
  volume: number;
  value: number;
  clients: number;
  transactions: number;
}

export interface TimeSeriesPoint {
  period: string;
  volume: number;
  value: number;
  clients: number;
}

export interface AgentEfficiency {
  agent: string;
  volume: number;
  value: number;
  uniqueClients: number;
  transactions: number;
  avgDealSize: number;
  valuePerClient: number;
  activePeriods: number;
}

export interface Filters {
  agents?: string[];
  producers?: string[];
  clients?: string[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface CrossTab {
  rows: string[];
  cols: string[];
  matrix: number[][];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
  max: number;
}

export interface Anomaly {
  type: "return" | "missing" | "implicit" | "outlier";
  row: NormalizedRow;
  note: string;
}

export interface CommissionResult {
  agent: string;
  volume: number;
  value: number;
  inferredValue: number;
  rate: number;
  commission: number;
}

export function periodKey(date: Date, period: Period): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  switch (period) {
    case "day":
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    case "week": {
      const tmp = new Date(Date.UTC(y, date.getMonth(), d));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const week = Math.ceil(
        ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
      );
      return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }
    case "month":
      return `${y}-${String(m).padStart(2, "0")}`;
    case "quarter":
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case "year":
      return String(y);
  }
}

export function applyFilters(rows: NormalizedRow[], f: Filters): NormalizedRow[] {
  return rows.filter((r) => {
    if (f.agents && f.agents.length && !f.agents.includes(r.agent)) return false;
    if (f.producers && f.producers.length && !f.producers.includes(r.producer))
      return false;
    if (f.clients && f.clients.length && !f.clients.includes(r.client))
      return false;
    if (f.dateFrom && r.date < f.dateFrom) return false;
    if (f.dateTo && r.date > f.dateTo) return false;
    return true;
  });
}

export function distinctValues(
  rows: NormalizedRow[],
  field: "agent" | "producer" | "client",
): string[] {
  const s = new Set<string>();
  for (const r of rows) if (r[field]) s.add(r[field]);
  return Array.from(s).sort();
}

export function computeTotals(rows: NormalizedRow[]): Totals {
  let volume = 0;
  let value = 0;
  let returns = 0;
  const clients = new Set<string>();
  for (const r of rows) {
    volume += r.volume;
    value += r.value;
    if (r.volume < 0 || r.value < 0) returns += 1;
    if (r.client) clients.add(r.client);
  }
  return {
    volume,
    value,
    clients: clients.size,
    transactions: rows.length,
    returns,
  };
}

export function hasValueData(rows: NormalizedRow[]): boolean {
  for (const r of rows) if (r.value !== 0) return true;
  return false;
}

export function primaryMetric(rows: NormalizedRow[]): Metric {
  return hasValueData(rows) ? "value" : "volume";
}

export function aggregateByDimension(
  rows: NormalizedRow[],
  dim: Dimension,
  sortBy: Metric = "value",
): DimensionAggregate[] {
  const map = new Map<
    string,
    { volume: number; value: number; clients: Set<string>; transactions: number }
  >();
  for (const r of rows) {
    const key = r[dim] || "(necunoscut)";
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { volume: 0, value: 0, clients: new Set(), transactions: 0 };
      map.set(key, bucket);
    }
    bucket.volume += r.volume;
    bucket.value += r.value;
    bucket.transactions += 1;
    if (r.client) bucket.clients.add(r.client);
  }
  return Array.from(map.entries())
    .map(([key, b]) => ({
      key,
      volume: b.volume,
      value: b.value,
      clients: b.clients.size,
      transactions: b.transactions,
    }))
    .sort((a, b) => b[sortBy] - a[sortBy]);
}

export function timeSeries(
  rows: NormalizedRow[],
  period: Period,
  groupBy?: Dimension,
): {
  points: TimeSeriesPoint[];
  groups?: string[];
  matrix?: Array<Record<string, string | number>>;
} {
  if (!groupBy) {
    const map = new Map<
      string,
      { volume: number; value: number; clients: Set<string> }
    >();
    for (const r of rows) {
      const k = periodKey(r.date, period);
      let b = map.get(k);
      if (!b) {
        b = { volume: 0, value: 0, clients: new Set() };
        map.set(k, b);
      }
      b.volume += r.volume;
      b.value += r.value;
      if (r.client) b.clients.add(r.client);
    }
    const points = Array.from(map.entries())
      .map(([k, b]) => ({
        period: k,
        volume: b.volume,
        value: b.value,
        clients: b.clients.size,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
    return { points };
  }

  const matrix = new Map<
    string,
    Map<string, { volume: number; value: number; clients: Set<string> }>
  >();
  const groups = new Set<string>();
  for (const r of rows) {
    const p = periodKey(r.date, period);
    const g = r[groupBy] || "(necunoscut)";
    groups.add(g);
    let row = matrix.get(p);
    if (!row) {
      row = new Map();
      matrix.set(p, row);
    }
    let b = row.get(g);
    if (!b) {
      b = { volume: 0, value: 0, clients: new Set() };
      row.set(g, b);
    }
    b.volume += r.volume;
    b.value += r.value;
    if (r.client) b.clients.add(r.client);
  }
  const sortedPeriods = Array.from(matrix.keys()).sort();
  const sortedGroups = Array.from(groups).sort();
  const flatMatrix: Array<Record<string, string | number>> = sortedPeriods.map(
    (p) => {
      const obj: Record<string, string | number> = { period: p };
      for (const g of sortedGroups) {
        const b = matrix.get(p)?.get(g);
        obj[g] = b?.value ?? 0;
      }
      return obj;
    },
  );
  const points: TimeSeriesPoint[] = sortedPeriods.map((p) => {
    let volume = 0;
    let value = 0;
    const cl = new Set<string>();
    matrix.get(p)?.forEach((b) => {
      volume += b.volume;
      value += b.value;
      b.clients.forEach((c) => cl.add(c));
    });
    return { period: p, volume, value, clients: cl.size };
  });
  return { points, groups: sortedGroups, matrix: flatMatrix };
}

export function agentEfficiency(
  rows: NormalizedRow[],
  period: Period = "month",
  sortBy: Metric = "value",
): AgentEfficiency[] {
  const map = new Map<
    string,
    {
      volume: number;
      value: number;
      clients: Set<string>;
      transactions: number;
      periods: Set<string>;
    }
  >();
  for (const r of rows) {
    const key = r.agent || "(necunoscut)";
    let b = map.get(key);
    if (!b) {
      b = {
        volume: 0,
        value: 0,
        clients: new Set(),
        transactions: 0,
        periods: new Set(),
      };
      map.set(key, b);
    }
    b.volume += r.volume;
    b.value += r.value;
    b.transactions += 1;
    if (r.client) b.clients.add(r.client);
    b.periods.add(periodKey(r.date, period));
  }
  return Array.from(map.entries())
    .map(([agent, b]) => ({
      agent,
      volume: b.volume,
      value: b.value,
      uniqueClients: b.clients.size,
      transactions: b.transactions,
      avgDealSize: b.transactions > 0 ? b.value / b.transactions : 0,
      valuePerClient: b.clients.size > 0 ? b.value / b.clients.size : 0,
      activePeriods: b.periods.size,
    }))
    .sort((a, b) =>
      sortBy === "value" ? b.value - a.value : b.volume - a.volume,
    );
}

export function crossTab(
  rows: NormalizedRow[],
  rowDim: Dimension,
  colDim: Dimension,
  metric: Metric,
  maxCols = 10,
  maxRows = 20,
): CrossTab {
  const cell = new Map<string, Map<string, number>>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const r of rows) {
    const rk = r[rowDim] || "(necunoscut)";
    const ck = r[colDim] || "(necunoscut)";
    const v = metric === "value" ? r.value : r.volume;
    let inner = cell.get(rk);
    if (!inner) {
      inner = new Map();
      cell.set(rk, inner);
    }
    inner.set(ck, (inner.get(ck) ?? 0) + v);
    rowTotals.set(rk, (rowTotals.get(rk) ?? 0) + v);
    colTotals.set(ck, (colTotals.get(ck) ?? 0) + v);
  }
  const sortedRows = Array.from(rowTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRows)
    .map(([k]) => k);
  const sortedCols = Array.from(colTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCols)
    .map(([k]) => k);
  const matrix: number[][] = sortedRows.map((rk) =>
    sortedCols.map((ck) => cell.get(rk)?.get(ck) ?? 0),
  );
  let max = 0;
  for (const r of matrix) for (const v of r) if (v > max) max = v;
  return {
    rows: sortedRows,
    cols: sortedCols,
    matrix,
    rowTotals: sortedRows.map((k) => rowTotals.get(k) ?? 0),
    colTotals: sortedCols.map((k) => colTotals.get(k) ?? 0),
    grandTotal: Array.from(rowTotals.values()).reduce((a, b) => a + b, 0),
    max,
  };
}

const SUSPICIOUS_TOKENS = [
  "implicit",
  "- implicit -",
  "necunoscut",
  "unknown",
  "n/a",
  "na",
];

function isSuspicious(s: string): boolean {
  if (!s || !s.trim()) return true;
  const norm = s.toLowerCase().replace(/[-_*]/g, " ").replace(/\s+/g, " ").trim();
  return SUSPICIOUS_TOKENS.some((t) => norm === t || norm.includes(t));
}

export function findAnomalies(rows: NormalizedRow[]): Anomaly[] {
  const out: Anomaly[] = [];
  const volumes = rows
    .map((r) => Math.abs(r.volume))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const median = volumes.length
    ? volumes[Math.floor(volumes.length / 2)]
    : 0;
  const outlierThreshold = median * 5;
  for (const r of rows) {
    if (r.volume < 0 || r.value < 0) {
      out.push({
        type: "return",
        row: r,
        note: "Cantitate / valoare negativă (probabil retur / storno)",
      });
      continue;
    }
    if (isSuspicious(r.agent) || isSuspicious(r.producer)) {
      const issues: string[] = [];
      if (isSuspicious(r.agent)) issues.push("agent");
      if (isSuspicious(r.producer)) issues.push("producător");
      const isImplicit =
        (r.agent && /implicit/i.test(r.agent)) ||
        (r.producer && /implicit/i.test(r.producer));
      out.push({
        type: isImplicit ? "implicit" : "missing",
        row: r,
        note: `${issues.join(", ")} ${isImplicit ? '= "- IMPLICIT -"' : "lipsește / necunoscut"}`,
      });
      continue;
    }
    if (outlierThreshold > 0 && Math.abs(r.volume) > outlierThreshold) {
      out.push({
        type: "outlier",
        row: r,
        note: `Cantitate de ${Math.round(
          r.volume / median,
        )}× față de median (${Math.round(median)})`,
      });
    }
  }
  return out;
}

export function computeCommissions(
  rows: NormalizedRow[],
  ratesByAgent: Record<string, number>,
  defaultRate: number,
  avgPricePerUnit: number,
): CommissionResult[] {
  const map = new Map<string, { volume: number; value: number }>();
  for (const r of rows) {
    const key = r.agent || "(necunoscut)";
    let b = map.get(key);
    if (!b) {
      b = { volume: 0, value: 0 };
      map.set(key, b);
    }
    b.volume += r.volume;
    b.value += r.value;
  }
  return Array.from(map.entries())
    .map(([agent, b]) => {
      const rate = ratesByAgent[agent] ?? defaultRate;
      const inferredValue = b.value > 0 ? b.value : b.volume * avgPricePerUnit;
      return {
        agent,
        volume: b.volume,
        value: b.value,
        inferredValue,
        rate,
        commission: inferredValue * (rate / 100),
      };
    })
    .sort((a, b) => b.commission - a.commission);
}
