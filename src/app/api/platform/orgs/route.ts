import { isDBEnabled } from "@/lib/db";
import {
  audit,
  createOrg,
  createOrgUser,
  generatePassword,
  isOrgStatus,
  listOrgs,
  requireAdmin,
} from "@/modules/platform";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  try {
    const result = await listOrgs({
      status: url.searchParams.get("status") ?? "",
      search: url.searchParams.get("search") ?? "",
      limit: parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
      offset: parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
    });
    return Response.json(result);
  } catch (e) {
    console.error("[orgs GET]", e);
    return Response.json({ error: "Eroare la listare" }, { status: 500 });
  }
}

/**
 * Creează organizația și, opțional, contul de owner.
 * Parola contului se generează aici și se întoarce O SINGURĂ DATĂ —
 * nu se mai poate citi ulterior (stocăm doar hash-ul).
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: {
    name?: string;
    cui?: string;
    email?: string;
    telefon?: string;
    planId?: string;
    status?: string;
    trialDays?: number;
    agentLimit?: number;
    note?: string;
    createOwner?: boolean;
    ownerName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name || name.length > 200) {
    return Response.json({ error: "Denumire invalidă" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return Response.json({ error: "Email invalid" }, { status: 400 });
  }
  if (body.status !== undefined && !isOrgStatus(body.status)) {
    return Response.json({ error: "Status invalid" }, { status: 400 });
  }
  const agentLimit = Math.min(
    500,
    Math.max(1, Number(body.agentLimit) || 5),
  );
  const trialDays = Math.min(180, Math.max(0, Number(body.trialDays ?? 14)));

  try {
    const org = await createOrg({
      name,
      cui: String(body.cui ?? "").replace(/\D/g, "").slice(0, 12),
      email,
      telefon: String(body.telefon ?? "").slice(0, 40),
      planId: body.planId || null,
      status: isOrgStatus(body.status) ? body.status : "trial",
      trialDays,
      agentLimit,
      note: String(body.note ?? "").slice(0, 2000),
    });

    let ownerPassword: string | null = null;
    if (body.createOwner && email) {
      ownerPassword = generatePassword();
      await createOrgUser(
        org.id,
        email,
        ownerPassword,
        String(body.ownerName ?? name).slice(0, 120),
        "owner",
      );
    }

    await audit(auth.session.email, "org.create", org.id, { name, planId: org.planId });
    return Response.json({ org, ownerPassword });
  } catch (e) {
    console.error("[orgs POST]", e);
    const msg =
      e instanceof Error && /unique|duplicate/i.test(e.message)
        ? "Există deja un cont cu emailul ăsta"
        : "Eroare la creare";
    return Response.json({ error: msg }, { status: 500 });
  }
}
