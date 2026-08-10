"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CopyBox,
  Field,
  api,
  inputClass,
} from "../../ui";
import SecurityCard from "@/app/SecurityCard";

interface MeResponse {
  admin: { id: string; email: string };
  integrations: {
    stripe: boolean;
    stripeWebhook: boolean;
    openai: boolean;
    anthropic: boolean;
    r2: boolean;
    db: boolean;
  };
}

const INTEGRATION_LABELS: Array<{
  key: keyof MeResponse["integrations"];
  label: string;
  env: string;
  hint: string;
}> = [
  {
    key: "db",
    label: "Bază de date",
    env: "DATABASE_URL",
    hint: "Postgres — persistența tuturor datelor",
  },
  {
    key: "stripe",
    label: "Stripe (plăți)",
    env: "STRIPE_SECRET_KEY",
    hint: "Abonamente, checkout și facturi automate",
  },
  {
    key: "stripeWebhook",
    label: "Stripe webhook",
    env: "STRIPE_WEBHOOK_SECRET",
    hint: "Endpoint: /api/stripe/webhook",
  },
  {
    key: "openai",
    label: "OpenAI",
    env: "OPENAI_API_KEY",
    hint: "Analize AI în panoul agenților",
  },
  {
    key: "anthropic",
    label: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    hint: "Provider AI alternativ",
  },
  {
    key: "r2",
    label: "Cloudflare R2",
    env: "R2_ACCOUNT_ID",
    hint: "Storage pentru fișiere mari",
  },
];

export default function SetariPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MeResponse>("/api/platform/me")
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Setări platformă
        </h1>
        <p className="text-sm text-slate-500">
          Contul tău de super-admin și starea integrărilor.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Contul meu</h2>
          <p className="text-sm text-slate-600">
            {me?.admin.email ?? "—"}
          </p>
          <div className="mt-4">
            <ChangePassword />
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Integrări</h2>
          <ul className="space-y-3">
            {INTEGRATION_LABELS.map((it) => {
              const on = me?.integrations[it.key] ?? false;
              return (
                <li key={it.key} className="flex items-start gap-3">
                  {on ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{it.label}</p>
                    <p className="text-xs text-slate-500">{it.hint}</p>
                    <code className="text-xs text-slate-400">{it.env}</code>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <EmailTest />
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Cum conectezi Stripe
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>
            În Stripe → <strong>Products</strong> creează câte un produs cu preț
            recurent lunar pentru fiecare plan.
          </li>
          <li>
            Copiază <code>price_...</code> al fiecărui preț și pune-l în{" "}
            <Link href="/platform/planuri" className="text-indigo-600 hover:underline">
              Planuri
            </Link>
            .
          </li>
          <li>
            În Stripe → <strong>Developers → Webhooks</strong> adaugă endpointul{" "}
            <code>/api/stripe/webhook</code> cu evenimentele{" "}
            <code>checkout.session.completed</code>,{" "}
            <code>customer.subscription.*</code>, <code>invoice.*</code>.
          </li>
          <li>
            Pune <code>STRIPE_SECRET_KEY</code> și{" "}
            <code>STRIPE_WEBHOOK_SECRET</code> în variabilele de mediu (Railway →
            Variables) și repornește.
          </li>
        </ol>
      </Card>

      <DemoCard />

      <SecurityCard endpoint="/api/platform/2fa" />

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Alte panouri
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin">
            <Button variant="secondary">Import prospecți & linkuri agenți</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

/** Creează/reface firma DEMO cu date complete — pentru prezentări. */
function DemoCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    owner: { email: string; password: string };
    manager: { email: string; password: string };
    agentLinks: Array<{ name: string; url: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<NonNullable<typeof result>>("/api/platform/demo", {
        method: "POST",
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            🎬 Firma DEMO
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Creează/reface „Demo Distribuție SRL" cu tot: 3 agenți, vânzări pe
            3 luni, vizite, comenzi, targeturi, restanțe, rute pe azi. Butonul
            „Vezi DEMO" de pe pagina de login intră direct în ea.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? "Se construiește..." : result ? "Reface demo" : "Creează demo"}
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {result && (
        <div className="mt-4 space-y-3">
          <Alert kind="success">Demo gata! Datele de acces (o singură dată):</Alert>
          <CopyBox
            label={`Administrator — ${result.owner.email}`}
            value={result.owner.password}
          />
          <CopyBox
            label={`Manager — ${result.manager.email}`}
            value={result.manager.password}
          />
          {result.agentLinks.map((a) => (
            <CopyBox key={a.name} label={`Agent — ${a.name}`} value={a.url} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api("/api/platform/password", {
        method: "POST",
        json: { current, next },
      });
      setMsg({ kind: "success", text: "Parola a fost schimbată." });
      setCurrent("");
      setNext("");
    } catch (e) {
      setMsg({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Parola curentă">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </Field>
      <Field label="Parola nouă" hint="Minim 10 caractere.">
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Button type="submit" disabled={saving}>
        {saving ? "Se schimbă..." : "Schimbă parola"}
      </Button>
    </form>
  );
}

/** Test de email: trimite un mesaj de probă și arată exact ce zice Resend. */
function EmailTest() {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{
        ok: boolean;
        motiv?: string;
        nota?: string;
        sugestie?: string;
      }>("/api/platform/email-test", { method: "POST", json: { to } });
      if (r.ok) {
        setMsg({ kind: "success", text: `Trimis ✓ — ${r.nota ?? ""}` });
      } else {
        setMsg({ kind: "error", text: `${r.motiv ?? "Eroare"} ${r.sugestie ?? ""}` });
      }
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="space-y-2">
      <p className="text-sm font-medium text-slate-800">Test de email</p>
      <p className="text-xs text-slate-500">
        Trimite un email de probă și vezi pe loc dacă pleacă. Dacă nu ajunge,
        cel mai des e Resend: până verifici domeniul, livrează doar către
        adresa contului tău.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
          placeholder="unde trimit testul"
          className={`${inputClass} mt-0 flex-1`}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Trimit..." : "Trimite test"}
        </Button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </form>
  );
}
