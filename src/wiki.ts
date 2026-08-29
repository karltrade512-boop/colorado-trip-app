import {
  bundleImage,
  commonsSearchQueries,
  isRecord,
  judgeFallPhoto,
  matchingFallWebcam,
  str,
  type FallPhotoInput,
  type WebcamHint,
} from "./bundle";

const PHOTO_CACHE = "colorado-place-photos-v2";
const memory = new Map<string, PlacePhoto>();

export type PlacePhoto =
  | { kind: "commons" | "webcam" | "bundle"; imageUrl: string; credit: string }
  | { kind: "none" };

type SearchHit = { title: string };
type ImageInfo = {
  url?: string;
  thumburl?: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
};
type QueryPage = {
  title?: string;
  imageinfo?: ImageInfo[];
  categories?: Array<{ title?: string }>;
};

function metaVal(info: ImageInfo | undefined, key: string): string | undefined {
  return str(info?.extmetadata?.[key]?.value)?.replace(/<[^>]+>/g, " ");
}

function fallInputFromCommons(page: QueryPage): { url?: string; input: FallPhotoInput } {
  const info = page.imageinfo?.[0];
  const cats = (page.categories ?? []).map((c) => (c.title ?? "").replace(/^Category:/, "")).join("; ");
  return {
    url: str(info?.thumburl) ?? str(info?.url),
    input: {
      dateText: metaVal(info, "DateTimeOriginal") ?? metaVal(info, "DateTime") ?? metaVal(info, "DateTimeMetadata"),
      title: page.title ?? metaVal(info, "ObjectName"),
      description: metaVal(info, "ImageDescription"),
      categories: [cats, metaVal(info, "Categories")].filter(Boolean).join("; "),
    },
  };
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
    /* cache miss is fine */
  }
}

async function commonsSearch(query: string): Promise<string[]> {
  const url =
    "https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&list=search" +
    `&srnamespace=6&srlimit=5&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) return [];
  const json = (await res.json()) as { query?: { search?: SearchHit[] } };
  return (json.query?.search ?? []).map((h) => h.title).filter(Boolean);
}

async function commonsFile(title: string): Promise<QueryPage | undefined> {
  const url =
    "https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&prop=imageinfo|categories" +
    "&iiprop=url|extmetadata&iiurlwidth=800&cllimit=20&titles=" +
    encodeURIComponent(title);
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { query?: { pages?: Record<string, QueryPage> } };
  const pages = json.query?.pages;
  if (!pages) return undefined;
  return Object.values(pages)[0];
}

async function firstFallCommons(name: string, area?: string): Promise<PlacePhoto | null> {
  const seen = new Set<string>();
  for (const q of commonsSearchQueries(name, area)) {
    let titles: string[] = [];
    try {
      titles = await commonsSearch(q);
    } catch {
      continue;
    }
    for (const title of titles) {
      if (seen.has(title)) continue;
      seen.add(title);
      try {
        const page = await commonsFile(title);
        if (!page) continue;
        const { url, input } = fallInputFromCommons(page);
        if (!url) continue;
        const verdict = judgeFallPhoto(input);
        if (!verdict.ok) continue;
        return { kind: "commons", imageUrl: url, credit: `Commons, ${verdict.why}` };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function lookupPlacePhoto(
  name: string,
  area: string | undefined,
  raw: Record<string, unknown>,
  webcams: WebcamHint[] = [],
): Promise<PlacePhoto> {
  const bundled = bundleImage(raw);
  if (bundled) {
    const verdict = judgeFallPhoto({
      title: bundled.label,
      description: bundled.url,
      dateText: str(isRecord(raw.image) ? raw.image.date ?? raw.image.taken : undefined),
    });
    if (verdict.ok) {
      return { kind: "bundle", imageUrl: bundled.url, credit: `${bundled.label} · ${verdict.why}` };
    }
  }
  const cached = await cachedPhoto(name);
  if (cached) return cached;
  const cam = matchingFallWebcam(
    {
      name,
      area,
      trailhead: str(raw.trailhead),
      extra: isRecord(raw.alltrails) ? str(raw.alltrails.name) : undefined,
    },
    webcams,
  );
  if (cam) {
    const photo: PlacePhoto = {
      kind: "webcam",
      imageUrl: cam.url,
      credit: `RMNP webcam · ${cam.name} · live/recent still`,
    };
    await remember(name, photo);
    return photo;
  }
  const commons = await firstFallCommons(name, area);
  if (commons) {
    await remember(name, commons);
    return commons;
  }
  const none: PlacePhoto = { kind: "none" };
  await remember(name, none);
  return none;
}

export async function hydratePlacePhotos(
  root: ParentNode = document,
  webcams: WebcamHint[] = [],
): Promise<void> {
  const slots = [...root.querySelectorAll<HTMLElement>(".place-photo.waiting")];
  for (const slot of slots) {
    const name = slot.dataset.photoName;
    if (!name) continue;
    const extra = slot.dataset.photoExtra;
    const photo = await lookupPlacePhoto(
      name,
      slot.dataset.photoArea || undefined,
      {
        trailhead: slot.dataset.photoTrail,
        alltrails: extra ? { name: extra } : undefined,
      },
      webcams,
    );
    slot.classList.remove("waiting");
    if (photo.kind === "none") {
      slot.classList.add("none");
      const p = document.createElement("p");
      p.className = "whisper";
      p.textContent = "No fall photo in this bundle";
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
