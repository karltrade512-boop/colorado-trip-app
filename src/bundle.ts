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

export type DietPrint = { gf: string; df: string; gfQuote?: string; dfQuote?: string };

export function gfDf(raw: Record<string, unknown>): DietPrint {
  const gf = formatDiet(pick(raw, ["gf", "gluten_free", "gluten-free", "GF"]), "GF");
  const df = formatDiet(pick(raw, ["df", "dairy_free", "dairy-free", "DF"]), "DF");
  return { gf: gf.line, df: df.line, gfQuote: gf.quote, dfQuote: df.quote };
}

function nonUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return undefined;
  return v;
}

function formatDiet(v: unknown, label: string): { line: string; quote?: string } {
  if (v === undefined || v === null || v === "") return { line: `${label}: unknown` };
  if (typeof v === "boolean") return { line: v ? `${label}: tagged` : `${label}: not tagged` };
  if (isRecord(v)) {
    const status = str(v.status) ?? str(v.value) ?? str(v.level) ?? str(v.tag) ?? "unknown";
    const confidence = nonUrl(str(v.confidence));
    const sourceLabel = nonUrl(str(v.source) ?? str(v.from) ?? str(v.kind));
    const paren = confidence ?? sourceLabel;
    const quote = str(v.quote);
    return { line: paren ? `${label}: ${status} (${paren})` : `${label}: ${status}`, quote };
  }
  return { line: `${label}: ${String(v)}` };
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

export function validateBundle(json: unknown): TripBundle {
  if (!isRecord(json)) throw new Error("Bundle is not an object");
  if (json.schema_version !== "1.0.0") {
    throw new Error(`Unsupported schema_version ${String(json.schema_version)} — this app reads 1.0.0`);
  }
  return json as TripBundle;
}
