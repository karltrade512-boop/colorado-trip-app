import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  dogStatus,
  gfDf,
  milesLines,
  missingInventory,
  oneLineLight,
  validateBundle,
  daysList,
  collectionItems,
  darkestPlausibleNight,
  foliageWebcams,
  foliageExploreFallUrl,
  foliageBands,
  foliageCountyWindows,
  foliageHasObservation,
  foliageModelFetched,
  foliageModelRule,
  foliageModelStatus,
  foliageRanking,
  foliageBandForPlace,
  defaultCabinFromDay,
  foodDirectories,
  behaviourSubject,
  tripSubjects,
  placesList,
  landAccessAreas,
  landNamedExceptions,
  permitPrint,
  sheetMilesLines,
  placeCardSections,
} from "./bundle.ts";
import { osmExtraExcluded } from "./live.ts";

describe("trip-bundle", () => {
  const json = JSON.parse(readFileSync(new URL("../public/trip-bundle.json", import.meta.url), "utf8"));
  const bundle = validateBundle(json);

  it("is schema 1.0.0 with engine generated stamp", () => {
    assert.equal(bundle.schema_version, "1.0.0");
    assert.equal(bundle.generated, "2026-08-28T16:33:35");
  });

  it("has nine trip days and named inventory hikes", () => {
    const days = daysList(bundle).map((d) => d.date);
    assert.deepEqual(days, [
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    const hikes = collectionItems(bundle, "hikes", "hike").map((h) => h.name);
    assert.ok(hikes.includes("Lake Isabelle"));
    assert.ok(hikes.includes("Columbine Lake"));
    assert.equal(hikes.length, 15);
  });

  it("keeps recovered Drake range and does not invent a single elevation", () => {
    const places = bundle.places as Record<string, { elevation_display: string; elevation_confirmed: boolean }>;
    assert.equal(places.drake.elevation_confirmed, false);
    assert.match(places.drake.elevation_display, /6,081-6,308/);
  });

  it("prints AllTrails and agency miles separately", () => {
    const lines = milesLines({
      miles_alltrails: "4.2 mi",
      miles_nps: "3.8 mi",
    });
    assert.ok(lines.some((l) => l.includes("AllTrails") && l.includes("4.2")));
    assert.ok(lines.some((l) => /NPS|agency/i.test(l) && l.includes("3.8")));
    assert.equal(lines.some((l) => l.includes("4.0")), false);
  });

  it("prints nested AllTrails round-trip and agency one-way without averaging", () => {
    const lines = milesLines({
      alltrails: { round_trip_mi: 6.6 },
      agency: { one_way_mi: 2 },
      each_way_mi: 3.3,
    });
    assert.ok(lines.some((l) => /AllTrails/i.test(l) && l.includes("6.6")));
    assert.ok(lines.some((l) => /agency/i.test(l) && l.includes("2")));
    assert.ok(lines.some((l) => /derived/i.test(l) && l.includes("3.3")));
    assert.equal(lines.some((l) => l.includes("4.3")), false);
  });

  it("treats missing dog rule as unknown, not banned", () => {
    assert.equal(dogStatus({}), "unknown");
    assert.equal(dogStatus({ dogs: false }), "banned");
    assert.equal(dogStatus({ dogs: true }), "ok");
  });

  it("keeps GF and DF separate and does not upgrade unknown", () => {
    const both = gfDf({ gf: { status: "yes", source: "official" }, df: { status: "unknown", source: "directory" } });
    assert.match(both.gf, /official/);
    assert.match(both.df, /unknown/);
    const missing = gfDf({});
    assert.match(missing.gf, /unknown/);
    assert.match(missing.df, /unknown/);
  });

  it("prints GF/DF as status (confidence) and never a source URL", () => {
    const printed = gfDf({
      gluten_free: {
        status: "stocked",
        quote: "organic, and gluten-free foods",
        confidence: "official",
        source: "https://www.thecountrymarketofestespark.com/",
      },
      dairy_free: { status: "unknown", quote: null, confidence: null, source: null },
    });
    assert.equal(printed.gf, "GF: stocked (official)");
    assert.equal(printed.gfQuote, "organic, and gluten-free foods");
    assert.doesNotMatch(printed.gf, /https?:/);
    assert.match(printed.df, /^DF: unknown$/);
  });

  it("renders light from the day object", () => {
    const day = daysList(bundle).find((d) => d.date === "2026-09-29");
    const line = oneLineLight(day);
    assert.match(line, /06:54/);
    assert.match(line, /Drake/);
  });

  it("surfaces overnight-open and missing weather as gaps", () => {
    const gaps = missingInventory(bundle).join("\n");
    assert.match(gaps, /Overnight/);
    assert.match(gaps, /weather/i);
    assert.match(gaps, /Return after/);
  });

  it("reads the engine food places (19) without inventing names", () => {
    const food = bundle.food as { places: Array<{ name: string }> };
    assert.equal(food.places.length, 19);
    const items = collectionItems(bundle, "food", "food");
    assert.equal(items.length, 19);
    assert.ok(items.some((p) => p.name === "The Country Market of Estes Park"));
  });

  it("records bighorn not in rut from engine behaviour", () => {
    const behaviour = bundle.behaviour as {
      subjects: { bighorn: { action: string; detail: string } };
    };
    assert.equal(behaviour.subjects.bighorn.action, "low");
    assert.match(behaviour.subjects.bighorn.detail, /NOT in rut/i);
  });

  it("prints Lake Isabelle nested AllTrails and agency miles from the engine file", () => {
    const hike = collectionItems(bundle, "hikes", "hike").find((h) => h.name === "Lake Isabelle");
    assert.ok(hike);
    const lines = milesLines(hike.raw);
    assert.ok(lines.some((l) => /AllTrails/i.test(l) && l.includes("6.6")));
    assert.ok(lines.some((l) => /agency/i.test(l) && l.includes("2")));
    assert.equal(lines.some((l) => /not in this bundle/i.test(l)), false);
  });

  it("picks a plausible night length, not wrap-around 24 h driving verdicts", () => {
    const hit = darkestPlausibleNight(daysList(bundle));
    assert.ok(hit);
    assert.ok(hit.hours < 12);
    assert.notEqual(hit.day.date, "2026-09-29");
    assert.equal(hit.day.date, "2026-10-05");
    assert.equal(hit.hours, 6.4);
    const oct4 = daysList(bundle).find((d) => d.date === "2026-10-04");
    assert.match(oct4?.light?.moon?.verdict ?? "", /5\.2 h of real darkness/);
  });

  it("lists seven RMNP webcam stills and Explore Fall as a source, not an observation", () => {
    const cams = foliageWebcams(bundle);
    assert.equal(cams.length, 7);
    assert.ok(cams.some((c) => c.name === "Alpine Visitor Center"));
    assert.ok(cams.some((c) => c.name === "Grand Lake Entrance"));
    assert.equal(foliageExploreFallUrl(bundle), "https://www.explorefall.com/states/colorado.html");
    assert.equal(foliageHasObservation(bundle), false);
    assert.match(foliageRanking(bundle) ?? "", /webcam still outranks/i);
  });

  it("prints Drake and Nederland modelled peaks and both county forecast windows", () => {
    const bands = foliageBands(bundle);
    const drake = bands.find((b) => b.place === "Drake");
    const nederland = bands.find((b) => b.place === "Nederland");
    assert.equal(drake?.modelled_peak, "2026-10-03");
    assert.equal(nederland?.modelled_peak, "2026-09-23");
    assert.equal(foliageBandForPlace(bundle, "Drake, CO")?.modelled_peak, "2026-10-03");
    assert.equal(foliageBandForPlace(bundle, "Nederland, CO")?.modelled_peak, "2026-09-23");
    const counties = foliageCountyWindows(bundle);
    assert.deepEqual(
      counties.find((c) => c.county === "Larimer"),
      { county: "Larimer", from: "2026-09-17", to: "2026-09-21" },
    );
    assert.deepEqual(
      counties.find((c) => c.county === "Boulder"),
      { county: "Boulder", from: "2026-09-17", to: "2026-09-21" },
    );
    assert.match(foliageModelStatus(bundle) ?? "", /MODEL, not observation/i);
    assert.equal(foliageModelFetched(bundle), "2026-08-28");
  });

  it("does not invent coordinates beyond cabins and origin already in the bundle", () => {
    const pinned = placesList(bundle).filter((p) => p.lat != null && p.lon != null).map((p) => p.id);
    assert.deepEqual(pinned.sort(), ["drake", "nederland", "origin"]);
  });

  it("names the five elk meadows from behaviour and keeps bighorn NOT in rut", () => {
    assert.deepEqual(tripSubjects(bundle), ["raptors", "owls", "fall-color", "elk", "bighorn", "landscape"]);
    const elk = behaviourSubject(bundle, "elk");
    assert.deepEqual(elk?.places, [
      "Horseshoe Park",
      "Moraine Park",
      "Upper Beaver Meadows",
      "Harbison Meadow",
      "Holzwarth Meadow",
    ]);
    const bighorn = behaviourSubject(bundle, "bighorn");
    assert.match(bighorn?.detail ?? "", /NOT in rut/i);
    assert.deepEqual(bighorn?.places, []);
  });

  it("never treats fuel or charging stations as Around extras", () => {
    assert.equal(osmExtraExcluded({ amenity: "fuel" }), true);
    assert.equal(osmExtraExcluded({ amenity: "charging_station" }), true);
    assert.equal(osmExtraExcluded({ tourism: "viewpoint" }), false);
  });

  it("prints Lost Lake (Hessie) sheet facts from the engine file", () => {
    const hike = collectionItems(bundle, "hikes", "hike").find((h) => h.name === "Lost Lake (Hessie)");
    assert.ok(hike);
    assert.equal(hike.raw.trailhead, "Hessie Trailhead, County Road 130");
    const miles = sheetMilesLines(hike.raw);
    assert.ok(miles.some((l) => /AllTrails/i.test(l) && l.includes("4.2")));
    assert.ok(miles.some((l) => /agency/i.test(l) && l.includes("2.1")));
    assert.equal(hike.raw.behind_brainard_gate, false);
    assert.match(String(hike.raw.wildlife), /Moose and brook trout/i);
  });

  it("keeps Lake Isabelle gated with the disagreement string", () => {
    const hike = collectionItems(bundle, "hikes", "hike").find((h) => h.name === "Lake Isabelle");
    assert.ok(hike);
    assert.equal(hike.raw.behind_brainard_gate, true);
    assert.match(String(hike.raw.disagreement), /AllTrails 6\.6/);
    assert.equal(permitPrint(hike.raw), "permit unknown");
  });

  it("prints Country Market address and GF official/stocked", () => {
    const place = collectionItems(bundle, "food", "food").find((p) => p.name === "The Country Market of Estes Park");
    assert.ok(place);
    assert.equal(place.raw.address, "900 Moraine Ave, Estes Park, CO 80517");
    const diet = gfDf(place.raw);
    assert.equal(diet.gf, "GF: stocked (official)");
    assert.equal(foodDirectories(bundle).estes_park, "https://www.findmeglutenfree.com/us/co/estes-park");
  });

  it("prints Brainard trip_dates_status for Oct 2–5 and Caribou Ranch as a named exception", () => {
    const brainard = landAccessAreas(bundle)[0];
    assert.ok(brainard);
    const timed = brainard.timed_entry as { trip_dates_status?: string };
    assert.match(timed.trip_dates_status ?? "", /Oct 2-5/);
    const names = landNamedExceptions(bundle).map((e) => String(e.match));
    assert.ok(names.includes("Caribou Ranch"));
    assert.ok(names.includes("Hall Ranch"));
    assert.ok(names.includes("Heil Valley Ranch"));
    assert.ok(names.includes("Dodd Lake"));
  });

  it("has thermals on 2026-09-29 and the foliage elevation rule", () => {
    const day = daysList(bundle).find((d) => d.date === "2026-09-29");
    assert.deepEqual(day?.light?.thermals, ["09:47", "15:54"]);
    assert.equal(foliageModelRule(bundle), "Colour descends ~1.5 days per 100 m of elevation.");
  });

  it("defaults cabin to Drake when the day’s base is null", () => {
    const drive = daysList(bundle).find((d) => d.date === "2026-09-27");
    assert.equal(drive?.base, null);
    assert.equal(defaultCabinFromDay(drive), "drake");
    const ned = daysList(bundle).find((d) => d.date === "2026-10-02");
    assert.equal(ned?.base, "nederland");
    assert.equal(defaultCabinFromDay(ned), "nederland");
    const drakeDay = daysList(bundle).find((d) => d.date === "2026-09-29");
    assert.equal(drakeDay?.base, "drake");
    assert.equal(defaultCabinFromDay(drakeDay), "drake");
  });

  it("keeps diet-unknown food in the directory", () => {
    const items = collectionItems(bundle, "food", "food");
    const unknownDf = items.filter((i) => /unknown/i.test(gfDf(i.raw).df));
    assert.ok(unknownDf.length > 0);
    assert.ok(unknownDf.some((i) => i.name === "The Country Market of Estes Park"));
  });

  it("prints Bluebird why / look-out from the engine record, not a blank More", () => {
    const hike = collectionItems(bundle, "hikes", "hike").find((h) => h.name === "Bluebird Lake");
    assert.ok(hike);
    const sec = placeCardSections(hike, bundle);
    const why = sec.why.join("\n");
    const look = sec.lookOut.join("\n");
    const all = [...sec.why, ...sec.lookOut, ...sec.around, ...sec.details].join("\n");
    assert.match(why, /Wild Basin/);
    assert.match(why, /beyond|stated range/i);
    assert.match(why, /13\.6 vs NPS 12\.0/);
    assert.match(look, /timed entry/i);
    assert.match(look, /dogs prohibited/i);
    assert.match(all, /disagreement|13\.6 vs/i);
    assert.equal(sec.why.includes("No why-go text in this bundle."), false);
    assert.ok(sec.around.includes("Ouzel Lake"));
  });

  it("prints Lost Lake why from wildlife or review_summary", () => {
    const hike = collectionItems(bundle, "hikes", "hike").find((h) => h.name === "Lost Lake (Hessie)");
    assert.ok(hike);
    const why = placeCardSections(hike, bundle).why.join("\n");
    assert.match(why, /Moose and brook trout|Beautiful views, a lovely lake/i);
  });

  it("prints Country Market address in look-out or details", () => {
    const place = collectionItems(bundle, "food", "food").find((p) => p.name === "The Country Market of Estes Park");
    assert.ok(place);
    const sec = placeCardSections(place, bundle);
    const blob = [...sec.lookOut, ...sec.details].join("\n");
    assert.match(blob, /900 Moraine Ave/);
  });
});
