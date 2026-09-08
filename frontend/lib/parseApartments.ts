import type { Apartment, CommuteInfo, ProximityResult } from "./types";

interface RawApartment {
  id?: string;
  agent_description?: string;
  monthly_price?: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  bedrooms?: number;
  bathrooms?: number;
  square_feet?: number;
  listing_url?: string;
  listing_source?: string;
  over_budget?: boolean;
  photos?: string[];
}

interface CommuteRow {
  elements?: Array<{
    duration?: { text: string; value: number };
    distance?: { text: string; value: number };
    status?: string;
  }>;
}

interface RawCommuteData {
  rows?: CommuteRow[];
  origins?: string[];
  status?: string;
}

/**
 * Coordinate key used to match a commute/proximity row back to its listing by
 * location instead of array position — the Analyst re-emits listings as a separate
 * JSON block per output step and doesn't reliably keep every block in the same
 * order, so index-based matching silently mispairs a listing with a neighbor's
 * commute/distance data. ~11m precision (4 decimals) is far tighter than the gap
 * between distinct listings, while still absorbing minor LLM formatting/rounding
 * differences when it re-writes the lat/lng it read off a listing.
 */
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function parseOriginKey(origin: string | undefined): string | null {
  if (!origin) return null;
  const parts = origin.split(",");
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return coordKey(lat, lng);
}

/**
 * Finds all top-level JSON blocks delimited by openChar/closeChar,
 * correctly skipping over string literals so nested brackets don't confuse the count.
 */
function findTopLevelJsonBlocks(text: string, openChar: string, closeChar: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === openChar) {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return results;
}

function rowToCommute(row: CommuteRow): CommuteInfo | null {
  const el = row.elements?.[0];
  if (!el || el.status !== "OK") return null;
  return {
    duration_text: el.duration?.text ?? "",
    distance_text: el.distance?.text ?? "",
    duration_seconds: el.duration?.value ?? 0,
  };
}

/**
 * Returns a coordKey → CommuteInfo map when the response carries "origins" (current
 * backend), or null when it doesn't (older cached dossiers) so the caller can fall
 * back to positional attachment instead of matching nothing.
 */
function parseCommuteByCoord(commuteJson: string): Map<string, CommuteInfo> | null {
  try {
    const data: RawCommuteData = JSON.parse(commuteJson);
    if (!data.rows || !data.origins || data.origins.length !== data.rows.length) return null;
    const byCoord = new Map<string, CommuteInfo>();
    data.rows.forEach((row, i) => {
      const key = parseOriginKey(data.origins![i]);
      const commute = rowToCommute(row);
      if (key && commute) byCoord.set(key, commute);
    });
    return byCoord;
  } catch {
    return null;
  }
}

/** Legacy fallback: positional attachment for dossiers with no "origins" field. */
function parseCommuteData(commuteJson: string): Array<CommuteInfo | null> {
  try {
    const data: RawCommuteData = JSON.parse(commuteJson);
    if (!data.rows) return [];
    // One row per origin, in the SAME order the Analyst built the origins array
    // (apartment order) — must stay index-aligned with `apartments`, so a failed
    // row becomes `null` in place rather than being dropped (dropping would shift
    // every later row onto the wrong listing).
    return data.rows.map(rowToCommute);
  } catch {
    return [];
  }
}

export function parseAnalystDossier(dossier: string): {
  apartments: Apartment[];
} {
  if (!dossier) return { apartments: [] };

  const apartments: Apartment[] = [];

  // Find all top-level JSON arrays using bracket-counting (handles nested brackets and string literals)
  const arrayBlocks = findTopLevelJsonBlocks(dossier, "[", "]");
  for (const raw of arrayBlocks) {
    try {
      const items: RawApartment[] = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0 && items[0]?.address) {
        for (const item of items) {
          if (typeof item.latitude === "number" && typeof item.longitude === "number") {
            apartments.push({
              id: item.id ?? `apt-${apartments.length}`,
              agent_description: item.agent_description ?? "",
              monthly_price: item.monthly_price ?? 0,
              address: item.address ?? "",
              latitude: item.latitude,
              longitude: item.longitude,
              bedrooms: item.bedrooms,
              bathrooms: item.bathrooms,
              square_feet: item.square_feet,
              listing_url: item.listing_url,
              listing_source: item.listing_source,
              over_budget: item.over_budget,
              photos: Array.isArray(item.photos) ? item.photos : undefined,
            });
          }
        }
        break;
      }
    } catch {
      continue;
    }
  }

  // Attach commute data — find the top-level JSON object that contains a "rows" field
  // Use bracket-counting for objects too so nested arrays in rows don't truncate the match.
  // Prefer matching by coordinate (robust to the Analyst listing apartments in a different
  // order across JSON blocks); fall back to positional attachment only if the response has
  // no "origins" field to match against (older cached dossiers).
  const objectBlocks = findTopLevelJsonBlocks(dossier, "{", "}");
  let commuteAttached = false;
  for (const block of objectBlocks) {
    if (!block.includes('"rows"')) continue;
    const byCoord = parseCommuteByCoord(block);
    if (byCoord && byCoord.size > 0) {
      for (const apt of apartments) {
        const commute = byCoord.get(coordKey(apt.latitude, apt.longitude));
        if (commute) apt.commute = commute;
      }
      commuteAttached = true;
      break;
    }
    const commutes = parseCommuteData(block);
    if (commutes.some((c) => c !== null)) {
      commutes.forEach((c, i) => {
        if (c && apartments[i]) apartments[i].commute = c;
      });
      commuteAttached = true;
      break;
    }
  }

  if (!commuteAttached) {
    // Fallback: parse text lines like "123 Main St — 25 min commute (15 miles)"
    const textLines = dossier.match(/—\s*(\d+)\s*min(?:ute)?s?\s+commute\s*\(([^)]+)\)/gi) ?? [];
    textLines.forEach((line, i) => {
      const m = line.match(/(\d+)\s*min(?:ute)?s?\s+commute\s*\(([^)]+)\)/i);
      if (m && apartments[i]) {
        apartments[i].commute = {
          duration_text: `${m[1]} mins`,
          distance_text: m[2].trim(),
          duration_seconds: parseInt(m[1], 10) * 60,
        };
      }
    });
  }

  // P2-4: attach proximity badges. Each find_nearby_amenities block is a top-level
  // {"label","kind","results":[...]} object; each result already carries its own
  // "origin" coordinate — match on that (same reasoning as commute above) rather than
  // trusting results[i] to line up with apartments[i].
  for (const block of objectBlocks) {
    if (!block.includes('"results"') || !block.includes('"label"')) continue;
    try {
      const data = JSON.parse(block) as {
        label?: string;
        results?: Array<{ origin?: string; name?: string; distance_text?: string } | null>;
      };
      if (!data.label || !Array.isArray(data.results)) continue;
      const byCoord = new Map<string, { name: string; distance_text: string }>();
      for (const r of data.results) {
        if (!r || !r.name || !r.distance_text) continue;
        const key = parseOriginKey(r.origin);
        if (key) byCoord.set(key, { name: r.name, distance_text: r.distance_text });
      }
      for (const apt of apartments) {
        const match = byCoord.get(coordKey(apt.latitude, apt.longitude));
        if (!match) continue;
        const entry: ProximityResult = { label: data.label!, name: match.name, distance_text: match.distance_text };
        (apt.proximity_results ??= []).push(entry);
      }
    } catch {
      continue;
    }
  }

  return { apartments };
}

/**
 * Hidden marker the Summarizer appends with its reasoned best→worst ranking, e.g.
 *   <!--RANKING:["123","456"]-->
 * react-markdown drops HTML comments, but we also strip it from displayed text.
 */
export const RANKING_MARKER_RE = /<!--\s*RANKING\s*:\s*(\[[^\]]*\])\s*-->/i;

/** Extract the ranked list of apartment ids from the Summarizer's output, or null. */
export function parseRanking(text: string): string[] | null {
  if (!text) return null;
  const m = text.match(RANKING_MARKER_RE);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr.map(String) : null;
  } catch {
    return null;
  }
}

/** Remove the hidden RANKING marker (and anything after it) from user-facing text. */
export function stripRankingMarker(text: string): string {
  const i = text.search(/<!--\s*RANKING/i);
  return i === -1 ? text : text.slice(0, i).trimEnd();
}

/**
 * Reorder apartments to follow the Summarizer's ranking (matched by id, best first).
 * Any apartment not named in the ranking is appended in its original order.
 */
export function applyRanking(apartments: Apartment[], ranking: string[] | null): Apartment[] {
  if (!ranking || ranking.length === 0 || apartments.length === 0) return apartments;
  const byId = new Map(apartments.map((a) => [String(a.id), a]));
  const ordered: Apartment[] = [];
  for (const id of ranking) {
    const a = byId.get(String(id));
    if (a) {
      ordered.push(a);
      byId.delete(String(id));
    }
  }
  for (const a of apartments) {
    if (byId.has(String(a.id))) ordered.push(a);
  }
  return ordered;
}

export function mergeSafetyReport(apartments: Apartment[], safetyReport: string): Apartment[] {
  if (!safetyReport || apartments.length === 0) return apartments;

  return apartments.map((apt) => {
    const lines = safetyReport.split("\n");
    const aptLine = lines.findIndex(
      (l) => l.toLowerCase().includes(apt.address.split(",")[0].toLowerCase())
    );
    if (aptLine === -1) return apt;

    const snippet = lines
      .slice(aptLine, aptLine + 3)
      .join(" ")
      .replace(/\*\*/g, "")
      .slice(0, 120)
      .trim();

    return { ...apt, safety_summary: snippet || undefined };
  });
}
