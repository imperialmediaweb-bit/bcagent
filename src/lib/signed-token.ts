const enc = new TextEncoder();
const dec = new TextDecoder();

function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface TokenPayload {
  agentId: string;
  agentName: string;
  exp: number;
  scope?: string;
}

export async function signToken(
  payload: TokenPayload,
  secret: string,
): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const key = await getKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body)),
  );
  return `${body}.${b64uEncode(sig)}`;
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sigPart] = parts;
  if (!body || !sigPart) return null;
  let sig: Uint8Array;
  try {
    sig = b64uDecode(sigPart);
  } catch {
    return null;
  }
  const key = await getKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(dec.decode(b64uDecode(body))) as TokenPayload;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
