"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BedDouble,
  Minus,
  ShoppingBasket,
  TrendingDown,
} from "lucide-react";
import type { NormalizedRow } from "@/lib/parse-xls";
import type { Metric } from "@/lib/analytics";
import { smartAnalysis, type AgentScore } from "@/modules/analytics/smart";

const fmt = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(n);

/**
 * Secțiunea „Analiză Smart": scoruri per agent, alerte de tendință,
 * clienți adormiți și oportunități de cross-sell — totul calculat local,
 * instant, fără AI (AI-ul le comentează separat în Briefing).
 */
export default function SmartPanel({
  rows,
  metric,
}: {
  rows: NormalizedRow[];
  metric: Metric;
}) {
  const analysis = useMemo(() => smartAnalysis(rows, metric), [rows, metric]);
  if (!analysis) return null;
  const unit = metric === "value" ? "RON" : "buc";

  return (
    <div className="space-y-6">
      {/* Scoruri agenți */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {analysis.scores.map((s, i) => (
          <ScoreCard key={s.agent} score={s} rank={i + 1} unit={unit} />
        ))}
      </div>

      {/* Alerte */}
      {analysis.alerts.length > 0 && (
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <TrendingDown className="h-4 w-4 text-rose-500" />
            Tendințe periculoase ({analysis.alerts.length})
          </h3>
          <ul className="mt-3 space-y-2">
            {analysis.alerts.map((a, i) => (
              <li
                key={i}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                  a.type === "echipa"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {a.note}
                </span>
                <span className="font-mono text-xs opacity-70">
                  {a.points.map((p) => fmt(p.metric)).join(" → ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Clienți adormiți */}
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BedDouble className="h-4 w-4 text-indigo-500" />
            Clienți adormiți ({analysis.dormant.length})
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Cumpărau regulat și au tăcut mai mult decât dublul cadenței lor.
            Sortați după cât valorau — de reactivat primii.
          </p>
          {analysis.dormant.length === 0 ? (
            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Niciun client cu cadența ruptă. 👏
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {analysis.dormant.slice(0, 10).map((d) => (
                <li key={d.client} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-slate-800">
                      {d.client}
                    </p>
                    <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                      {d.daysSince} zile tăcere
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.agent} · comanda la ~{d.expectedEveryDays} zile · istoric{" "}
                    {fmt(metric === "value" ? d.value : d.volume)} {unit} ·
                    ultima: {d.lastDate}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cross-sell */}
        <div className="card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShoppingBasket className="h-4 w-4 text-emerald-500" />
            Oportunități de coș ({analysis.basket.length})
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Clienți care cumpără un brand dar nu și perechea lui firească —
            de propus la următoarea vizită.
          </p>
          {analysis.basket.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Nicio oportunitate clară cu datele curente.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {analysis.basket.slice(0, 10).map((b, i) => (
                <li key={i} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-slate-800">
                      {b.client}
                    </p>
                    <span className="shrink-0 text-xs font-medium text-emerald-700">
                      ~{fmt(b.estMetric)} {unit}/lună potențial
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {b.agent} · are <strong>{b.has}</strong>, lipsește{" "}
                    <strong>{b.missing}</strong> · {b.adoptionPct}% din
                    clienții similari îl cumpără
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreCard({
  score,
  rank,
  unit,
}: {
  score: AgentScore;
  rank: number;
  unit: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone =
    score.score >= 70
      ? "text-emerald-600"
      : score.score >= 40
        ? "text-amber-600"
        : "text-rose-600";
  const ringTone =
    score.score >= 70 ? "#10b981" : score.score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="card p-5 text-left transition hover:shadow-md"
    >
      <div className="flex items-center gap-4">
        {/* Inel de scor */}
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="3.5"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke={ringTone}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={`${score.score} 100`}
              pathLength={100}
            />
          </svg>
          <span
            className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${tone}`}
          >
            {score.score}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-800">
              #{rank} {score.agent}
            </p>
            {score.trend === "up" ? (
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                <ArrowUpRight className="h-3.5 w-3.5" />
                {score.trendPct > 0 ? `+${score.trendPct}%` : ""}
              </span>
            ) : score.trend === "down" ? (
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-600">
                <ArrowDownRight className="h-3.5 w-3.5" />
                {score.trendPct}%
              </span>
            ) : (
              <Minus className="h-3.5 w-3.5 text-slate-400" />
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {fmt(score.volume)} {unit} · {score.uniqueClients} clienți ·{" "}
            {score.producers} branduri
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          {(
            [
              ["Volum", score.components.volum, "din cel mai bun agent"],
              ["Clienți", score.components.clienti, "din cel mai bun agent"],
              ["Regularitate", score.components.regularitate, "vinde constant lunar"],
              ["Diversitate", score.components.diversitate, "mix de branduri"],
            ] as const
          ).map(([label, v, hint]) => (
            <div key={label}>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-600">{label}</span>
                <span className="text-slate-500">
                  {v}/100 <span className="text-slate-400">· {hint}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div
                  className="h-1.5 rounded-full bg-indigo-500"
                  style={{ width: `${v}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
