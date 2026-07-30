"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Phone, Search, Upload } from "lucide-react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatDate,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface Client {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  telefon: string;
  agent: string;
  lastVisit: string | null;
}

export default function ClientiPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<Array<{ agentId: string; name: string }>>([]);
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ clients: Client[]; total: number }>(
        `/api/agentie/clients?agent=${encodeURIComponent(agent)}&search=${encodeURIComponent(search)}&limit=200`,
      );
      setClients(d.clients);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agent, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    api<{ agents: Array<{ agentId: string; name: string }> }>(
      "/api/agentie/agents",
    )
      .then((d) => setAgents(d.agents))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Clienții firmei ({formatNumber(total)})
        </h1>
        <p className="text-sm text-slate-500">
          Toate firmele convertite, cu agentul responsabil și ultima vizită.
        </p>
      </header>

      <ImportUniversCard onDone={load} agents={agents} />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după nume, localitate sau CUI"
              className={`${inputClass} mt-0 pl-9`}
            />
          </div>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className={`${inputClass} mt-0 sm:w-56`}
          >
            <option value="">Toți agenții</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : clients.length === 0 ? (
        <EmptyState text="Niciun client încă — agenții îi convertesc din teren, sau folosește importul din vânzări." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Localitate</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Ultima vizită</th>
                <th className="px-4 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.cui} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{c.denumire}</p>
                    <p className="text-xs text-slate-500">CUI {c.cui}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.localitate}
                    {c.judet ? ` (${c.judet})` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.agent || "—"}</td>
                  <td className="px-4 py-3">
                    {c.lastVisit ? (
                      formatDate(c.lastVisit)
                    ) : (
                      <span className="text-rose-600">niciodată</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.telefon ? (
                      <a
                        href={`tel:${c.telefon}`}
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {c.telefon}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/**
 * „Adu universul de clienți": managerul/patronul trage fișierul cu clienții
 * activi (denumire + CUI + agent, cum e), aplicația îi potrivește cu firmele
 * oficiale, îi trece pe „client" și îi DISTRIBUIE agenților din fișier.
 */
/** Un singur client, adăugat de mână: nume sau CUI + agentul care-l ține. */
function ManualAdd({
  agents,
  onDone,
}: {
  agents: Array<{ agentId: string; name: string }>;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [cui, setCui] = useState("");
  const [agent, setAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const d = await api<{
        matched: Array<{ denumire: string; localitate: string; agent: string }>;
        unmatched: string[];
      }>("/api/agentie/clients-import", {
        method: "POST",
        json: { clients: [{ name, cui, agent }] },
      });
      if (d.matched.length > 0) {
        const m = d.matched[0];
        setMsg({
          kind: "success",
          text: `${m.denumire} (${m.localitate || "—"}) e acum client${m.agent ? ` la ${m.agent}` : ""}.`,
        });
        setName("");
        setCui("");
        onDone();
      } else {
        setMsg({
          kind: "error",
          text: "Nu am găsit firma — verifică numele exact sau pune CUI-ul.",
        });
      }
    } catch (e) {
      setMsg({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={add}
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
    >
      <div className="min-w-0 flex-1">
        <label className="text-xs font-medium text-slate-500">
          Sau adaugă un client manual
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Denumirea firmei"
          className={`${inputClass} mt-1`}
        />
      </div>
      <input
        value={cui}
        onChange={(e) => setCui(e.target.value)}
        placeholder="CUI (opțional)"
        className={`${inputClass} mt-0 w-32`}
      />
      <select
        value={agent}
        onChange={(e) => setAgent(e.target.value)}
        className={`${inputClass} mt-0 w-44`}
      >
        <option value="">Fără agent</option>
        {agents.map((a) => (
          <option key={a.agentId} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || (name.trim().length < 4 && cui.replace(/\D/g, "").length < 2)}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? "..." : "Adaugă"}
      </button>
      {msg && (
        <p
          className={`w-full text-sm ${msg.kind === "success" ? "text-emerald-700" : "text-rose-600"}`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}

function ImportUniversCard({
  onDone,
  agents,
}: {
  onDone: () => void;
  agents: Array<{ agentId: string; name: string }>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    matched: Array<{
      client: string;
      denumire: string;
      cui: string;
      localitate: string;
      agent: string;
      via: string;
    }>;
    unmatched: string[];
    agentsUnknown: string[];
    updated: number;
    fileInfo: string;
  } | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function handleFile(f: File) {
    setBusy("Citesc fișierul...");
    setError(null);
    setResult(null);
    try {
      const { parseClientsFile } = await import("@/lib/parse-xls");
      const parsed = await parseClientsFile(await f.arrayBuffer());
      if (parsed.clients.length === 0) {
        setError(
          "N-am găsit clienți în fișier. Trebuie o coloană cu denumirea (antet gen Denumire / Client / Firma); CUI și Agent sunt opționale.",
        );
        return;
      }
      setBusy(`Potrivesc ${parsed.clients.length} clienți cu firmele oficiale...`);
      const d = await api<NonNullable<typeof result>>(
        "/api/agentie/clients-import",
        { method: "POST", json: { clients: parsed.clients } },
      );
      setResult({
        ...d,
        fileInfo: `${f.name} — coloane: ${parsed.columns.name}${parsed.columns.cui ? ", " + parsed.columns.cui : ""}${parsed.columns.agent ? ", " + parsed.columns.agent : ""}`,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Upload className="h-4 w-4 text-emerald-600" />
            Adu universul de clienți (XLS/CSV)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Fișierul cu clienții activi, așa cum îl ai: o coloană cu{" "}
            <strong>denumirea</strong>; <strong>CUI</strong> și{" "}
            <strong>agentul</strong> dacă există. Îi potrivim cu firmele
            oficiale (adresă, telefon, hartă) și îi distribuim pe agenți.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ?? "Alege fișierul"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xls,.xlsx,.ods,.csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <ManualAdd agents={agents} onDone={onDone} />

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-400">{result.fileInfo}</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {result.matched.length} clienți importați
            </span>
            {result.unmatched.length > 0 && (
              <span className="rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                {result.unmatched.length} nepotriviți
              </span>
            )}
            {result.agentsUnknown.length > 0 && (
              <span className="rounded-md bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
                agenți necunoscuți: {result.agentsUnknown.join(", ")} — adaugă-i
                întâi în Agenți, apoi reimportă
              </span>
            )}
          </div>
          {result.matched.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {(showAll ? result.matched : result.matched.slice(0, 8)).map((m) => (
                <li
                  key={m.cui}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">
                      {m.denumire}
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        {m.via === "cui" ? "potrivit pe CUI" : `din: ${m.client}`}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      CUI {m.cui} · {m.localitate || "—"}
                      {m.agent ? ` · → ${m.agent}` : " · fără agent"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.matched.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              {showAll ? "Arată mai puțini" : `Arată toți ${result.matched.length}`}
            </button>
          )}
          {result.unmatched.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">
                Nepotriviți ({result.unmatched.length}) — nume care nu apar în
                registrul firmelor active
              </summary>
              <p className="mt-1">{result.unmatched.slice(0, 100).join(" · ")}</p>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
