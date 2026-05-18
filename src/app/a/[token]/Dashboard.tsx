"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Building2,
  Calendar,
  CircleUserRound,
  Coins,
  Download,
  Factory,
  FileSpreadsheet,
  Filter,
  Grid3X3,
  LineChart as LineChartIcon,
  LogOut,
  PieChart as PieChartIcon,
  Sparkles,
  Trophy,
  Upload,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  computeCommissions,
  computeTotals,
  crossTab,
  distinctValues,
  findAnomalies,
  hasValueData,
  periodKey,
  timeSeries,
  type Dimension,
  type Filters,
  type Metric,
  type Period,
} from "@/lib/analytics";
import { generateSampleData } from "@/lib/sample-data";
import { downloadCSV } from "@/lib/csv-export";
import AIInsights from "./AIInsights";

const PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#3b82f6",
  "#84cc16",
];

const fmtNum = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(n);
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    maximumFractionDigits: 0,
  }).format(n);
const fmtCompact = (n: number) =>
  new Intl.NumberFormat("ro-RO", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export default function Dashboard({
  agentId,
  agentName,
  token,
  aiEnabled,
}: {
  agentId: string;
  agentName: string;
  token: string;
  aiEnabled: boolean;
}) {
  const [rows, setRows] = useState<NormalizedRow[]>([]);
  const [parseInfo, setParseInfo] = useState<ParseResult | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Dimension | "none">("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [defaultRate, setDefaultRate] = useState(5);
  const [avgPrice, setAvgPrice] = useState(1);
  const [agentRates, setAgentRates] = useState<Record<string, number>>({});

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const result = await parseXLSBuffer(buf);
      if (result.rows.length === 0) {
        setError(
          "Fișierul nu conține date valide sau coloanele nu au putut fi detectate.",
        );
      }
      setRows(result.rows);
      setParseInfo(result);
      setIsDemo(false);
      setAgentRates({});
    } catch (e) {
      setError(
        "Eroare la parsarea fișierului: " +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setLoading(false);
    }
  }

  function loadDemo() {
    setRows(generateSampleData());
    setIsDemo(true);
    setParseInfo(null);
    setError(null);
    setAgentRates({});
  }

  function reset() {
    setRows([]);
    setParseInfo(null);
    setIsDemo(false);
    setFilters({});
    setAgentRates({});
  }

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const metric: Metric = useMemo(
    () => (hasValueData(filtered) ? "value" : "volume"),
    [filtered],
  );
  const totals = useMemo(() => computeTotals(filtered), [filtered]);
  const byAgent = useMemo(
    () => aggregateByDimension(filtered, "agent", metric),
    [filtered, metric],
  );
  const byProducer = useMemo(
    () => aggregateByDimension(filtered, "producer", metric),
    [filtered, metric],
  );
  const byClient = useMemo(
    () => aggregateByDimension(filtered, "client", metric),
    [filtered, metric],
  );
  const efficiency = useMemo(
    () => agentEfficiency(filtered, period, metric),
    [filtered, period, metric],
  );
  const ts = useMemo(
    () =>
      timeSeries(filtered, period, groupBy === "none" ? undefined : groupBy),
    [filtered, period, groupBy],
  );
  const matrix = useMemo(
    () => crossTab(filtered, "agent", "producer", metric, 10, 20),
    [filtered, metric],
  );
  const anomalies = useMemo(() => findAnomalies(filtered), [filtered]);
  const commissions = useMemo(
    () => computeCommissions(filtered, agentRates, defaultRate, avgPrice),
    [filtered, agentRates, defaultRate, avgPrice],
  );

  const deltas = useMemo(() => computeDeltas(filtered, period), [filtered, period]);
  const transactionsByPeriod = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) {
      const k = periodKey(r.date, period);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, n]) => ({ x: k, y: n }));
  }, [filtered, period]);

  const sparklines = useMemo(
    () => ({
      value: ts.points.map((p) => ({ x: p.period, y: p.value })),
      volume: ts.points.map((p) => ({ x: p.period, y: p.volume })),
      clients: ts.points.map((p) => ({ x: p.period, y: p.clients })),
      transactions: transactionsByPeriod,
    }),
    [ts.points, transactionsByPeriod],
  );

  const agents = useMemo(() => distinctValues(rows, "agent"), [rows]);
  const producers = useMemo(() => distinctValues(rows, "producer"), [rows]);

  const aiSummary = useMemo(() => {
    if (filtered.length === 0) return null;
    let min = filtered[0].date;
    let max = filtered[0].date;
    for (const r of filtered) {
      if (r.date < min) min = r.date;
      if (r.date > max) max = r.date;
    }
    const trim = (
      arr: Array<{
        key: string;
        volume: number;
        value: number;
        clients: number;
        transactions: number;
      }>,
    ) =>
      arr.slice(0, 8).map((a) => ({
        key: a.key,
        volume: Math.round(a.volume),
        value: Math.round(a.value),
        clients: a.clients,
        transactions: a.transactions,
      }));
    const anomalyByType = anomalies.reduce<Record<string, number>>(
      (acc, a) => {
        acc[a.type] = (acc[a.type] ?? 0) + 1;
        return acc;
      },
      {},
    );
    return {
      metric,
      period,
      totals: {
        volume: Math.round(totals.volume),
        value: Math.round(totals.value),
        clients: totals.clients,
        transactions: totals.transactions,
        returns: totals.returns,
      },
      dateRange: {
        min: min.toISOString().slice(0, 10),
        max: max.toISOString().slice(0, 10),
      },
      byAgent: trim(byAgent),
      byProducer: trim(byProducer),
      byClient: trim(byClient),
      evolution: ts.points.slice(-24).map((p) => ({
        period: p.period,
        value: Math.round(p.value),
        volume: Math.round(p.volume),
        clients: p.clients,
      })),
      agentProducerMatrix: {
        rows: matrix.rows.slice(0, 6),
        cols: matrix.cols.slice(0, 6),
        matrix: matrix.matrix
          .slice(0, 6)
          .map((row) => row.slice(0, 6).map((v) => Math.round(v))),
      },
      anomalies: {
        total: anomalies.length,
        byType: anomalyByType,
        examples: anomalies.slice(0, 8).map((a) => ({
          type: a.type,
          agent: a.row.agent || "(necunoscut)",
          producer: a.row.producer || "(necunoscut)",
          volume: a.row.volume,
          note: a.note,
        })),
      },
    };
  }, [
    filtered,
    metric,
    period,
    totals,
    byAgent,
    byProducer,
    byClient,
    ts.points,
    matrix,
    anomalies,
  ]);

  const hasData = rows.length > 0;
  const valueless = metric === "volume";

  function exportCSV() {
    if (!filtered.length) return;
    downloadCSV(
      `vanzari_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Data", "Agent", "Producător", "Client", "Cantitate", "Valoare"],
      filtered.map((r) => [
        r.date.toISOString().slice(0, 10),
        r.agent,
        r.producer,
        r.client,
        r.volume,
        r.value,
      ]),
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar hasData={hasData} />

      <div className="lg:pl-60">
        <Topbar
          agentName={agentName}
          agentId={agentId}
          hasData={hasData}
          isDemo={isDemo}
          onExport={exportCSV}
          onReset={reset}
        />

        <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
          <Hero
            agentName={agentName}
            hasData={hasData}
            loading={loading}
            error={error}
            isDemo={isDemo}
            parseInfo={parseInfo}
            rows={rows}
            onFile={handleFile}
            onDemo={loadDemo}
          />

          {hasData && (
            <>
              {valueless && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Mod cantitate</p>
                    <p className="text-xs">
                      Nu s-a detectat coloană de valoare — toate clasamentele și KPI-urile folosesc <strong>cantitatea</strong>. Pentru estimări în RON, setează prețul mediu în secțiunea Comisioane.
                    </p>
                  </div>
                </div>
              )}

              <section id="overview" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<BarChart3 className="h-5 w-5" />}
                  title="Privire de ansamblu"
                  subtitle={`${fmtNum(filtered.length)} tranzacții în intervalul selectat`}
                />
                <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {!valueless && (
                    <KpiCard
                      label="Valoare totală"
                      value={fmtMoney(totals.value)}
                      delta={deltas.value}
                      spark={sparklines.value}
                      color="#6366f1"
                      icon={<Sparkles className="h-4 w-4" />}
                    />
                  )}
                  <KpiCard
                    label={valueless ? "Cantitate totală" : "Volum total"}
                    value={fmtCompact(totals.volume)}
                    delta={deltas.volume}
                    spark={sparklines.volume}
                    color="#10b981"
                    icon={<BarChart3 className="h-4 w-4" />}
                  />
                  <KpiCard
                    label="Clienți unici"
                    value={fmtNum(totals.clients)}
                    delta={deltas.clients}
                    spark={sparklines.clients}
                    color="#8b5cf6"
                    icon={<Users className="h-4 w-4" />}
                  />
                  <KpiCard
                    label="Tranzacții"
                    value={fmtNum(totals.transactions)}
                    delta={deltas.transactions}
                    spark={sparklines.transactions}
                    color="#f59e0b"
                    icon={<FileSpreadsheet className="h-4 w-4" />}
                  />
                  {valueless && (
                    <KpiCard
                      label="Storno-uri"
                      value={fmtNum(totals.returns)}
                      delta={null}
                      spark={[]}
                      color="#ef4444"
                      icon={<AlertTriangle className="h-4 w-4" />}
                    />
                  )}
                </div>
              </section>

              <InsightsStrip
                byAgent={byAgent}
                byProducer={byProducer}
                byClient={byClient}
                deltas={deltas}
                metric={metric}
              />

              {aiSummary && (
                <section id="ai" className="scroll-mt fade-in">
                  <SectionTitle
                    icon={<Bot className="h-5 w-5" />}
                    title="AI Insights"
                    subtitle="Analiză și conversație cu Claude — doar date agregate ajung pe server"
                  />
                  <div className="mt-4">
                    <AIInsights
                      token={token}
                      summary={aiSummary}
                      enabled={aiEnabled}
                    />
                  </div>
                </section>
              )}

              <FiltersBar
                showFilters={showFilters}
                onToggle={() => setShowFilters((v) => !v)}
                filters={filters}
                setFilters={setFilters}
                period={period}
                setPeriod={setPeriod}
                groupBy={groupBy}
                setGroupBy={setGroupBy}
                agents={agents}
                producers={producers}
              />

              <section id="evolutie" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<LineChartIcon className="h-5 w-5" />}
                  title="Evoluție vânzări și clienți"
                  subtitle={`Agregat pe ${PERIOD_LABELS[period].toLowerCase()}`}
                />
                <div className="mt-4 grid gap-6 lg:grid-cols-3">
                  <div className="card p-6 lg:col-span-2">
                    <h3 className="text-sm font-semibold text-slate-700">
                      {valueless ? "Cantitate" : "Valoare"}{" "}
                      {groupBy !== "none"
                        ? `per ${groupBy === "agent" ? "agent" : "producător"}`
                        : "în timp"}
                    </h3>
                    <div className="mt-4 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        {ts.matrix && ts.groups ? (
                          <LineChart data={ts.matrix}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={fmtCompact} />
                            <Tooltip
                              formatter={(v: number) =>
                                valueless ? fmtNum(v) : fmtMoney(v)
                              }
                              contentStyle={tooltipStyle}
                            />
                            <Legend />
                            {ts.groups.map((g, i) => (
                              <Line
                                key={g}
                                type="monotone"
                                dataKey={g}
                                stroke={PALETTE[i % PALETTE.length]}
                                strokeWidth={2}
                                dot={false}
                              />
                            ))}
                          </LineChart>
                        ) : (
                          <AreaChart data={ts.points}>
                            <defs>
                              <linearGradient id="valArea" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={fmtCompact} />
                            <Tooltip
                              formatter={(v: number) =>
                                valueless ? fmtNum(v) : fmtMoney(v)
                              }
                              contentStyle={tooltipStyle}
                            />
                            <Area
                              type="monotone"
                              dataKey={valueless ? "volume" : "value"}
                              stroke="#6366f1"
                              strokeWidth={2}
                              fill="url(#valArea)"
                              name={valueless ? "Cantitate" : "Valoare"}
                            />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="card p-6">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Clienți unici / perioadă
                    </h3>
                    <div className="mt-4 h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={ts.points}>
                          <defs>
                            <linearGradient id="clArea" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <Tooltip contentStyle={tooltipStyle} />
                          <Area
                            type="monotone"
                            dataKey="clients"
                            stroke="#8b5cf6"
                            strokeWidth={2}
                            fill="url(#clArea)"
                            name="Clienți unici"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </section>

              <section id="distribuire" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<PieChartIcon className="h-5 w-5" />}
                  title="Distribuție pe producători și agenți"
                />
                <div className="mt-4 grid gap-6 lg:grid-cols-3">
                  <DonutCard
                    title="Cota de piață per producător"
                    data={byProducer.slice(0, 8)}
                    metric={metric}
                    icon={<Factory className="h-4 w-4" />}
                  />
                  <RankingCard
                    title="Volume per agent"
                    data={byAgent}
                    metric={metric}
                    icon={<CircleUserRound className="h-4 w-4" />}
                  />
                  <RankingCard
                    title="Volume per producător"
                    data={byProducer}
                    metric={metric}
                    icon={<Factory className="h-4 w-4" />}
                  />
                </div>
              </section>

              <section id="matrice" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<Grid3X3 className="h-5 w-5" />}
                  title="Matrice Agent × Producător"
                  subtitle="Cine vinde ce brand. Culoarea = intensitate."
                />
                <CrossTabPanel matrix={matrix} metric={metric} />
              </section>

              <section id="comisioane" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<Coins className="h-5 w-5" />}
                  title="Comisioane per agent"
                  subtitle="Configurează rata și prețul mediu — sistemul calculează sumele"
                />
                <CommissionPanel
                  commissions={commissions}
                  defaultRate={defaultRate}
                  setDefaultRate={setDefaultRate}
                  avgPrice={avgPrice}
                  setAvgPrice={setAvgPrice}
                  agentRates={agentRates}
                  setAgentRates={setAgentRates}
                  valueless={valueless}
                />
              </section>

              <section id="eficienta" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<Trophy className="h-5 w-5" />}
                  title="Eficiență per agent"
                />
                <div className="card mt-4 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50/50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Agent</th>
                          <th className="px-4 py-3">{valueless ? "Cantitate" : "Valoare"}</th>
                          {!valueless && <th className="px-4 py-3">Cantitate</th>}
                          <th className="px-4 py-3">Clienți unici</th>
                          <th className="px-4 py-3">Tranzacții</th>
                          {!valueless && <th className="px-4 py-3">Val./client</th>}
                          {!valueless && <th className="px-4 py-3">Avg tranzacție</th>}
                          <th className="px-4 py-3">Perioade active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {efficiency.map((e, i) => (
                          <tr
                            key={e.agent}
                            className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                                  style={{ background: PALETTE[i % PALETTE.length] }}
                                >
                                  {initials(e.agent)}
                                </span>
                                <span className="font-medium text-slate-800">{e.agent}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-800">
                              {valueless ? fmtNum(e.volume) : fmtMoney(e.value)}
                            </td>
                            {!valueless && (
                              <td className="px-4 py-3 text-slate-600">{fmtNum(e.volume)}</td>
                            )}
                            <td className="px-4 py-3 text-slate-600">{fmtNum(e.uniqueClients)}</td>
                            <td className="px-4 py-3 text-slate-600">{fmtNum(e.transactions)}</td>
                            {!valueless && (
                              <td className="px-4 py-3 text-slate-600">{fmtMoney(e.valuePerClient)}</td>
                            )}
                            {!valueless && (
                              <td className="px-4 py-3 text-slate-600">{fmtMoney(e.avgDealSize)}</td>
                            )}
                            <td className="px-4 py-3 text-slate-600">{e.activePeriods}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section id="clienti" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<Building2 className="h-5 w-5" />}
                  title="Top clienți"
                  subtitle="Top 10 după valoare / cantitate"
                />
                <div className="card mt-4 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50/50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">#</th>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">{valueless ? "Cantitate" : "Valoare"}</th>
                          {!valueless && <th className="px-4 py-3">Cantitate</th>}
                          <th className="px-4 py-3">Tranzacții</th>
                          <th className="px-4 py-3 w-1/4">Pondere</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byClient.slice(0, 10).map((c, i) => {
                          const denom = valueless ? totals.volume : totals.value;
                          const num = valueless ? c.volume : c.value;
                          const pct = denom > 0 ? (num / denom) * 100 : 0;
                          return (
                            <tr
                              key={c.key}
                              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                            >
                              <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                              <td className="px-4 py-3 font-medium text-slate-800">{c.key}</td>
                              <td className="px-4 py-3 font-semibold text-slate-800">
                                {valueless ? fmtNum(c.volume) : fmtMoney(c.value)}
                              </td>
                              {!valueless && (
                                <td className="px-4 py-3 text-slate-600">{fmtNum(c.volume)}</td>
                              )}
                              <td className="px-4 py-3 text-slate-600">{fmtNum(c.transactions)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-slate-100">
                                    <div
                                      className="h-full rounded-full bg-indigo-500"
                                      style={{ width: `${Math.min(100, pct)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-slate-500">{pct.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section id="anomalii" className="scroll-mt fade-in">
                <SectionTitle
                  icon={<AlertTriangle className="h-5 w-5" />}
                  title="Anomalii și storno-uri"
                  subtitle={`${anomalies.length} rânduri detectate`}
                />
                <AnomaliesPanel anomalies={anomalies} />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "white",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

const PERIOD_LABELS: Record<Period, string> = {
  day: "Zi",
  week: "Săptămână",
  month: "Lună",
  quarter: "Trimestru",
  year: "An",
};

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

function Sidebar({ hasData }: { hasData: boolean }) {
  const links = [
    { href: "#overview", label: "Privire ansamblu", icon: BarChart3 },
    { href: "#ai", label: "AI Insights", icon: Bot },
    { href: "#evolutie", label: "Evoluție", icon: LineChartIcon },
    { href: "#distribuire", label: "Distribuție", icon: PieChartIcon },
    { href: "#matrice", label: "Matrice brand", icon: Grid3X3 },
    { href: "#comisioane", label: "Comisioane", icon: Coins },
    { href: "#eficienta", label: "Eficiență", icon: Trophy },
    { href: "#clienti", label: "Top clienți", icon: Building2 },
    { href: "#anomalii", label: "Anomalii", icon: AlertTriangle },
  ];
  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
          <BarChart3 className="h-4 w-4" />
        </div>
        <span className="font-semibold tracking-tight">BC Agent</span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
              hasData
                ? "text-slate-700 hover:bg-slate-100"
                : "pointer-events-none text-slate-400"
            }`}
          >
            <l.icon className="h-4 w-4" />
            {l.label}
          </a>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-4 text-xs text-slate-500">
        <p>Sales analytics</p>
        <p className="mt-1">v0.3 · token + AI</p>
      </div>
    </aside>
  );
}

function Topbar({
  agentName,
  agentId,
  hasData,
  isDemo,
  onExport,
  onReset,
}: {
  agentName: string;
  agentId: string;
  hasData: boolean;
  isDemo: boolean;
  onExport: () => void;
  onReset: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-semibold text-white sm:flex">
            {initials(agentName)}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{agentName}</p>
            <p className="text-xs text-slate-500">Agent · {agentId}</p>
          </div>
          {isDemo && (
            <span className="ml-2 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              Date demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Token valid
          </span>
          {hasData && (
            <>
              <button
                type="button"
                onClick={onExport}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Reset
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({
  agentName,
  hasData,
  loading,
  error,
  isDemo,
  parseInfo,
  rows,
  onFile,
  onDemo,
}: {
  agentName: string;
  hasData: boolean;
  loading: boolean;
  error: string | null;
  isDemo: boolean;
  parseInfo: ParseResult | null;
  rows: NormalizedRow[];
  onFile: (f: File) => void;
  onDemo: () => void;
}) {
  const dateRange = useMemo(() => {
    if (rows.length === 0) return null;
    let min = rows[0].date;
    let max = rows[0].date;
    for (const r of rows) {
      if (r.date < min) min = r.date;
      if (r.date > max) max = r.date;
    }
    return { min, max };
  }, [rows]);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-sm sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-12 h-72 w-72 rounded-full bg-white/10 blur-3xl"
      />
      <div className="relative grid gap-6 lg:grid-cols-5 lg:items-center">
        <div className="lg:col-span-3">
          <p className="text-sm font-medium uppercase tracking-wider text-white/70">
            {hasData ? "Panou de control" : "Bun venit"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Salut, {agentName.split(" ")[0]}!
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/80">
            {hasData
              ? `Ai încarcate ${fmtNum(rows.length)} de tranzacții${
                  dateRange
                    ? ` din intervalul ${dateRange.min.toLocaleDateString("ro-RO")} – ${dateRange.max.toLocaleDateString("ro-RO")}`
                    : ""
                }${isDemo ? " (date demo)" : ""}. Filtrează, compară și întreabă AI cu un singur click.`
              : "Încarcă un fișier XLS/XLSX/CSV cu vânzările tale — sistemul detectează automat coloanele, construiește panoul și activează analiza AI. Datele rămân în browser-ul tău."}
          </p>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/30 bg-white/15 p-4 backdrop-blur">
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/40 px-4 py-6 text-center transition hover:bg-white/10">
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">
                {loading ? "Se procesează..." : "Încarcă XLS / XLSX / CSV"}
              </span>
              <span className="text-xs text-white/70">
                Detecție automată a coloanelor
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
            {!hasData && (
              <button
                type="button"
                onClick={onDemo}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:bg-white/90"
              >
                <Sparkles className="h-4 w-4" />
                Încarcă date demo
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="relative mt-4 rounded-lg bg-rose-500/20 px-4 py-2 text-sm text-white">
          {error}
        </div>
      )}
      {parseInfo && parseInfo.rows.length > 0 && (
        <div className="relative mt-4 grid gap-2 rounded-lg bg-white/10 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <Mapping label="Data" value={parseInfo.mapping.date} />
          <Mapping label="Agent" value={parseInfo.mapping.agent} />
          <Mapping label="Producător" value={parseInfo.mapping.producer} />
          <Mapping label="Client" value={parseInfo.mapping.client} />
          <Mapping label="Cantitate" value={parseInfo.mapping.volume} />
          <Mapping label="Valoare" value={parseInfo.mapping.value} />
          <p className="text-white/70 sm:col-span-2 lg:col-span-3">
            {parseInfo.rows.length} rânduri procesate
            {parseInfo.skipped > 0
              ? ` · ${parseInfo.skipped} sărite (dată invalidă)`
              : ""}
            {parseInfo.diagnostic?.sheetUsed
              ? ` · foaia "${parseInfo.diagnostic.sheetUsed}", header pe rândul ${parseInfo.diagnostic.headerRow}`
              : ""}
          </p>
        </div>
      )}
      {parseInfo && parseInfo.rows.length === 0 && parseInfo.diagnostic && (
        <div className="relative mt-4 space-y-3 rounded-lg bg-amber-500/20 p-4 text-xs text-white">
          <p className="font-medium">
            Nu am putut detecta automat coloanele. Iată ce am găsit în fișier:
          </p>
          <div>
            <p className="font-medium text-white/80">
              Foi în fișier: {parseInfo.diagnostic.sheetNames.length}
            </p>
            <ul className="ml-4 list-disc text-white/70">
              {parseInfo.diagnostic.sheetNames.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          {parseInfo.diagnostic.sample && parseInfo.diagnostic.sample.length > 0 && (
            <div>
              <p className="font-medium text-white/80">
                Primele {parseInfo.diagnostic.sample.length} rânduri (raw):
              </p>
              <div className="mt-1 overflow-x-auto rounded bg-black/30 p-2">
                <table className="text-[10px]">
                  <tbody>
                    {parseInfo.diagnostic.sample.map((row, i) => (
                      <tr key={i} className="border-b border-white/10 last:border-0">
                        <td className="pr-2 font-mono text-white/50">
                          R{String(row._row)}:
                        </td>
                        {Object.entries(row)
                          .filter(([k]) => k !== "_row")
                          .map(([k, v], j) => (
                            <td key={j} className="px-2 font-mono text-white/80">
                              {v == null ? "" : String(v).slice(0, 30)}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {parseInfo.diagnostic.candidates && parseInfo.diagnostic.candidates.length > 0 && (
            <div>
              <p className="font-medium text-white/80">
                Top candidați (coloane detectate):
              </p>
              <ul className="ml-4 list-disc text-white/70">
                {parseInfo.diagnostic.candidates.map((c, i) => (
                  <li key={i}>
                    foaia &quot;{c.sheet}&quot;, header pe rândul {c.headerRow}: {c.mappedCount} coloane mapate, {c.rowsCount} rânduri parsabile
                    <div className="ml-2 text-[10px] text-white/60">
                      → {Object.entries(c.mapping).map(([k, v]) => `${k}=${v}`).join(", ")}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-white/90">
            <strong>Trimite-mi un screenshot cu această informație</strong> sau spune-mi numele exact al coloanelor din fișier ca să adaug aliasul lipsă.
          </p>
        </div>
      )}
    </section>
  );
}

function Mapping({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-white/10 px-3 py-1.5">
      <span className="font-medium text-white">{label}</span>
      {value ? (
        <span className="truncate text-white/80">{value}</span>
      ) : (
        <span className="text-rose-200">(nedetectat)</span>
      )}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  spark,
  color,
  icon,
}: {
  label: string;
  value: string;
  delta: number | null;
  spark: Array<{ x: string; y: number }>;
  color: string;
  icon: React.ReactNode;
}) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            <span className="text-slate-400">{icon}</span>
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            {value}
          </p>
        </div>
        {delta !== null && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
              positive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {positive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {fmtPct(delta)}
          </span>
        )}
      </div>
      {spark.length > 1 && (
        <div className="mt-3 h-12">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark}>
              <defs>
                <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="y"
                stroke={color}
                strokeWidth={2}
                fill={`url(#spark-${label})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function InsightsStrip({
  byAgent,
  byProducer,
  byClient,
  deltas,
  metric,
}: {
  byAgent: ReturnType<typeof aggregateByDimension>;
  byProducer: ReturnType<typeof aggregateByDimension>;
  byClient: ReturnType<typeof aggregateByDimension>;
  deltas: ReturnType<typeof computeDeltas>;
  metric: Metric;
}) {
  const topAgent = byAgent[0];
  const topProducer = byProducer[0];
  const topClient = byClient[0];

  const formatVal = (a?: { value: number; volume: number }) => {
    if (!a) return undefined;
    return metric === "value" ? fmtMoney(a.value) : `${fmtNum(a.volume)} buc`;
  };

  return (
    <section className="fade-in grid grid-cols-2 gap-4 lg:grid-cols-4">
      <InsightCard
        icon={<Trophy className="h-4 w-4" />}
        label="Top agent"
        value={topAgent?.key ?? "—"}
        sub={formatVal(topAgent)}
        accent="from-indigo-500 to-violet-500"
      />
      <InsightCard
        icon={<Factory className="h-4 w-4" />}
        label="Top producător"
        value={topProducer?.key ?? "—"}
        sub={formatVal(topProducer)}
        accent="from-emerald-500 to-teal-500"
      />
      <InsightCard
        icon={<Building2 className="h-4 w-4" />}
        label="Top client"
        value={topClient?.key ?? "—"}
        sub={formatVal(topClient)}
        accent="from-amber-500 to-orange-500"
      />
      <InsightCard
        icon={
          (deltas[metric] ?? 0) >= 0 ? (
            <ArrowUpRight className="h-4 w-4" />
          ) : (
            <ArrowDownRight className="h-4 w-4" />
          )
        }
        label="Ritm creștere"
        value={deltas[metric] !== null ? fmtPct(deltas[metric] as number) : "—"}
        sub="Perioada curentă vs precedentă"
        accent={
          (deltas[metric] ?? 0) >= 0
            ? "from-emerald-500 to-green-500"
            : "from-rose-500 to-pink-500"
        }
      />
    </section>
  );
}

function InsightCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white ${accent}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

function FiltersBar({
  showFilters,
  onToggle,
  filters,
  setFilters,
  period,
  setPeriod,
  groupBy,
  setGroupBy,
  agents,
  producers,
}: {
  showFilters: boolean;
  onToggle: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  groupBy: Dimension | "none";
  setGroupBy: (g: Dimension | "none") => void;
  agents: string[];
  producers: string[];
}) {
  const active =
    (filters.agents?.length ?? 0) +
    (filters.producers?.length ?? 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);

  return (
    <section className="card fade-in p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"
        >
          <Filter className="h-4 w-4" />
          Filtre
          {active > 0 && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
              {active}
            </span>
          )}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <SelectInline
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Perioadă"
            value={period}
            options={Object.entries(PERIOD_LABELS) as Array<[Period, string]>}
            onChange={(v) => setPeriod(v as Period)}
          />
          <SelectInline
            icon={<BarChart3 className="h-3.5 w-3.5" />}
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
      {showFilters && (
        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <ChipMulti
            label="Agenți"
            options={agents}
            selected={filters.agents ?? []}
            onChange={(v) => setFilters({ ...filters, agents: v })}
          />
          <ChipMulti
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
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setFilters({})}
            >
              Resetează filtrele
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SelectInline<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs">
      <span className="flex items-center gap-1 text-slate-500">
        {icon}
        {label}
      </span>
      <select
        className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
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

function ChipMulti({
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
  function toggle(o: string) {
    if (selected.includes(o)) onChange(selected.filter((x) => x !== o));
    else onChange([...selected, o]);
  }
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
        {options.length === 0 && (
          <span className="text-xs text-slate-400">(niciun)</span>
        )}
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                on
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
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
      <p className="text-xs font-medium uppercase text-slate-500">Interval</p>
      <div className="mt-2 flex gap-1">
        <input
          type="date"
          value={toStr(from)}
          onChange={(e) => onChange(parse(e.target.value), to)}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
        />
        <input
          type="date"
          value={toStr(to)}
          onChange={(e) => onChange(from, parse(e.target.value))}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}

function DonutCard({
  title,
  data,
  metric,
  icon,
}: {
  title: string;
  data: ReturnType<typeof aggregateByDimension>;
  metric: Metric;
  icon: React.ReactNode;
}) {
  const total = data.reduce((s, d) => s + d[metric], 0);
  const chartData = data.map((d) => ({ ...d, _metric: d[metric] }));
  return (
    <div className="card flex flex-col p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <span className="text-slate-400">{icon}</span>
        {title}
      </div>
      <div className="mt-2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="_metric"
              nameKey="key"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              isAnimationActive={false}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) =>
                metric === "value" ? fmtMoney(v) : `${fmtNum(v)} buc`
              }
              contentStyle={tooltipStyle}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 space-y-1.5 text-xs">
        {data.slice(0, 5).map((d, i) => {
          const pct = total > 0 ? (d[metric] / total) * 100 : 0;
          return (
            <li key={d.key} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="flex-1 truncate text-slate-700">{d.key}</span>
              <span className="text-slate-500">{pct.toFixed(1)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RankingCard({
  title,
  data,
  metric,
  icon,
}: {
  title: string;
  data: ReturnType<typeof aggregateByDimension>;
  metric: Metric;
  icon: React.ReactNode;
}) {
  const top = data.slice(0, 6).map((d) => ({ ...d, _metric: d[metric] }));
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <span className="text-slate-400">{icon}</span>
        {title}
      </div>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ left: 70, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtCompact} stroke="#94a3b8" />
            <YAxis
              type="category"
              dataKey="key"
              tick={{ fontSize: 11 }}
              width={70}
              stroke="#94a3b8"
            />
            <Tooltip
              formatter={(v: number) =>
                metric === "value" ? fmtMoney(v) : `${fmtNum(v)} buc`
              }
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="_metric" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {top.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CrossTabPanel({
  matrix,
  metric,
}: {
  matrix: ReturnType<typeof crossTab>;
  metric: Metric;
}) {
  const fmt = metric === "value" ? fmtMoney : fmtNum;
  if (matrix.rows.length === 0) {
    return (
      <div className="card mt-4 p-6 text-sm text-slate-500">
        Nu există date suficiente pentru matrice.
      </div>
    );
  }
  return (
    <div className="card mt-4 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-semibold text-slate-600">
                Agent \ Producător
              </th>
              {matrix.cols.map((c) => (
                <th
                  key={c}
                  className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-600"
                >
                  {c}
                </th>
              ))}
              <th className="border-b border-l border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-700">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((rk, i) => (
              <tr key={rk}>
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">
                  {rk}
                </td>
                {matrix.matrix[i].map((v, j) => {
                  const intensity = matrix.max > 0 ? v / matrix.max : 0;
                  return (
                    <td
                      key={j}
                      className="border-t border-slate-100 px-3 py-2 text-right tabular-nums"
                      style={{
                        background:
                          v > 0
                            ? `rgba(99, 102, 241, ${0.05 + intensity * 0.45})`
                            : undefined,
                        color: intensity > 0.6 ? "white" : "#1f2937",
                      }}
                    >
                      {v === 0 ? "–" : fmt(v)}
                    </td>
                  );
                })}
                <td className="border-l border-t border-slate-100 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-800">
                  {fmt(matrix.rowTotals[i])}
                </td>
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 z-10 border-r border-t-2 border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">
                Total
              </td>
              {matrix.colTotals.map((v, j) => (
                <td
                  key={j}
                  className="border-t-2 border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-700 tabular-nums"
                >
                  {fmt(v)}
                </td>
              ))}
              <td className="border-l border-t-2 border-slate-200 bg-slate-100 px-3 py-2 text-right font-semibold text-slate-900">
                {fmt(matrix.grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommissionPanel({
  commissions,
  defaultRate,
  setDefaultRate,
  avgPrice,
  setAvgPrice,
  agentRates,
  setAgentRates,
  valueless,
}: {
  commissions: ReturnType<typeof computeCommissions>;
  defaultRate: number;
  setDefaultRate: (n: number) => void;
  avgPrice: number;
  setAvgPrice: (n: number) => void;
  agentRates: Record<string, number>;
  setAgentRates: (r: Record<string, number>) => void;
  valueless: boolean;
}) {
  const totalCommission = commissions.reduce((s, c) => s + c.commission, 0);
  return (
    <div className="card mt-4 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberInput
          label="Rată implicită (%)"
          value={defaultRate}
          onChange={setDefaultRate}
          step={0.5}
          min={0}
          max={100}
        />
        {valueless && (
          <NumberInput
            label="Preț mediu / unitate (RON)"
            value={avgPrice}
            onChange={setAvgPrice}
            step={0.1}
            min={0}
            max={100000}
          />
        )}
        <div className="flex items-end">
          <div className="w-full rounded-lg bg-indigo-50 px-4 py-3">
            <p className="text-xs font-medium uppercase text-indigo-600">
              Total comisioane
            </p>
            <p className="mt-1 text-xl font-semibold text-indigo-900">
              {fmtMoney(totalCommission)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3">Agent</th>
              <th className="py-2 pr-3">Cantitate</th>
              <th className="py-2 pr-3">Valoare estimată</th>
              <th className="py-2 pr-3">Rată (%)</th>
              <th className="py-2 pr-3 text-right">Comision</th>
            </tr>
          </thead>
          <tbody>
            {commissions.map((c, i) => (
              <tr key={c.agent} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    >
                      {initials(c.agent)}
                    </span>
                    <span className="font-medium text-slate-800">{c.agent}</span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-slate-600">{fmtNum(c.volume)}</td>
                <td className="py-2 pr-3 text-slate-600">{fmtMoney(c.inferredValue)}</td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    max={100}
                    value={agentRates[c.agent] ?? defaultRate}
                    onChange={(e) =>
                      setAgentRates({
                        ...agentRates,
                        [c.agent]: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
                  />
                </td>
                <td className="py-2 pr-3 text-right font-semibold text-slate-800">
                  {fmtMoney(c.commission)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
      />
    </label>
  );
}

function AnomaliesPanel({
  anomalies,
}: {
  anomalies: ReturnType<typeof findAnomalies>;
}) {
  if (anomalies.length === 0) {
    return (
      <div className="card mt-4 flex items-center gap-3 p-6 text-sm text-emerald-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
          ✓
        </span>
        Nu s-au detectat anomalii.
      </div>
    );
  }
  const counts = anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1;
    return acc;
  }, {});
  const TYPE_STYLES: Record<string, { label: string; cls: string }> = {
    return: { label: "Storno", cls: "bg-rose-50 text-rose-700" },
    missing: { label: "Lipsă date", cls: "bg-amber-50 text-amber-700" },
    implicit: { label: "IMPLICIT", cls: "bg-orange-50 text-orange-700" },
    outlier: { label: "Outlier", cls: "bg-violet-50 text-violet-700" },
  };
  return (
    <div className="card mt-4 overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4">
        {Object.entries(counts).map(([t, n]) => (
          <span
            key={t}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${TYPE_STYLES[t]?.cls ?? ""}`}
          >
            {TYPE_STYLES[t]?.label ?? t}: {n}
          </span>
        ))}
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500 backdrop-blur">
            <tr>
              <th className="px-4 py-2">Tip</th>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Agent</th>
              <th className="px-4 py-2">Producător</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2 text-right">Cantitate</th>
              <th className="px-4 py-2">Detalii</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.slice(0, 200).map((a, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[a.type]?.cls ?? ""}`}
                  >
                    {TYPE_STYLES[a.type]?.label ?? a.type}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {a.row.date.toLocaleDateString("ro-RO")}
                </td>
                <td className="px-4 py-2 text-slate-800">{a.row.agent || "—"}</td>
                <td className="px-4 py-2 text-slate-800">{a.row.producer || "—"}</td>
                <td className="px-4 py-2 text-slate-600">{a.row.client || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                  {fmtNum(a.row.volume)}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anomalies.length > 200 && (
        <p className="border-t border-slate-100 p-3 text-center text-xs text-slate-500">
          Afișate primele 200 din {anomalies.length}
        </p>
      )}
    </div>
  );
}

function computeDeltas(rows: NormalizedRow[], period: Period) {
  if (rows.length === 0)
    return {
      value: null as number | null,
      volume: null as number | null,
      clients: null as number | null,
      transactions: null as number | null,
    };
  const periodsMap = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    const k = periodKey(r.date, period);
    let arr = periodsMap.get(k);
    if (!arr) {
      arr = [];
      periodsMap.set(k, arr);
    }
    arr.push(r);
  }
  const sortedKeys = Array.from(periodsMap.keys()).sort();
  if (sortedKeys.length < 2) {
    return { value: null, volume: null, clients: null, transactions: null };
  }
  const curKey = sortedKeys[sortedKeys.length - 1];
  const prevKey = sortedKeys[sortedKeys.length - 2];
  const cur = periodsMap.get(curKey) ?? [];
  const prev = periodsMap.get(prevKey) ?? [];
  const sum = (arr: NormalizedRow[]) => {
    let value = 0;
    let volume = 0;
    const clients = new Set<string>();
    for (const r of arr) {
      value += r.value;
      volume += r.volume;
      if (r.client) clients.add(r.client);
    }
    return { value, volume, clients: clients.size, transactions: arr.length };
  };
  const c = sum(cur);
  const p = sum(prev);
  const pct = (a: number, b: number) =>
    b === 0 ? (a === 0 ? 0 : 100) : ((a - b) / b) * 100;
  return {
    value: pct(c.value, p.value),
    volume: pct(c.volume, p.volume),
    clients: pct(c.clients, p.clients),
    transactions: pct(c.transactions, p.transactions),
  };
}
