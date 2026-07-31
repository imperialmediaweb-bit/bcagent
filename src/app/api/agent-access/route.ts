import { cookies } from "next/headers";
import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PIN-ul linkului de agent (legare de dispozitiv, ca la WhatsApp Web):
 *  - setup  → agentul își creează PIN-ul la prima deschidere; dispozitivul
 *             curent devine „cunoscut" (cookie 1 an);
 *  - verify → pe un dispozitiv nou, linkul cere PIN-ul; 5 greșeli în 15
 *             minute blochează 15 minute (login_events kind='agent').
 * Agenții demo (id demo-*) sunt exceptați — demo-ul trebuie să curgă liber.
 */

const DEVICE_COOKIE = "bcagent_device";

async function setDeviceCookie(): Promise<string> {
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value ?? "";
  if (!/^[a-f0-9]{32}$/.test(deviceId)) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  jar.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 86400,
  });
  return deviceId;
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const ip = clientIP(req);
  const rl = rateLimit(`agent-access:${ip}`, { max: 20, windowMs: 300_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe încercări" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });

  let body: { token?: string; action?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = body.token ? await verifyToken(body.token, secret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const agentId = payload.agentId;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const {
      isLockedOut,
      recordLoginEvent,
      touchDevice,
      hashPassword,
      verifyPassword,
    } = await import("@/modules/platform");

    const pin = String(body.pin ?? "").replace(/\D/g, "");
    // hashPassword cere minim 8 caractere — prefixăm PIN-ul cu un context
    // fix + id-ul agentului (leagă hash-ul de agent, nu doar de cifre).
    const pinMaterial = (p: string) => `pin:${agentId}:${p}`;

    if (body.action === "setup") {
      if (pin.length < 4 || pin.length > 6) {
        return Response.json({ error: "PIN-ul are 4-6 cifre" }, { status: 400 });
      }
      const existing = await db<Array<{ agent_id: string }>>`
        SELECT agent_id FROM agent_pin WHERE agent_id = ${agentId}
      `;
      if (existing.length > 0) {
        return Response.json(
          { error: "PIN-ul există deja — folosește-l sau cere resetare managerului" },
          { status: 409 },
        );
      }
      await db`
        INSERT INTO agent_pin (agent_id, pin_hash)
        VALUES (${agentId}, ${await hashPassword(pinMaterial(pin))})
      `;
      const deviceId = await setDeviceCookie();
      await touchDevice("agent", agentId, deviceId, req.headers.get("user-agent") ?? "", ip);
      await recordLoginEvent("agent", agentId, ip, true);
      return Response.json({ ok: true });
    }

    if (body.action === "verify") {
      if (await isLockedOut("agent", agentId)) {
        return Response.json(
          { error: "Prea multe încercări greșite — reîncearcă peste 15 minute" },
          { status: 423 },
        );
      }
      const [row] = await db<Array<{ pin_hash: string }>>`
        SELECT pin_hash FROM agent_pin WHERE agent_id = ${agentId}
      `;
      if (!row) {
        return Response.json({ error: "PIN-ul nu e setat încă" }, { status: 400 });
      }
      if (!(await verifyPassword(pinMaterial(pin), row.pin_hash))) {
        await recordLoginEvent("agent", agentId, ip, false);
        return Response.json({ error: "PIN greșit" }, { status: 401 });
      }
      const deviceId = await setDeviceCookie();
      await touchDevice("agent", agentId, deviceId, req.headers.get("user-agent") ?? "", ip);
      await recordLoginEvent("agent", agentId, ip, true);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    console.error("[agent-access]", e);
    return Response.json({ error: "Eroare" }, { status: 500 });
  }
}
