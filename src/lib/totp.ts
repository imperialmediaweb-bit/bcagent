/**
 * TOTP (RFC 6238) — codurile de 6 cifre din Google Authenticator /
 * Microsoft Authenticator / Authy. Implementare pe Web Crypto, fără
 * dependențe: HMAC-SHA1 peste contorul de timp (pas 30s), secret base32.
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // contorul pe 64 de biți, big-endian (partea înaltă e mereu 0 aici)
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    "raw",
    secret.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    (((mac[offset] & 0x7f) << 24) |
      ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) |
      (mac[offset + 3] & 0xff)) %
    1_000_000;
  return String(code).padStart(6, "0");
}

/**
 * Verifică un cod cu fereastră de ±1 pas (30s) — telefonul agentului
 * poate avea ceasul ușor decalat.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
): Promise<boolean> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6 || !secretBase32) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length < 10) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const c of [step, step - 1, step + 1]) {
    if ((await hotp(secret, c)) === clean) return true;
  }
  return false;
}

/** URL-ul otpauth:// pe care îl scanează aplicația de autentificare. */
export function totpUri(secret: string, account: string, issuer = "Provendi"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
