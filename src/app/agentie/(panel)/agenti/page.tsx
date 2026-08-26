"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Plus } from "lucide-react";
import AiMarkdown from "@/components/AiMarkdown";
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
  awayFrom: string | null;
  awayUntil: string | null;
  salaryCents: number | null;
  commissionPct: number | null;
  visitsToday: number;
  visitsWeek: number;
  visits30: number;
  clients: number;
}

/** Ce a lăsat un agent în urmă pe teren. */
interface TerenRand {
  agent: string;
  pinuri: number;
  confirmate: number;
  taiate: number;
  zone: number;
  zile: string[];
  vizite: number;
  comenzi: number;
  ultima: string | null;
}
interface TerenTotal {
  clienti: number;
  cuLoc: number;
  dinTeren: number;
  magazine: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AgentiPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [myRole, setMyRole] = useState("manager");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [awayFor, setAwayFor] = useState<AgentRow | null>(null);
  const [salaryFor, setSalaryFor] = useState<AgentRow | null>(null);
  const [evalFor, setEvalFor] = useState<AgentRow | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ agents: AgentRow[]; myRole: string }>(
        "/api/agentie/agents",
      );
      setAgents(d.agents);
      setMyRole(d.myRole);
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
            const today = todayISO();
            const awayNow =
              a.awayUntil &&
              a.awayUntil >= today &&
              (!a.awayFrom || a.awayFrom <= today);
            const awayPlanned = a.awayFrom && a.awayFrom > today;
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
                    {awayNow && <Badge status="trial">🏖 în concediu</Badge>}
                    {awayPlanned && <Badge status="draft">🗓 concediu programat</Badge>}
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
                  <Button variant="secondary" onClick={() => setEvalFor(a)}>
                    🎓 Evaluare AI
                  </Button>
                  <Button variant="secondary" onClick={() => setAwayFor(a)}>
                    🏖 Concediu
                  </Button>
                  {myRole === "owner" && (
                    <Button variant="secondary" onClick={() => setSalaryFor(a)}>
                      💰 Salariu
                    </Button>
                  )}
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
                  <Button
                    variant="secondary"
                    title="Telefon pierdut/schimbat: șterge PIN-ul și dispozitivele — agentul își setează PIN nou la următoarea deschidere a linkului"
                    onClick={async () => {
                      if (!confirm(`Resetezi PIN-ul lui ${a.name}? Va seta unul nou la următoarea deschidere a linkului.`)) return;
                      try {
                        await api("/api/agentie/agents", {
                          method: "PATCH",
                          json: { agentRowId: a.id, resetPin: true },
                        });
                        alert("PIN resetat ✓");
                      } catch (e) {
                        alert(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    🔑 Reset PIN
                  </Button>
                </div>
                {a.awayUntil && (
                  <p className="mt-2 text-xs text-sky-600">
                    Concediu: {a.awayFrom ? new Date(a.awayFrom).toLocaleDateString("ro-RO") : "?"}{" "}
                    → {new Date(a.awayUntil).toLocaleDateString("ro-RO")}
                  </p>
                )}
                {myRole === "owner" && a.salaryCents !== null && (
                  <p className="mt-1 text-xs text-slate-500">
                    💰 {(a.salaryCents / 100).toLocaleString("ro-RO")} RON/lună
                    {a.commissionPct ? ` + ${a.commissionPct}% comision` : ""}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {myRole === "owner" && agents.some((a) => a.salaryCents !== null) && (
        <Card className="p-4">
          <p className="text-sm text-slate-600">
            💰 Cost lunar echipă (salarii de bază):{" "}
            <strong className="text-slate-900">
              {(
                agents.reduce((s, a) => s + (a.active ? a.salaryCents ?? 0 : 0), 0) /
                100
              ).toLocaleString("ro-RO")}{" "}
              RON
            </strong>{" "}
            · {agents.filter((a) => a.active && a.salaryCents !== null).length}{" "}
            agenți cu salariu setat
          </p>
        </Card>
      )}

      <MuncaDeTeren />

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
      <SalaryModal
        agent={salaryFor}
        onClose={() => setSalaryFor(null)}
        onDone={load}
      />
      <EvalModal agent={evalFor} onClose={() => setEvalFor(null)} />
    </div>
  );
}

/**
 * CE AU FĂCUT AGENȚII PE TEREN.
 *
 * Vizitele se vedeau deja, în pagina lor. Munca de hartă — nu: cine a pus
 * locul exact la un magazin, cine a confirmat că prăvălia din harta veche
 * mai există, cine a tăiat una închisă, cine și-a scris zonele pe zile.
 * Se făcea, dar nu se vedea nicăieri: nici patronul n-avea ce arăta, nici
 * omul care a bătut satul n-avea cu ce se lăuda.
 *
 * Nu e încă un meniu: stă aici, în „Agenți", unde se uită oricum.
 */
function MuncaDeTeren() {
  const [randuri, setRanduri] = useState<TerenRand[]>([]);
  const [total, setTotal] = useState<TerenTotal | null>(null);
  const [gata, setGata] = useState(false);

  useEffect(() => {
    let viu = true;
    api<{ agenti: TerenRand[]; total: TerenTotal | null }>("/api/agentie/teren")
      .then((d) => {
        if (!viu) return;
        setRanduri(d.agenti);
        setTotal(d.total);
      })
      .catch(() => {
        /* dacă nu merge, pagina de agenți rămâne întreagă */
      })
      .finally(() => viu && setGata(true));
    return () => {
      viu = false;
    };
  }, []);

  if (!gata) return null;
  const auMuncit = randuri.filter(
    (r) => r.pinuri + r.confirmate + r.taiate + r.zone > 0,
  );

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Munca de teren — ce au făcut agenții pe hartă
      </h2>
      {total && (
        <p className="mt-1 break-words text-xs leading-snug text-slate-600">
          Din <b>{total.clienti}</b> clienți, <b>{total.cuLoc}</b> au locul pe
          hartă
          {total.dinTeren > 0 && (
            <>
              {" "}
              — dintre care <b className="text-emerald-700">{total.dinTeren}</b>{" "}
              puse de agenți, la fața locului. Alea sunt cele mai bune: omul a
              fost acolo.
            </>
          )}
          {total.magazine > 0 && (
            <> Plus {total.magazine} magazine de prospectat, pe hartă.</>
          )}
        </p>
      )}

      {auMuncit.length === 0 ? (
        <p className="mt-3 break-words rounded-lg bg-slate-50 p-3 text-xs leading-snug text-slate-600">
          Încă n-a pus nimeni nimic pe hartă din teren. Când un agent apasă
          „Sunt aici" la un magazin, sau confirmă unul de prospectat, apare
          aici, pe numele lui.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {auMuncit.map((r) => (
            <li key={r.agent} className="py-2">
              <p className="break-words text-sm font-semibold leading-snug text-slate-900">
                {r.agent}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 break-words text-xs leading-snug text-slate-600">
                {r.pinuri > 0 && (
                  <span className="text-emerald-700">
                    📍 <b>{r.pinuri}</b> locuri puse la fața locului
                  </span>
                )}
                {r.confirmate > 0 && (
                  <span className="text-violet-700">
                    ✅ <b>{r.confirmate}</b> magazine confirmate
                  </span>
                )}
                {r.taiate > 0 && (
                  <span className="text-rose-700">
                    ✕ <b>{r.taiate}</b> găsite închise
                  </span>
                )}
                {r.zone > 0 && (
                  <span>
                    🗺️ <b>{r.zone}</b> sate în zonele lui
                    {r.zile.length > 0 && `, pe ${r.zile.length} zile`}
                  </span>
                )}
                {r.vizite > 0 && (
                  <span>
                    📋 <b>{r.vizite}</b> vizite
                  </span>
                )}
                {r.comenzi > 0 && (
                  <span>
                    🛒 <b>{r.comenzi}</b> comenzi
                  </span>
                )}
              </p>
              {r.ultima && (
                <p className="mt-0.5 break-words text-xs leading-snug text-slate-400">
                  ultima urmă: {new Date(r.ultima).toLocaleString("ro-RO")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 break-words text-xs leading-snug text-slate-500">
        Un loc pus de agent bate orice import: el a fost acolo. De-aia nu se
        atinge nimeni de ele, nici măcar „Adu locațiile".
      </p>
    </Card>
  );
}

/** Evaluarea AI a agentului: analiza logică din datele lui reale. */
function EvalModal({
  agent,
  onClose,
}: {
  agent: { agentId: string; name: string } | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    setText("");
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/agentie/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ agentId: agent.agentId }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(data?.error ?? `Eroare ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [agent]);

  return (
    <Modal
      open={!!agent}
      onClose={onClose}
      title={`🎓 Evaluare AI — ${agent?.name ?? ""}`}
      wide
    >
      {error && <Alert>{error}</Alert>}
      {busy && !text && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
          Analizez vizitele, conversiile, comenzile și targetul...
        </p>
      )}
      {text && (
        <div className="text-sm text-slate-700">
          <AiMarkdown text={text} />
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Închide
        </Button>
      </div>
    </Modal>
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
  const [ttlDays, setTtlDays] = useState(365);
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
              onChange={(e) => setTtlDays(parseInt(e.target.value) || 365)}
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
    awayFrom: string | null;
    awayUntil: string | null;
  } | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);

  useEffect(() => {
    setFrom(agent?.awayFrom ?? new Date().toISOString().slice(0, 10));
    setUntil(agent?.awayUntil ?? "");
    setError(null);
    setOverlap(null);
  }, [agent]);

  async function save(clear: boolean, force = false) {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/agentie/agents", {
        method: "PATCH",
        json: {
          agentRowId: agent.id,
          awayFrom: clear ? null : from,
          awayUntil: clear ? null : until,
          force,
        },
      });
      await onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 409 = suprapunere cu alt concediu — cerem confirmare explicită.
      if (msg.startsWith("Se suprapune")) {
        setOverlap(msg);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!agent} onClose={onClose} title={`Concediu — ${agent?.name ?? ""}`}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="De la">
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setOverlap(null);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Până la (inclusiv)">
            <input
              type="date"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
                setOverlap(null);
              }}
              className={inputClass}
            />
          </Field>
        </div>
        {error && <Alert>{error}</Alert>}
        {overlap && (
          <div className="space-y-2">
            <Alert>
              ⚠ {overlap} — zona rămâne descoperită în perioada asta.
            </Alert>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => save(false, true)}
              className="w-full"
            >
              Înțeleg, salvează oricum
            </Button>
          </div>
        )}
        <div className="flex justify-between gap-2">
          {agent?.awayUntil && (
            <Button variant="ghost" disabled={busy} onClick={() => save(true)}>
              S-a întors — șterge concediul
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Renunță
            </Button>
            <Button
              disabled={busy || !until || !from}
              onClick={() => save(false)}
            >
              Salvează
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SalaryModal({
  agent,
  onClose,
  onDone,
}: {
  agent: {
    id: string;
    name: string;
    salaryCents: number | null;
    commissionPct: number | null;
  } | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [salary, setSalary] = useState("");
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSalary(
      agent?.salaryCents !== null && agent?.salaryCents !== undefined
        ? String(agent.salaryCents / 100)
        : "",
    );
    setPct(
      agent?.commissionPct !== null && agent?.commissionPct !== undefined
        ? String(agent.commissionPct)
        : "",
    );
    setError(null);
  }, [agent]);

  async function save() {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/agentie/agents", {
        method: "PATCH",
        json: {
          agentRowId: agent.id,
          salaryCents: salary === "" ? null : Math.round(parseFloat(salary) * 100),
          commissionPct: pct === "" ? null : parseFloat(pct),
        },
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
    <Modal open={!!agent} onClose={onClose} title={`Salariu — ${agent?.name ?? ""}`}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Salariu de bază (RON/lună)">
            <input
              type="number"
              min={0}
              step="1"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              className={inputClass}
              placeholder="3500"
            />
          </Field>
          <Field label="Comision (%)">
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className={inputClass}
              placeholder="5"
            />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Vizibil doar pentru administrator. Comisionul se leagă de calculatorul din
          rapoartele de vânzări.
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Renunță
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? "Se salvează..." : "Salvează"}
          </Button>
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
