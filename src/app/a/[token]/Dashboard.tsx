"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  parseXLSBuffer,
  type NormalizedRow,
  type ParseResult,
} from "@/lib/parse-xls";
import {
  aggregateByDimension,
  agentEfficiency,
  applyFilters,
  computeTotals,
  distinctValues,
  timeSeries,
  type Dimension,
  type Filters,
  type Period,
} from "@/lib/analytics";

const CHART_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const fmtNum = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(n);

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    maximumFractionDigits: 0,
  }).format(n);

export default function Dashboard({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [rows, setRows] = useState<NormalizedRow[]>([]);
  const [parseInfo, setParseInfo] = useState<ParseResult | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Dimension | "none">("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const result = await parseXLSBuffer(buf);
      if (result.rows.length === 0) {
        setError(
          "Fișierul nu conține date valide sau nu s-au putut detecta coloanele necesare.",
        );
      }
      setRows(result.rows);
      setParseInfo(result);
    } catch (e) {
      setError(
        "Eroare la parsarea fișierului: " +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const totals = useMemo(() => computeTotals(filtered), [filtered]);
  const byAgent = useMemo(
    () => aggregateByDimension(filtered, "agent"),
    [filtered],
  );
  const byProducer = useMemo(
    () => aggregateByDimension(filtered, "producer"),
    [filtered],
  );
  const efficiency = useMemo(
    () => agentEfficiency(filtered, period),
    [filtered, period],
  );
  const ts = useMemo(
    () => timeSeries(filtered, period, groupBy === "none" ? undefined : groupBy),
    [filtered, period, groupBy],
  );

  const agents = useMemo(() => distinctValues(rows, "agent"), [rows]);
  const producers = useMemo(() => distinctValues(rows, "producer"), [rows]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">Panou {agentName}</h1>
            <p className="text-xs text-neutral-500">ID agent: {agentId}</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Autentificat prin token
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <section className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-base font-medium">1. Încarcă fișierul XLS de vânzări</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Sistemul detectează automat coloanele (Data, Agent, Producător, Client,
            Volum, Valoare). Acceptă .xlsx, .xls, .csv. Datele rămân în browser.
          </p>
          <div className="mt-4">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="block w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          {loading && (
            <p className="mt-3 text-sm text-neutral-500">Se procesează...</p>
          )}
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          {parseInfo && parseInfo.rows.length > 0 && (
            <div className="mt-4 grid gap-2 rounded-md bg-neutral-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <MappingItem label="Data" value={parseInfo.mapping.date} />
              <MappingItem label="Agent" value={parseInfo.mapping.agent} />
              <MappingItem label="Producător" value={parseInfo.mapping.producer} />
              <MappingItem label="Client" value={parseInfo.mapping.client} />
              <MappingItem label="Volum" value={parseInfo.mapping.volume} />
              <MappingItem label="Valoare" value={parseInfo.mapping.value} />
              <p className="text-neutral-500 sm:col-span-2 lg:col-span-3">
                {parseInfo.rows.length} rânduri procesate
                {parseInfo.skipped > 0
                  ? ` · ${parseInfo.skipped} sărite (dată invalidă)`
                  : ""}
              </p>
            </div>
          )}
        </section>

        {rows.length > 0 && (
          <>
            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi label="Valoare totală" value={fmtMoney(totals.value)} />
              <Kpi label="Volum total" value={fmtNum(totals.volume)} />
              <Kpi label="Clienți unici" value={fmtNum(totals.clients)} />
              <Kpi label="Tranzacții" value={fmtNum(totals.transactions)} />
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-6">
              <h2 className="text-base font-medium">Filtre</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MultiSelect
                  label="Agenți"
                  options={agents}
                  selected={filters.agents ?? []}
                  onChange={(v) => setFilters({ ...filters, agents: v })}
                />
                <MultiSelect
                  label="Producători"
                  options={producers}
                  selected={filters.producers ?? []}
                  onChange={(v) => setFilters({ ...filters, producers: v })}
                />
                <DateRange
                  from={filters.dateFrom}
                  to={filters.dateTo}
                  onChange={(from, to) =>
                    setFilters({ ...filters, dateFrom: from, dateTo: to })
                  }
                />
                <div className="flex items-end">
                  <button
                    type="button"
                    className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
                    onClick={() => setFilters({})}
                  >
                    Resetează filtrele
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-base font-medium">Evoluție vânzări</h2>
                <div className="flex gap-3">
                  <Select
                    label="Perioadă"
                    value={period}
                    options={[
                      ["day", "Zi"],
                      ["week", "Săptămână"],
                      ["month", "Lună"],
                      ["quarter", "Trimestru"],
                      ["year", "An"],
                    ]}
                    onChange={(v) => setPeriod(v as Period)}
                  />
                  <Select
                    label="Grupare"
                    value={groupBy}
                    options={[
                      ["none", "Total"],
                      ["agent", "Per agent"],
                      ["producer", "Per producător"],
                    ]}
                    onChange={(v) => setGroupBy(v as Dimension | "none")}
                  />
                </div>
              </div>
              <div className="mt-6 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  {ts.matrix && ts.groups ? (
                    <LineChart data={ts.matrix}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      {ts.groups.map((g, i) => (
                        <Line
                          key={g}
                          type="monotone"
                          dataKey={g}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  ) : (
                    <LineChart data={ts.points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        name="Valoare"
                      />
                      <Line
                        type="monotone"
                        dataKey="volume"
                        stroke="#10b981"
                        strokeWidth={2}
                        name="Volum"
                      />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-6">
              <h2 className="text-base font-medium">Evoluție număr de clienți</h2>
              <div className="mt-6 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ts.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="clients"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      name="Clienți unici"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <DimensionPanel
                title="Volume per agent"
                data={byAgent}
                labelHead="Agent"
              />
              <DimensionPanel
                title="Volume per producător"
                data={byProducer}
                labelHead="Producător"
              />
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-6">
              <h2 className="text-base font-medium">Raport eficiență per agent</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                    <tr>
                      <th className="py-2 pr-4">Agent</th>
                      <th className="py-2 pr-4">Valoare</th>
                      <th className="py-2 pr-4">Volum</th>
                      <th className="py-2 pr-4">Clienți unici</th>
                      <th className="py-2 pr-4">Tranzacții</th>
                      <th className="py-2 pr-4">Val./client</th>
                      <th className="py-2 pr-4">Avg tranzacție</th>
                      <th className="py-2 pr-4">Perioade active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {efficiency.map((e) => (
                      <tr key={e.agent} className="border-b border-neutral-100">
                        <td className="py-2 pr-4 font-medium">{e.agent}</td>
                        <td className="py-2 pr-4">{fmtMoney(e.value)}</td>
                        <td className="py-2 pr-4">{fmtNum(e.volume)}</td>
                        <td className="py-2 pr-4">{fmtNum(e.uniqueClients)}</td>
                        <td className="py-2 pr-4">{fmtNum(e.transactions)}</td>
                        <td className="py-2 pr-4">{fmtMoney(e.valuePerClient)}</td>
                        <td className="py-2 pr-4">{fmtMoney(e.avgDealSize)}</td>
                        <td className="py-2 pr-4">{e.activePeriods}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function MappingItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="font-medium">{label}:</span>{" "}
      {value ? (
        <span className="text-emerald-700">{value}</span>
      ) : (
        <span className="text-rose-600">(nedetectat)</span>
      )}
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase text-neutral-500">{label}</span>
      <select
        multiple
        className="mt-1 block w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
        size={Math.min(5, Math.max(options.length, 2))}
        value={selected}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions, (o) => o.value))
        }
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase text-neutral-500">{label}</span>
      <select
        className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateRange({
  from,
  to,
  onChange,
}: {
  from?: Date;
  to?: Date;
  onChange: (from?: Date, to?: Date) => void;
}) {
  const toStr = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "");
  const parse = (s: string) => (s ? new Date(s) : undefined);
  return (
    <div>
      <span className="text-xs font-medium uppercase text-neutral-500">Interval</span>
      <div className="mt-1 flex gap-1">
        <input
          type="date"
          value={toStr(from)}
          onChange={(e) => onChange(parse(e.target.value), to)}
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          type="date"
          value={toStr(to)}
          onChange={(e) => onChange(from, parse(e.target.value))}
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}

function DimensionPanel({
  title,
  data,
  labelHead,
}: {
  title: string;
  data: Array<{
    key: string;
    value: number;
    volume: number;
    clients: number;
    transactions: number;
  }>;
  labelHead: string;
}) {
  const top = data.slice(0, 10);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <h3 className="text-base font-medium">{title}</h3>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="key" tick={{ fontSize: 11 }} width={80} />
            <Tooltip />
            <Bar dataKey="value" fill="#0ea5e9" name="Valoare" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-1 pr-3">{labelHead}</th>
              <th className="py-1 pr-3">Valoare</th>
              <th className="py-1 pr-3">Volum</th>
              <th className="py-1 pr-3">Clienți</th>
              <th className="py-1 pr-3">Tranz.</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-neutral-100">
                <td className="py-1 pr-3 font-medium">{d.key}</td>
                <td className="py-1 pr-3">{fmtMoney(d.value)}</td>
                <td className="py-1 pr-3">{fmtNum(d.volume)}</td>
                <td className="py-1 pr-3">{fmtNum(d.clients)}</td>
                <td className="py-1 pr-3">{fmtNum(d.transactions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
