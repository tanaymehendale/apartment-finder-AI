"use client";
import type { Apartment } from "@/lib/types";
import { CommuteBadge } from "./CommuteBadge";

interface Props {
  apartment: Apartment;
  index: number;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
}

const RANK_LABELS = ["Top Pick", "Runner-up", "Budget Pick"];
const RANK_COLORS = [
  "bg-primary text-white",
  "bg-gray-700 text-white",
  "bg-accent text-white",
];

export function ApartmentCard({ apartment, index, isHighlighted, onHover }: Props) {
  const rankLabel = RANK_LABELS[index] ?? `Option ${index + 1}`;
  const rankColor = RANK_COLORS[index] ?? "bg-gray-500 text-white";

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
      {/* Rank badge */}
      <span className={`absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full ${rankColor}`}>
        {rankLabel}
      </span>

      {/* Price */}
      <div className="mb-2">
        <span className="text-2xl font-bold text-gray-900">
          ${apartment.monthly_price.toLocaleString()}
        </span>
        <span className="text-sm text-muted">/mo</span>
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

      {/* Commute badge */}
      <div className="flex flex-wrap gap-1.5">
        <CommuteBadge commute={apartment.commute} />
      </div>

      {/* Safety summary */}
      {apartment.safety_summary && (
        <p className="mt-2.5 text-xs text-muted leading-relaxed border-t border-gray-50 pt-2.5">
          {apartment.safety_summary}
        </p>
      )}

      {/* Stale data warning */}
      {apartment.data_warning && (
        <p className="mt-1.5 text-[10px] text-amber-600 flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Data may be stale
        </p>
      )}
    </div>
  );
}
