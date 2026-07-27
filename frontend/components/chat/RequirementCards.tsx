"use client";
import { useEffect, useRef, useState } from "react";
import type { RequirementsPayload } from "@/lib/api";
import { CheckCircleIcon, ChevronDownIcon, PlusIcon } from "@/lib/icons";

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
// Transit (train/bus) → Places typed Nearby Search for the nearest real station;
// the rest are categories → Places "nearest X" text search. "Train station" (not
// a specific regional system) so the default reads generically nationwide.
const QUICK_NEAR: Proximity[] = [
  { label: "Train station", kind: "transit" },
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
      aria-pressed={active}
      className={`px-3 py-1.5 text-sm font-medium rounded-xl border transition-all ${
        active
          ? "bg-primary-600 text-white border-primary-600 shadow-xs"
          : "bg-surface text-neutral-600 border-neutral-200 hover:border-primary-300 hover:text-primary-700"
      }`}
    >
      {children}
    </button>
  );
}

// A compact filter pill that opens a popover with the real controls — keeps the
// whole filter row to a single line instead of a page-length vertical stack.
function FilterPill({
  label,
  summary,
  active,
  children,
}: {
  label: string;
  summary: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 pl-3.5 pr-2.5 py-2 text-sm font-medium rounded-xl border transition-all ${
          active
            ? "bg-primary-50 text-primary-700 border-primary-200"
            : "bg-surface text-neutral-600 border-neutral-200 hover:border-neutral-300"
        }`}
      >
        <span className={active ? "text-primary-500" : "text-neutral-400"}>{label}</span>
        {summary}
        <ChevronDownIcon
          className={`w-3.5 h-3.5 transition-transform ${active ? "text-primary-400" : "text-neutral-400"} ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-2 min-w-[16rem] bg-surface border border-neutral-200 rounded-2xl shadow-lg p-3">
          {children}
        </div>
      )}
    </div>
  );
}

export function RequirementCards({ onChange }: Props) {
  const [bedrooms, setBedrooms] = useState(0);
  const [bathrooms, setBathrooms] = useState(0);
  const [roommates, setRoommates] = useState(0);
  const [perPerson, setPerPerson] = useState(false);
  const [proximity, setProximity] = useState<Proximity[]>([]);
  const [custom, setCustom] = useState("");

  // Intelligent filter: "budget is per person" only makes sense once there's
  // someone to split with. Surface it at 2+ roommates, and clear a stale
  // selection if the user dials roommates back down below that.
  const showBudgetBasis = roommates >= 2;
  useEffect(() => {
    if (!showBudgetBasis && perPerson) setPerPerson(false);
  }, [showBudgetBasis, perPerson]);

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

  const isNearActive = (label: string) =>
    proximity.some((x) => x.label.toLowerCase() === label.toLowerCase());

  const bedSummary = BED_OPTS.find((o) => o.v === bedrooms)?.label ?? "Any";
  const bathSummary = BATH_OPTS.find((o) => o.v === bathrooms)?.label ?? "Any";
  const roomSummary = ROOM_OPTS.find((o) => o.v === roommates)?.label ?? "Just me";
  const nearSummary = proximity.length === 0 ? "Add" : `${proximity.length} selected`;

  return (
    <div className="w-full flex flex-wrap items-center gap-2">
      <FilterPill label="Beds" summary={bedSummary} active={bedrooms > 0}>
        <div className="flex flex-wrap gap-2">
          {BED_OPTS.map((o) => (
            <Chip key={o.label} active={bedrooms === o.v} onClick={() => setBedrooms(o.v)}>
              {o.label}
            </Chip>
          ))}
        </div>
      </FilterPill>

      <FilterPill label="Baths" summary={bathSummary} active={bathrooms > 0}>
        <div className="flex flex-wrap gap-2">
          {BATH_OPTS.map((o) => (
            <Chip key={o.label} active={bathrooms === o.v} onClick={() => setBathrooms(o.v)}>
              {o.label}
            </Chip>
          ))}
        </div>
      </FilterPill>

      <FilterPill label="Roommates" summary={roomSummary} active={roommates > 0}>
        <div className="flex flex-wrap gap-2">
          {ROOM_OPTS.map((o) => (
            <Chip key={o.label} active={roommates === o.v} onClick={() => setRoommates(o.v)}>
              {o.label}
            </Chip>
          ))}
        </div>
      </FilterPill>

      {showBudgetBasis && (
        <FilterPill label="Budget" summary={perPerson ? "Per person" : "Total"} active={perPerson}>
          <div className="flex flex-wrap gap-2">
            <Chip active={!perPerson} onClick={() => setPerPerson(false)}>
              Total
            </Chip>
            <Chip active={perPerson} onClick={() => setPerPerson(true)}>
              Per person
            </Chip>
          </div>
        </FilterPill>
      )}

      <FilterPill label="Near" summary={nearSummary} active={proximity.length > 0}>
        <div className="flex flex-col gap-3 w-64">
          <div className="flex flex-wrap gap-2">
            {QUICK_NEAR.map((p) => (
              <Chip key={p.label} active={isNearActive(p.label)} onClick={() => toggleNear(p)}>
                <span className="inline-flex items-center gap-1">
                  {isNearActive(p.label) ? (
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                  ) : (
                    <PlusIcon className="w-3 h-3" />
                  )}
                  {p.label}
                </span>
              </Chip>
            ))}
            {proximity
              .filter((p) => !QUICK_NEAR.some((q) => q.label.toLowerCase() === p.label.toLowerCase()))
              .map((p) => (
                <Chip key={p.label} active onClick={() => toggleNear(p)}>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    {p.label}
                  </span>
                </Chip>
              ))}
          </div>
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
              placeholder="e.g. Indian grocery"
              aria-label="Add a custom nearby place"
              className="flex-1 text-sm px-3 py-2 rounded-xl border border-neutral-200 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={!custom.trim()}
              className="px-3 py-2 text-sm font-medium rounded-xl bg-neutral-100 text-neutral-700 hover:bg-primary-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </FilterPill>
    </div>
  );
}
