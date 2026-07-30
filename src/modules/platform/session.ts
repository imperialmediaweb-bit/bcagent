import { cookies } from "next/headers";
import type { AdminSession } from "./types";

/**
 * Sesiuni semnate HMAC-SHA256, păstrate în cookie httpOnly.
 * Aceeași schemă ca linkurile magice ale agenților, dar cu payload de admin
 * și cheie separată (SESSION_SECRET, cu fallback pe TOKEN_SECRET).
 */

const COOKIE_NAME = "bcagent_admin";
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

export async function signSession(payload: AdminSession): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await key(), enc.encode(body)),
  );
  return `${body}.${b64uEncode(sig)}`;
}

export async function verifySession(
  token: string,
): Promise<AdminSession | null> {
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
    const payload = JSON.parse(dec.decode(b64uDecode(body))) as AdminSession;
    if (
      typeof payload.exp !== "number" ||
      payload.exp * 1000 < Date.now() ||
      payload.role !== "platform_admin" ||
      !payload.email
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Durata sesiunii de admin: 12 ore. */
export const SESSION_TTL_SECONDS = 12 * 3600;

export async function setSessionCookie(payload: AdminSession): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Sesiunea curentă din cookie (server components + route handlers). */
export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifySession(raw);
}

/** Guard pentru API: întoarce sesiunea sau un răspuns 401. */
export async function requireAdmin(): Promise<
  { session: AdminSession } | { response: Response }
> {
  const session = await getSession();
  if (!session) {
    return {
      response: Response.json(
        { error: "Neautentificat" },
        { status: 401 },
      ),
    };
  }
  return { session };
}
