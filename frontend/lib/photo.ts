// Real-time photo fallback: RentCast never provides listing photos, and Apify
// only has one for some Zillow-sourced listings. Every listing does carry
// lat/lng though, so we can always fall back to a Street View shot of that
// exact point via the backend's proxy (api/server.py's /api/photo — server-side
// so GOOGLE_MAPS_API_KEY never reaches the browser).
export function streetViewUrl(lat: number, lng: number): string {
  return `/api/photo?lat=${lat}&lng=${lng}`;
}
