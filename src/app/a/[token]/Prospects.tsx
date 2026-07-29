"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Navigation,
  Phone,
  Search,
} from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";

interface ProspectItem {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  caen: string;
  caenDesc: string;
  tva: boolean | null;
  activ: boolean | null;
  status: string;
  note: string;
  assignedAgent: string;
  updatedAt: string;
}

interface ProspectsResponse {
  enabled: boolean;
  total: number;
  funnel: { total: number; contactati: number; clienti: number };
  prospects: ProspectItem[];
  error?: string;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  nou: { label: "Nou", cls: "bg-slate-100 text-slate-700" },
  contactat: { label: "Contactat", cls: "bg-amber-50 text-amber-700" },
  client: { label: "Client", cls: "bg-emerald-50 text-emerald-700" },
  respins: { label: "Respins", cls: "bg-rose-50 text-rose-700" },
};

const CAEN_LABELS: Record<string, string> = {
  "4711": "Alimentară",
  "4719": "Magazin universal",
  "4721": "Fructe-legume",
  "4722": "Carne",
  "4724": "Pâine-patiserie",
  "4725": "Băuturi",
  "4726": "Tutungerie",
  "4729": "Alte alimentare",
  "5630": "Bar",
};

const PAGE_SIZE = 50;

export default function Prospects({
  token,
  agents,
}: {
  token: string;
  agents: string[];
}) {
  const [data, setData] = useState<ProspectsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [judet, setJudet] = useState("");
  const [caen, setCaen] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [savingCui, setSavingCui] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        token,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (judet) params.set("judet", judet);
      if (caen) params.set("caen", caen);
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      const res = await fetch(`/api/prospects?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ProspectsResponse;
      if (!res.ok || json.error) {
        setError(json.error ?? `Eroare ${res.status}`);
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, judet, caen, status, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce căutarea
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function patchProspect(
    cui: string,
    patch: { status?: string; note?: string; assignedAgent?: string },
  ) {
    setSavingCui(cui);
    try {
      const res = await fetch("/api/prospects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, cui, ...patch }),
      });
      if (res.ok && data) {
        setData({
          ...data,
          prospects: data.prospects.map((p) =>
            p.cui === cui
              ? {
                  ...p,
                  status: patch.status ?? p.status,
                  note: patch.note ?? p.note,
                  assignedAgent: patch.assignedAgent ?? p.assignedAgent,
                }
              : p,
          ),
        });
      }
    } catch {
      // silent — refresh la următorul load
    } finally {
      setSavingCui(null);
    }
  }

  function exportCurrent() {
    if (!data?.prospects.length) return;
    downloadCSV(
      `prospecti_${new Date().toISOString().slice(0, 10)}.csv`,
      ["CUI", "Denumire", "Adresă", "Localitate", "Județ", "CAEN", "Tip", "Status", "Agent", "Note"],
      data.prospects.map((p) => [
        p.cui,
        p.denumire,
        p.adresa,
        p.localitate,
        p.judet,
        p.caen,
        CAEN_LABELS[p.caen] ?? p.caenDesc,
        p.status,
        p.assignedAgent,
        p.note,
      ]),
    );
  }

  function mapsUrl(p: ProspectItem): string {
    const q = encodeURIComponent(
      [p.denumire, p.adresa, p.localitate].filter(Boolean).join(", "),
    );
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1),
    [data],
  );

  if (error?.includes("DATABASE_URL") || error?.includes("configurată")) {
    return (
      <div className="card p-6 text-sm text-slate-600">
        Modulul Prospecți necesită baza de date Postgres — configurează
        DATABASE_URL pe server.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data && data.funnel.total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <FunnelCard
            icon={<Building className="h-4 w-4" />}
            label="Total prospecți"
            value={data.funnel.total}
            accent="from-indigo-500 to-violet-500"
          />
          <FunnelCard
            icon={<Phone className="h-4 w-4" />}
            label="Contactați"
            value={data.funnel.contactati}
            accent="from-amber-500 to-orange-500"
          />
          <FunnelCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Deveniti clienți"
            value={data.funnel.clienti}
            accent="from-emerald-500 to-teal-500"
          />
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Caută firmă, CUI, adresă..."
              className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <select
            value={judet}
            onChange={(e) => {
              setJudet(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">Toate județele</option>
            <option value="SV">Suceava</option>
            <option value="BT">Botoșani</option>
          </select>
          <select
            value={caen}
            onChange={(e) => {
              setCaen(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">Toate tipurile</option>
            {Object.entries(CAEN_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">Toate statusurile</option>
            {Object.entries(STATUS_LABELS).map(([s, v]) => (
              <option key={s} value={s}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCurrent}
            disabled={!data?.prospects.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Se încarcă prospecții...
        </div>
      )}

      {error && !error.includes("configurată") && (
        <div className="card p-4 text-sm text-rose-600">{error}</div>
      )}

      {data && data.total === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-slate-500">
          <Building className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3">
            Niciun prospect încă. Administratorul importă lista de firme din
            panoul de admin (fișierul MF „Date de identificare plătitori").
          </p>
        </div>
      )}

      {data && data.prospects.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Firmă</th>
                  <th className="hidden px-3 py-2.5 md:table-cell">Adresă</th>
                  <th className="px-3 py-2.5">Tip</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">Agent</th>
                  <th className="px-3 py-2.5 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {data.prospects.map((p) => (
                  <tr
                    key={p.cui}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-800">{p.denumire}</p>
                      <p className="text-xs text-slate-500">
                        CUI {p.cui}
                        {p.localitate ? ` · ${p.localitate}` : ""}
                        {p.judet ? ` (${p.judet})` : ""}
                        {p.tva === true ? " · TVA" : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 md:hidden">
                        {p.adresa}
                      </p>
                    </td>
                    <td className="hidden max-w-[280px] px-3 py-2.5 text-xs text-slate-600 md:table-cell">
                      <span className="line-clamp-2">{p.adresa || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        {CAEN_LABELS[p.caen] ?? p.caen ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={p.status}
                        disabled={savingCui === p.cui}
                        onChange={(e) =>
                          patchProspect(p.cui, { status: e.target.value })
                        }
                        className={`rounded-full border-0 px-2 py-1 text-xs font-medium ${STATUS_LABELS[p.status]?.cls ?? "bg-slate-100"}`}
                      >
                        {Object.entries(STATUS_LABELS).map(([s, v]) => (
                          <option key={s} value={s}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">
                      <select
                        value={p.assignedAgent}
                        disabled={savingCui === p.cui}
                        onChange={(e) =>
                          patchProspect(p.cui, { assignedAgent: e.target.value })
                        }
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">—</option>
                        {agents.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <a
                        href={mapsUrl(p)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Navighează cu Google Maps"
                        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        <Navigation className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Navighează</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              {data.total} rezultate · pagina {page + 1}/{totalPages}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={page + 1 >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FunnelCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white ${accent}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight text-slate-900">
          {new Intl.NumberFormat("ro-RO").format(value)}
        </p>
        <p className="truncate text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}
