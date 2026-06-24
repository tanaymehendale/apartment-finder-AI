"use client";
import { useEffect, useState } from "react";
import type { RequirementsPayload } from "@/lib/api";

type Proximity = { label: string; kind: "named" | "category" | "transit" };

interface Props {
  /** Emits the optional-only requirements payload whenever a selection changes. */
  onChange: (payload: Partial<RequirementsPayload>) => void;
}

const BED_OPTS = [
  { label: "Any", v: 0 },
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "3", v: 3 },
  { label: "4+", v: 4 },
];
const BATH_OPTS = [
  { label: "Any", v: 0 },
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "3+", v: 3 },
];
const ROOM_OPTS = [
  { label: "Just me", v: 0 },
  { label: "1", v: 1 },
  { label: "2", v: 2 },
  { label: "3+", v: 3 },
];
// Transit (Caltrain/bus) → Places typed Nearby Search for the nearest real station;
// the rest are categories → Places "nearest X" text search.
const QUICK_NEAR: Proximity[] = [
  { label: "Caltrain", kind: "transit" },
  { label: "Bus stop", kind: "transit" },
  { label: "Grocery store", kind: "category" },
  { label: "Gym", kind: "category" },
  { label: "Park", kind: "category" },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
        active
          ? "bg-primary text-white border-primary shadow-sm"
          : "bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function RequirementCards({ onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [bedrooms, setBedrooms] = useState(0);
  const [bathrooms, setBathrooms] = useState(0);
  const [roommates, setRoommates] = useState(0);
  const [perPerson, setPerPerson] = useState(false);
  const [proximity, setProximity] = useState<Proximity[]>([]);
  const [custom, setCustom] = useState("");

  // Rebuild the optional-only payload whenever a selection changes. Only fields the
  // user actually changed from the default are included, so an untouched panel emits
  // {} (→ plain free-text search, no structured path).
  useEffect(() => {
    const payload: Partial<RequirementsPayload> = {};
    if (bedrooms) payload.min_bedrooms = bedrooms;
    if (bathrooms) payload.min_bathrooms = bathrooms;
    if (roommates) payload.roommates = roommates;
    if (perPerson) payload.budget_is_per_person = true;
    if (proximity.length) payload.proximity = proximity;
    onChange(payload);
  }, [bedrooms, bathrooms, roommates, perPerson, proximity, onChange]);

  function toggleNear(p: Proximity) {
    setProximity((prev) =>
      prev.some((x) => x.label.toLowerCase() === p.label.toLowerCase())
        ? prev.filter((x) => x.label.toLowerCase() !== p.label.toLowerCase())
        : [...prev, p]
    );
  }

  function addCustom() {
    const label = custom.trim();
    if (!label) return;
    if (!proximity.some((x) => x.label.toLowerCase() === label.toLowerCase())) {
      setProximity((prev) => [...prev, { label, kind: "category" }]);
    }
    setCustom("");
  }

  const isActive = (label: string) =>
    proximity.some((x) => x.label.toLowerCase() === label.toLowerCase());

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-primary transition-colors mx-auto"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Add preferences (optional)
      </button>

      {open && (
        <div className="mt-3 w-full bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-col gap-4 text-left">
          {/* Bedrooms */}
          <Section label="Bedrooms">
            {BED_OPTS.map((o) => (
              <Chip key={o.label} active={bedrooms === o.v} onClick={() => setBedrooms(o.v)}>
                {o.label}
              </Chip>
            ))}
          </Section>

          {/* Bathrooms */}
          <Section label="Bathrooms">
            {BATH_OPTS.map((o) => (
              <Chip key={o.label} active={bathrooms === o.v} onClick={() => setBathrooms(o.v)}>
                {o.label}
              </Chip>
            ))}
          </Section>

          {/* Roommates + budget basis */}
          <Section label="Roommates">
            {ROOM_OPTS.map((o) => (
              <Chip key={o.label} active={roommates === o.v} onClick={() => setRoommates(o.v)}>
                {o.label}
              </Chip>
            ))}
          </Section>

          <Section label="Budget is">
            <Chip active={!perPerson} onClick={() => setPerPerson(false)}>
              Total
            </Chip>
            <Chip active={perPerson} onClick={() => setPerPerson(true)}>
              Per person
            </Chip>
          </Section>

          {/* Also near */}
          <Section label="Also near">
            {QUICK_NEAR.map((p) => (
              <Chip key={p.label} active={isActive(p.label)} onClick={() => toggleNear(p)}>
                {isActive(p.label) ? "✓ " : "+ "}
                {p.label}
              </Chip>
            ))}
            {proximity
              .filter((p) => !QUICK_NEAR.some((q) => q.label.toLowerCase() === p.label.toLowerCase()))
              .map((p) => (
                <Chip key={p.label} active onClick={() => toggleNear(p)}>
                  ✓ {p.label}
                </Chip>
              ))}
          </Section>

          {/* Custom amenity */}
          <div className="flex items-center gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Add another, e.g. Indian grocery"
              className="flex-1 text-xs px-3 py-2 rounded-xl border border-gray-200 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={!custom.trim()}
              className="px-3 py-2 text-xs font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
