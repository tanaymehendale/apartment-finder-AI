"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { Apartment } from "@/lib/types";

// Fix default icon paths broken by webpack
delete (L.Icon.Default.prototype as { _getIconUrl?: () => void })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const highlightIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width:28px;height:28px;background:#1A56DB;border:3px solid white;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(26,86,219,0.5);
    "></div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
});

const defaultIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width:22px;height:22px;background:#6B7280;border:2.5px solid white;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      box-shadow:0 2px 6px rgba(0,0,0,0.2);
    "></div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

function FitBounds({ apartments }: { apartments: Apartment[] }) {
  const map = useMap();
  useEffect(() => {
    if (apartments.length === 0) return;
    const bounds = L.latLngBounds(
      apartments.map((a) => [a.latitude, a.longitude] as L.LatLngTuple)
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [apartments, map]);
  return null;
}

interface Props {
  apartments: Apartment[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
}

export function MapView({ apartments, highlightedId, onHighlight }: Props) {
  if (apartments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 rounded-2xl border border-gray-100">
        <p className="text-sm text-muted">No apartments to display</p>
      </div>
    );
  }

  const center: [number, number] = [
    apartments[0].latitude,
    apartments[0].longitude,
  ];

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
      <FitBounds apartments={apartments} />
      {apartments.map((apt) => (
        <Marker
          key={apt.id}
          position={[apt.latitude, apt.longitude]}
          icon={highlightedId === apt.id ? highlightIcon : defaultIcon}
          eventHandlers={{
            mouseover: () => onHighlight(apt.id),
            mouseout: () => onHighlight(null),
          }}
        >
          <Popup>
            <div className="text-xs">
              <p className="font-semibold text-gray-900 mb-0.5">{apt.address}</p>
              <p className="text-primary font-bold">${apt.monthly_price.toLocaleString()}/mo</p>
              {apt.commute && (
                <p className="text-gray-500 mt-0.5">{apt.commute.duration_text} commute</p>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
