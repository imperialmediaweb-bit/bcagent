import { isDBEnabled } from "@/lib/db";
import { requestOrigin } from "@/lib/request-origin";
import { audit, requireAdmin, seedDemoOrg } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * FIRMA DEMO: butonul din /platform/setari creează (sau reface de la zero)
 * „Demo Distribuție SRL" cu TOT: 3 agenți cu linkuri, vânzări pe 3 luni,
 * vizite, comenzi, targeturi, clienți cu restanțe, rute pe ziua curentă,
 * deconturi. Logica de seed e în modules/platform/demo-seed.ts — aceeași
 * pe care o folosește și „Vezi DEMO" de pe login la prima apăsare.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  try {
    const result = await seedDemoOrg(requestOrigin(req));
    await audit(auth.session.email, "demo.create", result.org.id);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[demo]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Eroare la creare demo" },
      { status: 500 },
    );
  }
}
