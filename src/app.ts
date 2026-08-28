import type { Map as LeafletMap } from "leaflet";
import type { Day, LiveResult, TripBundle, UnverifiedExtra } from "./types";
import {
  areaOf,
  collection,
  collectionItems,
  collectionNote,
  darkHoursHint,
  daysList,
  dogStatus,
  earlyCost,
  elevationLine,
  foliageBlocks,
  gfDf,
  isRecord,
  itemLatLon,
  lengthNumber,
  milesLines,
  missingInventory,
  namedItems,
  nextOrToday,
  oneLineLight,
  permitOf,
  pickDay,
  placeById,
  placesList,
  rankGroup,
  runsList,
  str,
  subjectOf,
  todayIso,
  validateBundle,
} from "./bundle";
import { idbGet, idbSet, type CachedBundle } from "./db";
import { haversineKm, isStandalone, mapsUrl } from "./geo";
import { bundleLiveTargets, fetchLive, fetchUnverifiedExtras } from "./live";

export type RouteId = "today" | "map" | "light" | "filters" | "open" | "drive" | "food" | "gaps" | "more";

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
  filters: Filters;
  gps: { lat: number; lon: number; at: number } | null;
  gpsError: string | null;
  selectedId: string | null;
  extras: UnverifiedExtra[];
  extrasError: string | null;
  extrasAt: string | null;
  live: LiveResult[];
  liveBusy: boolean;
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
  filters: { ...FILTERS_DEFAULT },
  gps: null,
  gpsError: null,
  selectedId: null,
  extras: [],
  extrasError: null,
  extrasAt: null,
  live: [],
  liveBusy: false,
  saveProgress: null,
  saveMessage: null,
  standalone: false,
};

let map: LeafletMap | null = null;

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
  const head = parts[0] || "today";
  if (head === "print") return { route: "today", printDate: parts[1] ?? null };
  const known: RouteId[] = ["today", "map", "light", "filters", "open", "drive", "food", "gaps", "more"];
  return { route: known.includes(head as RouteId) ? (head as RouteId) : "today", printDate: null };
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

function itemCard(item: ReturnType<typeof namedItems>[number], extraClass = ""): string {
  const dog = dogStatus(item.raw);
  const miles = milesLines(item.raw);
  const elev = elevationLine(item.raw);
  const permit = permitOf(item.raw);
  const subs = subjectOf(item.raw);
  const area = areaOf(item.raw);
  const coords = itemLatLon(item.raw);
  const diet = gfDf(item.raw);
  const early = earlyCost(item.raw);
  const low = rankGroup(item.raw) === "low";
  const bannedFold = state.dogsWithUs && dog === "banned";
  return `<article class="card ${extraClass} ${bannedFold ? "folded-dogs" : ""}" data-id="${esc(item.id)}">
    <h3>${esc(item.name)}</h3>
    <p class="meta">
      <span class="pill dog-${dog}">dogs: ${dog}</span>
      ${permit ? `<span class="pill">${esc(permit)}</span>` : `<span class="pill dim">permit unknown</span>`}
      ${area ? `<span class="pill">${esc(area)}</span>` : ""}
      ${early ? `<span class="pill warn">early — sorts last</span>` : ""}
      ${low ? `<span class="pill dim">low-ranked</span>` : ""}
    </p>
    ${miles.length ? `<ul class="facts">${miles.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : `<p class="gap">Miles/length not in this bundle. AllTrails and agency figures print separately when present — never averaged.</p>`}
    <p class="facts">${esc(elev)}</p>
    ${subs.length ? `<p class="meta">${subs.map((s) => `<span class="pill">${esc(s)}</span>`).join("")}</p>` : ""}
    ${item.raw.note ? `<p class="note">${esc(String(item.raw.note))}</p>` : ""}
    ${
      extraClass === "food" || "gf" in item.raw || "df" in item.raw
        ? `<p class="diet">${esc(diet.gf)} · ${esc(diet.df)}</p>`
        : ""
    }
    ${coords ? `<a class="btn" href="${esc(mapsUrl(coords.lat, coords.lon, item.name))}">Open in Maps</a>` : `<p class="gap">No pin in this bundle — hiking nav is AllTrails, not this app.</p>`}
    ${bannedFold ? `<p class="note">Not with the dogs — folded, not removed.</p>` : ""}
  </article>`;
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

function renderToday(bundle: TripBundle): string {
  const tz = placeById(bundle, "drake")?.tz || "America/Denver";
  const now = todayIso(tz);
  const pick = nextOrToday(bundle, now);
  const day = pick.day;
  const area = areaForDay(day);
  const food = foodItems(bundle).filter((f) => !area || area === "driving" || !areaOf(f.raw) || areaOf(f.raw) === area);
  const items = sortItems(
    menuItems(bundle).filter((it) => matchesFilters(it.raw, state.filters)),
    bundle,
  );
  const high = items.filter((i) => rankGroup(i.raw) === "high");
  const low = items.filter((i) => rankGroup(i.raw) === "low");
  const statusLine =
    pick.status === "today"
      ? `Today ${now}`
      : pick.status === "before"
        ? `Trip has not started (${now}). Showing first trip day ${day?.date ?? "—"}.`
        : pick.status === "after"
          ? `After last day in days[] (${now}).`
          : `Today ${now} has no days[] row — gap.`;

  const gotchas: string[] = [];
  if (area) {
    const g = collection(bundle, "gotchas");
    for (const it of namedItems(g, "gotcha")) gotchas.push(it.name);
  }
  const land = collection(bundle, "land_rules");
  if (isRecord(land)) {
    if (land.drake_pin) gotchas.push(`Drake pin: ${String(land.drake_pin)}`);
    if (land.rmnp_timed_entry) gotchas.push(`RMNP timed-entry: ${String(land.rmnp_timed_entry)}`);
    if (land.bighorn_rut === false) gotchas.push("Bighorn are NOT in rut.");
  }
  const gate = collection(bundle, "gates");
  if (isRecord(gate)) {
    gotchas.push(
      `Brainard last_seen ${str(gate.last_seen) ?? "unknown"} (table ${str(gate.last_seen_table) ?? "—"}; checked ${str(gate.checked) ?? "—"})`,
    );
  }

  const foliage = foliageBlocks(collection(bundle, "foliage"));

  return `<section>
    <p class="kicker">${esc(statusLine)}</p>
    <h1>${esc(bundle.trip?.name ?? "Trip")}</h1>
    <p class="lightline">${esc(oneLineLight(day))}</p>
    <p class="meta">${esc(cacheAge(state.loadedAt))} · ${esc(state.source)}${bundle.generated ? ` · bundle ${esc(bundle.generated)}` : ""}</p>
    ${day?.note ? `<p class="gap">${esc(String(day.note))}</p>` : ""}
    <h2>Possible hikes &amp; photo ops</h2>
    <p class="note">Menu, not a schedule. Skip all of these is valid. Hiking nav is AllTrails.</p>
    ${emptyOrMissing("hikes", bundle, "Hikes")}
    ${high.map((i) => itemCard(i)).join("")}
    ${
      low.length
        ? `<details class="fold" ${state.showLow ? "open" : ""}>
            <summary>Low-ranked (${low.length}) — still here</summary>
            ${low.map((i) => itemCard(i)).join("")}
          </details>`
        : ""
    }
    <h2>Food in this area</h2>
    ${emptyOrMissing("food", bundle, "Food")}
    ${food.map((i) => itemCard(i, "food")).join("")}
    <h2>Dog / permit / gate</h2>
    ${gotchas.length ? `<ul class="facts">${gotchas.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : `<p class="gap">No gotchas block for today in this bundle.</p>`}
    <h2>Fall color</h2>
    ${
      foliage.length
        ? foliage
            .map(
              (b) =>
                `<div class="card"><p class="pill">${esc(b.kind)}</p><p>${esc(b.text)}</p>${b.as_of ? `<p class="meta">as of ${esc(b.as_of)}</p>` : `<p class="gap">as-of unknown</p>`}</div>`,
            )
            .join("")
        : `<p class="gap">No foliage block in this bundle.</p>`
    }
    <p><a class="btn" href="#/print/${esc(day?.date ?? "")}">Printable day view</a></p>
  </section>`;
}

function renderLight(bundle: TripBundle): string {
  const days = daysList(bundle);
  let darkest: { day: Day; hours: number } | undefined;
  for (const d of days) {
    const h = darkHoursHint(d);
    if (h === undefined) continue;
    if (!darkest || h > darkest.hours) darkest = { day: d, hours: h };
  }
  return `<section>
    <h1>Days / light</h1>
    <p class="note">Bundle light only. This app does not recompute sun.</p>
    ${
      darkest
        ? `<p class="lightline">Darkest night in this file: ${esc(darkest.day.date)} · ${esc(String(darkest.hours))} h</p>`
        : `<p class="gap">Dark-hours figures not complete in this file.</p>`
    }
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Base</th><th>Up / down</th><th>Gold AM</th><th>Gold PM</th><th>Night</th></tr></thead>
      <tbody>
        ${days
          .map((d) => {
            const L = d.light;
            return `<tr>
              <td>${esc(d.date)}<br><span class="dim">${esc(d.kind ?? "")}</span></td>
              <td>${esc(d.base ?? d.light_computed_for ?? "—")}</td>
              <td>${L?.sunrise && L?.sunset ? `${esc(L.sunrise)} / ${esc(L.sunset)}` : `<span class="gap">unknown</span>`}</td>
              <td>${L?.golden_am?.length ? esc(L.golden_am.join("–")) : `<span class="gap">unknown</span>`}</td>
              <td>${L?.golden_pm?.length ? esc(L.golden_pm.join("–")) : `<span class="gap">unknown</span>`}</td>
              <td>${L?.moon?.verdict ? esc(L.moon.verdict) : `<span class="gap">unknown</span>`}</td>
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
    <p class="note">Filters do not pick a winner. Default sort is nearby/GPS when permitted. <code>no_early_mornings</code> is a sort key, not a filter.</p>
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
    ${items.map((i) => itemCard(i)).join("") || emptyOrMissing("hikes", bundle, "Hikes")}
  </section>`;
}

function renderOpen(bundle: TripBundle): string {
  const decisions = namedItems(collection(bundle, "decisions"), "decision");
  const overs = runsList(bundle).filter((r) => String(r.overnight).toLowerCase() === "open");
  return `<section>
    <h1>Open calls</h1>
    <p class="note">Three decisions stay open. This app does not choose.</p>
    ${
      decisions.length
        ? decisions
            .map((d) => {
              const opts = namedItems(d.raw.options, "opt");
              return `<article class="card">
                <h3>${esc(d.name)}</h3>
                <p class="pill">${esc(str(d.raw.status) ?? "open")}</p>
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
          `<article class="card"><h3>Overnight on ${esc(r.id)}</h3><p class="pill">open — never a chosen stop</p>${r.note ? `<p>${esc(r.note)}</p>` : ""}</article>`,
      )
      .join("")}
  </section>`;
}

function renderFood(bundle: TripBundle): string {
  const items = foodItems(bundle);
  const meta = collection(bundle, "food");
  const areas = isRecord(meta) && Array.isArray(meta.areas) ? meta.areas.map(String) : [];
  const count = isRecord(meta) ? meta.engine_count : undefined;
  return `<section>
    <h1>Food · GF / DF</h1>
    <p class="note">GF and DF are separate. Preference, not celiac. Missing tag does not hide a place. Unknown is not safe.</p>
    ${count !== undefined ? `<p class="meta">Engine count: ${esc(String(count))}</p>` : ""}
    ${areas.length ? `<p class="meta">Areas: ${areas.map((a) => `<span class="pill">${esc(a)}</span>`).join(" ")}</p>` : ""}
    ${emptyOrMissing("food", bundle, "Food")}
    ${items.map((i) => itemCard(i, "food")).join("")}
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
        <li>Safari: tap the Share button (square with arrow).</li>
        <li>Scroll to <strong>Add to Home Screen</strong>.</li>
        <li>Tap Add. Open from the home screen next time.</li>
      </ol>`;
  const live = state.live;
  const targets = bundleLiveTargets(bundle);
  return `<section>
    <h1>Install &amp; live</h1>
    <h2>Add to Home Screen</h2>
    ${a2hs}
    <h2>Save for offline</h2>
    <p class="note">Saves the shell + bundle. Then turn on Airplane Mode and reopen to prove it.</p>
    <button class="btn" data-action="save-offline" ${state.saveProgress !== null ? "disabled" : ""}>Save for offline</button>
    ${state.saveProgress !== null ? `<p class="meta">Saving… ${Math.round(state.saveProgress * 100)}%</p>` : ""}
    ${state.saveMessage ? `<p class="${state.saveMessage.startsWith("Saved") ? "ok" : "gap"}">${esc(state.saveMessage)}</p>` : ""}
    <p class="meta">${esc(cacheAge(state.loadedAt))} · source ${esc(state.source)}</p>
    <h2>Webcams &amp; Brainard gate</h2>
    <p class="note">Display only. Failures stay failures — not “closed” and not “no color”.</p>
    ${targets.length ? `<button class="btn" data-action="refresh-live" ${state.liveBusy ? "disabled" : ""}>Fetch live</button>` : `<p class="gap">No webcam or gate URLs in this bundle.</p>`}
    ${
      isRecord(collection(bundle, "gates"))
        ? `<article class="card"><h3>${esc(str((collection(bundle, "gates") as Record<string, unknown>).name) ?? "Gate")}</h3>
           <p>last_seen ${esc(str((collection(bundle, "gates") as Record<string, unknown>).last_seen) ?? "unknown")}</p>
           <p class="meta">table ${esc(str((collection(bundle, "gates") as Record<string, unknown>).last_seen_table) ?? "—")} · checked ${esc(str((collection(bundle, "gates") as Record<string, unknown>).checked) ?? "—")}</p>
           ${str((collection(bundle, "gates") as Record<string, unknown>).note) ? `<p class="note">${esc(str((collection(bundle, "gates") as Record<string, unknown>).note)!)}</p>` : ""}
           </article>`
        : ""
    }
    ${live
      .map(
        (r) =>
          `<article class="card ${r.ok ? "" : "fail"}">
            <h3>${esc(r.label)} <span class="pill">${esc(r.kind)}</span></h3>
            <p>${r.ok ? `Fetched HTTP ${r.status ?? ""}` : esc(r.error ?? "failed")}</p>
            <p class="meta">fetched-at ${esc(r.fetchedAt)}</p>
            ${r.ok && r.kind === "webcam" ? `<img alt="" src="${esc(r.url)}">` : `<a href="${esc(r.url)}">${esc(r.url)}</a>`}
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
  }
  if (isRecord(land) && land.bighorn_rut === false) bits.push("Bighorn are NOT in rut.");
  if (!bits.length) return "";
  return `<h2>Behaviour / land</h2><ul class="facts">${bits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
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

function renderDrive(bundle: TripBundle): string {
  const detour = bundle.trip?.detour_minutes;
  const stops = allMappable(bundle);
  const gps = state.gps;
  const sortedStops = gps
    ? stops.slice().sort((a, b) => haversineKm(gps.lat, gps.lon, a.lat, a.lon) - haversineKm(gps.lat, gps.lon, b.lat, b.lon))
    : stops;
  return `<section>
    <h1>Driving glance</h1>
    <p class="note">Trip stops first, then UNVERIFIED OSM extras. Not gas. Not popularity. detour_minutes = ${detour ?? "unknown"} (printed, not turned into miles).</p>
    <button class="btn" data-action="gps">${gps ? "Refresh GPS" : "Use GPS"}</button>
    ${gps ? `<p class="meta">GPS ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}</p>` : ""}
    ${state.gpsError ? `<p class="gap">${esc(state.gpsError)}</p>` : ""}
    <h2>Trip stops</h2>
    ${sortedStops
      .map((s) => {
        const d = gps ? `${haversineKm(gps.lat, gps.lon, s.lat, s.lon).toFixed(1)} km` : "";
        return `<article class="card"><h3>${esc(s.name)}</h3><p class="meta">${esc(s.kind)} ${esc(d)}</p>
          <a class="btn" href="${esc(mapsUrl(s.lat, s.lon, s.name))}">Open in Maps</a></article>`;
      })
      .join("") || `<p class="gap">No trip stops with pins.</p>`}
    <h2>UNVERIFIED extras</h2>
    <button class="btn" data-action="extras" ${gps ? "" : "disabled"}>Fetch nearby OSM extras</button>
    ${state.extrasError ? `<p class="gap">${esc(state.extrasError)}</p>` : ""}
    ${state.extrasAt ? `<p class="meta">fetched-at ${esc(state.extrasAt)}</p>` : ""}
    ${state.extras
      .map(
        (e) =>
          `<article class="card unverified"><h3>${esc(e.name)}</h3><p class="pill">UNVERIFIED</p><p class="meta">${esc(e.kind)}</p>
           <a class="btn" href="${esc(mapsUrl(e.lat, e.lon, e.name))}">Open in Maps</a></article>`,
      )
      .join("")}
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
    ["map", "Map"],
    ["light", "Light"],
    ["filters", "Filters"],
    ["open", "Open"],
    ["drive", "Drive"],
    ["food", "Food"],
    ["gaps", "Gaps"],
    ["more", "More"],
  ];
  return `<header class="top">
      <p class="brand">Colorado trip</p>
      <label class="toggle compact"><input type="checkbox" data-action="dogs-with-us" ${state.dogsWithUs ? "checked" : ""}> Dogs with us</label>
    </header>
    <main id="main">${body}</main>
    <nav class="tabbar">${nav
      .map(
        ([id, label]) =>
          `<a class="${state.route === id ? "on" : ""}" href="#/${id}">${label}</a>`,
      )
      .join("")}</nav>`;
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
      .bindPopup(p.name);
    m.on("click", () => {
      state.selectedId = p.id;
      document.querySelectorAll(".sync-list .linkish").forEach((el) => {
        el.classList.toggle("on", (el as HTMLElement).dataset.id === p.id);
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
      return renderDrive(bundle);
    case "food":
      return renderFood(bundle);
    case "gaps":
      return renderGaps(bundle);
    case "more":
      return renderMore(bundle);
  }
}

export function paint(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const printing = Boolean(state.printDate);
  document.body.classList.toggle("printing", printing);
  root.innerHTML = printing ? bodyHtml() : shell(bodyHtml());
  if (state.route === "map" && state.bundle && !printing) {
    void mountMap(state.bundle);
  }
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
    if (action === "print") window.print();
  });
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

async function requestGps(): Promise<void> {
  if (!navigator.geolocation) {
    state.gpsError = "Geolocation is not available on this device.";
    paint();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() };
      state.gpsError = null;
      paint();
    },
    (err) => {
      state.gpsError = `GPS denied or failed (${err.message}). Nearby sort stays off.`;
      paint();
    },
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

async function loadExtras(): Promise<void> {
  const here = state.gps;
  if (!here) return;
  try {
    state.extras = await fetchUnverifiedExtras(here.lat, here.lon);
    state.extrasAt = new Date().toISOString();
    state.extrasError = null;
  } catch (e) {
    state.extrasError = `OSM extras fetch failed — ${e instanceof Error ? e.message : "error"}. Not treated as “nothing nearby”.`;
  }
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
