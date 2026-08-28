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
} from "./bundle.ts";

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
});
