"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import type { Plan } from "@/modules/platform/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  api,
  formatMoney,
  inputClass,
} from "../../ui";

interface PlansResponse {
  plans: Plan[];
  stripe: boolean;
  stripeCheck: Record<string, { ok: boolean; message: string }> | null;
}

const EMPTY: Plan = {
  id: "",
  name: "",
  priceCents: 0,
  currency: "RON",
  interval: "month",
  agentLimit: 5,
  features: { prospects: true, export: true, aiInsights: false, support: "email" },
  stripePriceId: null,
  active: true,
  createdAt: "",
};

export default function PlanuriPage() {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async (verify = false) => {
    try {
      setData(
        await api<PlansResponse>(`/api/platform/plans${verify ? "?verify=1" : ""}`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm("Ștergi planul? Dacă e folosit, dezactivează-l în loc să-l ștergi."))
      return;
    try {
      await api(`/api/platform/plans?id=${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Planuri de abonament
          </h1>
          <p className="text-sm text-slate-500">
            Prețurile pe care le vinzi firmelor de distribuție.
          </p>
        </div>
        <div className="flex gap-2">
          {data.stripe && (
            <Button
              variant="secondary"
              disabled={verifying}
              onClick={async () => {
                setVerifying(true);
                await load(true);
                setVerifying(false);
              }}
            >
              {verifying ? "Se verifică..." : "Verifică în Stripe"}
            </Button>
          )}
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="h-4 w-4" /> Plan nou
          </Button>
        </div>
      </header>

      {!data.stripe && (
        <Alert kind="info">
          Stripe nu e configurat. Planurile funcționează pentru facturare manuală;
          pentru plăți online adaugă <code>STRIPE_SECRET_KEY</code> și{" "}
          <code>STRIPE_WEBHOOK_SECRET</code> în variabilele de mediu.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      {data.plans.length === 0 ? (
        <EmptyState text="Niciun plan definit." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.plans.map((p) => {
            const check = data.stripeCheck?.[p.id];
            return (
              <Card key={p.id} className={p.active ? "" : "opacity-60"}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">{p.name}</h2>
                    <p className="text-xs text-slate-500">
                      {p.id} · {p.interval === "year" ? "anual" : "lunar"}
                    </p>
                  </div>
                  {!p.active && <Badge status="anulat">inactiv</Badge>}
                </div>

                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                  {formatMoney(p.priceCents, p.currency)}
                  <span className="text-sm font-normal text-slate-500">
                    /{p.interval === "year" ? "an" : "lună"}
                  </span>
                </p>

                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" /> {p.agentLimit} agenți
                  </li>
                  {p.features.prospects && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" /> Bază de prospecți
                    </li>
                  )}
                  {p.features.export && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" /> Export CSV
                    </li>
                  )}
                  {p.features.aiInsights && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" /> Analize AI
                    </li>
                  )}
                  {p.features.aiCoach && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" /> Antrenor AI +
                      fișe client
                    </li>
                  )}
                  {p.features.aiVision && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" /> Poze stand +
                      evaluări AI
                    </li>
                  )}
                  {p.features.support && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-500" /> Suport{" "}
                      {p.features.support}
                    </li>
                  )}
                </ul>

                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">Stripe Price ID</p>
                  <p className="truncate font-mono text-xs text-slate-700">
                    {p.stripePriceId ?? "— nesetat —"}
                  </p>
                  {check && (
                    <p
                      className={`mt-1 text-xs ${check.ok ? "text-emerald-600" : "text-amber-600"}`}
                    >
                      {check.ok ? "✓ " : "⚠ "}
                      {check.message}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(p)}>
                    <Pencil className="h-4 w-4" /> Editează
                  </Button>
                  <Button variant="ghost" onClick={() => remove(p.id)}>
                    <Trash2 className="h-4 w-4 text-rose-500" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <PlanModal
        plan={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

function PlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Plan>(plan ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (plan) setForm(plan);
    setError(null);
  }, [plan]);

  function set<K extends keyof Plan>(k: K, v: Plan[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/platform/plans", {
        method: "POST",
        json: {
          id: form.id || undefined,
          name: form.name,
          priceCents: form.priceCents,
          currency: form.currency,
          interval: form.interval,
          agentLimit: form.agentLimit,
          features: form.features,
          stripePriceId: form.stripePriceId ?? "",
          active: form.active,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!plan}
      onClose={onClose}
      title={plan?.createdAt ? `Editează „${plan.name}"` : "Plan nou"}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nume plan">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Preț (RON / perioadă)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.priceCents / 100}
              onChange={(e) =>
                set("priceCents", Math.round((parseFloat(e.target.value) || 0) * 100))
              }
              className={inputClass}
            />
          </Field>
          <Field label="Interval">
            <select
              value={form.interval}
              onChange={(e) => set("interval", e.target.value as "month" | "year")}
              className={inputClass}
            >
              <option value="month">Lunar</option>
              <option value="year">Anual</option>
            </select>
          </Field>
          <Field label="Limită agenți">
            <input
              type="number"
              min={1}
              max={1000}
              value={form.agentLimit}
              onChange={(e) => set("agentLimit", parseInt(e.target.value) || 1)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Stripe Price ID"
          hint="Din Stripe → Products → prețul recurent (price_...)."
        >
          <input
            value={form.stripePriceId ?? ""}
            onChange={(e) => set("stripePriceId", e.target.value)}
            className={inputClass}
            placeholder="price_1ABC..."
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Funcționalități incluse
          </legend>
          {(
            [
              ["prospects", "Bază de prospecți (1,3M firme)"],
              ["export", "Export CSV"],
              ["aiInsights", "Analize & briefing AI"],
              ["aiCoach", "Antrenor AI + fișe de client"],
              ["aiVision", "Poze la stand + evaluări AI agenți"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!form.features[key]}
                onChange={(e) =>
                  set("features", { ...form.features, [key]: e.target.checked })
                }
                className="rounded border-slate-300"
              />
              {label}
            </label>
          ))}
          <Field label="Suport">
            <input
              value={form.features.support ?? ""}
              onChange={(e) =>
                set("features", { ...form.features, support: e.target.value })
              }
              className={inputClass}
              placeholder="email / prioritar / dedicat"
            />
          </Field>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
            className="rounded border-slate-300"
          />
          Plan activ (se poate vinde)
        </label>

        {error && <Alert>{error}</Alert>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Renunță
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Se salvează..." : "Salvează planul"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
