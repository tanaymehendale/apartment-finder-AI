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
  data_warning?: string;
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

  // Try to extract JSON arrays from the dossier text (Analyst writes prose + JSON)
  const jsonMatches = dossier.match(/\[[\s\S]*?\]/g) ?? [];
  for (const raw of jsonMatches) {
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
              data_warning: item.data_warning,
            });
          }
        }
        break;
      }
    } catch {
      continue;
    }
  }

  // Attach commute data from dossier
  const commuteMatch = dossier.match(/"rows"\s*:\s*\[[\s\S]*?\]/);
  if (commuteMatch) {
    const commutes = parseCommuteData(`{${commuteMatch[0]}}`);
    commutes.forEach((c, i) => {
      if (apartments[i]) apartments[i].commute = c;
    });
  }

  return { apartments };
}

export function mergeSafetyReport(apartments: Apartment[], safetyReport: string): Apartment[] {
  if (!safetyReport || apartments.length === 0) return apartments;

  return apartments.map((apt, i) => {
    // Try to extract the safety note for this apartment from the report
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
