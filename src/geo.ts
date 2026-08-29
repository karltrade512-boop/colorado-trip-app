export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function mapsUrl(lat: number, lon: number, label?: string): string {
  const q = label ? encodeURIComponent(label) : `${lat},${lon}`;
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (ios) return `https://maps.apple.com/?daddr=${lat},${lon}&q=${q}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export function mapsSearchUrl(query: string): string {
  const q = encodeURIComponent(query);
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (ios) return `https://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}
