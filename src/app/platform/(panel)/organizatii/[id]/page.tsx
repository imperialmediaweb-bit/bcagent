"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
  Trash2,
  UserPlus,
} from "lucide-react";
import type {
  Invoice,
  Organization,
  OrgUser,
  Plan,
} from "@/modules/platform/types";
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
  formatDateTime,
  formatMoney,
  inputClass,
} from "../../../ui";

interface OrgDetail {
  org: Organization;
  users: OrgUser[];
  agents: Array<{ id: string; agentId: string; name: string; active: boolean }>;
  invoices: Invoice[];
  aiUsage?: {
    days: number;
    totalCalls: number;
    totalBani: number;
    byKind: Array<{ kind: string; calls: number; bani: number }>;
  };
}

const AI_KIND_LABEL: Record<string, string> = {
  ocr: "📷 Poze la factură (OCR)",
  analiza: "📊 Analize vânzări",
  briefing: "🧠 Briefing firmă",
  client_voice: "🗣️ Vocea clientului",
  coach: "🎓 Antrenor",
  chat: "💬 Chat agent",
  brief_client: "👤 Fișe client",
  issue: "🐛 Triaj probleme",
};

export default function OrgDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<OrgDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<OrgDetail>(`/api/platform/orgs/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
    api<{ plans: Plan[] }>("/api/platform/plans")
      .then((d) => setPlans(d.plans))
      .catch(() => setPlans([]));
  }, [load]);

  async function patch(patchBody: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/platform/orgs/${id}`, { method: "PATCH", json: patchBody });
      await load();
      setNotice("Salvat.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function billing(action: string, planId?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url?: string; count?: number }>(
        `/api/platform/orgs/${id}/billing`,
        { method: "POST", json: { action, planId } },
      );
      if (res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        setNotice(`Sincronizat: ${res.count ?? 0} facturi.`);
        await load();
        setTimeout(() => setNotice(null), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeOrg() {
    if (
      !confirm(
        "Ștergi definitiv organizația, conturile și facturile ei din platformă?",
      )
    )
      return;
    try {
      await api(`/api/platform/orgs/${id}`, { method: "DELETE" });
      router.push("/platform/organizatii");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />;

  const { org } = data;

  return (
    <div className="space-y-5">
      <Link
        href="/platform/organizatii"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Organizații
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {org.name}
            </h1>
            <Badge status={org.status}>{org.status}</Badge>
          </div>
          <p className="text-sm text-slate-500">
            {org.cui ? `CUI ${org.cui} · ` : ""}
            {org.planName ?? "fără plan"} ·{" "}
            {org.agentCount ?? 0}/{org.agentLimit} agenți
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {org.status !== "suspendat" ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => patch({ status: "suspendat" })}
            >
              Suspendă
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => patch({ status: "activ" })}>
              Reactivează
            </Button>
          )}
          <Button variant="danger" onClick={removeOrg}>
            <Trash2 className="h-4 w-4" /> Șterge
          </Button>
        </div>
      </header>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DetailsCard org={org} plans={plans} busy={busy} onSave={patch} />
          <UsersCard orgId={id} users={data.users} onChanged={load} />
          <AgentsCard
            orgId={id}
            agents={data.agents}
            limit={org.agentLimit}
            onChanged={load}
          />
          <HartaCard orgId={id} />
        </div>

        <div className="space-y-4">
          <BillingCard org={org} plans={plans} busy={busy} onAction={billing} />
          <AiUsageCard usage={data.aiUsage} />
          <InvoicesCard invoices={data.invoices} />
        </div>
      </div>
    </div>
  );
}

function DetailsCard({
  org,
  plans,
  busy,
  onSave,
}: {
  org: Organization;
  plans: Plan[];
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: org.name,
    cui: org.cui,
    email: org.email,
    telefon: org.telefon,
    planId: org.planId ?? "",
    status: org.status,
    agentLimit: org.agentLimit,
    trialEndsAt: org.trialEndsAt ? org.trialEndsAt.slice(0, 10) : "",
    note: org.note,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-slate-800">Date organizație</h2>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            ...form,
            trialEndsAt: form.trialEndsAt
              ? new Date(form.trialEndsAt).toISOString()
              : null,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Denumire">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="CUI">
            <input
              value={form.cui}
              onChange={(e) => set("cui", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={inputClass}
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
              onChange={(e) => set("planId", e.target.value)}
              className={inputClass}
            >
              <option value="">Fără plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {(p.priceCents / 100).toFixed(0)} {p.currency}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) =>
                set("status", e.target.value as Organization["status"])
              }
              className={inputClass}
            >
              {["trial", "activ", "suspendat", "anulat"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
          <Field label="Trial până la">
            <input
              type="date"
              value={form.trialEndsAt}
              onChange={(e) => set("trialEndsAt", e.target.value)}
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
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Se salvează..." : "Salvează"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BillingCard({
  org,
  plans,
  busy,
  onAction,
}: {
  org: Organization;
  plans: Plan[];
  busy: boolean;
  onAction: (action: string, planId?: string) => Promise<void>;
}) {
  const [planId, setPlanId] = useState(org.planId ?? "");
  const plan = plans.find((p) => p.id === planId);

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <CreditCard className="h-4 w-4" /> Abonament & plată
      </h2>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Plan curent</dt>
          <dd className="font-medium text-slate-800">{org.planName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Următoarea plată</dt>
          <dd className="font-medium text-slate-800">
            {formatDate(org.currentPeriodEnd)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Client Stripe</dt>
          <dd className="truncate font-mono text-xs text-slate-600">
            {org.stripeCustomerId ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Abonament</dt>
          <dd className="truncate font-mono text-xs text-slate-600">
            {org.stripeSubscriptionId ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-2">
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className={`${inputClass} mt-0`}
        >
          <option value="">Alege planul pentru plată</option>
          {plans
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {(p.priceCents / 100).toFixed(0)} {p.currency}/
                {p.interval === "year" ? "an" : "lună"}
              </option>
            ))}
        </select>
        {plan && !plan.stripePriceId && (
          <p className="text-xs text-amber-600">
            Planul nu are Price ID Stripe — completează-l în Planuri.
          </p>
        )}
        <Button
          className="w-full"
          disabled={busy || !planId}
          onClick={() => onAction("checkout", planId)}
        >
          <Link2 className="h-4 w-4" /> Generează link de plată
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy || !org.stripeCustomerId}
          onClick={() => onAction("portal")}
        >
          <ExternalLink className="h-4 w-4" /> Portal facturare client
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy || !org.stripeCustomerId}
          onClick={() => onAction("sync-invoices")}
        >
          <RefreshCw className="h-4 w-4" /> Sincronizează facturile
        </Button>
      </div>
    </Card>
  );
}

function UsersCard({
  orgId,
  users,
  onChanged,
}: {
  orgId: string;
  users: OrgUser[];
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "manager">("owner");
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ password: string }>(
        `/api/platform/orgs/${orgId}/users`,
        { method: "POST", json: { email, name, role } },
      );
      setPassword(res.password);
      setEmail("");
      setName("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function action(userId: string, act: string) {
    setError(null);
    try {
      const res = await api<{ password?: string }>(
        `/api/platform/orgs/${orgId}/users`,
        { method: "PATCH", json: { userId, action: act } },
      );
      if (res.password) {
        setPassword(res.password);
        setOpen(true);
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(userId: string) {
    if (!confirm("Ștergi contul?")) return;
    try {
      await api(`/api/platform/orgs/${orgId}/users?userId=${userId}`, {
        method: "DELETE",
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">
          Conturi firmă ({users.length})
        </h2>
        <Button variant="secondary" onClick={() => { setPassword(null); setOpen(true); }}>
          <UserPlus className="h-4 w-4" /> Cont nou
        </Button>
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      {users.length === 0 ? (
        <EmptyState text="Firma nu are încă niciun cont de acces." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {u.name || u.email}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {u.email} · {u.role}
                  {u.lastLoginAt ? ` · ultim login ${formatDate(u.lastLoginAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!u.active && <Badge status="suspendat">inactiv</Badge>}
                <Button
                  variant="ghost"
                  title="Resetează parola"
                  onClick={() => action(u.id, "reset-password")}
                >
                  <KeyRound className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  title={u.active ? "Dezactivează" : "Activează"}
                  onClick={() => action(u.id, u.active ? "deactivate" : "activate")}
                >
                  {u.active ? "⏸" : "▶"}
                </Button>
                <Button variant="ghost" title="Șterge" onClick={() => remove(u.id)}>
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Cont firmă">
        {password ? (
          <div className="space-y-4">
            <Alert kind="success">
              Parolă generată — se afișează o singură dată.
            </Alert>
            <CopyBox value={password} label="Parolă" />
            <div className="flex justify-end">
              <Button onClick={() => { setPassword(null); setOpen(false); }}>
                Gata
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-4">
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Nume">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Rol">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "owner" | "manager")}
                className={inputClass}
              >
                <option value="owner">Owner (administrator)</option>
                <option value="manager">Manager</option>
              </select>
            </Field>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Renunță
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Se creează..." : "Creează cont"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

function AgentsCard({
  orgId,
  agents,
  limit,
  onChanged,
}: {
  orgId: string;
  agents: Array<{ id: string; agentId: string; name: string; active: boolean }>;
  limit: number;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [ttlDays, setTtlDays] = useState(30);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggleAgent(agentRowId: string, active: boolean) {
    setError(null);
    try {
      await api(`/api/platform/orgs/${orgId}/agents`, {
        method: "PATCH",
        json: { agentRowId, active },
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string }>(`/api/platform/orgs/${orgId}/agents`, {
        method: "POST",
        json: { agentId, agentName, ttlDays },
      });
      setLink(res.url);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">
          Agenți de teren ({agents.filter((a) => a.active).length}/{limit})
        </h2>
        <Button
          variant="secondary"
          onClick={() => {
            setLink(null);
            setOpen(true);
          }}
        >
          <Link2 className="h-4 w-4" /> Link agent
        </Button>
      </div>

      {error && !open && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState text="Niciun agent înregistrat pentru firma asta." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {agents.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{a.name}</p>
                <p className="truncate font-mono text-xs text-slate-500">{a.agentId}</p>
              </div>
              <div className="flex items-center gap-2">
                {!a.active && <Badge status="anulat">blocat</Badge>}
                <Button
                  variant="ghost"
                  title={
                    a.active
                      ? "Blochează accesul instant (linkul moare)"
                      : "Redeschide accesul"
                  }
                  onClick={() => toggleAgent(a.id, !a.active)}
                >
                  {a.active ? "⏸" : "▶"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {agents.length >= 2 && (
        <TransferBox orgId={orgId} agents={agents} onDone={onChanged} />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Link magic pentru agent">
        {link ? (
          <div className="space-y-4">
            <Alert kind="success">Link generat — trimite-l agentului pe WhatsApp.</Alert>
            <CopyBox value={link} label="Link" />
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Gata</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={issue} className="space-y-4">
            <Field label="ID agent" hint="Trebuie să fie identic cu numele agentului din XLS-uri.">
              <input
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                required
                className={inputClass}
                placeholder="a-001"
              />
            </Field>
            <Field label="Nume agent">
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Valabilitate (zile)">
              <input
                type="number"
                min={1}
                max={365}
                value={ttlDays}
                onChange={(e) => setTtlDays(parseInt(e.target.value) || 30)}
                className={inputClass}
              />
            </Field>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Renunță
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Se emite..." : "Emite link"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

/** Predarea portofoliului: X pleacă → clienții și prospecții lui trec la Y. */
function TransferBox({
  orgId,
  agents,
  onDone,
}: {
  orgId: string;
  agents: Array<{ id: string; agentId: string; name: string; active: boolean }>;
  onDone: () => Promise<void>;
}) {
  const [fromAgent, setFromAgent] = useState("");
  const [toAgent, setToAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(
    null,
  );

  async function transfer() {
    if (!fromAgent || !toAgent || fromAgent === toAgent) return;
    if (
      !confirm(
        `Transferi TOT portofoliul (clienți + prospecți) de la ${fromAgent} la ${toAgent} și blochezi accesul lui ${fromAgent}?`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ moved: number }>(
        `/api/platform/orgs/${orgId}/transfer`,
        { method: "POST", json: { fromAgent, toAgent } },
      );
      setMsg({
        kind: "success",
        text: `${res.moved} firme transferate la ${toAgent}. Accesul lui ${fromAgent} e blocat.`,
      });
      setFromAgent("");
      setToAgent("");
      await onDone();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
        Pleacă un agent? Predă portofoliul
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={fromAgent}
          onChange={(e) => setFromAgent(e.target.value)}
          className={`${inputClass} mt-0 flex-1`}
        >
          <option value="">Cine predă...</option>
          {agents.map((a) => (
            <option key={a.id} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="hidden text-slate-400 sm:block">→</span>
        <select
          value={toAgent}
          onChange={(e) => setToAgent(e.target.value)}
          className={`${inputClass} mt-0 flex-1`}
        >
          <option value="">Cine preia...</option>
          {agents
            .filter((a) => a.active && a.name !== fromAgent)
            .map((a) => (
              <option key={a.id} value={a.name}>
                {a.name}
              </option>
            ))}
        </select>
        <Button
          variant="secondary"
          disabled={busy || !fromAgent || !toAgent || fromAgent === toAgent}
          onClick={transfer}
        >
          {busy ? "Se transferă..." : "Transferă"}
        </Button>
      </div>
      {msg && (
        <div className="mt-2">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      <p className="mt-2 text-xs text-amber-700">
        Istoricul vizitelor și vânzărilor rămâne pe numele agentului vechi —
        doar portofoliul viitor se mută.
      </p>
    </div>
  );
}

function InvoicesCard({ invoices }: { invoices: Invoice[] }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-800">
        Facturi ({invoices.length})
      </h2>
      {invoices.length === 0 ? (
        <EmptyState text="Nicio factură pentru organizația asta." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {invoices.map((inv) => (
            <li key={inv.id} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-800">
                  {inv.number || inv.id}
                </p>
                <Badge status={inv.status}>{inv.status}</Badge>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{formatDateTime(inv.issuedAt)}</span>
                <span className="font-medium text-slate-700">
                  {formatMoney(inv.amountCents, inv.currency)}
                </span>
              </div>
              {(inv.pdfUrl || inv.hostedUrl) && (
                <div className="mt-1 flex gap-3 text-xs">
                  {inv.pdfUrl && (
                    <a
                      href={inv.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      PDF
                    </a>
                  )}
                  {inv.hostedUrl && (
                    <a
                      href={inv.hostedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      Vezi în Stripe
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Consumul AI al firmei pe 30 de zile — cât te costă clientul ăsta. */
function AiUsageCard({
  usage,
}: {
  usage?: {
    days: number;
    totalCalls: number;
    totalBani: number;
    byKind: Array<{ kind: string; calls: number; bani: number }>;
  };
}) {
  const lei = (bani: number) => (bani / 100).toFixed(2);
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-800">
        🤖 Consum AI (30 zile)
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Cât te costă firma asta la AI — estimare, calibrată pe modelele
        folosite. Semnal pentru preț, nu factura exactă a furnizorului.
      </p>
      {!usage || usage.totalCalls === 0 ? (
        <p className="text-sm text-slate-400">
          Fără consum AI în ultimele 30 de zile.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {lei(usage.totalBani)} lei
            </span>
            <span className="text-xs text-slate-500">
              din {usage.totalCalls.toLocaleString("ro-RO")} apeluri AI
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {usage.byKind.map((k) => (
              <li
                key={k.kind}
                className="flex items-center justify-between py-1.5 text-sm"
              >
                <span className="text-slate-700">
                  {AI_KIND_LABEL[k.kind] ?? k.kind}
                </span>
                <span className="text-slate-500">
                  {k.calls.toLocaleString("ro-RO")} ·{" "}
                  <strong className="text-slate-700">{lei(k.bani)} lei</strong>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * ADU LOCAȚIILE DIN HARTA FIRMEI, de la locul potrivit.
 *
 * Alternativa era să intri în contul personal al clientului: i-ar sări
 * alerta de „dispozitiv nou", i-ar apărea în jurnal ca făcut de EL, iar
 * dacă iese ceva strâmb nu s-ar mai ști cine a apăsat. Aici rămâne scris:
 * adminul platformei, pentru firma asta.
 */
interface OSMRezultat {
  facut: {
    judet: string;
    magazine: number;
    locuriPuse: number;
    magazineNoi: number;
    eroare?: string;
  } | null;
  ramase: number;
  plan: Array<{ judet: string; stare: string; noi: number; locuri: number }>;
}

function HartaCard({ orgId }: { orgId: string }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ruleaza(anuleaza: boolean) {
    if (anuleaza && !confirm("Șterg locurile aduse din hartă. Cele puse de agenți din teren rămân. Continui?")) {
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      // Fără link n-avem hartă de citit — sărim direct la OpenStreetMap.
      const d =
        !anuleaza && link.trim() === ""
          ? {}
          : await api<{
              scrise?: number;
              sterse?: number;
              totalPuncte?: number;
              nesigure?: number;
              clientiCuLoc?: number;
              magazineSalvate?: number;
              faraLocPeHarta?: number;
            }>(`/api/platform/orgs/${orgId}/harta`, {
              method: "POST",
              body: JSON.stringify(anuleaza ? { anuleaza: true } : { link }),
            });
      const text = anuleaza
        ? `Am șters ${d.sterse ?? 0} locuri aduse din hartă. Ce au pus agenții a rămas.`
        : link.trim() === ""
          ? "N-ai dat link de hartă — caut doar pe OpenStreetMap."
          : `Am pus locul la ${d.scrise ?? 0} magazine, din ${d.totalPuncte ?? 0} câte are harta.` +
          (d.clientiCuLoc !== undefined
            ? ` Acum ${d.clientiCuLoc} dintre clienții firmei au locul exact pe hartă.`
            : "") +
          (d.nesigure ? ` ${d.nesigure} n-au fost sigure — le pun agenții din teren.` : "") +
          (d.magazineSalvate
            ? ` Plus ${d.magazineSalvate} magazine de prospectat, cu locul lor.`
            : "") +
          (d.faraLocPeHarta
            ? ` ${d.faraLocPeHarta} firme erau în hartă fără coordonate.`
            : "");
      setMsg(text);

      // A DOUA JUMĂTATE A ACELEIAȘI APĂSĂRI: magazinele de pe
      // OpenStreetMap. Vin în cereri separate doar pentru că serviciul lor
      // e lent, județ cu județ — nu ca să mai apese cineva un buton.
      if (!anuleaza) {
        for (let tura = 0; tura < 20; tura++) {
          const r = await api<{ osm: OSMRezultat }>(
            `/api/platform/orgs/${orgId}/harta`,
            { method: "POST", body: JSON.stringify({ osm: true }) },
          );
          const gata = r.osm.plan.filter((t) => t.stare === "gata");
          const noi = gata.reduce((s, t) => s + t.noi, 0);
          const puse = gata.reduce((s, t) => s + t.locuri, 0);
          setMsg(
            `${text} Din OpenStreetMap: ${noi} magazine de prospectat` +
              (puse ? `, plus ${puse} firme care au primit locul` : "") +
              `. Județe gata: ${gata.map((t) => t.judet).join(", ") || "—"}` +
              (r.osm.ramase ? `; mai sunt ${r.osm.ramase} (le ia cronul noaptea).` : "."),
          );
          if (!r.osm.facut || r.osm.ramase === 0) break;
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-800">
        Adu locațiile magazinelor
      </h2>
      <p className="mt-1 break-words text-xs leading-snug text-slate-500">
        Dacă firma are o hartă Google My Maps cu magazinele puse de mână, le
        aducem aici. Aceeași apăsare caută și pe OpenStreetMap magazinele la
        care n-a ajuns niciun agent. De atunci agenții navighează pe
        coordonate exacte.
      </p>
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="https://www.google.com/maps/d/viewer?mid=..."
        className="mt-2 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => ruleaza(false)}
          disabled={busy}
          className="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Lucrez..." : "Adu locațiile"}
        </button>
        <button
          type="button"
          onClick={() => ruleaza(true)}
          disabled={busy}
          className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Anulează ce am adus
        </button>
      </div>
      <p className="mt-2 break-words text-xs leading-snug text-slate-500">
        Se scriu doar potrivirile sigure. Ce au pus agenții din teren nu se
        atinge, iar tot ce aduce importul se poate șterge cu „Anulează".
      </p>
      {msg && (
        <p className="mt-2 break-words text-xs font-medium leading-snug text-emerald-700">
          ✓ {msg}
        </p>
      )}
      {err && (
        <p className="mt-2 break-words text-xs font-medium leading-snug text-rose-600">
          {err}
        </p>
      )}
    </Card>
  );
}
