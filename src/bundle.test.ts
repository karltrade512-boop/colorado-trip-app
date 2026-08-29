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
  foliageModelStatus,
  foliageRanking,
  foliageBandForPlace,
  behaviourSubject,
  tripSubjects,
  placesList,
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
});
