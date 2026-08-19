export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Versiunea aplicației care rulează pe server. Telefoanele o compară cu
 * versiunea pe care au încărcat-o și, dacă e alta, se reîmprospătează
 * singure — agentul nu trebuie să știe să „închidă și să deschidă
 * aplicația", lucru pe care oricum nu-l face nimeni pe teren.
 *
 * Railway pune un identificator unic la fiecare deploy; local folosim ora
 * de pornire a serverului.
 */
const VERSIUNE =
  process.env.RAILWAY_DEPLOYMENT_ID ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  `local-${Date.now()}`;

export function GET() {
  return new Response(JSON.stringify({ versiune: VERSIUNE }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
