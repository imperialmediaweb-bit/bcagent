"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Building,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  Navigation,
  Phone,
  Save,
  Search,
  SlidersHorizontal,
  Star,
  User,
} from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import {
  CAEN_DIVISIONS,
  COUNTY_LIST,
  CORE_CAEN,
  DOMAIN_PRESETS,
  TARGET_CAEN,
} from "@/modules/prospects";

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
  telefon: string;
  email: string;
  contact: string;
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

// Presetările de domeniu vin din modul — aceleași și pe hartă.

const PAGE_SIZE = 50;

/** Număr pentru linkul WhatsApp: fără +/0 inițial, cu prefix 40 pentru RO. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("40")) return digits;
  if (digits.startsWith("0")) return `4${digits}`;
  return `40${digits}`;
}

function caenShort(code: string, desc: string): string {
  if (!code) return "—";
  if (TARGET_CAEN[code]) {
    // Prima parte a descrierii lungi
    return TARGET_CAEN[code].split(",")[0].slice(0, 34);
  }
  if (desc) return desc.slice(0, 34);
  const div = CAEN_DIVISIONS[code.slice(0, 2)];
  return div ? div : code;
}

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
  const [caenPrefix, setCaenPrefix] = useState("");
  const [preset, setPreset] = useState("");
  const [status, setStatus] = useState("");
  const [localitate, setLocalitate] = useState("");
  const [localitateInput, setLocalitateInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyTva, setOnlyTva] = useState(false);
  const [withPhone, setWithPhone] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    telefon: string;
    email: string;
    contact: string;
    note: string;
  }>({ telefon: "", email: "", contact: "", note: "" });
  const [showFilters, setShowFilters] = useState(true);
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
      if (caenPrefix) params.set("caen", caenPrefix);
      if (preset) {
        const p = DOMAIN_PRESETS.find((x) => x.id === preset);
        if (p) params.set("caenIn", p.caens.join(","));
      }
      if (status) params.set("status", status);
      if (localitate) params.set("localitate", localitate);
      if (search) params.set("search", search);
      if (onlyActive) params.set("onlyActive", "1");
      if (onlyTva) params.set("onlyTva", "1");
      if (withPhone) params.set("withPhone", "1");
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
  }, [
    token,
    judet,
    caenPrefix,
    preset,
    status,
    localitate,
    search,
    onlyActive,
    onlyTva,
    withPhone,
    page,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce pentru câmpurile text
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setLocalitate(localitateInput);
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [localitateInput]);

  async function patchProspect(
    cui: string,
    patch: {
      status?: string;
      note?: string;
      assignedAgent?: string;
      telefon?: string;
      email?: string;
      contact?: string;
    },
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
                  telefon: patch.telefon ?? p.telefon,
                  email: patch.email ?? p.email,
                  contact: patch.contact ?? p.contact,
                }
              : p,
          ),
        });
      }
    } catch {
      // reîncercare la următorul load
    } finally {
      setSavingCui(null);
    }
  }

  function exportCurrent() {
    if (!data?.prospects.length) return;
    downloadCSV(
      `firme_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "CUI", "Denumire", "Adresă", "Localitate", "Județ", "Telefon",
        "Email", "Persoană contact", "CAEN", "Domeniu", "TVA", "Status",
        "Agent", "Note",
      ],
      data.prospects.map((p) => [
        p.cui,
        p.denumire,
        p.adresa,
        p.localitate,
        p.judet,
        p.telefon,
        p.email,
        p.contact,
        p.caen,
        p.caenDesc || caenShort(p.caen, p.caenDesc),
        p.tva === true ? "DA" : p.tva === false ? "NU" : "",
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

  function resetFilters() {
    setJudet("");
    setCaenPrefix("");
    setPreset("");
    setStatus("");
    setLocalitateInput("");
    setSearchInput("");
    setOnlyActive(true);
    setOnlyTva(false);
    setWithPhone(false);
    setPage(0);
  }

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1),
    [data],
  );

  const activeFilters =
    (judet ? 1 : 0) +
    (caenPrefix ? 1 : 0) +
    (preset ? 1 : 0) +
    (status ? 1 : 0) +
    (localitate ? 1 : 0) +
    (search ? 1 : 0) +
    (onlyTva ? 1 : 0) +
    (withPhone ? 1 : 0);

  if (error?.includes("configurat")) {
    return (
      <div className="card p-6 text-sm text-slate-600">
        Modulul necesită baza de date Postgres (DATABASE_URL).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <FunnelCard
            icon={<Building className="h-4 w-4" />}
            label="Rezultate filtrate"
            value={data.total}
            accent="from-indigo-500 to-violet-500"
          />
          <FunnelCard
            icon={<Phone className="h-4 w-4" />}
            label="Contactate (total)"
            value={data.funnel.contactati}
            accent="from-amber-500 to-orange-500"
          />
          <FunnelCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Devenite clienți"
            value={data.funnel.clienti}
            accent="from-emerald-500 to-teal-500"
          />
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Caută firme
            {activeFilters > 0 && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                {activeFilters}
              </span>
            )}
          </button>
          <div className="flex gap-2">
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Resetează
              </button>
            )}
            <button
              type="button"
              onClick={exportCurrent}
              disabled={!data?.prospects.length}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-slate-500">
                Domeniu (ce vinzi)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DOMAIN_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPreset(preset === p.id ? "" : p.id);
                      setCaenPrefix("");
                      setPage(0);
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                      preset === p.id
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="text-xs font-medium uppercase text-slate-500">
                  Județ
                </span>
                <select
                  value={judet}
                  onChange={(e) => {
                    setJudet(e.target.value);
                    setPage(0);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
                >
                  <option value="">Toate județele</option>
                  {COUNTY_LIST.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase text-slate-500">
                  Localitate
                </span>
                <input
                  type="text"
                  value={localitateInput}
                  onChange={(e) => setLocalitateInput(e.target.value)}
                  placeholder="ex: Rădăuți"
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase text-slate-500">
                  Cod CAEN
                </span>
                <input
                  type="text"
                  value={caenPrefix}
                  onChange={(e) => {
                    setCaenPrefix(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setPreset("");
                    setPage(0);
                  }}
                  placeholder="ex: 4711 sau 47"
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase text-slate-500">
                  Status
                </span>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(0);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-2 text-sm"
                >
                  <option value="">Toate</option>
                  {Object.entries(STATUS_LABELS).map(([s, v]) => (
                    <option key={s} value={s}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Caută după nume firmă, CUI sau adresă..."
                className="w-full rounded-md border border-slate-200 py-2 pl-8 pr-3 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={(e) => {
                    setOnlyActive(e.target.checked);
                    setPage(0);
                  }}
                  className="rounded border-slate-300"
                />
                Doar firme active (verificate ANAF)
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlyTva}
                  onChange={(e) => {
                    setOnlyTva(e.target.checked);
                    setPage(0);
                  }}
                  className="rounded border-slate-300"
                />
                Doar plătitori de TVA
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={withPhone}
                  onChange={(e) => {
                    setWithPhone(e.target.checked);
                    setPage(0);
                  }}
                  className="rounded border-slate-300"
                />
                Doar cu număr de telefon
              </label>
            </div>
          </div>
        )}
      </div>

      {loading && !data && (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Se încarcă...
        </div>
      )}

      {error && !error.includes("configurat") && (
        <div className="card p-4 text-sm text-rose-600">{error}</div>
      )}

      {data && data.total === 0 && !loading && (
        <div className="card p-8 text-center text-sm text-slate-500">
          <Building className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3">
            Nicio firmă pentru filtrele alese. Încearcă alt domeniu/județ, sau
            debifează „Doar firme active" (firmele neverificate la ANAF încă nu
            au domeniu setat).
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
                  <th className="px-3 py-2.5">Domeniu</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">Agent</th>
                  <th className="px-3 py-2.5 text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {data.prospects.map((p) => (
                  <Fragment key={p.cui}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-800">{p.denumire}</p>
                      <p className="text-xs text-slate-500">
                        CUI {p.cui}
                        {p.localitate ? ` · ${p.localitate}` : ""}
                        {p.judet ? ` (${p.judet})` : ""}
                        {p.tva === true ? " · TVA" : ""}
                        {p.activ === null ? " · neverificat" : ""}
                      </p>
                      {p.telefon ? (
                        <div className="mt-1 flex items-center gap-2">
                          <a
                            href={`tel:${p.telefon}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            {p.telefon}
                          </a>
                          <a
                            href={`https://wa.me/${waNumber(p.telefon)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="WhatsApp"
                            className="text-emerald-600 hover:text-emerald-800"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">
                          fără telefon în evidențe
                        </p>
                      )}
                      {p.email && (
                        <a
                          href={`mailto:${p.email}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                        >
                          <Mail className="h-3 w-3" />
                          {p.email}
                        </a>
                      )}
                      {p.contact && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                          <User className="h-3 w-3" />
                          {p.contact}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-400 md:hidden">
                        {p.adresa}
                      </p>
                    </td>
                    <td className="hidden max-w-[260px] px-3 py-2.5 text-xs text-slate-600 md:table-cell">
                      <span className="line-clamp-2">{p.adresa || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                        title={p.caenDesc || p.caen}
                      >
                        {caenShort(p.caen, p.caenDesc)}
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
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Marchează ca interesant (Contactat)"
                          onClick={() =>
                            patchProspect(p.cui, {
                              status:
                                p.status === "nou" ? "contactat" : p.status,
                            })
                          }
                          className="rounded-md border border-slate-200 p-1.5 text-amber-600 hover:bg-amber-50"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Editează date de contact"
                          onClick={() => {
                            if (expanded === p.cui) {
                              setExpanded(null);
                            } else {
                              setExpanded(p.cui);
                              setDraft({
                                telefon: p.telefon,
                                email: p.email,
                                contact: p.contact,
                                note: p.note,
                              });
                            }
                          }}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                        >
                          {expanded === p.cui ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
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
                      </div>
                    </td>
                  </tr>
                  {expanded === p.cui && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="block">
                            <span className="text-xs font-medium uppercase text-slate-500">
                              Telefon
                            </span>
                            <input
                              type="tel"
                              value={draft.telefon}
                              onChange={(e) =>
                                setDraft({ ...draft, telefon: e.target.value })
                              }
                              placeholder="07xx xxx xxx"
                              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium uppercase text-slate-500">
                              Email
                            </span>
                            <input
                              type="email"
                              value={draft.email}
                              onChange={(e) =>
                                setDraft({ ...draft, email: e.target.value })
                              }
                              placeholder="contact@firma.ro"
                              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs font-medium uppercase text-slate-500">
                              Persoană de contact
                            </span>
                            <input
                              type="text"
                              value={draft.contact}
                              onChange={(e) =>
                                setDraft({ ...draft, contact: e.target.value })
                              }
                              placeholder="ex: Ion — administrator"
                              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="block sm:col-span-3">
                            <span className="text-xs font-medium uppercase text-slate-500">
                              Notițe (ce s-a discutat, program, cerințe)
                            </span>
                            <textarea
                              value={draft.note}
                              onChange={(e) =>
                                setDraft({ ...draft, note: e.target.value })
                              }
                              rows={2}
                              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={savingCui === p.cui}
                            onClick={async () => {
                              await patchProspect(p.cui, {
                                telefon: draft.telefon,
                                email: draft.email,
                                contact: draft.contact,
                                note: draft.note,
                              });
                              setExpanded(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingCui === p.cui ? "Se salvează..." : "Salvează"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpanded(null)}
                            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-white"
                          >
                            Anulează
                          </button>
                          <span className="text-xs text-slate-500">
                            Emailul nu există în evidențele oficiale — îl
                            completezi tu când afli.
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              {data.total.toLocaleString("ro-RO")} rezultate · pagina {page + 1}/
              {totalPages.toLocaleString("ro-RO")}
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
