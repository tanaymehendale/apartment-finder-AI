import type { Apartment, CommuteInfo } from "./types";

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
  status?: string;
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

function parseCommuteData(commuteJson: string): CommuteInfo[] {
  try {
    const data: RawCommuteData = JSON.parse(commuteJson);
    if (!data.rows) return [];
    return data.rows.map((row) => {
      const el = row.elements?.[0];
      if (!el || el.status !== "OK") return null;
      return {
        duration_text: el.duration?.text ?? "",
        distance_text: el.distance?.text ?? "",
        duration_seconds: el.duration?.value ?? 0,
      };
    }).filter(Boolean) as CommuteInfo[];
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
  // Use bracket-counting for objects too so nested arrays in rows don't truncate the match
  const objectBlocks = findTopLevelJsonBlocks(dossier, "{", "}");
  let commuteAttached = false;
  for (const block of objectBlocks) {
    if (!block.includes('"rows"')) continue;
    const commutes = parseCommuteData(block);
    if (commutes.length > 0) {
      commutes.forEach((c, i) => {
        if (apartments[i]) apartments[i].commute = c;
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
