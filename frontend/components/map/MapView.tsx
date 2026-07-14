"use client";
import { useEffect, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { Apartment, LandmarkInfo } from "@/lib/types";

// Fix default icon paths broken by webpack
delete (L.Icon.Default.prototype as { _getIconUrl?: () => void })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const RANK_LABELS = ["Best Pick", "Runner-up", "3rd Choice", "4th Choice", "5th Choice"];
const RANK_COLORS = ["#1A56DB", "#374151", "#0EA5E9", "#6B7280", "#9CA3AF"];
const RANK_BG = ["#1A56DB", "#374151", "#0EA5E9", "#6B7280", "#9CA3AF"];

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

function makeAptIcon(index: number, highlighted: boolean) {
  const color = highlighted ? RANK_BG[index] ?? "#1A56DB" : "#6B7280";
  const size = highlighted ? 30 : 24;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;background:${color};border:2.5px solid white;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      transition:all 0.15s ease;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

const landmarkIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:34px;height:34px;background:#F59E0B;border:3px solid white;
    border-radius:50%;display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 10px rgba(245,158,11,0.5);
    font-size:16px;line-height:1;
  ">⭐</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -20],
});

function FitBounds({ apartments, landmark }: { apartments: Apartment[]; landmark?: LandmarkInfo | null }) {
  const map = useMap();
  useEffect(() => {
    const points: L.LatLngTuple[] = apartments.map((a) => [a.latitude, a.longitude]);
    if (landmark) points.push([landmark.lat, landmark.lng]);
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [apartments, landmark, map]);
  return null;
}

interface RouteState {
  aptId: string;
  points: [number, number][];
  loading: boolean;
}

interface Props {
  apartments: Apartment[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  landmark?: LandmarkInfo | null;
}

export function MapView({ apartments, highlightedId, onHighlight, landmark }: Props) {
  const [route, setRoute] = useState<RouteState | null>(null);

  const fetchRoute = useCallback(async (apt: Apartment) => {
    if (!landmark) return;
    setRoute({ aptId: apt.id, points: [], loading: true });
    try {
      const res = await fetch(
        `/api/directions?origin=${apt.latitude},${apt.longitude}&destination=${landmark.lat},${landmark.lng}`
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

  if (apartments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-2xl border border-gray-100">
        <p className="text-sm text-muted">No apartments to display</p>
      </div>
    );
  }

  const center: [number, number] = [apartments[0].latitude, apartments[0].longitude];

  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds apartments={apartments} landmark={landmark} />

      {/* Landmark pin */}
      {landmark && (
        <Marker position={[landmark.lat, landmark.lng]} icon={landmarkIcon}>
          <Popup>
            <div className="text-xs font-semibold text-amber-600">{landmark.name || "Destination"}</div>
          </Popup>
        </Marker>
      )}

      {/* Route polyline */}
      {route && route.points.length >= 2 && (
        <Polyline
          positions={route.points}
          pathOptions={{
            color: "#1A56DB",
            weight: 4,
            opacity: 0.75,
            dashArray: route.loading ? "8 8" : undefined,
          }}
        />
      )}

      {/* Apartment pins */}
      {apartments.map((apt, index) => (
        <Marker
          key={apt.id}
          position={[apt.latitude, apt.longitude]}
          icon={makeAptIcon(index, highlightedId === apt.id)}
          eventHandlers={{
            mouseover: () => onHighlight(apt.id),
            mouseout: () => onHighlight(null),
            popupopen: () => fetchRoute(apt),
            popupclose: () => {
              setRoute(null);
              onHighlight(null);
            },
          }}
        >
          <Popup minWidth={200} maxWidth={260}>
            <AptPopup apt={apt} index={index} landmark={landmark} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function AptPopup({ apt, index, landmark }: { apt: Apartment; index: number; landmark?: LandmarkInfo | null }) {
  const rankLabel = RANK_LABELS[index] ?? `#${index + 1}`;
  const rankColor = RANK_COLORS[index] ?? "#6B7280";

  return (
    <div className="text-xs" style={{ fontFamily: "inherit" }}>
      {/* Photo */}
      {apt.photos && apt.photos.length > 0 && (
        <div style={{ margin: "-8px -12px 8px", overflow: "hidden", borderRadius: "6px 6px 0 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={apt.photos[0]}
            alt="Listing"
            style={{ width: "100%", height: "120px", objectFit: "cover", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
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
      <p style={{ fontWeight: 600, color: "#111827", marginBottom: "2px", lineHeight: "1.3" }}>
        {apt.agent_description}
      </p>

      {/* Address */}
      <p style={{ color: "#6B7280", marginBottom: "4px", lineHeight: "1.3" }}>
        {apt.address}
      </p>

      {/* Price */}
      <p style={{ fontWeight: 700, color: "#1A56DB", fontSize: "13px", marginBottom: "4px" }}>
        ${apt.monthly_price.toLocaleString()}/mo
      </p>

      {/* Commute */}
      {apt.commute && (
        <p style={{ color: "#6B7280", marginBottom: "6px" }}>
          🚗 {apt.commute.duration_text} · {apt.commute.distance_text}
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
              flex: 1, textAlign: "center", fontSize: "10.5px", fontWeight: 600,
              padding: "5px 6px", borderRadius: "8px", background: "#F3F4F6",
              color: "#374151", textDecoration: "none",
            }}
          >
            {listingButtonLabel(apt.listing_source)}
          </a>
        )}
        {landmark && (
          <a
            href={directionsUrl(apt, landmark)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1, textAlign: "center", fontSize: "10.5px", fontWeight: 600,
              padding: "5px 6px", borderRadius: "8px", background: "#DBEAFE",
              color: "#1A56DB", textDecoration: "none",
            }}
          >
            Directions
          </a>
        )}
      </div>
    </div>
  );
}
