"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { Apartment, LandmarkInfo } from "@/lib/types";
import { ApartmentCard } from "./ApartmentCard";
import { SkeletonResults } from "./Skeleton";
import { GridIcon, HomeSearchIcon, RouteIcon, SpinnerIcon } from "@/lib/icons";

const MapView = dynamic(() => import("@/components/map/MapView").then((m) => ({ default: m.MapView })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-neutral-50 rounded-2xl">
      <SpinnerIcon className="w-5 h-5 text-neutral-400 animate-spin-slow" />
    </div>
  ),
});

interface Props {
  apartments: Apartment[];
  landmark?: LandmarkInfo | null;
  roommates?: number;
  /** True while the agent pipeline is actively searching — show skeletons, not the empty state. */
  isLoading?: boolean;
}

export function ResultsPanel({ apartments, landmark, roommates = 0, isLoading = false }: Props) {
  const [activeTab, setActiveTab] = useState<"cards" | "map">("map");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hasResults = apartments.length > 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 bg-surface">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 font-display">
            {hasResults ? `${apartments.length} listings found` : isLoading ? "Searching…" : "Results"}
          </h2>
          <p className="text-xs text-neutral-500">
            {hasResults
              ? "Ranked by best match"
              : isLoading
                ? "Comparing listings, commutes, and safety"
                : "Will appear here after searching"}
          </p>
        </div>
        {hasResults && (
          <div className="flex rounded-xl overflow-hidden border border-neutral-200 bg-neutral-50 p-0.5">
            {(["cards", "map"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-pressed={activeTab === tab}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  activeTab === tab
                    ? "bg-surface text-neutral-900 shadow-xs"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {tab === "cards" ? (
                  <span className="flex items-center gap-1">
                    <GridIcon className="w-3.5 h-3.5" />
                    Cards
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <RouteIcon className="w-3.5 h-3.5" />
                    Map
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {!hasResults ? (
          isLoading ? (
            <SkeletonResults />
          ) : (
            <EmptyState />
          )
        ) : activeTab === "cards" ? (
          <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
            {apartments.map((apt, i) => (
              <ApartmentCard
                key={apt.id}
                apartment={apt}
                index={i}
                isHighlighted={hoveredId === apt.id}
                onHover={setHoveredId}
                roommates={roommates}
                landmark={landmark}
              />
            ))}
          </div>
        ) : (
          <div className="h-full p-4">
            <MapView
              apartments={apartments}
              highlightedId={hoveredId}
              onHighlight={setHoveredId}
              landmark={landmark}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="w-20 h-20 rounded-3xl bg-neutral-100 flex items-center justify-center">
        <HomeSearchIcon className="w-9 h-9 text-neutral-300" />
      </div>
      <div>
        <p className="text-sm font-semibold text-neutral-500 mb-1">No listings yet</p>
        <p className="text-xs text-neutral-400 max-w-xs leading-relaxed">
          Start a conversation on the left — apartment cards and map pins will appear here automatically.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
        {["Search listings", "Check commutes", "Review safety"].map((step, i) => (
          <div key={step} className="bg-surface border border-neutral-100 rounded-xl p-3 text-center shadow-xs">
            <div className="font-display text-primary-600 font-bold text-lg mb-0.5">{i + 1}</div>
            <p className="text-[10px] text-neutral-500 leading-tight">{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
