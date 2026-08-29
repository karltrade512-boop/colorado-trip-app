import { bundleImage, str, wikiTitleCandidates } from "./bundle";

const PHOTO_CACHE = "colorado-place-photos-v1";
const memory = new Map<string, PlacePhoto>();

export type PlacePhoto =
  | { kind: "bundle"; imageUrl: string; credit: string }
  | { kind: "wiki"; imageUrl: string; credit: string }
  | { kind: "none" };

type WikiSummary = {
  type?: string;
  title?: string;
  thumbnail?: { source?: string };
};

function summaryUrl(title: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function openPhotoCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(PHOTO_CACHE);
  } catch {
    return null;
  }
}

async function cachedPhoto(key: string): Promise<PlacePhoto | undefined> {
  const hit = memory.get(key);
  if (hit) return hit;
  const cache = await openPhotoCache();
  if (!cache) return undefined;
  const res = await cache.match(`https://place-photo.local/meta/${encodeURIComponent(key)}`);
  if (!res) return undefined;
  try {
    const json = (await res.json()) as PlacePhoto;
    memory.set(key, json);
    return json;
  } catch {
    return undefined;
  }
}

async function remember(key: string, photo: PlacePhoto): Promise<void> {
  memory.set(key, photo);
  const cache = await openPhotoCache();
  if (!cache) return;
  try {
    await cache.put(
      `https://place-photo.local/meta/${encodeURIComponent(key)}`,
      new Response(JSON.stringify(photo), { headers: { "Content-Type": "application/json" } }),
    );
    if (photo.kind !== "none") {
      const img = await fetch(photo.imageUrl, { mode: "cors" });
      if (img.ok) await cache.put(photo.imageUrl, img);
    }
  } catch {
    /* cache miss is fine; next online fetch can retry */
  }
}

async function fetchSummary(title: string): Promise<PlacePhoto | null> {
  try {
    const res = await fetch(summaryUrl(title), { mode: "cors" });
    if (!res.ok) return null;
    const json = (await res.json()) as WikiSummary;
    if (json.type === "disambiguation") return null;
    const imageUrl = str(json.thumbnail?.source);
    if (!imageUrl) return null;
    const page = str(json.title) ?? title;
    return { kind: "wiki", imageUrl, credit: `Wikipedia / Wikimedia · ${page}` };
  } catch {
    return null;
  }
}

export async function lookupPlacePhoto(name: string, area: string | undefined, raw: Record<string, unknown>): Promise<PlacePhoto> {
  const bundled = bundleImage(raw);
  if (bundled) {
    const photo: PlacePhoto = { kind: "bundle", imageUrl: bundled.url, credit: bundled.label };
    memory.set(name, photo);
    return photo;
  }
  const cached = await cachedPhoto(name);
  if (cached) return cached;
  for (const title of wikiTitleCandidates(name, area)) {
    const hit = await fetchSummary(title);
    if (hit) {
      await remember(name, hit);
      return hit;
    }
  }
  const none: PlacePhoto = { kind: "none" };
  await remember(name, none);
  return none;
}

export async function hydratePlacePhotos(root: ParentNode = document): Promise<void> {
  const slots = [...root.querySelectorAll<HTMLElement>(".place-photo.waiting")];
  for (const slot of slots) {
    const name = slot.dataset.photoName;
    if (!name) continue;
    const photo = await lookupPlacePhoto(name, slot.dataset.photoArea || undefined, {});
    slot.classList.remove("waiting");
    if (photo.kind === "none") {
      slot.classList.add("none");
      const p = document.createElement("p");
      p.className = "whisper";
      p.textContent = "No photo in this bundle";
      slot.replaceChildren(p);
      continue;
    }
    const img = document.createElement("img");
    img.src = photo.imageUrl;
    img.alt = name;
    const cap = document.createElement("figcaption");
    cap.textContent = photo.credit;
    slot.replaceChildren(img, cap);
  }
}
