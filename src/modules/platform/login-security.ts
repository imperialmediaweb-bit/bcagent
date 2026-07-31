import { getDB } from "@/lib/db";
import { ensurePlatformSchema } from "./schema";

/**
 * Securitatea conturilor cu parolă („ca la bancă"):
 *  - fiecare încercare de login se scrie în login_events (istoric vizibil);
 *  - 5 eșecuri în 15 minute pe același cont → contul se blochează 15 min
 *    (pe CONT, nu doar pe IP — nu ajută atacatorul să schimbe rețeaua).
 */

const MAX_FAILS = 5;
const WINDOW_MIN = 15;

function db() {
  const d = getDB();
  if (!d) throw new Error("DATABASE_URL lipsește");
  return d;
}

export async function recordLoginEvent(
  kind: "org" | "platform",
  email: string,
  ip: string,
  ok: boolean,
): Promise<void> {
  await ensurePlatformSchema();
  await db()`
    INSERT INTO login_events (kind, email, ip, ok)
    VALUES (${kind}, ${email.toLowerCase()}, ${ip.slice(0, 64)}, ${ok})
  `;
}

/** Contul e blocat? (prea multe eșecuri recente) */
export async function isLockedOut(
  kind: "org" | "platform",
  email: string,
): Promise<boolean> {
  await ensurePlatformSchema();
  const [row] = await db()<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM login_events
    WHERE kind = ${kind} AND email = ${email.toLowerCase()} AND ok = FALSE
      AND created_at > NOW() - (${WINDOW_MIN} || ' minutes')::interval
  `;
  return parseInt(row.n, 10) >= MAX_FAILS;
}

export interface LoginEvent {
  ip: string;
  ok: boolean;
  createdAt: string;
}

/** Ultimele conectări ale unui cont — afișate în Setări, ca la bancă. */
export async function loginHistory(
  kind: "org" | "platform",
  email: string,
  limit = 15,
): Promise<LoginEvent[]> {
  await ensurePlatformSchema();
  const rows = await db()<
    Array<{ ip: string; ok: boolean; created_at: Date }>
  >`
    SELECT ip, ok, created_at FROM login_events
    WHERE kind = ${kind} AND email = ${email.toLowerCase()}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    ip: r.ip,
    ok: r.ok,
    createdAt: r.created_at.toISOString(),
  }));
}

/* ─────────────────────────── 2FA (TOTP) ─────────────────────────── */

export async function getOrgUserTotp(
  userId: string,
): Promise<{ secret: string; enabled: boolean }> {
  const [row] = await db()<Array<{ totp_secret: string; totp_enabled: boolean }>>`
    SELECT totp_secret, totp_enabled FROM org_users WHERE id = ${userId}
  `;
  return { secret: row?.totp_secret ?? "", enabled: row?.totp_enabled ?? false };
}

export async function setOrgUserTotp(
  userId: string,
  secret: string,
  enabled: boolean,
): Promise<void> {
  await db()`
    UPDATE org_users SET totp_secret = ${secret}, totp_enabled = ${enabled}
    WHERE id = ${userId}
  `;
}

export async function orgUserTotpByEmail(
  email: string,
): Promise<{ secret: string; enabled: boolean }> {
  const [row] = await db()<Array<{ totp_secret: string; totp_enabled: boolean }>>`
    SELECT totp_secret, totp_enabled FROM org_users
    WHERE email = ${email.toLowerCase()} AND active
  `;
  return { secret: row?.totp_secret ?? "", enabled: row?.totp_enabled ?? false };
}

export async function getAdminTotp(
  adminId: string,
): Promise<{ secret: string; enabled: boolean }> {
  const [row] = await db()<Array<{ totp_secret: string; totp_enabled: boolean }>>`
    SELECT totp_secret, totp_enabled FROM platform_admins WHERE id = ${adminId}
  `;
  return { secret: row?.totp_secret ?? "", enabled: row?.totp_enabled ?? false };
}

export async function setAdminTotp(
  adminId: string,
  secret: string,
  enabled: boolean,
): Promise<void> {
  await db()`
    UPDATE platform_admins SET totp_secret = ${secret}, totp_enabled = ${enabled}
    WHERE id = ${adminId}
  `;
}

export async function adminTotpByEmail(
  email: string,
): Promise<{ secret: string; enabled: boolean }> {
  const [row] = await db()<Array<{ totp_secret: string; totp_enabled: boolean }>>`
    SELECT totp_secret, totp_enabled FROM platform_admins
    WHERE email = ${email.toLowerCase()}
  `;
  return { secret: row?.totp_secret ?? "", enabled: row?.totp_enabled ?? false };
}

/* ──────────── Dispozitive cunoscute + alertă „ca la Facebook" ──────────── */

/** Nume prietenos de browser/telefon din User-Agent — pentru email + listă. */
export function describeDevice(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "browser necunoscut";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iPhone/iPad"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "dispozitiv necunoscut";
  return `${browser} pe ${os}`;
}

export interface KnownDevice {
  deviceId: string;
  ua: string;
  ip: string;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Înregistrează dispozitivul la un login reușit.
 * Întoarce true dacă e un dispozitiv NOU (nemaiîntâlnit la contul ăsta) —
 * caz în care apelantul trimite emailul de alertă.
 */
export async function touchDevice(
  kind: "org" | "platform",
  email: string,
  deviceId: string,
  ua: string,
  ip: string,
): Promise<boolean> {
  await ensurePlatformSchema();
  const rows = await db()<Array<{ inserted: boolean }>>`
    INSERT INTO known_devices (kind, email, device_id, ua, ip)
    VALUES (${kind}, ${email.toLowerCase()}, ${deviceId}, ${ua.slice(0, 300)}, ${ip.slice(0, 64)})
    ON CONFLICT (kind, email, device_id)
    DO UPDATE SET last_seen = NOW(), ip = EXCLUDED.ip
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0]?.inserted === true;
}

/** Contul avea deja măcar un dispozitiv? (primul login nu alertează) */
export async function hasAnyDevice(
  kind: "org" | "platform",
  email: string,
): Promise<boolean> {
  await ensurePlatformSchema();
  const [row] = await db()<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM known_devices
    WHERE kind = ${kind} AND email = ${email.toLowerCase()}
  `;
  return parseInt(row.n, 10) > 0;
}

export async function listDevices(
  kind: "org" | "platform",
  email: string,
): Promise<KnownDevice[]> {
  await ensurePlatformSchema();
  const rows = await db()<
    Array<{ device_id: string; ua: string; ip: string; first_seen: Date; last_seen: Date }>
  >`
    SELECT device_id, ua, ip, first_seen, last_seen FROM known_devices
    WHERE kind = ${kind} AND email = ${email.toLowerCase()}
    ORDER BY last_seen DESC LIMIT 20
  `;
  return rows.map((r) => ({
    deviceId: r.device_id,
    ua: r.ua,
    ip: r.ip,
    firstSeen: r.first_seen.toISOString(),
    lastSeen: r.last_seen.toISOString(),
  }));
}
