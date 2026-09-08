"use client";
import { useState } from "react";
import type { Apartment, LandmarkInfo } from "@/lib/types";
import { CommuteBadge } from "./CommuteBadge";
import { BedIcon, BathIcon, PinIcon, ExternalLinkIcon, RouteIcon, BuildingIcon } from "@/lib/icons";
import { streetViewUrl } from "@/lib/photo";

interface Props {
  apartment: Apartment;
  index: number;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  roommates?: number;
  landmark?: LandmarkInfo | null;
}

// P3-2: pure client-side Google Maps directions link, no backend call.
function directionsUrl(apartment: Apartment, landmark: LandmarkInfo): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${apartment.latitude},${apartment.longitude}`,
    destination: `${landmark.lat},${landmark.lng}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// P3-1: label the "View listing" button by source so it's clear what it opens.
function listingButtonLabel(source?: string): string {
  if (source === "zillow") return "View on Zillow";
  if (source === "rentcast") return "Search listings";
  return "Search listings";
}

const RANK_LABELS = ["Top Pick", "Runner-up", "3rd Choice", "4th Choice", "5th Choice"];
const RANK_COLORS = [
  "bg-primary-600 text-white",
  "bg-neutral-700 text-white",
  "bg-accent-600 text-white",
  "bg-neutral-500 text-white",
  "bg-neutral-400 text-white",
];

export function ApartmentCard({ apartment, index, isHighlighted, onHover, roommates = 0, landmark }: Props) {
  const rankLabel = RANK_LABELS[index] ?? `Option ${index + 1}`;
  const rankColor = RANK_COLORS[index] ?? "bg-neutral-500 text-white";

  // P2-3: per-person rent split when the user is sharing with roommates.
  const occupants = roommates + 1;
  const perPerson = roommates > 0 ? Math.round(apartment.monthly_price / occupants) : null;
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = apartment.photos?.[0] ?? (photoFailed ? null : streetViewUrl(apartment.latitude, apartment.longitude));

  return (
    <div
      onMouseEnter={() => onHover(apartment.id)}
      onMouseLeave={() => onHover(null)}
      style={{ animationDelay: `${Math.min(index, 5) * 70}ms` }}
      className={`
        relative bg-surface rounded-2xl border overflow-hidden cursor-default transition-all duration-200 shadow-xs animate-reveal
        ${isHighlighted
          ? "border-primary-400 ring-2 ring-primary-100 shadow-md"
          : "border-neutral-100 hover:border-neutral-200 hover:shadow-sm"
        }
      `}
    >
      {/* Photo — real-estate listings lead with a photo; a flat branded
          placeholder (not a blank box) when the provider gave none, so the
          card grid doesn't jump between listings that have one and don't. */}
      <div className="relative w-full aspect-[16/10] bg-neutral-100">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BuildingIcon className="w-9 h-9 text-neutral-300" />
          </div>
        )}
        {/* Scrim so the badges stay legible over any photo */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/35 to-transparent pointer-events-none" />
        <div className="absolute top-3 right-3 flex items-center gap-1">
          {apartment.over_budget && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warning-100 text-warning-700 shadow-xs">
              Over budget
            </span>
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-xs ${rankColor}`}>
            {rankLabel}
          </span>
        </div>
      </div>

      <div className="p-4">
        {/* Price */}
        <div className="mb-2">
          <span className="font-display text-2xl font-bold text-neutral-900 tabular-nums">
            ${apartment.monthly_price.toLocaleString()}
          </span>
          <span className="text-sm text-neutral-500">/mo</span>
          {perPerson != null && (
            <span className="ml-2 text-xs font-medium text-primary-700">
              ${perPerson.toLocaleString()}/person · split {occupants} ways
            </span>
          )}
        </div>

        {/* Address */}
        <p className="text-sm font-medium text-neutral-800 mb-1 leading-snug">
          {apartment.address}
        </p>

        {/* Specs */}
        <div className="flex items-center gap-3 text-xs text-neutral-500 mb-3">
          {apartment.bedrooms != null && (
            <span className="flex items-center gap-1">
              <BedIcon className="w-3.5 h-3.5" />
              {apartment.bedrooms} bd
            </span>
          )}
          {apartment.bathrooms != null && (
            <span className="flex items-center gap-1">
              <BathIcon className="w-3.5 h-3.5" />
              {apartment.bathrooms} ba
            </span>
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
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-success-50 text-success-700"
            >
              <PinIcon className="w-3 h-3" />
              {p.label} · {p.distance_text}
            </span>
          ))}
        </div>

        {/* Safety summary */}
        {apartment.safety_summary && (
          <p className="mt-2.5 text-xs text-neutral-500 leading-relaxed border-t border-neutral-100 pt-2.5">
            {apartment.safety_summary}
          </p>
        )}

        {/* Actions: view listing + directions (P3-1, P3-2) */}
        <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center gap-2">
          {apartment.listing_url && (
            <a
              href={apartment.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl bg-neutral-50 text-neutral-700 hover:bg-neutral-100 transition-colors"
            >
              <ExternalLinkIcon className="w-3.5 h-3.5" />
              {listingButtonLabel(apartment.listing_source)}
            </a>
          )}
          {landmark && (
            <a
              href={directionsUrl(apartment, landmark)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
            >
              <RouteIcon className="w-3.5 h-3.5" />
              Directions
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
