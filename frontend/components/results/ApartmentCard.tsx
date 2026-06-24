"use client";
import type { Apartment } from "@/lib/types";
import { CommuteBadge } from "./CommuteBadge";

interface Props {
  apartment: Apartment;
  index: number;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  roommates?: number;
}

const RANK_LABELS = ["Top Pick", "Runner-up", "3rd Choice", "4th Choice", "5th Choice"];
const RANK_COLORS = [
  "bg-primary text-white",
  "bg-gray-700 text-white",
  "bg-accent text-white",
  "bg-gray-500 text-white",
  "bg-gray-400 text-white",
];

export function ApartmentCard({ apartment, index, isHighlighted, onHover, roommates = 0 }: Props) {
  const rankLabel = RANK_LABELS[index] ?? `Option ${index + 1}`;
  const rankColor = RANK_COLORS[index] ?? "bg-gray-500 text-white";

  // P2-3: per-person rent split when the user is sharing with roommates.
  const occupants = roommates + 1;
  const perPerson = roommates > 0 ? Math.round(apartment.monthly_price / occupants) : null;

  return (
    <div
      onMouseEnter={() => onHover(apartment.id)}
      onMouseLeave={() => onHover(null)}
      className={`
        relative bg-white rounded-2xl border p-4 cursor-default transition-all duration-200 shadow-sm
        ${isHighlighted
          ? "border-primary ring-2 ring-primary/10 shadow-md"
          : "border-gray-100 hover:border-gray-200 hover:shadow-md"
        }
      `}
    >
      {/* Rank + over-budget badges */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        {apartment.over_budget && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            Over budget
          </span>
        )}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${rankColor}`}>
          {rankLabel}
        </span>
      </div>

      {/* Price */}
      <div className="mb-2">
        <span className="text-2xl font-bold text-gray-900">
          ${apartment.monthly_price.toLocaleString()}
        </span>
        <span className="text-sm text-muted">/mo</span>
        {perPerson != null && (
          <span className="ml-2 text-xs font-medium text-primary">
            ${perPerson.toLocaleString()}/person · split {occupants} ways
          </span>
        )}
      </div>

      {/* Address */}
      <p className="text-sm font-medium text-gray-800 mb-1 pr-16 leading-snug">
        {apartment.address}
      </p>

      {/* Specs */}
      <div className="flex items-center gap-3 text-xs text-muted mb-3">
        {apartment.bedrooms != null && (
          <span className="flex items-center gap-0.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            {apartment.bedrooms} bd
          </span>
        )}
        {apartment.bathrooms != null && (
          <span>{apartment.bathrooms} ba</span>
        )}
        {apartment.square_feet != null && (
          <span>{apartment.square_feet.toLocaleString()} sqft</span>
        )}
      </div>

      {/* Commute + proximity badges */}
      <div className="flex flex-wrap gap-1.5">
        <CommuteBadge commute={apartment.commute} />
        {apartment.proximity_results?.map((p) => (
          <span
            key={p.label}
            title={p.name}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {p.label} · {p.distance_text}
          </span>
        ))}
      </div>

      {/* Safety summary */}
      {apartment.safety_summary && (
        <p className="mt-2.5 text-xs text-muted leading-relaxed border-t border-gray-50 pt-2.5">
          {apartment.safety_summary}
        </p>
      )}
    </div>
  );
}
