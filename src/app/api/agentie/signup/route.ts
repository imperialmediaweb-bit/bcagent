import { isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import {
  audit,
  createOrg,
  createOrgUser,
  getOrgUserForLogin,
  handleDeviceOnLogin,
  ORG_SESSION_TTL_SECONDS,
  recordLoginEvent,
  setOrgSessionCookie,
} from "@/modules/platform";

export const runtime = "nodejs";

/**
 * ÎNREGISTRARE SINGUR (self-signup): firma își face singură contul și
 * primește automat 30 de zile de probă cu tot inclus — fără să aștepte
 * pe nimeni. Contul creat e "owner" (administrator); administratorul
 * platformei vede firma nouă instant în /platform → Organizații și
 * poate prelungi proba oricând de acolo.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "Baza de date nu e configurată" }, { status: 503 });
  }
  const ip = clientIP(req);
  // Anti-abuz: 5 conturi pe oră per IP e mai mult decât suficient.
  const rl = rateLimit(`signup:${ip}`, { max: 5, windowMs: 3_600_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe conturi create de pe rețeaua asta. Reîncearcă mai târziu." },
      { status: 429 },
    );
  }

  let body: { firma?: string; name?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const firma = String(body.firma ?? "").trim().slice(0, 120);
  const name = String(body.name ?? "").trim().slice(0, 80);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (firma.length < 3) {
    return Response.json({ error: "Scrie numele firmei (minim 3 litere)" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ error: "Emailul nu arată valid" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Parola trebuie să aibă minim 8 caractere" }, { status: 400 });
  }

  try {
    const existing = await getOrgUserForLogin(email);
    if (existing) {
      return Response.json(
        { error: "Există deja un cont cu emailul ăsta — intră din pagina de login." },
        { status: 409 },
      );
    }

    const org = await createOrg({
      name: firma,
      email,
      trialDays: 30,
      agentLimit: 5,
      note: "Cont creat singur (self-signup)",
    });
    const user = await createOrgUser(org.id, email, password, name, "owner");

    await setOrgSessionCookie({
      userId: user.id,
      orgId: org.id,
      email: user.email,
      name: user.name,
      role: "owner",
      exp: Math.floor(Date.now() / 1000) + ORG_SESSION_TTL_SECONDS,
    });
    await recordLoginEvent("org", email, ip, true);
    await handleDeviceOnLogin("org", email, req, ip);
    await audit(email, "org.signup", org.id, { firma });

    // Email de bun venit — fire-and-forget: dacă nu pleacă, contul rămâne
    // creat, utilizatorul e deja logat. Nu blocăm răspunsul pe el.
    const { requestOrigin } = await import("@/lib/request-origin");
    const { sendWelcomeEmail } = await import("@/lib/welcome-email");
    void sendWelcomeEmail({
      to: email,
      firma,
      name,
      appUrl: requestOrigin(req),
    });

    return Response.json({ ok: true, org: { name: org.name } });
  } catch (e) {
    console.error("[agentie signup]", e);
    return Response.json({ error: "Eroare la crearea contului" }, { status: 500 });
  }
}
