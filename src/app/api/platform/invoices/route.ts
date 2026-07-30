import { isDBEnabled } from "@/lib/db";
import {
  audit,
  deleteInvoice,
  isInvoiceStatus,
  listInvoices,
  requireAdmin,
  setInvoiceStatus,
  upsertInvoice,
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
    const result = await listInvoices({
      orgId: url.searchParams.get("orgId") ?? "",
      status: url.searchParams.get("status") ?? "",
      limit: parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
      offset: parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
    });
    return Response.json(result);
  } catch (e) {
    console.error("[invoices GET]", e);
    return Response.json({ error: "Eroare la listare facturi" }, { status: 500 });
  }
}

/** Factură emisă manual (transfer bancar / plată în afara Stripe). */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: {
    orgId?: string;
    number?: string;
    amountCents?: number;
    currency?: string;
    status?: string;
    periodStart?: string;
    periodEnd?: string;
    issuedAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId = String(body.orgId ?? "");
  if (!orgId) return Response.json({ error: "Alege organizația" }, { status: 400 });
  const number = String(body.number ?? "").trim().slice(0, 60);
  if (!number) return Response.json({ error: "Serie/număr obligatoriu" }, { status: 400 });
  const amountCents = Math.max(0, Math.round(Number(body.amountCents) || 0));
  if (body.status !== undefined && !isInvoiceStatus(body.status)) {
    return Response.json({ error: "Status invalid" }, { status: 400 });
  }

  try {
    const invoice = await upsertInvoice({
      orgId,
      stripeInvoiceId: null,
      number,
      amountCents,
      currency: String(body.currency ?? "RON").toUpperCase().slice(0, 3),
      status: isInvoiceStatus(body.status) ? body.status : "open",
      periodStart: body.periodStart || null,
      periodEnd: body.periodEnd || null,
      issuedAt: body.issuedAt || null,
      paidAt: body.status === "paid" ? new Date().toISOString() : null,
    });
    await audit(auth.session.email, "invoice.create", invoice.id, { orgId, number });
    return Response.json({ invoice });
  } catch (e) {
    console.error("[invoices POST]", e);
    return Response.json({ error: "Eroare la creare factură" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id || !isInvoiceStatus(body.status)) {
    return Response.json({ error: "id/status invalid" }, { status: 400 });
  }

  try {
    await setInvoiceStatus(id, body.status);
    await audit(auth.session.email, "invoice.status", id, { status: body.status });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[invoices PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id lipsește" }, { status: 400 });

  try {
    await deleteInvoice(id);
    await audit(auth.session.email, "invoice.delete", id);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[invoices DELETE]", e);
    return Response.json({ error: "Eroare la ștergere" }, { status: 500 });
  }
}
