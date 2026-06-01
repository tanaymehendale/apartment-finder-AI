"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { Apartment } from "@/lib/types";
import { ApartmentCard } from "./ApartmentCard";

const MapView = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-50 rounded-2xl">
      <div className="text-sm text-muted animate-pulse">Loading map…</div>
    </div>
  ),
});

interface Props {
  apartments: Apartment[];
}

export function ResultsPanel({ apartments }: Props) {
  const [activeTab, setActiveTab] = useState<"cards" | "map">("cards");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hasResults = apartments.length > 0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            {hasResults ? `${apartments.length} listings found` : "Results"}
          </h2>
          <p className="text-xs text-muted">
            {hasResults ? "Ranked by best match" : "Will appear here after searching"}
          </p>
        </div>
        {hasResults && (
          <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 p-0.5">
            {(["cards", "map"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  activeTab === tab
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab === "cards" ? (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    Cards
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
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
          <EmptyState />
        ) : activeTab === "cards" ? (
          <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
            {apartments.map((apt, i) => (
              <ApartmentCard
                key={apt.id}
                apartment={apt}
                index={i}
                isHighlighted={hoveredId === apt.id}
                onHover={setHoveredId}
              />
            ))}
          </div>
        ) : (
          <div className="h-full p-4">
            <MapView
              apartments={apartments}
              highlightedId={hoveredId}
              onHighlight={setHoveredId}
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
      <div className="w-20 h-20 rounded-3xl bg-gray-100 flex items-center justify-center">
        <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-500 mb-1">No listings yet</p>
        <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
          Start a conversation on the left — apartment cards and map pins will appear here automatically.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
        {["Search listings", "Check commutes", "Review safety"].map((step, i) => (
          <div key={step} className="bg-white border border-gray-100 rounded-xl p-3 text-center shadow-sm">
            <div className="text-primary font-bold text-lg mb-0.5">{i + 1}</div>
            <p className="text-[10px] text-muted leading-tight">{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
