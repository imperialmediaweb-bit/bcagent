/**
 * Criptare la stocare (at-rest) pentru datele-blob sensibile — azi:
 * pozele facturilor. AES-256-GCM (autentificat: orice alterare a
 * cifratului e detectată la decriptare), cheia vine din env DATA_KEY
 * și NU stă lângă baza de date — un dump furat e ilizibil fără ea.
 *
 * Format stocat: "enc1:<iv base64>:<ciphertext base64>".
 * Fără DATA_KEY setat, datele trec în clar (compatibil cu ce există);
 * valorile vechi în clar rămân citibile și după activarea cheii.
 */

const PREFIX = "enc1:";

export function isDataEncryptionEnabled(): boolean {
  return !!process.env.DATA_KEY;
}

async function key(): Promise<CryptoKey | null> {
  const raw = process.env.DATA_KEY;
  if (!raw) return null;
  // Orice string din env → cheie AES-256 stabilă (SHA-256 pe bytes).
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Criptează un string (dacă există cheie); altfel îl întoarce neatins. */
export async function encryptData(plain: string): Promise<string> {
  const k = await key();
  if (!k || !plain) return plain;
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      k,
      new TextEncoder().encode(plain),
    ),
  );
  return `${PREFIX}${toB64(iv)}:${toB64(ct)}`;
}

/**
 * Decriptează dacă valoarea e criptată; valorile în clar (vechi sau
 * fără cheie) trec neatinse. Cifrat corupt / cheie greșită → "".
 */
export async function decryptData(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = await key();
  if (!k) return "";
  try {
    const [, ivB64, ctB64] = stored.split(":");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64) as unknown as Uint8Array<ArrayBuffer> },
      k,
      fromB64(ctB64) as unknown as Uint8Array<ArrayBuffer>,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}
