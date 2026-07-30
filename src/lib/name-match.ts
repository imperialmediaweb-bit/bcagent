/**
 * Potrivirea numelor de firme „din viața reală" (XLS-uri, liste de clienți)
 * cu denumirile oficiale MF: normalizare identică cu indexul din Postgres
 * + variante cu/fără forma juridică (SC/SRL/PFA...).
 */

const LEGAL_TOKENS = new Set([
  "SC", "SRL", "S", "R", "L", "SA", "PFA", "II", "IF", "SNC", "SCS", "SRLD",
]);

export function normalizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, " ").toUpperCase().trim();
}

export function coreName(norm: string): string {
  const tokens = norm.split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_TOKENS.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && LEGAL_TOKENS.has(tokens[tokens.length - 1]))
    tokens.pop();
  return tokens.join(" ");
}

export function variantsFor(name: string): string[] {
  const norm = normalizeName(name);
  if (norm.length < 4) return [];
  const core = coreName(norm);
  const set = new Set<string>([norm]);
  if (core.length >= 4) {
    set.add(core);
    set.add(`${core} SRL`);
    set.add(`${core} S R L`);
    set.add(`SC ${core} SRL`);
    set.add(`${core} PFA`);
  }
  return Array.from(set);
}
