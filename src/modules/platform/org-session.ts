import { cookies } from "next/headers";
import type { OrgRole } from "./types";

/**
 * Sesiunea panoului de AGENȚIE (owner/manager) — separată de cea de
 * super-admin: alt cookie, alt payload, aceeași schemă HMAC-SHA256.
 */

export interface OrgSession {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: OrgRole;
  exp: number;
}

const COOKIE_NAME = "bcagent_org";
export const ORG_SESSION_TTL_SECONDS = 12 * 3600;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.TOKEN_SECRET;
  if (!s) throw new Error("SESSION_SECRET / TOKEN_SECRET lipsesc");
  return s;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signOrgSession(payload: OrgSession): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await key(), enc.encode(body)),
  );
  return `${body}.${b64uEncode(sig)}`;
}

export async function verifyOrgSession(
  token: string,
): Promise<OrgSession | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sigPart] = parts;
  if (!body || !sigPart) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      b64uDecode(sigPart),
      enc.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64uDecode(body))) as OrgSession;
    if (
      typeof payload.exp !== "number" ||
      payload.exp * 1000 < Date.now() ||
      !payload.orgId ||
      !payload.userId ||
      (payload.role !== "owner" && payload.role !== "manager")
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function setOrgSessionCookie(payload: OrgSession): Promise<void> {
  const token = await signOrgSession(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ORG_SESSION_TTL_SECONDS,
  });
}

export async function clearOrgSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getOrgSession(): Promise<OrgSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifyOrgSession(raw);
}

/** Guard API: sesiune validă sau 401. Cu `ownerOnly` cere rolul de owner. */
export async function requireOrgUser(
  ownerOnly = false,
): Promise<{ session: OrgSession } | { response: Response }> {
  const session = await getOrgSession();
  if (!session) {
    return {
      response: Response.json({ error: "Neautentificat" }, { status: 401 }),
    };
  }
  if (ownerOnly && session.role !== "owner") {
    return {
      response: Response.json(
        { error: "Doar patronul (owner) poate face asta" },
        { status: 403 },
      ),
    };
  }
  return { session };
}
