"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Map, { Marker, Popup, Source, Layer, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Apartment, LandmarkInfo } from "@/lib/types";
import { authHeaders } from "@/lib/api";
import { streetViewUrl } from "@/lib/photo";
import { PinIcon, ClockIcon, ExternalLinkIcon, RouteIcon } from "@/lib/icons";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const MAP_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";

// Same palette as tailwind.config.ts (primary-600 / neutral-700 / accent-600
// / neutral-500 / neutral-400) — duplicated as plain CSS color strings since
// these markers render as inline-styled divs, not Tailwind-classed elements.
const RANK_LABELS = ["Best Pick", "Runner-up", "3rd Choice", "4th Choice", "5th Choice"];
const RANK_HEX = [
  "oklch(50% 0.165 32)",
  "oklch(38% 0.013 35)",
  "oklch(52% 0.08 165)",
  "oklch(55% 0.014 35)",
  "oklch(70% 0.012 35)",
];
const PRIMARY = "oklch(50% 0.165 32)";
// Mapbox GL's own style engine (paint/layout props on Source/Layer) parses
// colors with its bundled csscolorparser, which does NOT understand OKLCH —
// unlike the marker/popup divs below, which are plain DOM elements where the
// browser's native CSS engine handles oklch() fine. Hex equivalent, computed
// from the same oklch(50% 0.165 32), used only for the route line's paint prop.
const PRIMARY_HEX = "#ad301c";
const LANDMARK_COLOR = "oklch(56% 0.14 60)";

// P3-2: pure client-side Google Maps directions link, no backend call.
function directionsUrl(apt: Apartment, landmark: LandmarkInfo): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${apt.latitude},${apt.longitude}`,
    destination: `${landmark.lat},${landmark.lng}`,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// P3-1: label the "View listing" button by source so it's clear what it opens.
function listingButtonLabel(source?: string): string {
  return source === "zillow" ? "View on Zillow" : "Search listings";
}

interface RouteState {
  aptId: string;
  points: [number, number][]; // [lat, lng] pairs, as returned by /api/directions
  loading: boolean;
}

interface Props {
  apartments: Apartment[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  landmark?: LandmarkInfo | null;
}

export function MapView({ apartments, highlightedId, onHighlight, landmark }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteState | null>(null);

  const fetchRoute = useCallback(async (apt: Apartment) => {
    if (!landmark) return;
    setRoute({ aptId: apt.id, points: [], loading: true });
    try {
      const res = await fetch(
        `/api/directions?origin=${apt.latitude},${apt.longitude}&destination=${landmark.lat},${landmark.lng}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new Error("Route fetch failed");
      const data: { points: [number, number][] } = await res.json();
      setRoute({ aptId: apt.id, points: data.points, loading: false });
    } catch {
      // On failure show a straight dashed line as fallback
      setRoute({
        aptId: apt.id,
        points: [[apt.latitude, apt.longitude], [landmark.lat, landmark.lng]],
        loading: false,
      });
    }
  }, [landmark]);

  const selectApartment = useCallback((apt: Apartment, opts?: { flyTo?: boolean }) => {
    setSelectedId(apt.id);
    fetchRoute(apt);
    if (opts?.flyTo) {
      mapRef.current?.flyTo({ center: [apt.longitude, apt.latitude], zoom: 15, duration: 900 });
    }
  }, [fetchRoute]);

  // P4-2: as soon as results arrive, auto-select the top pick so its route +
  // commute are visible immediately — no click required.
  useEffect(() => {
    if (apartments.length === 0) {
      setSelectedId(null);
      setRoute(null);
      return;
    }
    selectApartment(apartments[0]);
    // Only re-run when a NEW result set arrives, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apartments]);

  // Fit the whole result set (+ landmark) in view whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const points: [number, number][] = apartments.map((a) => [a.longitude, a.latitude]);
    if (landmark) points.push([landmark.lng, landmark.lat]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo({ center: points[0], zoom: 13, duration: 0 });
      return;
    }
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, maxZoom: 14, duration: 0 },
    );
  }, [apartments, landmark, mapLoaded]);

  if (apartments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-neutral-50 rounded-2xl border border-neutral-100">
        <p className="text-sm text-neutral-500">No apartments to display</p>
      </div>
    );
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-full bg-neutral-50 rounded-2xl border border-neutral-100 p-6 text-center">
        <p className="text-sm text-neutral-500">
          Map unavailable — set <code className="px-1 py-0.5 bg-neutral-100 rounded">NEXT_PUBLIC_MAPBOX_TOKEN</code> in
          <code className="px-1 py-0.5 bg-neutral-100 rounded ml-1">frontend/.env.local</code>.
        </p>
      </div>
    );
  }

  const initialCenter: [number, number] = [apartments[0].longitude, apartments[0].latitude];
  const routeGeoJson = route && route.points.length >= 2
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: route.points.map(([lat, lng]) => [lng, lat]),
        },
      }
    : null;

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      mapStyle={MAP_STYLE}
      initialViewState={{ longitude: initialCenter[0], latitude: initialCenter[1], zoom: 12 }}
      style={{ height: "100%", width: "100%", borderRadius: 18 }}
      onLoad={() => setMapLoaded(true)}
      reuseMaps
    >
      {/* Route polyline */}
      {routeGeoJson && (
        <Source id="route" type="geojson" data={routeGeoJson}>
          <Layer
            id="route-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": PRIMARY_HEX,
              "line-width": 4,
              "line-opacity": 0.8,
              "line-dasharray": route?.loading ? [2, 2] : [1, 0],
            }}
          />
        </Source>
      )}

      {/* Landmark pin — permanent name label under the pin (no click needed) */}
      {landmark && (
        <Marker longitude={landmark.lng} latitude={landmark.lat} anchor="bottom">
          <div style={{ position: "relative", width: 34, height: 34 }} role="img" aria-label={`Destination: ${landmark.name || "your landmark"}`}>
            <div
              style={{
                width: 34, height: 34, background: LANDMARK_COLOR, border: "3px solid white",
                borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 3px 10px ${LANDMARK_COLOR.replace(")", " / 0.45)")}`,
              }}
            >
              <PinIcon style={{ width: 16, height: 16, color: "white" }} />
            </div>
            <div
              style={{
                position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                marginTop: 4, whiteSpace: "nowrap", background: "white", color: "oklch(38% 0.1 60)",
                fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                boxShadow: "0 2px 6px oklch(25% 0.02 35 / 0.15)", border: `1px solid oklch(90% 0.06 60)`,
                fontFamily: "var(--font-body), sans-serif",
              }}
            >
              {landmark.name || "Destination"}
            </div>
          </div>
        </Marker>
      )}

      {/* Apartment pins */}
      {apartments.map((apt, index) => {
        const active = highlightedId === apt.id || selectedId === apt.id;
        const color = active ? RANK_HEX[index] ?? PRIMARY : "oklch(46% 0.014 35)";
        const size = active ? 30 : 24;
        return (
          <Marker
            key={apt.id}
            longitude={apt.longitude}
            latitude={apt.latitude}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent?.stopPropagation();
              selectApartment(apt, { flyTo: true });
            }}
          >
            <div
              onMouseEnter={() => onHighlight(apt.id)}
              onMouseLeave={() => onHighlight(null)}
              role="button"
              aria-label={`${RANK_LABELS[index] ?? `Option ${index + 1}`}: ${apt.address}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectApartment(apt, { flyTo: true });
                }
              }}
              style={{
                width: size, height: size, background: color, border: "2.5px solid white",
                borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)",
                boxShadow: "0 2px 8px oklch(25% 0.02 35 / 0.25)", transition: "all 0.15s ease", cursor: "pointer",
              }}
            />
          </Marker>
        );
      })}

      {/* Detail popup for the selected/best-pick apartment */}
      {selectedId && (() => {
        const index = apartments.findIndex((a) => a.id === selectedId);
        const apt = apartments[index];
        if (!apt) return null;
        return (
          <Popup
            longitude={apt.longitude}
            latitude={apt.latitude}
            anchor="bottom"
            offset={36}
            maxWidth="260px"
            onClose={() => { setSelectedId(null); setRoute(null); }}
          >
            <AptPopup apt={apt} index={index} landmark={landmark} />
          </Popup>
        );
      })()}
    </Map>
  );
}

function AptPopup({ apt, index, landmark }: { apt: Apartment; index: number; landmark?: LandmarkInfo | null }) {
  const rankLabel = RANK_LABELS[index] ?? `#${index + 1}`;
  const rankColor = RANK_HEX[index] ?? "oklch(46% 0.014 35)";
  const [photoFailed, setPhotoFailed] = useState(false);
  // Real-time fallback: RentCast/Apify rarely have a listing photo, so fall back
  // to a Street View shot of the listing's own coordinates (see lib/photo.ts).
  const photo = apt.photos?.[0] ?? (photoFailed ? null : streetViewUrl(apt.latitude, apt.longitude));

  return (
    <div className="text-xs" style={{ fontFamily: "var(--font-body), sans-serif", padding: "10px 12px 12px" }}>
      {/* Photo */}
      {photo && (
        <div style={{ margin: "-10px -12px 8px", overflow: "hidden", borderRadius: "18px 18px 0 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt="Listing"
            style={{ width: "100%", height: "120px", objectFit: "cover", display: "block" }}
            onError={() => setPhotoFailed(true)}
          />
        </div>
      )}

      {/* Rank badge */}
      <div style={{ marginBottom: "6px" }}>
        <span style={{
          display: "inline-block",
          background: rankColor,
          color: "white",
          fontSize: "10px",
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: "20px",
        }}>
          {rankLabel}
        </span>
      </div>

      {/* Name / description */}
      <p style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: 700, color: "oklch(18% 0.01 35)", marginBottom: "2px", lineHeight: "1.3" }}>
        {apt.agent_description}
      </p>

      {/* Address */}
      <p style={{ color: "oklch(46% 0.014 35)", marginBottom: "4px", lineHeight: "1.3" }}>
        {apt.address}
      </p>

      {/* Price */}
      <p style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: 700, color: "oklch(50% 0.165 32)", fontSize: "13px", marginBottom: "4px" }}>
        ${apt.monthly_price.toLocaleString()}/mo
      </p>

      {/* Commute */}
      {apt.commute && (
        <p style={{ color: "oklch(46% 0.014 35)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
          <ClockIcon style={{ width: 12, height: 12, flexShrink: 0 }} />
          {apt.commute.duration_text} · {apt.commute.distance_text}
        </p>
      )}

      {/* Actions: view listing + directions (P3-1, P3-2) */}
      <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
        {apt.listing_url && (
          <a
            href={apt.listing_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              textAlign: "center", fontSize: "10.5px", fontWeight: 600,
              padding: "5px 6px", borderRadius: "10px", background: "oklch(95.5% 0.008 35)",
              color: "oklch(38% 0.013 35)", textDecoration: "none",
            }}
          >
            <ExternalLinkIcon style={{ width: 11, height: 11, flexShrink: 0 }} />
            {listingButtonLabel(apt.listing_source)}
          </a>
        )}
        {landmark && (
          <a
            href={directionsUrl(apt, landmark)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              textAlign: "center", fontSize: "10.5px", fontWeight: 600,
              padding: "5px 6px", borderRadius: "10px", background: "oklch(94% 0.035 32)",
              color: "oklch(42% 0.145 32)", textDecoration: "none",
            }}
          >
            <RouteIcon style={{ width: 11, height: 11, flexShrink: 0 }} />
            Directions
          </a>
        )}
      </div>
    </div>
  );
}
