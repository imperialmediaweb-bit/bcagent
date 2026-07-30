"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Plus } from "lucide-react";
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
  inputClass,
} from "@/app/platform/ui";

interface AgentRow {
  id: string;
  agentId: string;
  name: string;
  active: boolean;
  awayUntil: string | null;
  visitsToday: number;
  visitsWeek: number;
  visits30: number;
  clients: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AgentiPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [awayFor, setAwayFor] = useState<AgentRow | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ agents: AgentRow[] }>("/api/agentie/agents");
      setAgents(d.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(a: AgentRow) {
    try {
      await api("/api/agentie/agents", {
        method: "PATCH",
        json: { agentRowId: a.id, active: !a.active },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Agenții mei
          </h1>
          <p className="text-sm text-slate-500">
            Linkuri de acces, activitate, concedii și predarea portofoliului.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> Agent nou / link nou
        </Button>
      </header>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : agents.length === 0 ? (
        <EmptyState text="Niciun agent. Emite primul link de acces." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => {
            const away = a.awayUntil && a.awayUntil >= todayISO();
            return (
              <Card key={a.id} className={a.active ? "" : "opacity-60"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {a.name}
                    </p>
                    <p className="font-mono text-xs text-slate-500">{a.agentId}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {!a.active && <Badge status="anulat">blocat</Badge>}
                    {away && <Badge status="trial">🏖 concediu</Badge>}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 py-2">
                    <dt className="text-[10px] uppercase text-slate-500">Azi</dt>
                    <dd className="text-base font-semibold text-slate-800">
                      {a.visitsToday}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <dt className="text-[10px] uppercase text-slate-500">Săpt.</dt>
                    <dd className="text-base font-semibold text-slate-800">
                      {a.visitsWeek}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <dt className="text-[10px] uppercase text-slate-500">Clienți</dt>
                    <dd className="text-base font-semibold text-emerald-600">
                      {a.clients}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setAwayFor(a)}>
                    🏖 Concediu
                  </Button>
                  <Button
                    variant={a.active ? "secondary" : "primary"}
                    onClick={() => toggle(a)}
                    title={
                      a.active
                        ? "Blochează accesul instant (linkul moare)"
                        : "Redeschide accesul"
                    }
                  >
                    {a.active ? "⏸ Blochează" : "▶ Deblochează"}
                  </Button>
                </div>
                {away && (
                  <p className="mt-2 text-xs text-sky-600">
                    În concediu până la{" "}
                    {new Date(a.awayUntil!).toLocaleDateString("ro-RO")}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {agents.length >= 2 && <Transfer agents={agents} onDone={load} />}

      <NewAgentModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onDone={load}
      />
      <AwayModal
        agent={awayFor}
        onClose={() => setAwayFor(null)}
        onDone={load}
      />
    </div>
  );
}

function NewAgentModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [ttlDays, setTtlDays] = useState(30);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string }>("/api/agentie/agents", {
        method: "POST",
        json: { agentId, agentName, ttlDays },
      });
      setLink(res.url);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setLink(null);
    setAgentId("");
    setAgentName("");
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Link de acces pentru agent">
      {link ? (
        <div className="space-y-4">
          <Alert kind="success">
            Link generat — trimite-l agentului pe WhatsApp. Îl deschide pe
            telefon și are tot: harta, rutele, vizitele.
          </Alert>
          <CopyBox value={link} label="Linkul agentului" />
          <div className="flex justify-end">
            <Button onClick={close}>Gata</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="ID agent"
            hint="Același pentru re-emitere; identic cu numele din XLS-uri pentru rapoarte."
          >
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              required
              className={inputClass}
              placeholder="a-001"
            />
          </Field>
          <Field label="Nume complet">
            <input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              required
              className={inputClass}
              placeholder="Gavrilet Bogdan"
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
            <Button variant="secondary" onClick={close}>
              Renunță
            </Button>
            <Button type="submit" disabled={busy}>
              <Link2 className="h-4 w-4" />
              {busy ? "Se emite..." : "Emite link"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function AwayModal({
  agent,
  onClose,
  onDone,
}: {
  agent: {
    id: string;
    name: string;
    awayUntil: string | null;
  } | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUntil(agent?.awayUntil ?? "");
    setError(null);
  }, [agent]);

  async function save(value: string | null) {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/agentie/agents", {
        method: "PATCH",
        json: { agentRowId: agent.id, awayUntil: value },
      });
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!agent} onClose={onClose} title={`Concediu — ${agent?.name ?? ""}`}>
      <div className="space-y-4">
        <Field label="În concediu până la (inclusiv)">
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-between gap-2">
          {agent?.awayUntil && (
            <Button variant="ghost" disabled={busy} onClick={() => save(null)}>
              S-a întors — șterge concediul
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Renunță
            </Button>
            <Button disabled={busy || !until} onClick={() => save(until)}>
              Salvează
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Transfer({
  agents,
  onDone,
}: {
  agents: AgentRow[];
  onDone: () => Promise<void>;
}) {
  const [fromAgent, setFromAgent] = useState("");
  const [toAgent, setToAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(
    null,
  );

  async function run() {
    if (!fromAgent || !toAgent || fromAgent === toAgent) return;
    if (
      !confirm(
        `Transferi TOT portofoliul de la ${fromAgent} la ${toAgent} și îi blochezi accesul lui ${fromAgent}?`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ moved: number }>("/api/agentie/transfer", {
        method: "POST",
        json: { fromAgent, toAgent },
      });
      setMsg({
        kind: "success",
        text: `${res.moved} firme au trecut la ${toAgent}. ${fromAgent} nu mai are acces.`,
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
    <Card className="border-amber-200 bg-amber-50/40">
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
              {a.name} ({a.clients} clienți)
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
          onClick={run}
        >
          {busy ? "Se transferă..." : "Transferă"}
        </Button>
      </div>
      {msg && (
        <div className="mt-2">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
    </Card>
  );
}
