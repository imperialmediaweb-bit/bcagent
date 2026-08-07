/**
 * NAVIGAREA PE RUTĂ — inclusiv rutele care nu încap într-o zi.
 *
 * Google Maps acceptă maximum 10 puncte într-un link (9 opriri + destinația).
 * O rută de 25 de firme nu se poate porni dintr-un singur link — înainte se
 * tăiau restul în tăcere, iar agentul rămânea cu 15 clienți nevizitați fără
 * să știe. Acum ruta se împarte în ETAPE de câte 10, iar opririle deja
 * vizitate azi ies din calcul: a doua zi „Continuă ruta" pleacă exact de
 * unde a rămas.
 */

export const MAX_STOPS_PER_LEG = 10;

export interface NavStop {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
}

import { countyName, normalizeCounty } from "@/modules/prospects";

/** Adresa completă, așa cum o înțelege Google Maps. Numele județului vine
 *  din lista COMPLETĂ (toate cele 42), nu dintr-o copie parțială — altfel
 *  agentul din Timiș/Constanța ar fi navigat greșit. Acceptăm și cod, și
 *  nume, și cod numeric (normalizeCounty le duce pe toate la cod). */
export function navAddress(
  f: { adresa: string; localitate: string; judet?: string },
): string {
  const judetNume = f.judet ? countyName(normalizeCounty(f.judet)) : "";
  return [f.adresa, f.localitate, judetNume, "Romania"]
    .filter(Boolean)
    .join(", ");
}

/** Opririle rămase: cele care NU au fost vizitate (după CUI). */
export function remainingStops<T extends { cui: string }>(
  stops: T[],
  visitedCuis: Iterable<string>,
): T[] {
  const done = new Set(
    Array.from(visitedCuis, (c) => String(c).replace(/\D/g, "")),
  );
  return stops.filter((s) => !done.has(String(s.cui).replace(/\D/g, "")));
}

/** Ruta spartă în etape de maximum 10 opriri (limita Google Maps). */
export function routeLegs<T>(stops: T[], size = MAX_STOPS_PER_LEG): T[][] {
  const n = Math.max(1, Math.floor(size));
  const legs: T[][] = [];
  for (let i = 0; i < stops.length; i += n) legs.push(stops.slice(i, i + n));
  return legs;
}

/**
 * Link Google Maps pentru o etapă (maximum 10 opriri). Dacă primește mai
 * multe, ia primele 10 — restul se pornesc din etapa următoare, niciodată
 * pierdute în tăcere.
 */
export function legMapsUrl(stops: NavStop[], judet: string): string {
  const addrs = stops
    .slice(0, MAX_STOPS_PER_LEG)
    .map((s) => navAddress({ ...s, judet }));
  if (addrs.length === 0) return "";
  const destination = addrs[addrs.length - 1];
  const waypoints = addrs.slice(0, -1).join("|");
  return (
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
    "&travelmode=driving"
  );
}

export interface RoutePlan<T extends NavStop> {
  /** Câte opriri are ruta în total. */
  total: number;
  /** Câte au fost deja bifate („Am fost"). */
  done: number;
  /** Ce a mai rămas de făcut, în ordine. */
  remaining: T[];
  /** Etapele rămase (fiecare = un link de navigare). */
  legs: T[][];
  /** Linkurile de navigare, unul per etapă. */
  urls: string[];
  /** Ruta e terminată complet. */
  finished: boolean;
}

/** Tot ce trebuie ca să pornești sau să CONTINUI o rută. */
export function planRoute<T extends NavStop>(
  stops: T[],
  visitedCuis: Iterable<string>,
  judet: string,
): RoutePlan<T> {
  const remaining = remainingStops(stops, visitedCuis);
  const legs = routeLegs(remaining);
  return {
    total: stops.length,
    done: stops.length - remaining.length,
    remaining,
    legs,
    urls: legs.map((leg) => legMapsUrl(leg, judet)),
    finished: stops.length > 0 && remaining.length === 0,
  };
}
