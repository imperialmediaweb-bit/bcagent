/**
 * Teste pentru modulul platform (super-admin): parole, sesiuni semnate,
 * validatoare de status. Rulare:
 *   pnpm dlx tsx scripts/test-platform.ts
 *
 * Nu are nevoie de bază de date — testează exact logica de securitate
 * care ține panoul închis.
 */

process.env.SESSION_SECRET ??= "test-secret-pentru-sesiuni-de-admin-0123456789";

import {
  generatePassword,
  hashPassword,
  verifyPassword,
} from "../src/modules/platform/passwords";
import { signSession, verifySession } from "../src/modules/platform/session";
import { isInvoiceStatus, isOrgStatus } from "../src/modules/platform/repo";
import type { AdminSession } from "../src/modules/platform/types";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function future(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

async function main() {
  console.log("\n── Parole (PBKDF2-SHA256) ──");

  const hash = await hashPassword("parola-mea-tare-123");
  check("formatul stocat e pbkdf2$iter$salt$hash", hash.split("$").length === 4);
  check("prefixul e pbkdf2", hash.startsWith("pbkdf2$120000$"));
  check("parola în clar NU apare în hash", !hash.includes("parola-mea-tare-123"));
  check(
    "verificarea reușește cu parola corectă",
    await verifyPassword("parola-mea-tare-123", hash),
  );
  check(
    "verificarea eșuează cu parola greșită",
    !(await verifyPassword("parola-mea-tare-124", hash)),
  );
  check("verificarea eșuează pe hash corupt", !(await verifyPassword("x", "aiurea")));
  check(
    "verificarea eșuează pe număr mic de iterații (downgrade attack)",
    !(await verifyPassword("x", "pbkdf2$10$AAAA$AAAA")),
  );

  const hash2 = await hashPassword("parola-mea-tare-123");
  check("două hash-uri ale aceleiași parole diferă (salt aleator)", hash !== hash2);
  check(
    "ambele hash-uri validează aceeași parolă",
    await verifyPassword("parola-mea-tare-123", hash2),
  );

  let tooShort = false;
  try {
    await hashPassword("1234567");
  } catch {
    tooShort = true;
  }
  check("parolele sub 8 caractere sunt respinse", tooShort);

  const generated = generatePassword();
  check("parola generată are 14 caractere", generated.length === 14);
  check(
    "parola generată nu conține caractere ambigue (0/O/1/l/I)",
    !/[0O1lI]/.test(generated),
  );
  check(
    "două parole generate diferă",
    generatePassword() !== generatePassword(),
  );

  console.log("\n── Sesiuni semnate HMAC ──");

  const payload: AdminSession = {
    adminId: "adm_test",
    email: "admin@test.ro",
    role: "platform_admin",
    exp: future(3600),
  };
  const token = await signSession(payload);
  check("tokenul are forma body.signature", token.split(".").length === 2);

  const ok = await verifySession(token);
  check("sesiunea validă se verifică", ok?.email === "admin@test.ro");
  check("rolul e păstrat", ok?.role === "platform_admin");

  const [body, sig] = token.split(".");
  check(
    "semnătura modificată e respinsă",
    (await verifySession(`${body}.${sig.slice(0, -2)}AA`)) === null,
  );

  const forged = Buffer.from(
    JSON.stringify({ ...payload, email: "hacker@rau.ro" }),
  )
    .toString("base64url")
    .replace(/=+$/, "");
  check(
    "payload-ul modificat cu semnătura veche e respins",
    (await verifySession(`${forged}.${sig}`)) === null,
  );

  const expired = await signSession({ ...payload, exp: future(-10) });
  check("sesiunea expirată e respinsă", (await verifySession(expired)) === null);

  const wrongRole = await signSession({
    ...payload,
    role: "agent" as AdminSession["role"],
  });
  check(
    "sesiunea cu alt rol decât platform_admin e respinsă",
    (await verifySession(wrongRole)) === null,
  );

  check("tokenul gol e respins", (await verifySession("")) === null);
  check("tokenul aiurea e respins", (await verifySession("abc")) === null);

  // Semnat cu altă cheie → trebuie respins.
  const realSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "cu-totul-altceva-decat-cheia-reala-999";
  const otherKeyToken = await signSession(payload);
  process.env.SESSION_SECRET = realSecret;
  check(
    "tokenul semnat cu altă cheie e respins",
    (await verifySession(otherKeyToken)) === null,
  );

  console.log("\n── Validatoare de status ──");

  check("„activ\" e status valid de organizație", isOrgStatus("activ"));
  check("„trial\" e status valid", isOrgStatus("trial"));
  check("„suspendat\" e status valid", isOrgStatus("suspendat"));
  check("„anulat\" e status valid", isOrgStatus("anulat"));
  check("„admin\" NU e status de organizație", !isOrgStatus("admin"));
  check("valoarea non-string e respinsă", !isOrgStatus(42));

  check("„paid\" e status valid de factură", isInvoiceStatus("paid"));
  check("„open\" e status valid de factură", isInvoiceStatus("open"));
  check("„platita\" NU e status de factură", !isInvoiceStatus("platita"));

  console.log(
    `\n${failed === 0 ? "✅" : "❌"} ${passed} verificări trecute, ${failed} eșuate\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
