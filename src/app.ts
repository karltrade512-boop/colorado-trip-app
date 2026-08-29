import type { Map as LeafletMap } from "leaflet";
import type { Day, LiveResult, TripBundle, UnverifiedExtra } from "./types";
import {
  areaOf,
  behaviourSubject,
  collection,
  collectionItems,
  collectionNote,
  darkestPlausibleNight,
  darkHoursHint,
  daysList,
  dogStatus,
  earlyCost,
  foliageBandForPlace,
  foliageBands,
  foliageCountyWindows,
  foliageExploreFallUrl,
  foliageHasObservation,
  foliageModelFetched,
  foliageModelStatus,
  foliageModelRule,
  foliageRanking,
  foliageSources,
  foliageWebcams,
  foodDirectories,
  gainLines,
  gatewayFallback,
  gfDf,
  isRecord,
  itemLatLon,
  landAccessAreas,
  landFetched,
  landManagers,
  landNamedExceptions,
  landPermits,
  lengthNumber,
  missingInventory,
  namedItems,
  nextOrToday,
  num,
  oneLineLight,
  permitOf,
  permitPrint,
  pickDay,
  placeById,
  placesList,
  rankGroup,
  runsList,
  servesOf,
  sheetMilesLines,
  str,
  subjectOf,
  tripSubjects,
  todayIso,
  validateBundle,
} from "./bundle";
import { idbGet, idbSet, type CachedBundle } from "./db";
import { haversineKm, isStandalone, mapsSearchUrl, mapsUrl } from "./geo";
import { bundleLiveTargets, fetchLive, fetchUnverifiedExtras } from "./live";

export type RouteId =
  | "today"
  | "map"
  | "light"
  | "filters"
  | "open"
  | "drive"
  | "around"
  | "food"
  | "gaps"
  | "more"
  | "color"
  | "photos";

type Filters = {
  dogs: "any" | "ok" | "unknown" | "banned";
  permit: "any" | "yes" | "no" | "unknown";
  subject: string;
  maxMiles: string;
};

type AppState = {
  bundle: TripBundle | null;
  error: string | null;
  loadedAt: number | null;
  source: "network" | "idb" | "none";
  route: RouteId;
  printDate: string | null;
  dogsWithUs: boolean;
  showLow: boolean;
  showAllHikes: boolean;
  showAllFood: boolean;
  filters: Filters;
  gps: { lat: number; lon: number; at: number } | null;
  gpsError: string | null;
  selectedId: string | null;
  extras: UnverifiedExtra[];
  extrasError: string | null;
  extrasAt: string | null;
  extrasBusy: boolean;
  live: LiveResult[];
  liveBusy: boolean;
  colorCams: LiveResult[];
  colorBusy: boolean;
  saveProgress: number | null;
  saveMessage: string | null;
  standalone: boolean;
};

const FILTERS_DEFAULT: Filters = { dogs: "any", permit: "any", subject: "", maxMiles: "" };

const state: AppState = {
  bundle: null,
  error: null,
  loadedAt: null,
  source: "none",
  route: "today",
  printDate: null,
  dogsWithUs: sessionStorage.getItem("dogsWithUs") === "1",
  showLow: false,
  showAllHikes: false,
  showAllFood: false,
  filters: { ...FILTERS_DEFAULT },
  gps: null,
  gpsError: null,
  selectedId: null,
  extras: [],
  extrasError: null,
  extrasAt: null,
  extrasBusy: false,
  live: [],
  liveBusy: false,
  colorCams: [],
  colorBusy: false,
  saveProgress: null,
  saveMessage: null,
  standalone: false,
};

let map: LeafletMap | null = null;
let colorMap: LeafletMap | null = null;
let aroundAutoStarted = false;
let colorAutoStarted = false;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseHash(): { route: RouteId; printDate: string | null } {
  const h = (location.hash || "#/today").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  const raw = parts[0] || "today";
  if (raw === "print") return { route: "today", printDate: parts[1] ?? null };
  const known: RouteId[] = [
    "today",
    "map",
    "light",
    "filters",
    "open",
    "drive",
    "around",
    "food",
    "gaps",
    "more",
    "color",
    "photos",
  ];
  const head = (raw === "drive" ? "around" : raw) as RouteId;
  return { route: known.includes(head) ? head : "today", printDate: null };
}

function cacheAge(ms: number | null): string {
  if (!ms) return "cache age unknown";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "cached just now";
  if (min < 60) return `cached ${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `cached ${hr} h ago`;
  return `cached ${Math.round(hr / 24)} d ago`;
}

function areaForDay(day: Day | undefined): string | undefined {
  if (!day) return undefined;
  if (day.base) return day.base;
  if (day.kind === "driving") return "driving";
  return undefined;
}

function menuItems(bundle: TripBundle): ReturnType<typeof namedItems> {
  const hikes = collectionItems(bundle, "hikes", "hike");
  const photos = collectionItems(bundle, "photo", "photo");
  return [...hikes, ...photos];
}

function foodItems(bundle: TripBundle): ReturnType<typeof namedItems> {
  return collectionItems(bundle, "food", "food");
}

function matchesFilters(
  raw: Record<string, unknown>,
  f: Filters,
): boolean {
  if (f.dogs !== "any" && dogStatus(raw) !== f.dogs) return false;
  if (f.permit !== "any") {
    const p = permitOf(raw);
    const st = p === undefined || p === null || p === "" ? "unknown" : /no|none|not/i.test(p) ? "no" : "yes";
    if (st !== f.permit) return false;
  }
  if (f.subject) {
    const subs = subjectOf(raw).map((s) => s.toLowerCase());
    if (!subs.includes(f.subject.toLowerCase()) && !String(raw.name || "").toLowerCase().includes(f.subject.toLowerCase())) {
      return false;
    }
  }
  if (f.maxMiles) {
    const n = lengthNumber(raw);
    if (n !== undefined && n > Number(f.maxMiles)) return false;
    // unknown length stays visible — filters do not drop unknown
  }
  return true;
}

function sortItems(
  items: ReturnType<typeof namedItems>,
  bundle: TripBundle,
): ReturnType<typeof namedItems> {
  const noEarly = bundle.trip?.preferences?.no_early_mornings === true;
  const gps = state.gps;
  return items.slice().sort((a, b) => {
    if (state.dogsWithUs) {
      const da = dogStatus(a.raw);
      const db = dogStatus(b.raw);
      const rank = (d: string) => (d === "banned" ? 1 : 0);
      if (rank(da) !== rank(db)) return rank(da) - rank(db);
    }
    if (noEarly) {
      const ea = earlyCost(a.raw) ? 1 : 0;
      const eb = earlyCost(b.raw) ? 1 : 0;
      if (ea !== eb) return ea - eb;
    }
    if (gps) {
      const pa = itemLatLon(a.raw);
      const pb = itemLatLon(b.raw);
      const da = pa ? haversineKm(gps.lat, gps.lon, pa.lat, pa.lon) : Number.POSITIVE_INFINITY;
      const db = pb ? haversineKm(gps.lat, gps.lon, pb.lat, pb.lon) : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
    }
    return a.name.localeCompare(b.name);
  });
}

function prettyDate(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function dogLabel(raw: Record<string, unknown>): string {
  const rawDog = raw.dogs ?? raw.dog_rule ?? raw.dogs_allowed;
  if (typeof rawDog === "string" && rawDog.trim()) return rawDog.trim();
  const st = dogStatus(raw);
  if (st === "ok") return "leashed / allowed";
  if (st === "banned") return "prohibited";
  return "unknown";
}

function foodServesBases(bundle: TripBundle, placeArea: string | undefined): string[] {
  if (!placeArea) return [];
  const food = collection(bundle, "food");
  if (isRecord(food) && isRecord(food.areas)) {
    const block = food.areas[placeArea];
    if (isRecord(block) && Array.isArray(block.serves)) return block.serves.map(String);
  }
  return [placeArea];
}

function foodForDay(bundle: TripBundle, day: Day | undefined): ReturnType<typeof namedItems> {
  const items = foodItems(bundle);
  const base = areaForDay(day);
  if (!base) return items;
  return items.filter((f) => {
    const a = areaOf(f.raw);
    if (!a) return true;
    const serves = foodServesBases(bundle, a);
    if (base === "driving") return serves.includes("route") || a === "driving";
    return serves.includes(base) || a === base;
  });
}

function detailsBlock(rows: Array<[string, string | undefined | null]>, extra = ""): string {
  const kept = rows.filter(([, v]) => v != null && String(v).trim());
  if (!kept.length && !extra) return "";
  return `<details class="more-facts"><summary>More</summary>
    ${kept.map(([k, v]) => `<p><span class="k">${esc(k)}</span> ${esc(String(v))}</p>`).join("")}
    ${extra}
  </details>`;
}

function cabinChips(raw: Record<string, unknown>): string {
  const bundle = state.bundle;
  const ids = servesOf(raw);
  if (!ids.length) return "";
  return `<p class="chips">${ids
    .map((id) => {
      const p = bundle ? placeById(bundle, id) : undefined;
      return `<span class="chip">${esc(p?.name ?? id)}</span>`;
    })
    .join("")}</p>`;
}

function itemCard(item: ReturnType<typeof namedItems>[number], extraClass = ""): string {
  const dog = dogStatus(item.raw);
  const bannedFold = state.dogsWithUs && dog === "banned";
  const early = earlyCost(item.raw);
  const low = rankGroup(item.raw) === "low";
  const isFood = extraClass === "food";

  if (isFood) {
    const diet = gfDf(item.raw);
    const quotes: string[] = [];
    if (diet.gfQuote) quotes.push(`GF: “${diet.gfQuote}”`);
    if (diet.dfQuote) quotes.push(`DF: “${diet.dfQuote}”`);
    const addr = str(item.raw.address);
    const sources = [diet.gfSource, diet.dfSource].filter((u, i, a) => u && a.indexOf(u) === i) as string[];
    const always = state.bundle
      ? str((isRecord(collection(state.bundle, "food")) ? (collection(state.bundle, "food") as Record<string, unknown>).always_print : undefined))
      : undefined;
    const sourceHtml = sources.length
      ? sources.map((u) => `<p><a href="${esc(u)}" target="_blank" rel="noopener">Source</a></p>`).join("")
      : "";
    return `<article class="card sheet ${bannedFold ? "folded-dogs" : ""}" data-id="${esc(item.id)}">
      <h3>${esc(item.name)}</h3>
      <p class="lede">${esc(diet.gf)} <span class="dot">·</span> ${esc(diet.df)}</p>
      <p class="whisper">${esc(str(item.raw.kind) ?? "")}${areaOf(item.raw) ? ` · ${esc((areaOf(item.raw) ?? "").replace(/_/g, " "))}` : ""}</p>
      ${detailsBlock(
        [
          ["Address", addr],
          ["Note", str(item.raw.note)],
        ],
        `${quotes.map((q) => `<p>${esc(q)}</p>`).join("")}${sourceHtml}${always ? `<p class="whisper">${esc(always)}</p>` : ""}${bannedFold ? `<p class="whisper">Not with the dogs — folded, not removed.</p>` : ""}`,
      )}
    </article>`;
  }

  const miles = sheetMilesLines(item.raw);
  const gains = gainLines(item.raw);
  const at = isRecord(item.raw.alltrails) ? item.raw.alltrails : undefined;
  const agency = isRecord(item.raw.agency) ? item.raw.agency : undefined;
  const atUrl = at ? str(at.url) : undefined;
  const agencyUrl = agency ? str(agency.url) : undefined;
  const gated = item.raw.behind_brainard_gate === true;
  const extras: string[] = [];
  if (at) {
    const rating = num(at.rating);
    if (str(at.difficulty)) extras.push(`<p><span class="k">Difficulty</span> ${esc(str(at.difficulty)!)}</p>`);
    if (num(at.duration_min) !== undefined) extras.push(`<p><span class="k">Duration</span> AllTrails ${esc(String(num(at.duration_min)))} min</p>`);
    if (str(at.route_type)) extras.push(`<p><span class="k">Route</span> ${esc(str(at.route_type)!)}</p>`);
    if (rating !== undefined) extras.push(`<p><span class="k">Rating</span> AllTrails rating ${esc(String(rating))}</p>`);
  }
  if (gains.length) extras.push(gains.map((g) => `<p>${esc(g)}</p>`).join(""));
  if (item.raw.osm_routed_each_way_mi !== undefined && item.raw.osm_routed_each_way_mi !== null && item.raw.osm_routed_each_way_mi !== "") {
    extras.push(`<p><span class="k">OSM routed</span> ${esc(String(item.raw.osm_routed_each_way_mi))} mi each way (third measure, not averaged)</p>`);
  }
  if (atUrl) extras.push(`<p><a href="${esc(atUrl)}" target="_blank" rel="noopener">Open in AllTrails</a></p>`);
  if (agencyUrl) extras.push(`<p><a href="${esc(agencyUrl)}" target="_blank" rel="noopener">Agency page</a></p>`);
  if (agency && str(agency.note)) extras.push(`<p><span class="k">Agency note</span> ${esc(str(agency.note)!)}</p>`);
  if (early) extras.push(`<p class="whisper">Early — sorts last (sort key, not hidden).</p>`);
  if (low) extras.push(`<p class="whisper">Low-ranked — still here.</p>`);
  if (bannedFold) extras.push(`<p class="whisper">Not with the dogs — folded, not removed.</p>`);

  return `<article class="card sheet ${bannedFold ? "folded-dogs" : ""}" data-id="${esc(item.id)}">
    <div class="card-head">
      <h3>${esc(item.name)}</h3>
      <span class="badges">
        <span class="badge quiet dog-${dog}">${esc(dogLabel(item.raw))}</span>
        ${gated ? `<span class="badge quiet gate">Brainard gate</span>` : ""}
      </span>
    </div>
    ${miles.length ? `<p class="lede">${miles.map((m) => `<span>${esc(m)}</span>`).join("<br>")}</p>` : ""}
    ${cabinChips(item.raw)}
    ${detailsBlock(
      [
        ["Trailhead", str(item.raw.trailhead)],
        ["Disagreement", str(item.raw.disagreement)],
        ["Access", str(item.raw.access_risk)],
        ["Permit", permitPrint(item.raw)],
        ["Note", str(item.raw.note)],
        ["Review", str(item.raw.review_summary)],
        ["Wildlife", str(item.raw.wildlife)],
        ["Correction", str(item.raw.correction)],
      ],
      extras.join(""),
    )}
  </article>`;
}

const AREA_ORDER = ["Indian Peaks / Brainard", "RMNP", "Nederland-side"];

function hikeAreaGroup(raw: Record<string, unknown>): string {
  const a = (areaOf(raw) ?? "").toLowerCase();
  if (/brainard/.test(a) || (/indian peaks/.test(a) && !/fourth of july/.test(a))) return "Indian Peaks / Brainard";
  if (/rmnp|rocky mountain/.test(a)) return "RMNP";
  if (/nederland|eldora|hessie|fourth of july|caribou|arapaho/.test(a)) return "Nederland-side";
  return areaOf(raw) ?? "Other";
}

function collapsedCards(
  items: ReturnType<typeof namedItems>,
  extraClass: string,
  foldId: "hikes" | "food",
  preview = 3,
): string {
  if (!items.length) return "";
  const open = foldId === "hikes" ? state.showAllHikes : state.showAllFood;
  const folded = items.filter((i) => state.dogsWithUs && dogStatus(i.raw) === "banned");
  const main = items.filter((i) => !(state.dogsWithUs && dogStatus(i.raw) === "banned"));
  const foldedHtml = folded.map((i) => itemCard(i, extraClass)).join("");
  const noun = foldId === "food" ? "places" : "hikes";
  if (main.length <= preview) {
    return `${main.map((i) => itemCard(i, extraClass)).join("")}${foldedHtml}`;
  }
  const head = main.slice(0, preview);
  const rest = main.slice(preview);
  const restHtml =
    extraClass === "food"
      ? rest.map((i) => itemCard(i, extraClass)).join("")
      : groupedBlocks(rest, (it) => itemCard(it, extraClass), AREA_ORDER);
  return `${head.map((i) => itemCard(i, extraClass)).join("")}
    <details class="fold show-all" data-fold="${foldId}" ${open ? "open" : ""}>
      <summary>${items.length} ${noun} — show all</summary>
      ${restHtml}
    </details>
    ${foldedHtml}`;
}

function areaGroupKey(raw: Record<string, unknown>, kind: "hike" | "food"): string {
  if (kind === "food") return (areaOf(raw) ?? "Other").replace(/_/g, " ");
  return hikeAreaGroup(raw);
}

function groupedBlocks(
  items: ReturnType<typeof namedItems>,
  render: (it: ReturnType<typeof namedItems>[number]) => string,
  order: string[],
  kind: "hike" | "food" = "hike",
  headerExtra?: (key: string) => string,
): string {
  const groups = new Map<string, ReturnType<typeof namedItems>>();
  for (const it of items) {
    const g = areaGroupKey(it.raw, kind);
    const list = groups.get(g) ?? [];
    list.push(it);
    groups.set(g, list);
  }
  const rank = (k: string) => order.findIndex((o) => o.toLowerCase() === k.toLowerCase());
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = rank(a);
    const ib = rank(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys
    .map((key, i) => {
      const list = groups.get(key) ?? [];
      return `<details class="fold area-fold" ${i === 0 ? "open" : ""}>
        <summary>${esc(key)} (${list.length})</summary>
        ${headerExtra?.(key) ?? ""}
        ${list.map((it) => render(it)).join("")}
      </details>`;
    })
    .join("");
}

function groupedByArea(items: ReturnType<typeof namedItems>, extraClass = ""): string {
  return groupedBlocks(items, (it) => itemCard(it, extraClass), AREA_ORDER);
}

function hikeListNotes(items: ReturnType<typeof namedItems>): string {
  if (!items.length) return "";
  const anyMiles = items.some((i) => sheetMilesLines(i.raw).length > 0);
  const anyCoords = items.some((i) => itemLatLon(i.raw));
  const bits: string[] = [];
  if (!anyMiles) bits.push("AllTrails and agency miles print separately when present — never averaged.");
  if (!anyCoords) bits.push("Trailhead pins are not in this bundle.");
  return bits.length ? `<p class="note">${bits.map((b) => esc(b)).join(" ")}</p>` : "";
}

function emptyOrMissing(kind: "hikes" | "food" | "photo" | "gaps", bundle: TripBundle, label: string): string {
  const col = collection(bundle, kind);
  const note = collectionNote(bundle, kind);
  if (col === undefined) {
    return `<p class="gap">${esc(label)} is not in this bundle. That is a gap, not “nothing here”.</p>`;
  }
  const items = collectionItems(bundle, kind, kind);
  if (!items.length) {
    return `<p class="gap">${esc(label)} list is empty in this file. Empty list ≠ “nothing here”.${note ? " " + esc(note) : ""}</p>`;
  }
  return note ? `<p class="note">${esc(note)}</p>` : "";
}

function gapMentions(bundle: TripBundle, re: RegExp): string[] {
  return namedItems(collection(bundle, "gaps"), "gap")
    .map((g) => g.name)
    .filter((n) => re.test(n));
}

function renderGatewayCard(bundle: TripBundle): string {
  const g = gatewayFallback(bundle);
  if (!g) return "";
  const sources = Array.isArray(g.sources) ? g.sources.map(String).filter((u) => /^https?:\/\//i.test(u)) : [];
  return `<article class="card">
    <h3>Brainard Gateway fallback</h3>
    <p class="note">Page-level option — not copied onto every gated hike.</p>
    ${str(g.when) ? `<p>${esc(str(g.when)!)}</p>` : ""}
    ${str(g.park_at) ? `<p><span class="k">Park at</span> ${esc(str(g.park_at)!)}</p>` : ""}
    ${str(g.adds) ? `<p><span class="k">Adds</span> ${esc(str(g.adds)!)}</p>` : ""}
    ${str(g.consequence) ? `<p class="whisper">${esc(str(g.consequence)!)}</p>` : ""}
    ${sources.length ? `<p>${sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">Source</a>`).join(" · ")}</p>` : ""}
  </article>`;
}

function renderLandAndPermits(bundle: TripBundle): string {
  const permits = landPermits(bundle);
  const rmnp = permits.find((p) => /rocky mountain/i.test(String(p.match ?? p.name ?? "")));
  const windows = rmnp && Array.isArray(rmnp.windows) ? rmnp.windows.filter(isRecord) : [];
  const bookedGaps = gapMentions(bundle, /timed-entry|timed entry/i);
  const rmnpHtml = rmnp
    ? `<article class="card">
        <h3>${esc(str(rmnp.name) ?? "RMNP timed entry")}</h3>
        <ul class="facts tight">${windows
          .map((w) => {
            const label = str(w.label) ?? "window";
            const start = str(w.start) ?? "?";
            const end = str(w.end) ?? "?";
            const to = str(w.to) ?? "";
            return `<li>${esc(label)}: ${esc(start)}–${esc(end)}${to ? ` through ${esc(to)}` : ""}</li>`;
          })
          .join("")}</ul>
        ${str(rmnp.free_windows) ? `<p>${esc(str(rmnp.free_windows)!)}</p>` : ""}
        ${bookedGaps.map((g) => `<p class="gap">${esc(g)}</p>`).join("")}
        ${str(rmnp.source) ? `<p class="whisper"><a href="${esc(str(rmnp.source)!)}" target="_blank" rel="noopener">Source</a> · fetched ${esc(str(rmnp.fetched) ?? "unknown")}</p>` : ""}
      </article>`
    : "";

  const brainard = landAccessAreas(bundle)[0];
  const timed = brainard && isRecord(brainard.timed_entry) ? brainard.timed_entry : undefined;
  const fallback = brainard && isRecord(brainard.fallback) ? brainard.fallback : undefined;
  const brainardHtml = brainard
    ? `<article class="card">
        <h3>${esc(str(brainard.name) ?? "Brainard Lake")}</h3>
        ${str(brainard.why_it_matters) ? `<p>${esc(str(brainard.why_it_matters)!)}</p>` : ""}
        ${timed && str(timed.ticket_season_2026) ? `<p><span class="k">Ticket season 2026</span> ${esc(str(timed.ticket_season_2026)!)}</p>` : ""}
        ${timed && str(timed.trip_dates_status) ? `<p>${esc(str(timed.trip_dates_status)!)}</p>` : ""}
        ${
          fallback
            ? `<p><span class="k">Fallback</span> ${esc(str(fallback.name) ?? "Gateway")}${str(fallback.detail) ? ` — ${esc(str(fallback.detail)!)}` : ""}</p>
               ${str(fallback.fees) ? `<p class="whisper">${esc(str(fallback.fees)!)}</p>` : ""}
               ${str(fallback.source) ? `<p class="whisper"><a href="${esc(str(fallback.source)!)}" target="_blank" rel="noopener">Gateway source</a></p>` : ""}`
            : ""
        }
        ${str(brainard.fees) ? `<p><span class="k">Fees</span> ${esc(str(brainard.fees)!)}</p>` : ""}
        ${str(brainard.shuttle) ? `<p><span class="k">Shuttle</span> ${esc(str(brainard.shuttle)!)}</p>` : ""}
        ${str(brainard.dogs) ? `<p><span class="k">Dogs</span> ${esc(str(brainard.dogs)!)}</p>` : ""}
        ${timed && str(timed.source) ? `<p class="whisper"><a href="${esc(str(timed.source)!)}" target="_blank" rel="noopener">Timed-entry source</a></p>` : ""}
        ${str(brainard.fetched) ? `<p class="whisper">fetched ${esc(str(brainard.fetched)!)}</p>` : ""}
      </article>`
    : "";

  const gate = collection(bundle, "gates");
  const liveGate = state.live.find((r) => r.kind === "gate");
  const gateHtml = isRecord(gate)
    ? `<article class="card">
        <h3>Brainard gate (bundle)</h3>
        <p class="lede">${esc(str(gate.last_seen) ?? "last_seen unknown")}</p>
        <p class="whisper">checked ${esc(str(gate.checked) ?? "—")}</p>
        <p class="note">A failed live fetch is not “closed”.</p>
        ${liveGate && !liveGate.ok ? `<p class="gap">${esc(`Live fetch failed — ${liveGate.error ?? "error"}. Not interpreted as closed.`)}</p>` : ""}
        ${str(gate.source) ? `<p><a href="${esc(str(gate.source)!)}" target="_blank" rel="noopener">Road status source</a></p>` : ""}
        ${str(gate.why) ? `<p class="whisper">${esc(str(gate.why)!)}</p>` : ""}
      </article>`
    : "";

  const exceptions = landNamedExceptions(bundle);
  const exceptionsHtml = exceptions.length
    ? `<article class="card ${state.dogsWithUs ? "folded-dogs" : ""}">
        <h3>${state.dogsWithUs ? "Not with the dogs" : "Named dog bans"}</h3>
        ${state.dogsWithUs ? `<p class="whisper">Folded, not removed.</p>` : ""}
        <ul class="facts tight">${exceptions
          .map((ex) => {
            const name = str(ex.match) ?? "place";
            const detail = str(ex.detail);
            const src = str(ex.source);
            return `<li><strong>${esc(name)}</strong> · ${esc(str(ex.dogs) ?? "prohibited")}${detail ? ` — ${esc(detail)}` : ""}${src ? ` <a href="${esc(src)}" target="_blank" rel="noopener">Source</a>` : ""}</li>`;
          })
          .join("")}</ul>
      </article>`
    : "";

  const managers = landManagers(bundle);
  const fetched = landFetched(bundle);
  const managersHtml = managers.length
    ? `<details class="fold">
        <summary>Land manager summary${fetched ? ` · fetched ${esc(fetched)}` : ""}</summary>
        ${managers
          .map(
            (m) =>
              `<article class="card quiet-card"><h3 class="inline-h">${esc(m.name)}</h3>
               <p class="lede">${esc(str(m.raw.dogs) ?? "unknown")}</p>
               ${str(m.raw.detail) ? `<p>${esc(str(m.raw.detail)!)}</p>` : ""}
               <p class="whisper">fetched ${esc(str(m.raw.fetched) ?? fetched ?? "unknown")}</p>
               ${str(m.raw.source) ? `<p class="whisper"><a href="${esc(str(m.raw.source)!)}" target="_blank" rel="noopener">Source</a></p>` : ""}
              </article>`,
          )
          .join("")}
      </details>`
    : "";

  return `${rmnpHtml}${brainardHtml}${gateHtml}${exceptionsHtml}${managersHtml}`;
}

function foodDirectoryLinks(bundle: TripBundle, items: ReturnType<typeof namedItems>): string {
  const dirs = foodDirectories(bundle);
  const areas = [...new Set(items.map((i) => areaOf(i.raw)).filter((a): a is string => Boolean(a)))];
  const links = areas
    .map((a) => {
      const url = dirs[a];
      if (!url) return "";
      return `<a href="${esc(url)}" target="_blank" rel="noopener">Find Me Gluten Free — ${esc(a.replace(/_/g, " "))}</a>`;
    })
    .filter(Boolean);
  return links.length ? `<p class="whisper">${links.join(" · ")}</p>` : "";
}

function renderToday(bundle: TripBundle): string {
  const tz = placeById(bundle, "drake")?.tz || "America/Denver";
  const now = todayIso(tz);
  const pick = nextOrToday(bundle, now);
  const day = pick.day;
  const food = foodForDay(bundle, day);
  const items = sortItems(
    menuItems(bundle).filter((it) => matchesFilters(it.raw, state.filters)),
    bundle,
  );
  const statusLine =
    pick.status === "today"
      ? prettyDate(now)
      : pick.status === "before"
        ? `Trip has not started (${prettyDate(now)}). First day ${prettyDate(day?.date)}.`
        : pick.status === "after"
          ? `After last day in days[] (${prettyDate(now)}).`
          : `Today ${prettyDate(now)} has no days[] row — gap.`;

  const titleDate = prettyDate(day?.date) || prettyDate(now) || "Today";
  const ranking = foliageRanking(bundle);
  const always = isRecord(collection(bundle, "food"))
    ? str((collection(bundle, "food") as Record<string, unknown>).always_print)
    : undefined;

  return `<section class="today">
    <p class="kicker">${esc(statusLine === titleDate ? bundle.trip?.name ?? "Trip" : statusLine)}</p>
    <h1>${esc(titleDate)}</h1>
    <p class="lightline"><a href="#/light">${esc(oneLineLight(day))}</a></p>
    <p class="whisper">${esc(cacheAge(state.loadedAt))} · ${esc(state.source)}${bundle.generated ? ` · bundle ${esc(bundle.generated)}` : ""}</p>
    ${day?.note ? `<details class="fold"><summary>Day note</summary><p>${esc(String(day.note))}</p></details>` : ""}
    <h2>Hikes &amp; photo ops</h2>
    <p class="note">A menu, not a schedule. Skip all is valid. Hiking nav is AllTrails, not this app. Cabin chips are which base a card serves, not a day’s plan.</p>
    ${hikeListNotes(items)}
    ${emptyOrMissing("hikes", bundle, "Hikes")}
    ${collapsedCards(items, "", "hikes")}
    ${renderGatewayCard(bundle)}
    <h2>Food nearby</h2>
    ${always ? `<p class="note">${esc(always)}</p>` : ""}
    ${foodDirectoryLinks(bundle, food)}
    ${
      food.length
        ? collapsedCards(food, "food", "food")
        : foodItems(bundle).length
          ? `<p class="note">No places tagged for this base. Full list is on Food.</p>`
          : emptyOrMissing("food", bundle, "Food")
    }
    <h2>Brainard + permits</h2>
    ${renderLandAndPermits(bundle)}
    <h2>Fall color</h2>
    <p class="lede"><a href="#/color">Webcams first, then a map of cabins we have pins for — open Color</a></p>
    ${ranking ? `<p class="whisper">${esc(ranking)}</p>` : ""}
    <p class="print-link"><a href="#/print/${esc(day?.date ?? "")}">Printable day view</a></p>
  </section>`;
}

function renderLight(bundle: TripBundle): string {
  const days = daysList(bundle);
  const darkest = darkestPlausibleNight(days);
  const oct4 = days.find((d) => d.date === "2026-10-04");
  const oct4Hours = oct4 ? darkHoursHint(oct4) : undefined;
  return `<section>
    <h1>Days / light</h1>
    <p class="note">Bundle light only. This app does not recompute sun. Wrap-around 23–24 h driving verdicts are not a night length.</p>
    ${
      darkest
        ? `<p class="callout">Longest plausible darkness in this file: <strong>${esc(prettyDate(darkest.day.date))} (${esc(darkest.day.date)})</strong> · ${esc(String(darkest.hours))} h${oct4Hours !== undefined ? `. ${esc(prettyDate("2026-10-04"))} has ${esc(String(oct4Hours))} h.` : ""}</p>`
        : `<p class="gap">Dark-hours figures not complete in this file.</p>`
    }
    <p class="whisper table-hint">On a phone each day is a card. On a laptop this is a table — swipe if needed.</p>
    <div class="table-wrap"><table class="light-table">
      <thead><tr><th>Date</th><th>Base</th><th>Up / down</th><th>Gold AM</th><th>Gold PM</th><th>Civil</th><th>Thermals</th><th>Moon</th><th>Dark window</th><th>Night</th></tr></thead>
      <tbody>
        ${days
          .map((d) => {
            const L = d.light;
            const moon = L?.moon;
            const night = moon?.verdict;
            const hours = darkHoursHint(d);
            const wrap = hours !== undefined && hours >= 12;
            const thermals = L?.thermals?.length ? L.thermals.join("–") : undefined;
            const civil =
              L?.civil_dawn && L?.civil_dusk ? `${L.civil_dawn} / ${L.civil_dusk}` : undefined;
            const moonLine = moon
              ? [
                  moon.phase,
                  moon.illumination_pct != null ? `${moon.illumination_pct}%` : null,
                  moon.moonrise || moon.moonset ? `rise ${moon.moonrise ?? "—"} / set ${moon.moonset ?? "—"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined;
            const darkWin = moon?.dark_window?.length ? moon.dark_window.join("–") : undefined;
            return `<tr>
              <td data-label="Date">${esc(prettyDate(d.date))}<br><span class="whisper">${esc(d.date)} · ${esc(d.kind ?? "")}</span></td>
              <td data-label="Base">${esc(d.base ?? d.light_computed_for ?? "—")}</td>
              <td data-label="Up / down">${L?.sunrise && L?.sunset ? `${esc(L.sunrise)} / ${esc(L.sunset)}` : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Gold AM">${L?.golden_am?.length ? esc(L.golden_am.join("–")) : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Gold PM">${L?.golden_pm?.length ? esc(L.golden_pm.join("–")) : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Civil">${civil ? esc(civil) : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Thermals">${thermals ? `${esc(thermals)} <span class="whisper">(raptor soaring)</span>` : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Moon">${moonLine ? esc(moonLine) : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Dark window">${darkWin ? esc(darkWin) : `<span class="unknown">unknown</span>`}</td>
              <td data-label="Night">${night ? esc(night) : `<span class="unknown">unknown</span>`}${wrap ? `<span class="whisper"> (wrap-around verdict — not a night length)</span>` : ""}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table></div>
  </section>`;
}

function renderFilters(bundle: TripBundle): string {
  const items = sortItems(
    menuItems(bundle).filter((it) => matchesFilters(it.raw, state.filters)),
    bundle,
  );
  const subjects = [...new Set(menuItems(bundle).flatMap((i) => subjectOf(i.raw)))];
  return `<section>
    <h1>Filters</h1>
    <p class="note">Filters do not pick a winner. Default sort is nearby/GPS when permitted. <code>no_early_mornings</code> is a sort key, not a filter. Hiking nav is AllTrails, not this app.</p>
    ${hikeListNotes(items)}
    <form class="filters" data-action="filters">
      <label>Dogs
        <select name="dogs">
          ${["any", "ok", "unknown", "banned"].map((v) => `<option value="${v}" ${state.filters.dogs === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </label>
      <label>Permit
        <select name="permit">
          ${["any", "yes", "no", "unknown"].map((v) => `<option value="${v}" ${state.filters.permit === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </label>
      <label>Subject
        <select name="subject">
          <option value="">any</option>
          ${subjects.map((s) => `<option ${state.filters.subject === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
          ${(bundle.trip?.subjects ?? []).map((s) => `<option ${state.filters.subject === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
      </label>
      <label>Max miles (unknown stay visible)
        <input name="maxMiles" inputmode="decimal" value="${esc(state.filters.maxMiles)}" placeholder="e.g. 4">
      </label>
    </form>
    <p class="meta">${items.length} shown · skip all is valid</p>
    ${items.length ? groupedByArea(items) : emptyOrMissing("hikes", bundle, "Hikes")}
  </section>`;
}

function renderOpen(bundle: TripBundle): string {
  const decisions = namedItems(collection(bundle, "decisions"), "decision");
  const overs = runsList(bundle).filter((r) => String(r.overnight).toLowerCase() === "open");
  return `<section>
    <h1>Open calls</h1>
    <p class="note">Decisions stay open. This app does not choose.</p>
    ${
      decisions.length
        ? decisions
            .map((d) => {
              const opts = namedItems(d.raw.options, "opt");
              return `<article class="card">
                <h3>${esc(d.name)}</h3>
                <p class="whisper">${esc(str(d.raw.status) ?? "open")}</p>
                ${d.raw.note ? `<p>${esc(String(d.raw.note))}</p>` : ""}
                ${opts.length ? opts.map((o) => `<p>${esc(o.name)}${o.raw.cost ? ` — ${esc(String(o.raw.cost))}` : ""}</p>`).join("") : `<p class="gap">${esc(str(d.raw.options_note) ?? "No costed options in this bundle.")}</p>`}
              </article>`;
            })
            .join("")
        : `<p class="gap">No open_decisions array in this bundle.</p>`
    }
    ${overs
      .map(
        (r) =>
          `<article class="card"><h3>Overnight on ${esc(r.id)}</h3><p class="whisper">open — never a chosen stop</p>${r.note ? `<p>${esc(r.note)}</p>` : ""}</article>`,
      )
      .join("")}
  </section>`;
}

function renderFood(bundle: TripBundle): string {
  const items = foodItems(bundle);
  const meta = collection(bundle, "food");
  const areas = isRecord(meta) && isRecord(meta.areas) ? Object.keys(meta.areas) : isRecord(meta) && Array.isArray(meta.areas) ? meta.areas.map(String) : [];
  const always = isRecord(meta) ? str(meta.always_print) : undefined;
  return `<section>
    <h1>Food</h1>
    <p class="note">GF and DF are separate. Preference, not celiac. Missing tag does not hide a place. Unknown is not safe.</p>
    ${always ? `<p class="whisper">${esc(always)}</p>` : ""}
    ${areas.length ? `<p class="whisper">${areas.map((a) => esc(a.replace(/_/g, " "))).join(" · ")}</p>` : ""}
    ${emptyOrMissing("food", bundle, "Food")}
    ${
      items.length
        ? groupedBlocks(
            items,
            (i) => itemCard(i, "food"),
            ["estes park", "nederland", "lubbock", "amarillo"],
            "food",
            (key) => {
              const dirs = foodDirectories(bundle);
              const url = dirs[key.replace(/ /g, "_")] ?? dirs[key];
              return url
                ? `<p class="whisper"><a href="${esc(url)}" target="_blank" rel="noopener">Find Me Gluten Free</a></p>`
                : "";
            },
          )
        : ""
    }
  </section>`;
}

function renderGaps(bundle: TripBundle): string {
  const listed = namedItems(collection(bundle, "gaps"), "gap");
  const derived = missingInventory(bundle);
  return `<section>
    <h1>Gaps</h1>
    <p class="note">Unknown stays unknown. This screen prints holes; it does not fill them.</p>
    <h2>From the bundle</h2>
    ${
      listed.length
        ? `<ul class="facts">${listed.map((g) => `<li><strong>${esc(g.name)}</strong>${g.raw.note ? ` — ${esc(String(g.raw.note))}` : ""}</li>`).join("")}</ul>`
        : `<p class="gap">No gaps[] array. Derived holes still listed below.</p>`
    }
    <h2>Derived from missing keys</h2>
    <ul class="facts">${derived.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
  </section>`;
}

function renderMore(bundle: TripBundle): string {
  const a2hs = state.standalone
    ? `<p class="ok">Running as Home Screen app — not nagging.</p>`
    : `<ol class="a2hs">
        <li>Safari: Share (square with arrow).</li>
        <li>Add to Home Screen → Add.</li>
        <li>Open from the home screen next time.</li>
      </ol>`;
  const live = state.live;
  const targets = bundleLiveTargets(bundle);
  const gate = collection(bundle, "gates");
  return `<section>
    <h1>More</h1>
    <nav class="more-links" aria-label="Other screens">
      <a href="#/light">Days / light</a>
      <a href="#/filters">Filters</a>
      <a href="#/open">Open calls</a>
      <a href="#/gaps">Gaps</a>
    </nav>
    <h2>Install</h2>
    <article class="card quiet-card">
      <h2 class="inline-h">Add to Home Screen</h2>
      ${a2hs}
    </article>
    <article class="card quiet-card">
      <h2 class="inline-h">Save for offline</h2>
      <p class="note">Caches the shell and bundle. Then Airplane Mode, reopen the Home Screen icon.</p>
      <button class="btn" data-action="save-offline" ${state.saveProgress !== null ? "disabled" : ""}>Save for offline</button>
      ${state.saveProgress !== null ? `<p class="whisper">Saving… ${Math.round(state.saveProgress * 100)}%</p>` : ""}
      ${state.saveMessage ? `<p class="${state.saveMessage.startsWith("Saved") ? "ok" : "gap"}">${esc(state.saveMessage)}</p>` : ""}
      <p class="whisper">${esc(cacheAge(state.loadedAt))} · ${esc(state.source)}</p>
    </article>
    <h2>Webcams &amp; gate</h2>
    <p class="note">Display only. A failed fetch is not “closed” and not “no color”.</p>
    ${targets.length ? `<button class="btn" data-action="refresh-live" ${state.liveBusy ? "disabled" : ""}>Fetch live</button>` : `<p class="gap">No webcam or gate URLs in this bundle.</p>`}
    ${
      isRecord(gate)
        ? `<article class="card quiet-card"><h3>${esc(str(gate.name) ?? "Brainard")}</h3>
           <p class="lede">${esc(str(gate.last_seen) ?? "last_seen unknown")}</p>
           <p class="whisper">checked ${esc(str(gate.checked) ?? "—")}</p>
           ${str(gate.why) || str(gate.note) ? `<details class="more-facts"><summary>Details</summary><p>${esc(str(gate.why) ?? str(gate.note) ?? "")}</p></details>` : ""}
           </article>`
        : ""
    }
    ${live
      .map(
        (r) =>
          `<article class="card ${r.ok ? "" : "fail"}">
            <h3>${esc(r.label)}</h3>
            <p class="lede">${r.ok ? `Fetched HTTP ${r.status ?? ""}` : esc(r.error ?? "failed")}</p>
            <p class="whisper">fetched-at ${esc(r.fetchedAt)}</p>
            ${r.ok && r.kind === "webcam" ? `<img alt="" src="${esc(r.url)}">` : `<p class="whisper"><a href="${esc(r.url)}">${esc(r.url)}</a></p>`}
          </article>`,
      )
      .join("")}
    <label class="toggle"><input type="checkbox" data-action="dogs-with-us" ${state.dogsWithUs ? "checked" : ""}> Dogs-with-us (session). Banned places fold, they do not vanish.</label>
    ${behaviourBlock(bundle)}
  </section>`;
}

function behaviourBlock(bundle: TripBundle): string {
  const b = collection(bundle, "behaviour");
  const land = collection(bundle, "land_rules");
  const bits: string[] = [];
  if (isRecord(b)) {
    if (b.no_early_mornings_note) bits.push(String(b.no_early_mornings_note));
    if (b.gf_df_note) bits.push(String(b.gf_df_note));
    if (b.disagreeing_sources) bits.push(`Disagreeing sources: ${String(b.disagreeing_sources)}`);
    if (isRecord(b.subjects) && isRecord(b.subjects.bighorn)) {
      const detail = str(b.subjects.bighorn.detail);
      if (detail) bits.push(detail);
    }
  }
  if (isRecord(land) && land.bighorn_rut === false) bits.push("Bighorn are NOT in rut.");
  if (!bits.length) return "";
  return `<details class="fold"><summary>Behaviour / land</summary><ul class="facts tight">${bits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
}

function allMappable(bundle: TripBundle): Array<{ id: string; name: string; lat: number; lon: number; kind: string }> {
  const out: Array<{ id: string; name: string; lat: number; lon: number; kind: string }> = [];
  for (const p of placesList(bundle)) {
    if (p.lat != null && p.lon != null) out.push({ id: p.id ?? p.name ?? "place", name: p.name ?? "place", lat: p.lat, lon: p.lon, kind: "cabin/origin" });
  }
  for (const it of menuItems(bundle)) {
    const c = itemLatLon(it.raw);
    if (c) out.push({ id: it.id, name: it.name, lat: c.lat, lon: c.lon, kind: "trail/photo" });
  }
  return out;
}

function renderMap(bundle: TripBundle): string {
  const list = allMappable(bundle);
  return `<section class="map-screen">
    <h1>Map</h1>
    <p class="note">One map, synced to the list. Not hiking GPS, not turn-by-turn, not offline topo.</p>
    <div id="map" class="map" role="application"></div>
    <ul class="sync-list">
      ${list
        .map(
          (p) =>
            `<li><button class="linkish ${state.selectedId === p.id ? "on" : ""}" data-action="select" data-id="${esc(p.id)}" data-lat="${p.lat}" data-lon="${p.lon}">${esc(p.name)}</button>
             <a class="btn small" href="${esc(mapsUrl(p.lat, p.lon, p.name))}">Open in Maps</a></li>`,
        )
        .join("") || `<li class="gap">No coordinates in this bundle beyond cabins/origin.</li>`}
    </ul>
  </section>`;
}

function tripStops(bundle: TripBundle): Array<{ id: string; name: string; lat: number; lon: number; kind: string }> {
  const out: Array<{ id: string; name: string; lat: number; lon: number; kind: string }> = [];
  for (const p of placesList(bundle)) {
    if (p.lat != null && p.lon != null) {
      out.push({
        id: p.id ?? p.name ?? "place",
        name: p.name ?? "place",
        lat: p.lat,
        lon: p.lon,
        kind: p.id === "origin" ? "origin" : "cabin",
      });
    }
  }
  for (const it of menuItems(bundle)) {
    const c = itemLatLon(it.raw);
    if (c) out.push({ id: it.id, name: it.name, lat: c.lat, lon: c.lon, kind: "trail/photo" });
  }
  return out;
}

function renderAround(bundle: TripBundle): string {
  const detour = bundle.trip?.detour_minutes;
  const stops = tripStops(bundle);
  const gps = state.gps;
  const sortedStops = gps
    ? stops.slice().sort((a, b) => haversineKm(gps.lat, gps.lon, a.lat, a.lon) - haversineKm(gps.lat, gps.lon, b.lat, b.lon))
    : stops;
  return `<section>
    <h1>Around</h1>
    <p class="lede">Things to do around us. Trip-bundle stops first. OSM extras are UNVERIFIED. Not gas. Not hiking GPS. Not turn-by-turn.</p>
    <p class="note">detour_minutes = ${detour ?? "unknown"} (printed as minutes, not converted to miles).</p>
    ${
      gps
        ? `<p class="whisper">GPS ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}</p>`
        : `<p class="note">This screen asks for location when you open it. Fail visibly if denied.</p>`
    }
    ${state.gpsError ? `<p class="gap">${esc(state.gpsError)}</p>` : ""}
    <p>
      <button class="btn" data-action="gps">${gps ? "Refresh GPS" : "Use my location"}</button>
      <button class="btn" data-action="extras" ${gps ? "" : "disabled"}>${state.extrasBusy ? "Loading extras…" : "Refresh extras"}</button>
    </p>
    <h2>Trip stops (engine)</h2>
    ${
      sortedStops
        .map((s) => {
          const d = gps ? `${haversineKm(gps.lat, gps.lon, s.lat, s.lon).toFixed(1)} km` : "";
          return `<article class="card"><h3>${esc(s.name)}</h3><p class="whisper">${esc(s.kind)}${d ? ` · ${esc(d)}` : ""}</p>
            <a class="btn small" href="${esc(mapsUrl(s.lat, s.lon, s.name))}">Open in Maps</a></article>`;
        })
        .join("") || `<p class="gap">No trip stops with pins in this bundle.</p>`
    }
    <h2>UNVERIFIED extras</h2>
    <p class="note">Viewpoints, pullouts, overlooks, wildlife viewing from OpenStreetMap. Fuel is never listed. Not mixed into Today.</p>
    ${state.extrasBusy ? `<p class="note">Loading extras…</p>` : ""}
    ${state.extrasError ? `<p class="gap">${esc(state.extrasError)}</p>` : ""}
    ${state.extrasAt ? `<p class="whisper">fetched-at ${esc(state.extrasAt)}</p>` : ""}
    ${
      state.extras.length
        ? state.extras
            .map(
              (e) =>
                `<article class="card unverified"><h3>${esc(e.name)}</h3><p class="whisper">UNVERIFIED · ${esc(e.kind)}</p>
                 <a class="btn small" href="${esc(mapsUrl(e.lat, e.lon, e.name))}">Open in Maps</a></article>`,
            )
            .join("")
        : gps && !state.extrasBusy && !state.extrasError
          ? `<p class="note">No extras returned yet.</p>`
          : ""
    }
    <p class="whisper">Open in Maps for turn-by-turn. This screen is not GPS navigation.</p>
  </section>`;
}

function fmtFt(n: number | undefined): string {
  if (n === undefined) return "ft unknown";
  return `${n} ft`;
}

function colorPins(bundle: TripBundle): Array<{
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation_display?: string | null;
}> {
  const out: Array<{
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevation_display?: string | null;
  }> = [];
  for (const id of ["drake", "nederland"] as const) {
    const p = placeById(bundle, id);
    if (p?.lat != null && p.lon != null) {
      out.push({
        id: p.id ?? id,
        name: p.name ?? id,
        lat: p.lat,
        lon: p.lon,
        elevation_display: p.elevation_display,
      });
    }
  }
  return out;
}

function bandMatchesPin(placeName: string, bandPlace: string): boolean {
  const n = placeName.toLowerCase();
  const b = bandPlace.toLowerCase();
  return n.includes(b) || b.includes(n.split(",")[0]?.trim() ?? n);
}

function renderColor(bundle: TripBundle): string {
  const cams = foliageWebcams(bundle);
  const sources = foliageSources(bundle);
  const explore = foliageExploreFallUrl(bundle);
  const bands = foliageBands(bundle);
  const pins = colorPins(bundle);
  const unpinned = bands.filter((band) => !pins.some((p) => bandMatchesPin(p.name, band.place)));
  const ranking = foliageRanking(bundle);
  const asOf = foliageModelFetched(bundle);
  const county = foliageCountyWindows(bundle);
  return `<section>
    <h1>Color</h1>
    <p class="lede">Webcam stills first (bundle ranking). Then pins that exist in this bundle. Then FORECAST county windows and elevation model. OBSERVATION none if missing. Not hiking GPS.</p>
    ${ranking ? `<p class="note">${esc(ranking)}</p>` : ""}
    <h2>Webcam stills</h2>
    <p class="whisper">${cams.length} RMNP stills in foliage.webcams. Failed fetch is not “no color”.</p>
    <p><button class="btn" data-action="color-cams" ${state.colorBusy ? "disabled" : ""}>${state.colorBusy ? "Refreshing…" : "Refresh stills"}</button></p>
    ${
      cams.length
        ? cams
            .map((cam) => {
              const live = state.colorCams.find((r) => r.url === cam.url);
              const stamp = live?.fetchedAt ?? "not fetched yet";
              const fail =
                live && !live.ok
                  ? `<p class="gap">${esc(`fetch failed — ${live.error ?? "unknown"}. This is not “no color”. Still showing the NPS still URL.`)}</p>`
                  : "";
              return `<article class="card webcam-card">
                <h3>${esc(cam.name)}</h3>
                ${cam.note ? `<p class="whisper">${esc(cam.note)}</p>` : ""}
                ${cam.url ? `<p><img class="webcam" src="${esc(cam.url)}" alt="${esc(cam.name)}" loading="lazy" /></p>` : `<p class="gap">Webcam URL missing.</p>`}
                ${fail}
                <p class="whisper">fetched-at ${esc(stamp)}</p>
                ${cam.url ? `<p class="whisper"><a href="${esc(cam.url)}">Open still</a></p>` : ""}
              </article>`;
            })
            .join("")
        : `<p class="gap">No webcams in this bundle.</p>`
    }
    <h2>Fall color map</h2>
    <p class="note">Only places with coordinates in this bundle are pinned: Drake and Nederland. Trail Ridge, Bear Lake, and Estes Park have no pin. Not hiking GPS, not turn-by-turn, not offline topo.</p>
    <div id="color-map" class="map" role="application" aria-label="Fall color map of bundle pins"></div>
    <h3 class="inline-h">No pin in this bundle</h3>
    <ul class="facts">
      ${
        unpinned.length
          ? unpinned
              .map(
                (band) =>
                  `<li><strong>${esc(band.place)}</strong> · ${esc(fmtFt(band.elevation_ft))} · modelled peak ${esc(band.modelled_peak ?? "unknown")} · FORECAST</li>`,
              )
              .join("")
          : `<li class="note">Every modelled band has a pin in this bundle.</li>`
      }
    </ul>
    ${
      explore
        ? `<p><a class="btn" href="${esc(explore)}" target="_blank" rel="noopener">Open fall color map</a></p>
           <p class="whisper">Explore Fall Colorado map. Extra — not the only map. Not scraped into this app as an observation.</p>`
        : `<p class="gap">Explore Fall URL missing from foliage.sources.</p>`
    }
    <h2>FORECAST — county windows</h2>
    <ul class="facts">
      ${
        county.length
          ? county
              .map((w) => {
                const window = w.from && w.to ? `${w.from} → ${w.to}` : w.from ?? "missing";
                return `<li><strong>${esc(w.county)}</strong> ${esc(window)} · FORECAST</li>`;
              })
              .join("")
          : `<li class="note">No county_forecast in this bundle.</li>`
      }
    </ul>
    <h2>FORECAST — elevation model</h2>
    ${foliageModelRule(bundle) ? `<p class="lede">${esc(foliageModelRule(bundle)!)} · FORECAST / model</p>` : ""}
    <p class="note">${esc(foliageModelStatus(bundle) || "MODEL status missing.")}</p>
    <p class="whisper">as-of: ${esc(asOf || "missing")}</p>
    <ul class="facts">
      ${
        bands.length
          ? bands
              .map(
                (band) =>
                  `<li><strong>${esc(band.place)}</strong> ${esc(fmtFt(band.elevation_ft))} · modelled peak ${esc(band.modelled_peak ?? "unknown")} · FORECAST</li>`,
              )
              .join("")
          : `<li class="note">No model bands.</li>`
      }
    </ul>
    <h2>OBSERVATION</h2>
    <p>${foliageHasObservation(bundle) ? esc("Observation object present in this bundle.") : "OBSERVATION: none in this bundle"}</p>
    ${
      sources.filter((s) => s.url !== explore).length
        ? `<h2>Other foliage sources</h2><ul class="facts">${sources
            .filter((s) => s.url !== explore)
            .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.what ? ` — ${esc(s.what)}` : ""}</li>`)
            .join("")}</ul>`
        : ""
    }
  </section>`;
}

function renderPhotos(bundle: TripBundle): string {
  const subjects = tripSubjects(bundle);
  const subjectCards = subjects
    .map((name) => {
      const s = behaviourSubject(bundle, name);
      const places = s?.places ?? [];
      const placesHtml =
        places.length === 0
          ? `<p class="gap">${esc(`GAP: no named places for ${name} in this bundle. Empty list is not “nothing here”.`)}</p>`
          : `<ul class="facts">${places
              .map(
                (place) =>
                  `<li>
                    <strong>${esc(place)}</strong>
                    <span class="whisper"> · no pin in this bundle</span>
                    <p><a class="btn small" href="${esc(mapsSearchUrl(place))}">Open in Maps (name search)</a></p>
                  </li>`,
              )
              .join("")}</ul>
            <p class="whisper">Meadow names without coordinates stay names. Do not invent photo-op pins.</p>`;
      const extra =
        name === "bighorn"
          ? `<p class="lede">${esc(s?.detail?.match(/NOT in rut/i)?.[0] ?? "NOT in rut")}</p>`
          : "";
      return `<article class="card">
        <h2 class="inline-h">${esc(name)}</h2>
        ${extra}
        <p>${esc(s?.detail || s?.action || "No behaviour text.")}</p>
        ${s?.restriction ? `<p class="gap">${esc(s.restriction)}</p>` : ""}
        ${placesHtml}
        <p class="whisper">fetched-at ${esc(s?.fetched || "missing")}</p>
        ${s?.source ? `<p class="whisper"><a href="${esc(s.source)}">Source</a></p>` : ""}
      </article>`;
    })
    .join("");

  const hikes = menuItems(bundle);
  const hikeNames = groupedBlocks(hikes, (h) => itemCard(h), AREA_ORDER);

  return `<section>
    <h1>Photos</h1>
    <p class="lede">Subjects from trip.subjects. Named elk meadows from behaviour — names only, no invented pins. Hikes as picture spots, grouped by area.</p>
    ${subjectCards || `<p class="gap">trip.subjects missing.</p>`}
    <h2>Hikes as picture spots</h2>
    ${hikeNames}
  </section>`;
}

function renderPrint(bundle: TripBundle, date: string): string {
  const day = pickDay(bundle, date);
  return `<section class="print">
    <h1>Day ${esc(date)}</h1>
    <p class="note">Bundle only. Engine HTML sheets remain the field copy.</p>
    ${day ? `<pre class="sheet">${esc(JSON.stringify(day, null, 2))}</pre>` : `<p class="gap">${esc(date)} is not a days[] row.</p>`}
    <button class="btn" data-action="print">Print</button>
  </section>`;
}

function shell(body: string): string {
  const nav: Array<[RouteId, string]> = [
    ["today", "Today"],
    ["around", "Around"],
    ["photos", "Photos"],
    ["color", "Color"],
    ["food", "Food"],
    ["map", "Map"],
    ["more", "More"],
  ];
  const on = (id: RouteId) => {
    if (id === "around") return state.route === "around" || state.route === "drive";
    return state.route === id;
  };
  return `<div class="frame">
    <header class="top">
      <p class="brand">Colorado trip</p>
      <label class="toggle compact"><input type="checkbox" data-action="dogs-with-us" ${state.dogsWithUs ? "checked" : ""}> Dogs with us</label>
    </header>
    <nav class="tabbar" aria-label="Screens">${nav
      .map(
        ([id, label]) =>
          `<a class="${on(id) ? "on" : ""}" href="#/${id}">${label}</a>`,
      )
      .join("")}</nav>
    <main id="main">${body}</main>
  </div>`;
}

function destroyMaps(keep: "map" | "color" | "none"): void {
  if (keep !== "map" && map) {
    map.remove();
    map = null;
  }
  if (keep !== "color" && colorMap) {
    colorMap.remove();
    colorMap = null;
  }
}

async function mountMap(bundle: TripBundle): Promise<void> {
  const el = document.getElementById("map");
  if (!el) return;
  const L = await import("leaflet");
  if (map) {
    map.remove();
    map = null;
  }
  const pts = allMappable(bundle);
  const center: [number, number] = pts[0] ? [pts[0].lat, pts[0].lon] : [40.0, -105.5];
  map = L.map(el).setView(center, 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 18,
  }).addTo(map);
  for (const p of pts) {
    const m = L.circleMarker([p.lat, p.lon], {
      radius: 9,
      color: "#e8b048",
      fillColor: "#16302a",
      fillOpacity: 1,
      weight: 2,
    })
      .addTo(map)
      .bindPopup(
        `<strong>${esc(p.name)}</strong><br><a href="${esc(mapsUrl(p.lat, p.lon, p.name))}">Open in Maps</a>`,
      );
    m.on("click", () => {
      state.selectedId = p.id;
      document.querySelectorAll(".sync-list .linkish").forEach((node) => {
        node.classList.toggle("on", (node as HTMLElement).dataset.id === p.id);
      });
    });
  }
  if (pts.length > 1) {
    map.fitBounds(
      L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])),
      { padding: [24, 24] },
    );
  }
  const sel = pts.find((p) => p.id === state.selectedId);
  if (sel) map.setView([sel.lat, sel.lon], 12);
}

async function mountColorMap(bundle: TripBundle): Promise<void> {
  const el = document.getElementById("color-map");
  if (!el) return;
  const L = await import("leaflet");
  if (colorMap) {
    colorMap.remove();
    colorMap = null;
  }
  const pins = colorPins(bundle);
  const asOf = foliageModelFetched(bundle) ?? "missing";
  const center: [number, number] = pins[0] ? [pins[0].lat, pins[0].lon] : [40.2, -105.4];
  colorMap = L.map(el).setView(center, 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 18,
  }).addTo(colorMap);
  for (const p of pins) {
    const band = foliageBandForPlace(bundle, p.name);
    const elev = p.elevation_display?.trim() || "elevation unknown";
    const peak = band?.modelled_peak
      ? `modelled peak ${band.modelled_peak}`
      : "no matching foliage band in this bundle";
    const html = `<strong>${esc(p.name)}</strong><br>${esc(elev)}<br>${esc(peak)} · FORECAST<br>as-of: ${esc(asOf)}<br><a href="${esc(mapsUrl(p.lat, p.lon, p.name))}">Open in Maps</a>`;
    L.circleMarker([p.lat, p.lon], {
      radius: 10,
      color: "#e8b048",
      fillColor: "#16302a",
      fillOpacity: 1,
      weight: 2,
    })
      .addTo(colorMap)
      .bindPopup(html);
  }
  if (pins.length > 1) {
    colorMap.fitBounds(
      L.latLngBounds(pins.map((p) => [p.lat, p.lon] as [number, number])),
      { padding: [28, 28] },
    );
  }
  requestAnimationFrame(() => colorMap?.invalidateSize());
}

function bodyHtml(): string {
  if (state.error && !state.bundle) {
    return `<section><h1>Bundle not loaded</h1><p class="gap">${esc(state.error)}</p><p class="note">Put the engine export at <code>public/trip-bundle.json</code> and serve it as <code>/trip-bundle.json</code>.</p></section>`;
  }
  const bundle = state.bundle;
  if (!bundle) return `<section><p>Loading…</p></section>`;
  if (state.printDate) return renderPrint(bundle, state.printDate);
  switch (state.route) {
    case "today":
      return renderToday(bundle);
    case "map":
      return renderMap(bundle);
    case "light":
      return renderLight(bundle);
    case "filters":
      return renderFilters(bundle);
    case "open":
      return renderOpen(bundle);
    case "drive":
    case "around":
      return renderAround(bundle);
    case "food":
      return renderFood(bundle);
    case "gaps":
      return renderGaps(bundle);
    case "more":
      return renderMore(bundle);
    case "color":
      return renderColor(bundle);
    case "photos":
      return renderPhotos(bundle);
  }
}

function afterPaint(): void {
  if (state.printDate) return;
  if (state.route === "around" && !aroundAutoStarted) {
    aroundAutoStarted = true;
    void (async () => {
      const ok = await requestGps();
      if (ok) await loadExtras();
    })();
  }
  if (state.route === "color" && !colorAutoStarted && state.bundle) {
    colorAutoStarted = true;
    void refreshColorCams();
  }
}

export function paint(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const printing = Boolean(state.printDate);
  document.body.classList.toggle("printing", printing);
  const keep = printing ? "none" : state.route === "map" ? "map" : state.route === "color" ? "color" : "none";
  destroyMaps(keep);
  root.innerHTML = printing ? bodyHtml() : shell(bodyHtml());
  if (state.route === "map" && state.bundle && !printing) {
    void mountMap(state.bundle);
  }
  if (state.route === "color" && state.bundle && !printing) {
    void mountColorMap(state.bundle);
  }
  afterPaint();
}

function bind(): void {
  document.getElementById("app")?.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!t) return;
    const action = t.dataset.action;
    if (action === "select") {
      state.selectedId = t.dataset.id ?? null;
      const lat = Number(t.dataset.lat);
      const lon = Number(t.dataset.lon);
      if (map && Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon], 12);
      document.querySelectorAll(".sync-list .linkish").forEach((el) => {
        el.classList.toggle("on", (el as HTMLElement).dataset.id === state.selectedId);
      });
    }
    if (action === "gps") void requestGps();
    if (action === "extras") void loadExtras();
    if (action === "save-offline") void saveOffline();
    if (action === "refresh-live") void refreshLive();
    if (action === "color-cams") void refreshColorCams();
    if (action === "print") window.print();
  });
  document.getElementById("app")?.addEventListener(
    "toggle",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLDetailsElement)) return;
      if (t.dataset.fold === "hikes") state.showAllHikes = t.open;
      if (t.dataset.fold === "food") state.showAllFood = t.open;
    },
    true,
  );
  document.getElementById("app")?.addEventListener("change", (ev) => {
    const target = ev.target as HTMLElement;
    if (target.matches("[data-action='dogs-with-us']")) {
      const on = (target as HTMLInputElement).checked;
      state.dogsWithUs = on;
      sessionStorage.setItem("dogsWithUs", on ? "1" : "0");
      paint();
      return;
    }
    const form = target.closest("form.filters");
    if (!form) return;
    const fd = new FormData(form as HTMLFormElement);
    state.filters = {
      dogs: (fd.get("dogs") as Filters["dogs"]) || "any",
      permit: (fd.get("permit") as Filters["permit"]) || "any",
      subject: String(fd.get("subject") || ""),
      maxMiles: String(fd.get("maxMiles") || ""),
    };
    paint();
  });
}

async function requestGps(): Promise<boolean> {
  if (!navigator.geolocation) {
    state.gpsError = "Geolocation is not available on this device.";
    paint();
    return false;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() };
        state.gpsError = null;
        paint();
        resolve(true);
      },
      (err) => {
        state.gpsError = `GPS denied or failed (${err.message}). Nearby sort stays off. Location is required for Around extras.`;
        paint();
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

async function loadExtras(): Promise<void> {
  const here = state.gps;
  if (!here) return;
  state.extrasBusy = true;
  paint();
  try {
    state.extras = await fetchUnverifiedExtras(here.lat, here.lon);
    state.extrasAt = new Date().toISOString();
    state.extrasError = null;
  } catch (e) {
    state.extrasError = `OSM extras fetch failed — ${e instanceof Error ? e.message : "error"}. Not treated as “nothing nearby”.`;
  }
  state.extrasBusy = false;
  paint();
}

async function refreshColorCams(): Promise<void> {
  if (!state.bundle) return;
  const cams = foliageWebcams(state.bundle);
  if (!cams.length) return;
  state.colorBusy = true;
  paint();
  const out: LiveResult[] = [];
  for (const cam of cams) {
    out.push(await fetchLive({ url: cam.url, label: cam.name, kind: "webcam" }));
  }
  state.colorCams = out;
  state.colorBusy = false;
  paint();
}

async function refreshLive(): Promise<void> {
  if (!state.bundle) return;
  state.liveBusy = true;
  paint();
  const targets = bundleLiveTargets(state.bundle);
  const out: LiveResult[] = [];
  for (const t of targets) out.push(await fetchLive(t));
  state.live = out;
  state.liveBusy = false;
  paint();
}

async function saveOffline(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const urls = [
    base,
    `${base}index.html`,
    `${base}trip-bundle.json`,
    `${base}manifest.webmanifest`,
    `${base}icons/icon-192.png`,
    `${base}icons/icon-512.png`,
    `${base}icons/apple-touch-180.png`,
  ];
  state.saveProgress = 0;
  state.saveMessage = null;
  paint();
  try {
    const cache = await caches.open("colorado-offline-v1");
    for (let i = 0; i < urls.length; i++) {
      await cache.add(urls[i]);
      state.saveProgress = (i + 1) / urls.length;
      paint();
    }
    state.saveProgress = null;
    state.saveMessage = "Saved. Turn on Airplane Mode and reopen this Home Screen icon to prove it.";
  } catch (e) {
    state.saveProgress = null;
    state.saveMessage = `Save failed — ${e instanceof Error ? e.message : "error"}.`;
  }
  paint();
}

async function loadBundle(): Promise<void> {
  const url = `${import.meta.env.BASE_URL}trip-bundle.json`;
  const cached = await idbGet<CachedBundle>("bundle").catch(() => undefined);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const json: unknown = await res.json();
    const bundle = validateBundle(json);
    state.bundle = bundle;
    state.error = null;
    state.loadedAt = Date.now();
    state.source = "network";
    await idbSet("bundle", { json, fetchedAt: state.loadedAt, url } satisfies CachedBundle);
  } catch (e) {
    if (cached?.json) {
      try {
        state.bundle = validateBundle(cached.json);
        state.error = `Live fetch failed (${e instanceof Error ? e.message : "error"}); showing last-loaded bundle.`;
        state.loadedAt = cached.fetchedAt;
        state.source = "idb";
      } catch {
        state.bundle = null;
        state.error = e instanceof Error ? e.message : "Bundle failed";
      }
    } else {
      state.bundle = null;
      state.error = e instanceof Error ? e.message : "Bundle failed";
    }
  }
}

function readRoute(): void {
  const p = parseHash();
  state.route = p.route;
  state.printDate = p.printDate;
  void idbSet("lastRoute", p.printDate ? `print/${p.printDate}` : p.route);
}

export async function start(): Promise<void> {
  state.standalone = isStandalone();
  const last = await idbGet<string>("lastRoute").catch(() => undefined);
  if (!location.hash && last) location.hash = `#/${last}`;
  readRoute();
  bind();
  window.addEventListener("hashchange", () => {
    readRoute();
    paint();
  });
  paint();
  await loadBundle();
  paint();
}
