"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2, UserPlus } from "lucide-react";
import type { OrgUser } from "@/modules/platform/types";
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
  inputClass,
} from "@/app/platform/ui";

/**
 * Echipa de conducere: administratorul (owner) + managerii care au grijă de agenți.
 * Owner-ul creează conturile; managerii văd tot panoul, dar nu umblă la
 * conturi.
 */
export default function EchipaPage() {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [myRole, setMyRole] = useState<string>("manager");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "manager">("manager");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ users: OrgUser[]; myRole: string }>(
        "/api/agentie/users",
      );
      setUsers(d.users);
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

  const isOwner = myRole === "owner";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ password: string }>("/api/agentie/users", {
        method: "POST",
        json: { email, name, role },
      });
      setPassword(res.password);
      setEmail("");
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function action(userId: string, act: string) {
    setError(null);
    try {
      const res = await api<{ password?: string }>("/api/agentie/users", {
        method: "PATCH",
        json: { userId, action: act },
      });
      if (res.password) {
        setPassword(res.password);
        setOpen(true);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(userId: string) {
    if (!confirm("Ștergi contul?")) return;
    try {
      await api(`/api/agentie/users?userId=${userId}`, { method: "DELETE" });
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
            Echipa de conducere
          </h1>
          <p className="text-sm text-slate-500">
            Administratorul are control total; managerii supraveghează agenții,
            vizitele și vânzările.
          </p>
        </div>
        {isOwner && (
          <Button
            onClick={() => {
              setPassword(null);
              setOpen(true);
            }}
          >
            <UserPlus className="h-4 w-4" /> Manager nou
          </Button>
        )}
      </header>

      {!isOwner && (
        <Alert kind="info">
          Doar administratorul (owner) poate crea sau modifica conturi. Tu vezi lista.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : users.length === 0 ? (
        <EmptyState text="Niciun cont încă." />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <span className="truncate">{u.name || u.email}</span>
                    <Badge status={u.role === "owner" ? "activ" : "trial"}>
                      {u.role === "owner" ? "administrator" : "manager"}
                    </Badge>
                    {!u.active && <Badge status="anulat">dezactivat</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {u.email}
                    {u.lastLoginAt
                      ? ` · ultim login ${formatDate(u.lastLoginAt)}`
                      : " · nu s-a logat încă"}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1">
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
                      onClick={() =>
                        action(u.id, u.active ? "deactivate" : "activate")
                      }
                    >
                      {u.active ? "⏸" : "▶"}
                    </Button>
                    <Button variant="ghost" title="Șterge" onClick={() => remove(u.id)}>
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Cont de conducere">
        {password ? (
          <div className="space-y-4">
            <Alert kind="success">
              Parolă generată — se afișează o singură dată, trimite-o persoanei.
            </Alert>
            <CopyBox value={password} label="Parolă" />
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setPassword(null);
                  setOpen(false);
                }}
              >
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
                placeholder="ionut.carasus@firma.ro"
              />
            </Field>
            <Field label="Nume">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Ionuț Carasus"
              />
            </Field>
            <Field
              label="Rol"
              hint="Managerul vede tot și gestionează agenții; nu poate umbla la conturi."
            >
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "owner" | "manager")}
                className={inputClass}
              >
                <option value="manager">Manager (supervizor agenți)</option>
                <option value="owner">Owner (administrator)</option>
              </select>
            </Field>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Renunță
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Se creează..." : "Creează contul"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
