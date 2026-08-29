import type { LiveResult, TripBundle, UnverifiedExtra } from "./types";
import { collection, isRecord, str, urlsIn } from "./bundle";

export function bundleLiveTargets(bundle: TripBundle): Array<{ url: string; label: string; kind: "webcam" | "gate" }> {
  const out: Array<{ url: string; label: string; kind: "webcam" | "gate" }> = [];
  urlsIn(collection(bundle, "webcams"), out, "webcam");
  urlsIn(collection(bundle, "gates"), out, "gate");
  urlsIn(bundle.webcams, out, "webcam");
  urlsIn(bundle.gates, out, "gate");
  urlsIn(bundle.gate, out, "gate");
  urlsIn(bundle.brainard, out, "gate");
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
}

export async function fetchLive(target: { url: string; label: string; kind: "webcam" | "gate" }): Promise<LiveResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(target.url, { mode: "cors", cache: "no-store" });
    if (!res.ok) {
      return {
        url: target.url,
        ok: false,
        fetchedAt,
        status: res.status,
        error: `HTTP ${res.status} — fetch failed. Not interpreted as closed or “no color”.`,
        kind: target.kind,
        label: target.label,
      };
    }
    return {
      url: target.url,
      ok: true,
      fetchedAt,
      status: res.status,
      kind: target.kind,
      label: target.label,
    };
  } catch (err) {
    return {
      url: target.url,
      ok: false,
      fetchedAt,
      error: `${err instanceof Error ? err.message : "network error"} — fetch failed. Not interpreted as closed or “no color”.`,
      kind: target.kind,
      label: target.label,
    };
  }
}

const OVERPASS = "https://overpass-api.de/api/interpreter";

export function osmExtraExcluded(tags: Record<string, unknown>): boolean {
  const amenity = str(tags.amenity)?.toLowerCase();
  return amenity === "fuel" || amenity === "charging_station";
}

export async function fetchUnverifiedExtras(lat: number, lon: number): Promise<UnverifiedExtra[]> {
  const q = `
[out:json][timeout:20];
(
  node["tourism"="viewpoint"](around:8000,${lat},${lon});
  node["scenic"="yes"](around:8000,${lat},${lon});
  node["tourism"="picnic_site"](around:8000,${lat},${lon});
  node["leisure"="wildlife_hide"](around:8000,${lat},${lon});
  node["leisure"="bird_hide"](around:8000,${lat},${lon});
  node["highway"="rest_area"](around:8000,${lat},${lon});
  node["parking"="layby"](around:8000,${lat},${lon});
  node["natural"="peak"]["tourism"](around:8000,${lat},${lon});
  way["tourism"="viewpoint"](around:8000,${lat},${lon});
);
out center 30;
`.trim();
  const res = await fetch(OVERPASS, {
    method: "POST",
    body: `data=${encodeURIComponent(q)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json: unknown = await res.json();
  const elements = isRecord(json) && Array.isArray(json.elements) ? json.elements : [];
  const extras: UnverifiedExtra[] = [];
  for (const el of elements) {
    if (!isRecord(el)) continue;
    const tags = isRecord(el.tags) ? el.tags : {};
    const plat = numish(el.lat) ?? (isRecord(el.center) ? numish(el.center.lat) : undefined);
    const plon = numish(el.lon) ?? (isRecord(el.center) ? numish(el.center.lon) : undefined);
    if (plat === undefined || plon === undefined) continue;
    if (osmExtraExcluded(tags)) continue;
    const name = str(tags.name) ?? str(tags.tourism) ?? str(tags.leisure) ?? "unnamed OSM feature";
    const kind =
      str(tags.tourism) ??
      str(tags.leisure) ??
      str(tags.highway) ??
      str(tags.parking) ??
      str(tags.amenity) ??
      (str(tags.scenic) ? "overlook" : "osm");
    extras.push({
      id: `osm-${String(el.type)}-${String(el.id)}`,
      name,
      lat: plat,
      lon: plon,
      kind,
      unverified: true,
    });
  }
  return extras;
}

function numish(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}
