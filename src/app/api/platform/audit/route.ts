import { isDBEnabled } from "@/lib/db";
import { listAudit, requireAdmin } from "@/modules/platform";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);

  try {
    return Response.json(
      await listAudit(
        parseInt(url.searchParams.get("limit") ?? "100", 10) || 100,
        parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
      ),
    );
  } catch (e) {
    console.error("[audit GET]", e);
    return Response.json({ error: "Eroare la citirea jurnalului" }, { status: 500 });
  }
}
