import type { Day, NamedItem, Place, Run, TripBundle } from "./types";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isRecord(v)) {
    return Object.entries(v).map(([id, val]) =>
      isRecord(val) ? { id, ...val } : { id, value: val },
    );
  }
  return [];
}

export function pick(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

export function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

export function placesList(bundle: TripBundle): Place[] {
  return asArray(bundle.places).map((p, i) => {
    const r = isRecord(p) ? p : {};
    return {
      ...r,
      id: str(r.id) ?? `place-${i}`,
      name: str(r.name) ?? str(r.id) ?? `place-${i}`,
      lat: num(r.lat) ?? null,
      lon: num(r.lon) ?? num(r.lng) ?? null,
    } as Place;
  });
}

export function placeById(bundle: TripBundle, id: string | null | undefined): Place | undefined {
  if (!id) return undefined;
  return placesList(bundle).find((p) => p.id === id || slug(p.name) === slug(id));
}

export function daysList(bundle: TripBundle): Day[] {
  return asArray(bundle.days)
    .filter(isRecord)
    .map((d) => d as unknown as Day)
    .filter((d) => typeof d.date === "string");
}

export function runsList(bundle: TripBundle): Array<Run & { id: string }> {
  return asArray(bundle.runs).map((r, i) => {
    const rec = isRecord(r) ? r : {};
    return { id: str(rec.id) ?? `run-${i}`, ...(rec as Run) };
  });
}

export function todayIso(timeZone?: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function pickDay(bundle: TripBundle, date: string): Day | undefined {
  return daysList(bundle).find((d) => d.date === date);
}

export function defaultCabinFromDay(day: { base?: string | null } | undefined): "drake" | "nederland" {
  if (day?.base === "nederland") return "nederland";
  return "drake";
}

export function nextOrToday(bundle: TripBundle, nowIso: string): { day?: Day; status: "today" | "before" | "after" | "gap" } {
  const days = daysList(bundle).slice().sort((a, b) => a.date.localeCompare(b.date));
  const hit = days.find((d) => d.date === nowIso);
  if (hit) return { day: hit, status: "today" };
  const first = days[0];
  const last = days[days.length - 1];
  if (first && nowIso < first.date) return { day: first, status: "before" };
  if (last && nowIso > last.date) return { day: last, status: "after" };
  const upcoming = days.find((d) => d.date > nowIso);
  return { day: upcoming, status: "gap" };
}

function slug(s: string | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const COLLECTION_KEYS: Record<string, string[]> = {
  hikes: ["hikes", "trails", "walks", "hike_options", "trail_options"],
  food: ["food", "restaurants", "eats", "meals", "dining"],
  photo: ["photo_ops", "hotspots", "photos", "subjects_sites", "picture_spots", "viewpoints"],
  foliage: ["foliage", "fall_color", "color", "leaf_color"],
  gates: ["gates", "gate", "brainard", "brainard_gate"],
  webcams: ["webcams", "cams", "cameras"],
  gaps: ["gaps", "known_gaps", "open_items", "unbooked", "missing"],
  decisions: ["open_decisions", "decisions", "open_calls", "calls"],
  stops: ["stops", "route_stops", "waypoints"],
  gotchas: ["gotchas", "permits", "dog_rules", "alerts", "cautions"],
  land_rules: ["land_rules", "rules"],
  behaviour: ["behaviour", "behavior"],
};

export function collection(bundle: TripBundle, kind: keyof typeof COLLECTION_KEYS): unknown {
  const fromRoot = pick(bundle, COLLECTION_KEYS[kind]);
  if (fromRoot !== undefined) return fromRoot;
  const trip = bundle.trip;
  if (isRecord(trip)) {
    const fromTrip = pick(trip, COLLECTION_KEYS[kind]);
    if (fromTrip !== undefined) return fromTrip;
  }
  return undefined;
}

export function collectionItems(bundle: TripBundle, kind: keyof typeof COLLECTION_KEYS, prefix: string): NamedItem[] {
  const v = collection(bundle, kind);
  if (v === undefined) return [];
  if (Array.isArray(v)) return namedItems(v, prefix);
  if (isRecord(v)) {
    if (Array.isArray(v.items)) return namedItems(v.items, prefix);
    if (Array.isArray(v.places)) return namedItems(v.places, prefix);
    if (Array.isArray(v.hikes)) return namedItems(v.hikes, prefix);
  }
  return namedItems(v, prefix);
}

export function collectionNote(bundle: TripBundle, kind: keyof typeof COLLECTION_KEYS): string | undefined {
  const v = collection(bundle, kind);
  if (isRecord(v)) return str(v.note);
  return undefined;
}

export function namedItems(v: unknown, fallbackPrefix: string): NamedItem[] {
  if (v === undefined) return [];
  return asArray(v).map((item, i) => {
    if (typeof item === "string" && item.trim()) {
      return { id: `${fallbackPrefix}-${i}`, name: item.trim(), raw: { value: item } };
    }
    const rec = isRecord(item) ? item : { value: item };
    const name =
      str(rec.name) ??
      str(rec.title) ??
      str(rec.label) ??
      str(rec.trail) ??
      str(rec.place) ??
      str(rec.value) ??
      `${fallbackPrefix} ${i + 1}`;
    const id = str(rec.id) ?? `${fallbackPrefix}-${i}`;
    return { id, name, raw: rec };
  });
}

export function itemLatLon(raw: Record<string, unknown>): { lat: number; lon: number } | undefined {
  const lat =
    num(raw.lat) ??
    num(raw.latitude) ??
    (isRecord(raw.coords) ? num(raw.coords.lat) : undefined) ??
    (isRecord(raw.location) ? num(raw.location.lat) : undefined);
  const lon =
    num(raw.lon) ??
    num(raw.lng) ??
    num(raw.longitude) ??
    (isRecord(raw.coords) ? num(raw.coords.lon) ?? num(raw.coords.lng) : undefined) ??
    (isRecord(raw.location) ? num(raw.location.lon) ?? num(raw.location.lng) : undefined);
  if (lat === undefined || lon === undefined) return undefined;
  return { lat, lon };
}

/** Dogs: unknown stays unknown. Banned ≠ unknown ≠ fine. */
export type DogStatus = "banned" | "ok" | "unknown";

export function dogStatus(raw: Record<string, unknown>): DogStatus {
  const keys = ["dogs", "dog_rule", "dogs_allowed", "dog", "pets", "pets_allowed"];
  let found: unknown;
  for (const k of keys) {
    if (k in raw) {
      found = raw[k];
      break;
    }
  }
  if (found === undefined) return "unknown";
  if (found === null) return "unknown";
  if (found === false) return "banned";
  if (found === true) return "ok";
  const s = String(found).toLowerCase();
  if (!s || s === "unknown" || s === "unconfirmed" || s === "n/a" || s === "null") return "unknown";
  if (["no", "banned", "prohibited", "not allowed", "forbidden"].some((w) => s.includes(w))) return "banned";
  if (["yes", "allowed", "leash", "ok", "fine", "permitted"].some((w) => s.includes(w))) return "ok";
  return "unknown";
}

export type DietPrint = {
  gf: string;
  df: string;
  gfQuote?: string;
  dfQuote?: string;
  gfSource?: string;
  dfSource?: string;
};

export function gfDf(raw: Record<string, unknown>): DietPrint {
  const gf = formatDiet(pick(raw, ["gf", "gluten_free", "gluten-free", "GF"]), "GF");
  const df = formatDiet(pick(raw, ["df", "dairy_free", "dairy-free", "DF"]), "DF");
  return {
    gf: gf.line,
    df: df.line,
    gfQuote: gf.quote,
    dfQuote: df.quote,
    gfSource: gf.sourceUrl,
    dfSource: df.sourceUrl,
  };
}

function nonUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return undefined;
  return v;
}

function formatDiet(v: unknown, label: string): { line: string; quote?: string; sourceUrl?: string } {
  if (v === undefined || v === null || v === "") return { line: `${label}: unknown` };
  if (typeof v === "boolean") return { line: v ? `${label}: tagged` : `${label}: not tagged` };
  if (isRecord(v)) {
    const status = str(v.status) ?? str(v.value) ?? str(v.level) ?? str(v.tag) ?? "unknown";
    const confidence = nonUrl(str(v.confidence));
    const sourceLabel = nonUrl(str(v.source) ?? str(v.from) ?? str(v.kind));
    const paren = confidence ?? sourceLabel;
    const quote = str(v.quote);
    const sourceUrl = str(v.source);
    return {
      line: paren ? `${label}: ${status} (${paren})` : `${label}: ${status}`,
      quote,
      sourceUrl: sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined,
    };
  }
  return { line: `${label}: ${String(v)}` };
}

export function peekMilesLines(raw: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (isRecord(raw.alltrails)) {
    const rt = num(raw.alltrails.round_trip_mi);
    if (rt !== undefined) lines.push(`AllTrails: ${rt} mi round trip`);
  }
  if (isRecord(raw.agency)) {
    const ow = num(raw.agency.one_way_mi);
    if (ow !== undefined) lines.push(`agency: ${ow} mi one way`);
  }
  return lines;
}

export function sheetMilesLines(raw: Record<string, unknown>): string[] {
  const lines = peekMilesLines(raw);
  if (raw.each_way_mi !== undefined && raw.each_way_mi !== null && raw.each_way_mi !== "") {
    lines.push(`each way: ${String(raw.each_way_mi)} mi (derived)`);
  }
  return lines;
}

export function foodAreaServes(bundle: TripBundle, placeArea: string | undefined): string[] {
  if (!placeArea) return [];
  const food = collection(bundle, "food");
  if (isRecord(food) && isRecord(food.areas)) {
    const block = food.areas[placeArea];
    if (isRecord(block) && Array.isArray(block.serves)) return block.serves.map(String);
  }
  return [placeArea];
}

export type PlaceCardSections = {
  about: string[];
  why: string[];
  lookOut: string[];
  around: string[];
  details: string[];
};

export function bundleImage(raw: Record<string, unknown>): { url: string; label: string } | undefined {
  const asUrl = (v: unknown): string | undefined => {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) {
      if (/\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(v) || /\/wikipedia\/commons\//i.test(v)) return v;
    }
    if (isRecord(v)) return asUrl(v.url) ?? asUrl(v.href) ?? asUrl(v.src) ?? asUrl(v.image);
    return undefined;
  };
  for (const k of ["image", "photo", "thumbnail", "img", "image_url", "photo_url"]) {
    const url = asUrl(raw[k]);
    if (!url) continue;
    const rec = isRecord(raw[k]) ? raw[k] : undefined;
    const label = rec ? str(rec.source) ?? str(rec.credit) ?? str(rec.label) ?? k : k;
    return { url, label };
  }
  return undefined;
}

export type FallPhotoInput = {
  dateText?: string;
  title?: string;
  description?: string;
  categories?: string;
};

export type FallPhotoVerdict = { ok: true; why: string } | { ok: false; why: string };

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parsePhotoMonthYear(text: string | undefined): { month: number; year?: number } | undefined {
  if (!text) return undefined;
  const iso = text.match(/(\d{4})[-:](\d{2})[-:](\d{2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
  const named = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b\.?\s+(\d{4})/i);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (month) return { month, year: Number(named[2]) };
  }
  const named2 = text.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b\.?\s+(\d{4})/i);
  if (named2) {
    const month = MONTHS[named2[2].toLowerCase()];
    if (month) return { month, year: Number(named2[3]) };
  }
  return undefined;
}

export const NO_FALL_PHOTO_LABEL = "No fall photo in this bundle";

/** Season tags only. "Fall River" is a place name, not autumn. Bare "gold" is not enough. */
export function fallPhotoTextSignals(text: string): { fallTagged: boolean; aspenGold: boolean; winterish: boolean } {
  const fallTagged =
    /\b(autumn|foliage|aspen)\b/i.test(text) ||
    /\bfall\b(?!\s+river)/i.test(text) ||
    /\bgold(?:en)?\s+(aspen|leaves|larch|colou?rs?|foliage)\b/i.test(text) ||
    /\b(aspen|leaves|larch|colou?rs?|foliage)\s+gold(?:en)?\b/i.test(text);
  const aspenGold =
    (/\baspen\b/i.test(text) && /\b(gold|golden|autumn|foliage)\b/i.test(text)) ||
    (/\baspen\b/i.test(text) && /\bfall\b(?!\s+river)/i.test(text));
  const winterish = /\b(snow|ski(?:ing)?|ice|winter|blizzard|frozen)\b/i.test(text);
  return { fallTagged, aspenGold, winterish };
}

export function judgeFallPhoto(input: FallPhotoInput): FallPhotoVerdict {
  const text = [input.title, input.description, input.categories].filter(Boolean).join(" ");
  const { fallTagged, aspenGold, winterish } = fallPhotoTextSignals(text);
  const dt = parsePhotoMonthYear(input.dateText) ?? parsePhotoMonthYear(text);
  if (dt) {
    const stamp = `${MONTH_SHORT[dt.month]}${dt.year ? ` ${dt.year}` : ""}`;
    if (dt.month >= 1 && dt.month <= 4) {
      if (aspenGold) return { ok: true, why: `tagged aspen gold · ${stamp}` };
      return { ok: false, why: "winter/spring date" };
    }
    if (dt.month === 9 || dt.month === 10) {
      if (winterish && !fallTagged && !aspenGold) return { ok: false, why: "snow/winter in description" };
      return { ok: true, why: stamp };
    }
    if (fallTagged || aspenGold) {
      if (winterish && !aspenGold) return { ok: false, why: "winter tags" };
      return { ok: true, why: "tagged autumn" };
    }
    return { ok: false, why: "season not fall" };
  }
  if (winterish && !aspenGold) return { ok: false, why: "winter tags" };
  if (fallTagged || aspenGold) return { ok: true, why: "tagged autumn" };
  return { ok: false, why: "date unknown" };
}

export type WebcamHint = { name: string; url: string; note?: string };

export function matchingFallWebcam(
  place: { name: string; area?: string; trailhead?: string; extra?: string },
  cams: WebcamHint[],
): WebcamHint | undefined {
  const hay = [place.name, place.area, place.trailhead, place.extra].filter(Boolean).join(" ").toLowerCase();
  for (const cam of cams) {
    const n = cam.name.toLowerCase();
    if (n.includes("alpine visitor")) {
      if (/alpine visitor|trail ridge/.test(hay)) return cam;
      continue;
    }
    if (n.includes("glacier basin")) {
      if (/glacier basin|glacier gorge/.test(hay)) return cam;
      continue;
    }
    if (n.includes("longs peak")) {
      if (/longs peak/.test(hay)) return cam;
      continue;
    }
    if (n.includes("fall river")) {
      if (/fall river/.test(hay)) return cam;
      continue;
    }
    if (n.includes("beaver meadows")) {
      if (/beaver meadows/.test(hay)) return cam;
      continue;
    }
    if (n.includes("kawuneeche") || /harbison/i.test(cam.note ?? "")) {
      if (/kawuneeche|harbison/.test(hay)) return cam;
      continue;
    }
    if (n.includes("grand lake")) {
      if (/grand lake/.test(hay)) return cam;
    }
  }
  return undefined;
}

export function commonsSearchQueries(name: string, area?: string): string[] {
  const titles = wikiTitleCandidates(name, area).slice(0, 3);
  const q: string[] = [];
  for (const t of titles) {
    q.push(`"${t}" filetype:bitmap`);
    q.push(`${t} Colorado filetype:bitmap`);
  }
  return q.slice(0, 6);
}

const WEAK_PLACE = /^(lake|lakes|peak|peaks|mount|mountain|creek|river|trail|falls|pond|pass|ridge)$/i;

export function photoMentionsPlace(placeName: string, hay: string): boolean {
  const bare = placeName.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const tokens = bare.split(/\s+/).filter((t) => t.length >= 3 && !/^(the|and|via|for|from)$/i.test(t));
  const strong = tokens.filter((t) => !WEAK_PLACE.test(t));
  const blob = hay.toLowerCase();
  if (!strong.length) return blob.includes(bare.toLowerCase());
  return strong.every((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay));
}

const TRIP_AREA =
  /\b(brainard|indian peaks|rocky mountain|rmnp|wild basin|nederland|front range|roosevelt national|estes|allenspark|hessie|longs peak|glacier gorge|bear lake|pawnee|arapaho|jean lunning)\b/i;
const ELSEWHERE =
  /\b(minnesota|ontario|texas|oregon|california|florida|illinois|idaho|wisconsin|michigan|new zealand|croatia|san antonio|hennepin|huerfano|cuchara|audubon center|pioneer museum|umpqua|crater lake|mount cook|aoraki|kahurangi|humboldt)\b/i;
const GENERIC_LAKE = /^(blue lake|long lake|mitchell lake|diamond lake|columbine lake)$/i;

export function commonsCandidateOk(input: {
  mime?: string;
  title?: string;
  description?: string;
  categories?: string;
  placeName: string;
}): boolean {
  const mime = (input.mime ?? "").toLowerCase();
  const title = input.title ?? "";
  const description = input.description ?? "";
  const hay = `${title} ${description} ${input.categories ?? ""}`;
  if (!mime.startsWith("image/") || mime.includes("svg")) return false;
  if (/\.pdf$/i.test(title) || /\bpdf\b/i.test(title)) return false;
  if (/\b(trail[- ]map|just off the map|ecoregion|master plan|catalogue|catalog|HAER|atlas|DPLA)\b/i.test(hay)) return false;
  if (ELSEWHERE.test(hay) && !TRIP_AREA.test(hay)) return false;
  if (!photoMentionsPlace(input.placeName, title)) return false;
  const bare = input.placeName.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (GENERIC_LAKE.test(bare)) return TRIP_AREA.test(hay);
  return TRIP_AREA.test(hay) || /\bcolorado\b/i.test(hay);
}

export function wikiTitleCandidates(name: string, area?: string): string[] {
  const titles: string[] = [];
  const push = (t: string) => {
    const s = t.replace(/\s+/g, " ").trim();
    if (s && !titles.includes(s)) titles.push(s);
  };
  const bare = name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\/\s*.+$/, "")
    .replace(/\s*\+\s*.+$/, "")
    .trim();
  push(name);
  push(bare);
  push(`${bare} (Colorado)`);
  push(`${bare} Colorado`);
  if (area && /rmnp|rocky mountain|wild basin|glacier|bear lake|longs/i.test(area)) {
    push(`${bare} (Rocky Mountain National Park)`);
    push(`${bare}, Rocky Mountain National Park`);
  }
  if (area && /brainard|indian peaks/i.test(area)) {
    push(`${bare} (Indian Peaks)`);
    push(`${bare} Brainard`);
  }
  if (/hessie/i.test(name)) push("Lost Lake (Colorado)");
  if (/the loch/i.test(name)) push("The Loch (Rocky Mountain National Park)");
  return titles;
}

export type PlacePhotoDecision =
  | { kind: "bundle"; url: string; label: string; why: string }
  | { kind: "lookup" }
  | { kind: "none" };

/** Bundle URL is shown only if judgeFallPhoto passes. No Wikipedia thumb by itself. */
export function placePhotoDecision(raw: Record<string, unknown>, id: string): PlacePhotoDecision {
  const bundled = bundleImage(raw);
  if (bundled) {
    const rec = isRecord(raw.image) ? raw.image : isRecord(raw.photo) ? raw.photo : undefined;
    const verdict = judgeFallPhoto({
      title: bundled.label,
      description: [bundled.url, str(rec?.description)].filter(Boolean).join(" "),
      dateText: rec ? str(rec.datetime_original ?? rec.date ?? rec.taken) : undefined,
      categories: str(rec?.categories),
    });
    if (verdict.ok) return { kind: "bundle", url: bundled.url, label: bundled.label, why: verdict.why };
  }
  if (str(raw.trailhead) || isRecord(raw.alltrails) || id.startsWith("photo-")) return { kind: "lookup" };
  return { kind: "none" };
}

export function placeAbout(item: NamedItem): string[] {
  const raw = item.raw;
  const at = isRecord(raw.alltrails) ? raw.alltrails : undefined;
  const stats: string[] = [];
  const prose: string[] = [];
  pushLine(stats, areaOf(raw));
  pushLine(stats, str(raw.trailhead) ? `trailhead ${str(raw.trailhead)}` : undefined);
  if (at && str(at.difficulty)) pushLine(stats, `difficulty ${str(at.difficulty)}`);
  if (at && num(at.duration_min) !== undefined) pushLine(stats, `AllTrails duration ${num(at.duration_min)} min`);
  for (const g of gainLines(raw)) pushLine(stats, g);
  if (at && str(at.route_type)) pushLine(stats, `route ${str(at.route_type)}`);
  if (at && num(at.rating) !== undefined) pushLine(stats, `AllTrails rating ${num(at.rating)}`);
  pushLine(stats, str(raw.kind));
  pushLine(stats, str(raw.address));
  pushLine(prose, str(raw.note));
  pushLine(prose, str(raw.review_summary));
  pushLine(prose, str(raw.wildlife));
  pushLine(prose, str(raw.disagreement));
  if (!prose.length) pushLine(prose, "No writeup in this bundle.");
  return [...stats, ...prose];
}

function pushLine(lines: string[], v: string | undefined | null): void {
  const s = v != null ? String(v).trim() : "";
  if (s && !lines.includes(s)) lines.push(s);
}

export function dogPrint(raw: Record<string, unknown>): string {
  const rawDog = raw.dogs ?? raw.dog_rule ?? raw.dogs_allowed;
  if (typeof rawDog === "string" && rawDog.trim()) {
    const t = rawDog.trim();
    return /^dogs\b/i.test(t) ? t : `dogs ${t}`;
  }
  const st = dogStatus(raw);
  if (st === "ok") return "dogs allowed";
  if (st === "banned") return "dogs prohibited";
  return "dogs unknown";
}

export function placeCardSections(item: NamedItem, bundle: TripBundle): PlaceCardSections {
  const raw = item.raw;
  const at = isRecord(raw.alltrails) ? raw.alltrails : undefined;
  const agency = isRecord(raw.agency) ? raw.agency : undefined;
  const diet = gfDf(raw);
  const why: string[] = [];
  const lookOut: string[] = [];
  const details: string[] = [];

  pushLine(why, areaOf(raw));
  pushLine(why, str(raw.note));
  pushLine(why, str(raw.review_summary));
  pushLine(why, str(raw.wildlife));
  pushLine(why, str(raw.disagreement));
  pushLine(why, str(raw.correction));
  if (at && str(at.difficulty)) pushLine(why, `difficulty ${str(at.difficulty)}`);
  if (raw.each_way_mi !== undefined && raw.each_way_mi !== null && raw.each_way_mi !== "") {
    pushLine(why, `each way: ${String(raw.each_way_mi)} mi (derived)`);
  }

  if ("permit" in raw) pushLine(lookOut, permitPrint(raw));
  if ("dogs" in raw || "dog_rule" in raw || "dogs_allowed" in raw) pushLine(lookOut, dogPrint(raw));
  pushLine(lookOut, str(raw.access_risk));
  if (raw.behind_brainard_gate === true) {
    pushLine(lookOut, "Behind the Brainard gate.");
    const gw = gatewayFallback(bundle);
    if (gw) {
      const park = str(gw.park_at);
      const when = str(gw.when);
      pushLine(lookOut, [when, park ? `Park at ${park}` : undefined].filter(Boolean).join(" "));
    }
  } else if (raw.behind_brainard_gate === false) {
    pushLine(lookOut, "Not behind the Brainard gate.");
  }
  const area = areaOf(raw) ?? "";
  if (/rmnp|rocky mountain/i.test(area)) {
    for (const p of landPermits(bundle)) {
      if (!/rocky mountain|rmnp|timed/i.test(`${str(p.match) ?? ""} ${str(p.name) ?? ""}`)) continue;
      pushLine(lookOut, str(p.name) ?? str(p.match));
      if (Array.isArray(p.windows)) {
        for (const w of p.windows) {
          if (!isRecord(w)) continue;
          const label = str(w.label) ?? "window";
          const start = str(w.start) ?? "?";
          const end = str(w.end) ?? "?";
          const to = str(w.to) ?? "";
          pushLine(lookOut, `${label}: ${start}–${end}${to ? ` through ${to}` : ""}`);
        }
      }
    }
  }
  const nameLc = item.name.toLowerCase();
  for (const ex of landNamedExceptions(bundle)) {
    const match = str(ex.match) ?? str(ex.name);
    if (match && nameLc.includes(match.toLowerCase())) {
      pushLine(lookOut, `${match} · ${str(ex.dogs) ?? "named exception"}`);
    }
  }
  const foodMeta = collection(bundle, "food");
  const always = isRecord(foodMeta) ? str(foodMeta.always_print) : undefined;
  if (str(raw.address) || str(raw.kind) || diet.gfQuote || diet.dfQuote) {
    pushLine(lookOut, always);
  }
  if (diet.gfQuote) pushLine(lookOut, `GF: “${diet.gfQuote}”`);
  if (diet.dfQuote) pushLine(lookOut, `DF: “${diet.dfQuote}”`);

  if ((str(raw.trailhead) || isRecord(raw.alltrails)) && !itemLatLon(raw)) {
    pushLine(details, "no pin in this bundle");
  }
  pushLine(details, str(raw.trailhead) ? `trailhead ${str(raw.trailhead)}` : undefined);
  for (const g of gainLines(raw)) pushLine(details, g);
  if (at && num(at.duration_min) !== undefined) {
    pushLine(details, `AllTrails duration ${num(at.duration_min)} min`);
  }
  if (at && str(at.route_type)) pushLine(details, `route ${str(at.route_type)}`);
  if (at && num(at.rating) !== undefined) pushLine(details, `AllTrails rating ${num(at.rating)}`);
  if (agency && str(agency.url)) pushLine(details, `Agency page ${str(agency.url)}`);
  if (agency && str(agency.note)) pushLine(details, str(agency.note));
  pushLine(details, str(raw.address));
  if (str(raw.elevation_display)) pushLine(details, str(raw.elevation_display));
  if (str(raw.fetched)) pushLine(details, `fetched-at ${str(raw.fetched)}`);
  if (str(raw.source) && /^https?:\/\//i.test(str(raw.source)!)) {
    pushLine(details, `Source ${str(raw.source)}`);
  }
  if (raw.osm_routed_each_way_mi !== undefined && raw.osm_routed_each_way_mi !== null && raw.osm_routed_each_way_mi !== "") {
    pushLine(details, `OSM routed ${String(raw.osm_routed_each_way_mi)} mi each way (third measure, not averaged)`);
  }
  const serves = servesOf(raw);
  if (serves.length) {
    pushLine(details, `serves ${serves.map((id) => placeById(bundle, id)?.name ?? id).join(" · ")}`);
  }

  const around = aroundThisNames(item, bundle);
  return {
    about: placeAbout(item),
    why: why.length ? why : ["No why-go text in this bundle."],
    lookOut: lookOut.length ? lookOut : ["Look out for: not in this bundle."],
    around: around.length ? around : ["Around this: not in this bundle."],
    details: details.length ? details : ["Details: not in this bundle."],
  };
}

export function aroundThisNames(item: NamedItem, bundle: TripBundle): string[] {
  const names: string[] = [];
  const area = areaOf(item.raw);
  const serves = new Set(servesOf(item.raw));
  const foodServes = foodAreaServes(bundle, area);
  for (const s of foodServes) if (s !== area) serves.add(s);
  const pool = [
    ...collectionItems(bundle, "hikes", "hike"),
    ...collectionItems(bundle, "food", "food"),
    ...collectionItems(bundle, "photo", "photo"),
  ];
  for (const other of pool) {
    if (other.name === item.name) continue;
    const oa = areaOf(other.raw);
    const os = servesOf(other.raw);
    const otherFoodServes = foodAreaServes(bundle, oa);
    const areaHit = Boolean(area && oa && area.toLowerCase() === oa.toLowerCase());
    const serveHit =
      os.some((s) => serves.has(s)) ||
      otherFoodServes.some((s) => serves.has(s)) ||
      (area ? otherFoodServes.includes(area) : false);
    if (areaHit || serveHit) pushLine(names, other.name);
  }
  const drakeSide = serves.has("drake") || /drake/i.test(item.name) || item.id === "drake";
  if (drakeSide || /elk|photo/i.test(item.name) || item.id.startsWith("photo")) {
    for (const p of behaviourSubject(bundle, "elk")?.places ?? []) pushLine(names, p);
  }
  return names;
}

export function gainLines(raw: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (isRecord(raw.alltrails)) {
    const g = num(raw.alltrails.gain_ft);
    if (g !== undefined) lines.push(`AllTrails: ${g} ft gain`);
  }
  if (isRecord(raw.agency)) {
    const g = num(raw.agency.gain_ft);
    if (g !== undefined) lines.push(`agency: ${g} ft gain`);
  }
  return lines;
}

export function permitPrint(raw: Record<string, unknown>): string {
  if (!("permit" in raw) || raw.permit === undefined || raw.permit === null || raw.permit === "") {
    return "permit unknown";
  }
  return permitOf(raw) ?? "permit unknown";
}

export function servesOf(raw: Record<string, unknown>): string[] {
  if (!Array.isArray(raw.serves)) return [];
  return raw.serves.map(String).filter(Boolean);
}

export function gatewayFallback(bundle: TripBundle): Record<string, unknown> | undefined {
  const h = collection(bundle, "hikes");
  if (!isRecord(h) || !isRecord(h.gateway_fallback)) return undefined;
  return h.gateway_fallback;
}

export function foodDirectories(bundle: TripBundle): Record<string, string> {
  const food = collection(bundle, "food");
  if (!isRecord(food) || !isRecord(food.directories)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(food.directories)) {
    const url = str(v);
    if (url && /^https?:\/\//i.test(url)) out[k] = url;
  }
  return out;
}

export function landNamedExceptions(bundle: TripBundle): Array<Record<string, unknown>> {
  const land = collection(bundle, "land_rules");
  if (!isRecord(land) || !Array.isArray(land.named_exceptions)) return [];
  return land.named_exceptions.filter(isRecord);
}

export function landPermits(bundle: TripBundle): Array<Record<string, unknown>> {
  const land = collection(bundle, "land_rules");
  if (!isRecord(land) || !Array.isArray(land.permits)) return [];
  return land.permits.filter(isRecord);
}

export function landAccessAreas(bundle: TripBundle): Array<Record<string, unknown>> {
  const land = collection(bundle, "land_rules");
  if (!isRecord(land) || !Array.isArray(land.access_areas)) return [];
  return land.access_areas.filter(isRecord);
}

export function landManagers(bundle: TripBundle): Array<{ name: string; raw: Record<string, unknown> }> {
  const land = collection(bundle, "land_rules");
  if (!isRecord(land) || !isRecord(land.managers)) return [];
  return Object.entries(land.managers)
    .filter(([, v]) => isRecord(v))
    .map(([name, v]) => ({ name, raw: v as Record<string, unknown> }));
}

export function landFetched(bundle: TripBundle): string | undefined {
  const land = collection(bundle, "land_rules");
  return isRecord(land) ? str(land.fetched) : undefined;
}

export function milesLines(raw: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (isRecord(raw.alltrails)) {
    const rt = num(raw.alltrails.round_trip_mi);
    const m =
      rt !== undefined
        ? `${rt} mi round trip`
        : str(raw.alltrails.miles) ?? str(raw.alltrails.length) ?? str(raw.alltrails.distance);
    if (m) lines.push(`AllTrails: ${m}`);
  }
  if (isRecord(raw.agency)) {
    const ow = num(raw.agency.one_way_mi);
    const m =
      ow !== undefined
        ? `${ow} mi one way`
        : str(raw.agency.miles) ?? str(raw.agency.length) ?? str(raw.agency.distance);
    if (m) lines.push(`agency: ${m}`);
  }
  if (isRecord(raw.nps)) {
    const m = str(raw.nps.miles) ?? str(raw.nps.length) ?? str(raw.nps.distance);
    if (m) lines.push(`NPS: ${m}`);
  }
  const pairs: Array<[string, string[]]> = [
    ["AllTrails", ["miles_alltrails", "alltrails_miles", "length_alltrails", "alltrails_length"]],
    ["agency / NPS", ["miles_nps", "nps_miles", "miles_agency", "agency_miles", "length_nps", "length_agency"]],
  ];
  const already = (label: string) => lines.some((l) => l.toLowerCase().startsWith(label.toLowerCase()));
  for (const [label, keys] of pairs) {
    if (already(label.split(" ")[0] ?? label)) continue;
    const v = pick(raw, keys);
    if (v !== undefined && v !== null && v !== "" && !isRecord(v) && !Array.isArray(v)) {
      lines.push(`${label}: ${String(v)}`);
    }
  }
  if (raw.each_way_mi !== undefined && raw.each_way_mi !== null && raw.each_way_mi !== "") {
    lines.push(`each way: ${String(raw.each_way_mi)} mi (derived)`);
  }
  for (const k of ["miles", "length", "distance", "distance_mi", "length_mi", "miles_display", "length_display"]) {
    if (k in raw && raw[k] !== undefined && raw[k] !== null && raw[k] !== "" && !isRecord(raw[k])) {
      lines.push(`${k}: ${String(raw[k])}`);
    }
  }
  return unique(lines);
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

export function elevationLine(raw: Record<string, unknown>): string {
  const display = str(raw.elevation_display);
  if (display) return display;
  return "elevation unknown";
}

export function earlyCost(raw: Record<string, unknown>): boolean {
  const v = raw.early || raw.early_morning || raw.no_early_mornings_cost || raw.starts_early;
  if (v === true) return true;
  const t = str(raw.start) ?? str(raw.time) ?? str(raw.sunrise_needed);
  if (t && /^0[0-6]:/.test(t)) return true;
  return false;
}

export function rankGroup(raw: Record<string, unknown>): "high" | "low" {
  const r = str(raw.rank) ?? str(raw.priority) ?? str(raw.group);
  if (r && /low|later|skip|backup/.test(r.toLowerCase())) return "low";
  if (raw.low_ranked === true) return "low";
  return "high";
}

export function areaOf(raw: Record<string, unknown>): string | undefined {
  return str(raw.area) ?? str(raw.region) ?? str(raw.town) ?? str(raw.base) ?? str(raw.near);
}

export function subjectOf(raw: Record<string, unknown>): string[] {
  const v = raw.subjects ?? raw.subject ?? raw.for;
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return [v];
  return [];
}

export function permitOf(raw: Record<string, unknown>): string | undefined {
  const v = pick(raw, ["permit", "permits", "timed_entry", "entry", "pass"]);
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v ? "permit noted" : undefined;
  if (typeof v === "string") return v;
  if (isRecord(v)) return str(v.status) ?? str(v.note) ?? JSON.stringify(v);
  return String(v);
}

export function lengthNumber(raw: Record<string, unknown>): number | undefined {
  const nestedAt = isRecord(raw.alltrails) ? num(raw.alltrails.round_trip_mi) : undefined;
  const nestedAg = isRecord(raw.agency) ? num(raw.agency.one_way_mi) : undefined;
  return (
    nestedAt ??
    nestedAg ??
    num(raw.each_way_mi) ??
    num(raw.miles) ??
    num(raw.length) ??
    num(raw.distance) ??
    num(raw.distance_mi) ??
    num(raw.length_mi) ??
    num(raw.miles_alltrails) ??
    num(raw.miles_nps)
  );
}

export function urlsIn(raw: unknown, into: Array<{ url: string; label: string; kind: "webcam" | "gate" }> = [], kind?: "webcam" | "gate"): Array<{ url: string; label: string; kind: "webcam" | "gate" }> {
  if (typeof raw === "string" && /^https?:\/\//.test(raw)) {
    into.push({ url: raw, label: raw, kind: kind ?? guessKind(raw) });
    return into;
  }
  if (Array.isArray(raw)) {
    for (const x of raw) urlsIn(x, into, kind);
    return into;
  }
  if (isRecord(raw)) {
    const url = str(raw.url) ?? str(raw.href) ?? str(raw.src) ?? str(raw.image);
    const label = str(raw.name) ?? str(raw.title) ?? str(raw.label) ?? url ?? "link";
    const k = (str(raw.kind) === "gate" ? "gate" : str(raw.kind) === "webcam" ? "webcam" : kind) ?? (label.toLowerCase().includes("gate") ? "gate" : "webcam");
    if (url && /^https?:\/\//.test(url)) into.push({ url, label, kind: k });
    for (const [key, val] of Object.entries(raw)) {
      if (key === "url" || key === "href" || key === "src") continue;
      const nextKind = /gate/i.test(key) ? "gate" : /cam/i.test(key) ? "webcam" : kind;
      urlsIn(val, into, nextKind);
    }
  }
  return into;
}

function guessKind(url: string): "webcam" | "gate" {
  return /gate/i.test(url) ? "gate" : "webcam";
}

function foliageText(val: unknown, key: string): string {
  if (val === undefined || val === null) return "unknown";
  if (typeof val === "string" || typeof val === "number") return String(val);
  if (Array.isArray(val)) return val.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
  if (!isRecord(val)) return String(val);
  if (key === "model" || key === "FORECAST" || key === "forecast") {
    const bits = [str(val.status), str(val.rule), str(val.summary), str(val.text)].filter(Boolean);
    if (Array.isArray(val.bands)) {
      const bands = val.bands
        .filter(isRecord)
        .map((b) => [str(b.place), str(b.modelled_peak) ?? str(b.peak)].filter(Boolean).join(" "))
        .filter(Boolean);
      if (bands.length) bits.push(bands.join("; "));
    }
    if (bits.length) return bits.join(" — ");
  }
  if (key === "county_forecast" || key === "county") {
    return Object.entries(val)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map(String).join("–") : String(v)}`)
      .join(" · ");
  }
  return str(val.summary) ?? str(val.text) ?? str(val.note) ?? str(val.status) ?? JSON.stringify(val);
}

export function foliageBlocks(v: unknown): Array<{ kind: string; text: string; as_of?: string }> {
  if (v === undefined) return [];
  if (typeof v === "string") return [{ kind: "unknown", text: v }];
  if (Array.isArray(v)) return v.flatMap((x) => foliageBlocks(x));
  if (!isRecord(v)) return [{ kind: "unknown", text: String(v) }];
  const out: Array<{ kind: string; text: string; as_of?: string }> = [];
  for (const key of ["forecast", "FORECAST", "observation", "OBSERVATION", "observed", "model", "county", "county_forecast"]) {
    if (key in v) {
      const kind = /obs/i.test(key) ? "OBSERVATION" : /forecast|model|county/i.test(key) ? "FORECAST" : key;
      const val = v[key];
      out.push({
        kind,
        text: foliageText(val, key),
        as_of: str((isRecord(val) ? val.fetched ?? val.as_of : undefined) ?? v.fetched ?? v.as_of ?? v.asOf),
      });
    }
  }
  if (!out.length) {
    out.push({
      kind: str(v.kind) ?? str(v.type) ?? "unknown",
      text: str(v.summary) ?? str(v.text) ?? str(v.note) ?? JSON.stringify(v),
      as_of: str(v.as_of) ?? str(v.asOf),
    });
  }
  return out;
}

export function missingInventory(bundle: TripBundle): string[] {
  const gaps: string[] = [];
  const trip = bundle.trip;
  const days = daysList(bundle);
  const dates = new Set(days.map((d) => d.date));
  if (trip?.first_day && trip?.last_day) {
    for (const iso of enumerateDates(trip.first_day, trip.last_day)) {
      if (!dates.has(iso)) gaps.push(`${iso} is in trip.first_day–last_day but has no days[] row`);
    }
  }
  if (collection(bundle, "hikes") === undefined) gaps.push("No hikes/trails collection in this bundle");
  if (collection(bundle, "food") === undefined) gaps.push("No food collection in this bundle");
  if (collection(bundle, "foliage") === undefined) gaps.push("No foliage / fall-color block in this bundle");
  if (collection(bundle, "gates") === undefined) gaps.push("No gate block in this bundle");
  if (collection(bundle, "webcams") === undefined) gaps.push("No webcam URLs in this bundle");
  if (collection(bundle, "photo") === undefined) gaps.push("No photo-ops / hotspots collection in this bundle");
  const weather = pick(bundle, ["weather", "forecast"]) ?? days.some((d) => "weather" in d);
  if (!weather) gaps.push("No weather in this bundle");
  const birds = pick(bundle, ["birds", "ebird", "sightings"]);
  if (birds === undefined) gaps.push("Bird silence is silence — no bird feed in this bundle");
  const drake = placeById(bundle, "drake");
  if (drake && drake.elevation_confirmed === false) {
    gaps.push(`Drake pin unconfirmed — ${drake.elevation_display ?? "elevation is a range"}`);
  }
  for (const run of runsList(bundle)) {
    if (String(run.overnight).toLowerCase() === "open") {
      gaps.push(`Overnight on run ${run.id} is open (not a chosen stop)`);
    }
  }
  if (trip?.last_day) {
    gaps.push(`Return after ${trip.last_day} is not in this bundle`);
  }
  const gapCol = collection(bundle, "gaps");
  if (gapCol !== undefined) {
    for (const item of namedItems(gapCol, "gap")) {
      gaps.push(item.name + (str(item.raw.note) ? ` — ${str(item.raw.note)}` : ""));
    }
  }
  return unique(gaps);
}

function enumerateDates(a: string, b: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out;
  for (let t = start; t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function oneLineLight(day: Day | undefined): string {
  if (!day?.light) return "Light for this day is not in the bundle";
  const L = day.light;
  const bits = [
    L.sunrise ? `up ${L.sunrise}` : null,
    L.sunset ? `down ${L.sunset}` : null,
    L.golden_am?.length ? `gold AM ${L.golden_am.join("–")}` : null,
    L.golden_pm?.length ? `gold PM ${L.golden_pm.join("–")}` : null,
  ].filter(Boolean);
  const where = day.light_computed_for ? ` (${day.light_computed_for})` : "";
  return (bits.join(" · ") || "Light object present but empty") + where;
}

export function darkHoursHint(day: Day): number | undefined {
  const v = day.light?.moon?.verdict;
  if (!v) return undefined;
  const m = v.match(/([\d.]+)\s*h of real darkness/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Wrap-around moon verdicts (23–24 h on driving days) are not a night length. */
export function darkestPlausibleNight(days: Day[]): { day: Day; hours: number } | undefined {
  let best: { day: Day; hours: number } | undefined;
  for (const day of days) {
    const hours = darkHoursHint(day);
    if (hours === undefined || hours <= 0 || hours >= 12) continue;
    if (!best || hours > best.hours) best = { day, hours };
  }
  return best;
}

export type FoliageCam = { name: string; url: string; note?: string };
export type FoliageSource = { name: string; url: string; what?: string; kind?: string };
export type FoliageBand = { place: string; elevation_ft?: number; modelled_peak?: string };

function foliageRoot(bundle: TripBundle): Record<string, unknown> | undefined {
  const v = collection(bundle, "foliage");
  return isRecord(v) ? v : undefined;
}

export function foliageWebcams(bundle: TripBundle): FoliageCam[] {
  const f = foliageRoot(bundle);
  if (!f) return [];
  return asArray(f.webcams)
    .filter(isRecord)
    .map((c) => ({
      name: str(c.name) ?? str(c.title) ?? "webcam",
      url: str(c.url) ?? str(c.href) ?? "",
      note: str(c.note),
    }))
    .filter((c) => /^https?:\/\//.test(c.url));
}

export function foliageSources(bundle: TripBundle): FoliageSource[] {
  const f = foliageRoot(bundle);
  if (!f) return [];
  return asArray(f.sources)
    .filter(isRecord)
    .map((s) => ({
      name: str(s.name) ?? str(s.title) ?? "source",
      url: str(s.url) ?? str(s.href) ?? "",
      what: str(s.what) ?? str(s.note),
      kind: str(s.kind),
    }))
    .filter((s) => /^https?:\/\//.test(s.url));
}

export function foliageExploreFallUrl(bundle: TripBundle): string | undefined {
  const hit = foliageSources(bundle).find((s) => /explore fall/i.test(s.name) && /colorado/i.test(s.name + s.url));
  return hit?.url;
}

export function foliageBands(bundle: TripBundle): FoliageBand[] {
  const f = foliageRoot(bundle);
  if (!f || !isRecord(f.model) || !Array.isArray(f.model.bands)) return [];
  return f.model.bands.filter(isRecord).map((b) => ({
    place: str(b.place) ?? "place",
    elevation_ft: num(b.elevation_ft),
    modelled_peak: str(b.modelled_peak),
  }));
}

export function foliageModelStatus(bundle: TripBundle): string | undefined {
  const f = foliageRoot(bundle);
  return isRecord(f?.model) ? str(f.model.status) : undefined;
}

export function foliageModelRule(bundle: TripBundle): string | undefined {
  const f = foliageRoot(bundle);
  return isRecord(f?.model) ? str(f.model.rule) : undefined;
}

export function foliageCountyWindows(bundle: TripBundle): Array<{ county: string; from?: string; to?: string }> {
  const f = foliageRoot(bundle);
  if (!f || !isRecord(f.county_forecast)) return [];
  return Object.entries(f.county_forecast).map(([county, val]) => {
    if (Array.isArray(val) && val.length >= 2) return { county, from: str(val[0]), to: str(val[1]) };
    if (Array.isArray(val) && val.length === 1) return { county, from: str(val[0]) };
    return { county, from: typeof val === "string" ? val : undefined };
  });
}

export function foliageHasObservation(bundle: TripBundle): boolean {
  const f = foliageRoot(bundle);
  if (!f) return false;
  return f.OBSERVATION !== undefined || f.observation !== undefined || f.observed !== undefined;
}

export function foliageModelFetched(bundle: TripBundle): string | undefined {
  const f = foliageRoot(bundle);
  return isRecord(f?.model) ? str(f.model.fetched) ?? str(f.fetched) : undefined;
}

export function foliageRanking(bundle: TripBundle): string | undefined {
  const f = foliageRoot(bundle);
  return str(f?.ranking);
}

export function foliageBandForPlace(bundle: TripBundle, placeName: string): FoliageBand | undefined {
  const needle = placeName.toLowerCase();
  return foliageBands(bundle).find((b) => needle.includes(b.place.toLowerCase()) || b.place.toLowerCase().includes(needle));
}

export type BehaviourSubject = {
  id: string;
  action?: string;
  detail?: string;
  restriction?: string;
  fetched?: string;
  source?: string;
  places: string[];
};

export function behaviourSubject(bundle: TripBundle, id: string): BehaviourSubject | undefined {
  const b = collection(bundle, "behaviour");
  if (!isRecord(b) || !isRecord(b.subjects)) return undefined;
  const rec = b.subjects[id];
  if (!isRecord(rec)) return undefined;
  const places = Array.isArray(rec.places_named_by_source)
    ? rec.places_named_by_source.map(String).filter(Boolean)
    : [];
  return {
    id,
    action: str(rec.action),
    detail: str(rec.detail),
    restriction: str(rec.restriction),
    fetched: str(rec.fetched),
    source: str(rec.source),
    places,
  };
}

export function tripSubjects(bundle: TripBundle): string[] {
  return (bundle.trip?.subjects ?? []).map(String);
}

/** Hikes already in the engine file that the Instagram reel named, plus Lost Lake wildlife. */
export const MOOSE_LOOK_HIKE_NAMES = [
  "Lake Isabelle",
  "Blue Lake",
  "Long Lake",
  "Mitchell Lake",
  "Lost Lake (Hessie)",
] as const;

export type MooseOverlay = {
  kind: "overlay";
  not_engine: true;
  label: string;
  instagram: {
    url: string;
    account: string;
    fetched: string;
    location_sticker: string;
    caption: string;
    rut_line: string;
    guaranteed_quote: string;
  };
};

export function parseMooseOverlay(json: unknown): MooseOverlay {
  if (!isRecord(json)) throw new Error("Moose overlay is not an object");
  if (json.kind !== "overlay" || json.not_engine !== true) {
    throw new Error("Moose file is not labeled as an overlay");
  }
  const ig = isRecord(json.instagram) ? json.instagram : undefined;
  if (!ig) throw new Error("Moose overlay missing instagram");
  const url = str(ig.url);
  const account = str(ig.account);
  const fetched = str(ig.fetched);
  const location = str(ig.location_sticker);
  const caption = str(ig.caption);
  const rut = str(ig.rut_line);
  const guaranteed = str(ig.guaranteed_quote);
  const label = str(json.label);
  if (!url || !account || !fetched || !location || !caption || !rut || !guaranteed || !label) {
    throw new Error("Moose overlay is missing required Instagram fields");
  }
  return {
    kind: "overlay",
    not_engine: true,
    label,
    instagram: {
      url,
      account,
      fetched,
      location_sticker: location,
      caption,
      rut_line: rut,
      guaranteed_quote: guaranteed,
    },
  };
}

export function mooseLookHikes(bundle: TripBundle): NamedItem[] {
  const hikes = collectionItems(bundle, "hikes", "hike");
  const out: NamedItem[] = [];
  for (const want of MOOSE_LOOK_HIKE_NAMES) {
    const hit = hikes.find((h) => h.name === want);
    if (hit) out.push(hit);
  }
  return out;
}

export function nederlandBaseDates(bundle: TripBundle): string[] {
  return daysList(bundle)
    .filter((d) => d.base === "nederland")
    .map((d) => d.date);
}

export function mooseLookLine(hike: NamedItem): string {
  const gate =
    hike.raw.behind_brainard_gate === true
      ? "behind the Brainard gate"
      : hike.raw.behind_brainard_gate === false
        ? "not behind the Brainard gate"
        : "Brainard gate unknown";
  return `${hike.name} · look here, already in this trip file · ${dogPrint(hike.raw)} · ${permitPrint(hike.raw)} · ${gate}`;
}

export function mooseCardSections(bundle: TripBundle, overlay: MooseOverlay): PlaceCardSections {
  const ig = overlay.instagram;
  const igTag = `Instagram @${ig.account} (fetched ${ig.fetched})`;
  const lost = collectionItems(bundle, "hikes", "hike").find((h) => h.name === "Lost Lake (Hessie)");
  const wildlife = lost ? str(lost.raw.wildlife) : undefined;
  const brainard = landAccessAreas(bundle).find((a) => /brainard/i.test(`${str(a.match) ?? ""} ${str(a.name) ?? ""}`));
  const timed = isRecord(brainard?.timed_entry) ? brainard.timed_entry : undefined;
  const tripDates = timed ? str(timed.trip_dates_status) : undefined;
  const ticketSeason = timed ? str(timed.ticket_season_2026) : undefined;
  const ned = nederlandBaseDates(bundle);

  const about: string[] = [];
  pushLine(about, "moose is not in trip.subjects.");
  pushLine(about, overlay.label);
  pushLine(about, `${igTag}: ${ig.url}`);
  pushLine(about, `location sticker ${ig.location_sticker}`);
  pushLine(about, ig.caption);

  const why: string[] = [];
  pushLine(why, `${igTag}: “${ig.rut_line}.” Not official.`);
  pushLine(why, `${igTag}: she wrote “${ig.guaranteed_quote}.” That is her claim, not this app.`);
  pushLine(why, wildlife ? `Lost Lake (Hessie) AllTrails curated text: ${wildlife}` : undefined);
  pushLine(why, "moose is not in trip.subjects.");

  const lookOut: string[] = [];
  if (ticketSeason) pushLine(lookOut, `Brainard timed-entry ticket season ${ticketSeason}.`);
  pushLine(lookOut, tripDates);
  if (ned.length) {
    pushLine(lookOut, `Karl is based at Nederland ${ned[0]}–${ned[ned.length - 1]} (days[].base in this bundle).`);
  }
  pushLine(lookOut, `${igTag}: moose blend into willows, territorial, give space. That reel does not give a yardage.`);
  pushLine(lookOut, "No moose distance is in this bundle.");

  const around: string[] = mooseLookHikes(bundle).map(mooseLookLine);
  pushLine(around, "West-side RMNP / other Front Range moose spots are not in this bundle.");

  const details: string[] = [];
  pushLine(details, overlay.label);
  pushLine(details, `Source ${ig.url}`);
  pushLine(details, `fetched-at ${ig.fetched}`);
  pushLine(details, `location sticker ${ig.location_sticker}`);

  return {
    about: about.length ? about : ["moose is not in trip.subjects."],
    why: why.length ? why : ["No why-go text in this bundle."],
    lookOut: lookOut.length ? lookOut : ["Look out for: not in this bundle."],
    around: around.length ? around : ["Around this: not in this bundle."],
    details: details.length ? details : ["Details: not in this bundle."],
  };
}

export function validateBundle(json: unknown): TripBundle {
  if (!isRecord(json)) throw new Error("Bundle is not an object");
  if (json.schema_version !== "1.0.0") {
    throw new Error(`Unsupported schema_version ${String(json.schema_version)} — this app reads 1.0.0`);
  }
  return json as TripBundle;
}
