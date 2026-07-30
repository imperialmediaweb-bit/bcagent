/**
 * Originea PUBLICĂ a cererii. În producție (Railway) serverul ascultă pe
 * localhost:8080 în spatele proxy-ului, deci `new URL(req.url).origin` dă
 * adresa internă — linkurile și redirecturile construite din ea sunt moarte
 * pentru utilizator. Proxy-ul trimite domeniul real în X-Forwarded-Host /
 * X-Forwarded-Proto; le folosim pe acelea, cu fallback pe Host și pe req.url
 * (dezvoltare locală).
 */
export function requestOrigin(req: Request): string {
  const fixed = process.env.APP_URL;
  if (fixed) return fixed.replace(/\/+$/, "");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      new URL(req.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}
