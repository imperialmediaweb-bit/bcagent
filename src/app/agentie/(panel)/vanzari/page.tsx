"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseXLSBuffer } from "@/lib/parse-xls";
import { Trash2, Upload } from "lucide-react";
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
import { TrendingUp } from "lucide-react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface SalesData {
  metric: string;
  months: string[];
  agents: Array<{
    name: string;
    total: number;
    clients: number;
    brands: Record<string, number>;
    monthly: number[];
  }>;
  brands: string[];
  topClients: Array<{ client: string; agent: string; total: number }>;
  appSales?: {
    months: string[];
    agents: Array<{
      name: string;
      total: number;
      van: number;
      sales: number;
      monthly: number[];
    }>;
  };
}

const PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316",
];

interface OrgBatch {
  id: string;
  fileName: string;
  rowCount: number;
  dateMin: string;
  dateMax: string;
  uploadedAt: string;
}

/**
 * Upload de rapoarte direct din panoul agenției (owner SAU manager):
 * XLS/XLSX/ODS/CSV — detecția de coloane e cea din panoul agentului,
 * iar datele intră automat în Vânzări, Targeturi și Briefingul AI.
 */
function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [batches, setBatches] = useState<OrgBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadBatches = useCallback(() => {
    api<{ batches: OrgBatch[] }>("/api/agentie/upload")
      .then((d) => setBatches(d.batches))
      .catch(() => {});
  }, []);
  useEffect(loadBatches, [loadBatches]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg({ kind: "info", text: `Se citește ${file.name}...` });
    try {
      const parsed = await parseXLSBuffer(await file.arrayBuffer());
      if (!parsed.rows.length) {
        setMsg({
          kind: "error",
          text: "Nu am găsit rânduri valide — verifică dacă fișierul are coloanele Data / Agent / Client / Cantitate.",
        });
        return;
      }
      const res = await api<{
        rows: number;
        dateMin: string;
        dateMax: string;
        agentsUnknown: string[];
      }>("/api/agentie/upload", {
        method: "POST",
        json: {
          fileName: file.name,
          rows: parsed.rows.map((r) => ({
            date: r.date.toISOString(),
            agent: r.agent,
            producer: r.producer,
            client: r.client,
            volume: r.volume,
            value: r.value,
          })),
        },
      });
      const warn =
        res.agentsUnknown.length > 0
          ? ` ⚠ Agenți din fișier fără cont în firmă: ${res.agentsUnknown.join(", ")} — adaugă-i din pagina Agenți cu EXACT numele ăsta ca să se lege rapoartele.`
          : "";
      setMsg({
        kind: res.agentsUnknown.length ? "info" : "success",
        text: `Import reușit: ${res.rows.toLocaleString("ro-RO")} rânduri (${res.dateMin} → ${res.dateMax}). Cifrele s-au actualizat automat în Vânzări, Targeturi și Briefing.${warn}`,
      });
      loadBatches();
      onUploaded();
    } catch (err) {
      setMsg({
        kind: "error",
        text:
          err instanceof Error
            ? `Nu am putut încărca fișierul: ${err.message}`
            : "Nu am putut încărca fișierul.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeBatch(id: string) {
    if (!confirm("Ștergi raportul? Cifrele lui dispar din analize.")) return;
    try {
      await api(`/api/agentie/upload?id=${id}`, { method: "DELETE" });
      loadBatches();
      onUploaded();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Upload className="h-4 w-4 text-emerald-600" />
            Încarcă raport de vânzări (XLS, XLSX, ODS, CSV)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Coloanele se detectează automat (Data, Agent, Producător, Client,
            Cantitate, Valoare). Cifrele intră instant în toate analizele.
            <br />
            💡 De unde iei fișierul: <strong>SAGA → Situații → Ieșiri pe
            documente → Export Excel</strong> (merge și CSV/ODS).
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xls,.xlsx,.ods,.csv,.txt"
          onChange={onFile}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {busy ? "Se încarcă..." : "Alege fișierul"}
        </button>
      </div>
      {msg && (
        <div className="mt-3">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      {batches.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {batches.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{b.fileName}</p>
                <p className="text-xs text-slate-500">
                  {b.rowCount.toLocaleString("ro-RO")} rânduri · {b.dateMin} →{" "}
                  {b.dateMax} · urcat{" "}
                  {new Date(b.uploadedAt).toLocaleDateString("ro-RO")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeBatch(b.id)}
                className="shrink-0 rounded-md p-1.5 text-slate-400 hover:text-rose-500"
                title="Șterge raportul"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function VanzariPage() {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<SalesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setData(null);
    api<SalesData>(`/api/agentie/sales?months=${months}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [months, reloadKey]);

  if (error) return <Alert>{error}</Alert>;
  if (!data)
    return (
      <div className="space-y-5">
        <UploadCard onUploaded={() => setReloadKey((k) => k + 1)} />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    );

  const chartData = data.months.map((m, i) => {
    const row: Record<string, string | number> = { luna: m.slice(5) + "." + m.slice(2, 4) };
    for (const a of data.agents) row[a.name] = a.monthly[i] ?? 0;
    return row;
  });
  const teamTotal = data.agents.reduce((s, a) => s + a.total, 0);

  return (
    <div className="space-y-5">
      <UploadCard onUploaded={() => setReloadKey((k) => k + 1)} />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Vânzările firmei
          </h1>
          <p className="text-sm text-slate-500">
            Din XLS-urile încărcate: {formatNumber(teamTotal)} {data.metric} în
            perioada selectată, {data.agents.length} agenți.
          </p>
        </div>
        <select
          value={months}
          onChange={(e) => setMonths(parseInt(e.target.value))}
          className={`${inputClass} mt-0 w-44`}
        >
          <option value={3}>Ultimele 3 luni</option>
          <option value={6}>Ultimele 6 luni</option>
          <option value={12}>Ultimul an</option>
        </select>
      </header>

      {data.appSales && data.appSales.agents.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-800">
            🧾 Vânzări prin aplicație — facturi fotografiate & comenzi livrate
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Ce au înregistrat agenții direct pe telefon (poză la factură, van
            sales, comenzi). Sursă separată de rapoartele SAGA de mai jos — nu
            se adună între ele, ca să nu numeri aceeași vânzare de două ori.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3 text-right">Vânzări</th>
                  <th className="py-2 pr-3 text-right">Total RON</th>
                  <th className="py-2 pr-3 text-right">din care van 🚐</th>
                </tr>
              </thead>
              <tbody>
                {data.appSales.agents.map((a) => (
                  <tr key={a.name} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-800">
                      {a.name}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-600">
                      {a.sales}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-slate-900">
                      {formatNumber(a.total)}
                    </td>
                    <td className="py-2 pr-3 text-right text-violet-700">
                      {a.van > 0 ? formatNumber(a.van) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.agents.length === 0 ? (
        <EmptyState text="Nicio vânzare în perioada asta — încarcă XLS-urile de vânzări (SAGA) sau lasă agenții să-și înregistreze vânzările din telefon: apar automat mai sus." />
      ) : (
        <>
          <Card>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <TrendingUp className="h-4 w-4 text-indigo-500" />
              Evoluția lunară per agent ({data.metric})
            </h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="luna" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={60} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {data.agents.map((a, i) => (
                    <Line
                      key={a.name}
                      type="monotone"
                      dataKey={a.name}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Total ({data.metric})
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Clienți</th>
                  {data.brands.map((b) => (
                    <th key={b} className="px-4 py-3 text-right font-medium">
                      {b.length > 12 ? b.slice(0, 12) + "…" : b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.agents.map((a) => {
                  const maxBrand = Math.max(...Object.values(a.brands), 1);
                  return (
                    <tr key={a.name} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {a.name}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatNumber(a.total)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {a.clients}
                      </td>
                      {data.brands.map((b) => {
                        const v = a.brands[b] ?? 0;
                        const intensity = v / maxBrand;
                        return (
                          <td
                            key={b}
                            className="px-4 py-3 text-right text-slate-700"
                            style={{
                              backgroundColor:
                                v > 0
                                  ? `rgba(99, 102, 241, ${0.05 + intensity * 0.25})`
                                  : undefined,
                            }}
                          >
                            {v > 0 ? formatNumber(v) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">
                Top clienți ai firmei
              </h2>
              <ul className="divide-y divide-slate-100">
                {data.topClients.slice(0, 10).map((c, i) => (
                  <li key={c.client} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-700">
                      {i + 1}. {c.client}
                      <span className="ml-1 text-xs text-slate-400">({c.agent})</span>
                    </span>
                    <span className="shrink-0 font-medium text-slate-800">
                      {formatNumber(c.total)} {data.metric}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-800">
                Totaluri per agent
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.agents.map((a) => ({ name: a.name, Total: a.total }))}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      stroke="#94a3b8"
                      width={110}
                    />
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Bar dataKey="Total" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
