"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, api, inputClass } from "@/app/platform/ui";

export default function AgentieSetariPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Setări
        </h1>
        <p className="text-sm text-slate-500">Contul tău de acces.</p>
      </header>

      <Card className="max-w-md">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Schimbă parola
        </h2>
        <ChangePassword />
      </Card>
    </div>
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
      await api("/api/agentie/password", {
        method: "POST",
        json: { current, next },
      });
      setMsg({ kind: "success", text: "Parola a fost schimbată." });
      setCurrent("");
      setNext("");
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) });
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
