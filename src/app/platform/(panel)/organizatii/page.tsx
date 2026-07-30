"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Organization, Plan } from "@/modules/platform/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyBox,
  EmptyState,
  Field,
  Modal,
  api,
  formatDate,
  formatNumber,
  inputClass,
} from "../../ui";

const STATUSES = ["", "trial", "activ", "suspendat", "anulat"];
const PAGE_SIZE = 25;

export default function OrganizatiiPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        search,
        status,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      const data = await api<{ orgs: Organization[]; total: number }>(
        `/api/platform/orgs?${params}`,
      );
      setOrgs(data.orgs);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    api<{ plans: Plan[] }>("/api/platform/plans")
      .then((d) => setPlans(d.plans))
      .catch(() => setPlans([]));
  }, []);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Organizații
          </h1>
          <p className="text-sm text-slate-500">
            Firmele de distribuție care folosesc platforma ({formatNumber(total)})
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> Organizație nouă
        </Button>
      </header>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setPage(0);
                setSearch(e.target.value);
              }}
              placeholder="Caută după nume, CUI sau email"
              className={`${inputClass} mt-0 pl-9`}
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setPage(0);
              setStatus(e.target.value);
            }}
            className={`${inputClass} mt-0 sm:w-48`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "Toate statusurile" : s}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200/60" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState text="Nicio organizație găsită. Creează prima firmă de distribuție." />
      ) : (
        <>
          {/* Tabel pe desktop */}
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Organizație</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Agenți</th>
                  <th className="px-4 py-3 font-medium">Următoarea plată</th>
                  <th className="px-4 py-3 font-medium">Creat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orgs.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/platform/organizatii/${o.id}`}
                        className="font-medium text-slate-800 hover:text-indigo-600"
                      >
                        {o.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {o.cui ? `CUI ${o.cui}` : "fără CUI"}
                        {o.email ? ` · ${o.email}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {o.planName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={o.status}>{o.status}</Badge>
                      {o.status === "trial" && o.trialEndsAt && (
                        <p className="mt-1 text-xs text-slate-500">
                          până {formatDate(o.trialEndsAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {o.agentCount ?? 0} / {o.agentLimit}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(o.currentPeriodEnd)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDate(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Carduri pe mobil */}
          <div className="space-y-3 lg:hidden">
            {orgs.map((o) => (
              <Link
                key={o.id}
                href={`/platform/organizatii/${o.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{o.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {o.planName ?? "fără plan"} · {o.agentCount ?? 0}/{o.agentLimit} agenți
                    </p>
                  </div>
                  <Badge status={o.status}>{o.status}</Badge>
                </div>
              </Link>
            ))}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Înapoi
              </Button>
              <span className="text-sm text-slate-500">
                Pagina {page + 1} din {pages}
              </span>
              <Button
                variant="secondary"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Înainte →
              </Button>
            </div>
          )}
        </>
      )}

      <NewOrgModal
        open={showNew}
        plans={plans}
        onClose={() => setShowNew(false)}
        onCreated={() => {
          setShowNew(false);
          load();
        }}
      />
    </div>
  );
}

function NewOrgModal({
  open,
  plans,
  onClose,
  onCreated,
}: {
  open: boolean;
  plans: Plan[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    cui: "",
    email: "",
    telefon: "",
    planId: "",
    trialDays: 14,
    agentLimit: 5,
    note: "",
    createOwner: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ org: Organization; password: string | null } | null>(
    null,
  );

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ org: Organization; ownerPassword: string | null }>(
        "/api/platform/orgs",
        { method: "POST", json: form },
      );
      setResult({ org: data.org, password: data.ownerPassword });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setResult(null);
    setForm({
      name: "",
      cui: "",
      email: "",
      telefon: "",
      planId: "",
      trialDays: 14,
      agentLimit: 5,
      note: "",
      createOwner: true,
    });
    onClose();
  }

  if (result) {
    return (
      <Modal open={open} onClose={() => { onCreated(); close(); }} title="Organizație creată">
        <div className="space-y-4">
          <Alert kind="success">
            <strong>{result.org.name}</strong> a fost creată.
          </Alert>
          {result.password ? (
            <>
              <p className="text-sm text-slate-600">
                Parola contului de owner — se afișează o singură dată, trimite-o
                clientului acum:
              </p>
              <CopyBox value={result.password} label="Parolă" />
              <CopyBox value={result.org.email} label="Email de login" />
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Nu s-a creat cont de owner (fără email). Îl poți adăuga din pagina
              organizației.
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={() => { onCreated(); close(); }}>Gata</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} title="Organizație nouă" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Denumire firmă">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              className={inputClass}
              placeholder="Distribuție Nord SRL"
            />
          </Field>
          <Field label="CUI">
            <input
              value={form.cui}
              onChange={(e) => set("cui", e.target.value)}
              className={inputClass}
              placeholder="12345678"
            />
          </Field>
          <Field label="Email (login owner)">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={inputClass}
              placeholder="contact@firma.ro"
            />
          </Field>
          <Field label="Telefon">
            <input
              value={form.telefon}
              onChange={(e) => set("telefon", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Plan">
            <select
              value={form.planId}
              onChange={(e) => {
                const p = plans.find((x) => x.id === e.target.value);
                set("planId", e.target.value);
                if (p) set("agentLimit", p.agentLimit);
              }}
              className={inputClass}
            >
              <option value="">Fără plan (trial)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {(p.priceCents / 100).toFixed(0)} {p.currency}/lună
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zile trial">
            <input
              type="number"
              min={0}
              max={180}
              value={form.trialDays}
              onChange={(e) => set("trialDays", parseInt(e.target.value) || 0)}
              className={inputClass}
            />
          </Field>
          <Field label="Limită agenți">
            <input
              type="number"
              min={1}
              max={500}
              value={form.agentLimit}
              onChange={(e) => set("agentLimit", parseInt(e.target.value) || 1)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Notă internă">
          <textarea
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            rows={2}
            className={inputClass}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.createOwner}
            onChange={(e) => set("createOwner", e.target.checked)}
            className="rounded border-slate-300"
          />
          Creează cont de owner cu parolă generată (necesită email)
        </label>

        {error && <Alert>{error}</Alert>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Renunță
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Se creează..." : "Creează organizația"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
