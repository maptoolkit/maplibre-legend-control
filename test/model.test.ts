import { describe, expect, it } from "vitest";
import { buildLegendModel, geometryAnchor, humanize, pickLabel, valueToNumbers, valueToString } from "../src/model";
import { features, layerOrder, manifest, viewport } from "./fixtures";

const build = (overrides: Partial<Parameters<typeof buildLegendModel>[0]> = {}) =>
  buildLegendModel({ features, manifest, layerOrder, language: "de", viewport, edgeMargin: 24, ...overrides });

describe("buildLegendModel", () => {
  const model = build();
  const group = (id: string) => model.groups.find((g) => g.id === id);
  const entry = (key: string) => model.groups.flatMap((g) => g.entries).find((e) => e.key === key);

  it("orders groups by the manifest and labels them in the requested language", () => {
    expect(model.groups.map((g) => g.id)).toEqual(["place", "road", "nature"]);
    expect(group("road")?.label).toBe("Straßen und Verkehr");
    expect(build({ language: "en" }).groups.find((g) => g.id === "road")?.label).toBe("Roads and transport");
  });

  it("makes one class entry per main layer key and stacks its supporting layers bottom to top", () => {
    const motorway = entry("road:major_dark");
    expect(motorway).toMatchObject({ kind: "class", label: "Hauptstraße" });
    expect(motorway?.swatch.map((l) => `${l.id}:${l.role}`)).toEqual(["road_major_blur:blur", "road_major_casing:casing", "road_major_dark:main", "road_major_label:label"]);
    // the casing also attaches to the minor road, the blur does not
    expect(entry("road:minor")?.swatch.map((l) => l.id)).toEqual(["road_major_casing", "road_minor"]);
  });

  it("represents an entry by a ground-level copy and stacks copies of the very same feature", () => {
    const motorway = entry("road:major_dark")!;
    const main = motorway.swatch.find((l) => l.role === "main")!;
    const casing = motorway.swatch.find((l) => l.role === "casing")!;
    expect(main.id).toBe("road_major_dark"); // not the bridge duplicate
    expect(main.paint["line-width"]).toBe(5); // the motorway copy, not the 9 px trunk
    expect(casing.paint["line-gap-width"]).toBe(5); // the motorway's own casing, gap = main width
    // crossing supporting layers (bridge shadow) never stack
    expect(motorway.swatch.some((l) => l.id === "road_major_blur_bridge")).toBe(false);
  });

  it("shows overlays with the full stack of their feature — the route and the road it runs on", () => {
    const hiking = entry("road:hiking")!;
    expect(hiking.swatch.map((l) => `${l.id}:${l.role}`)).toEqual(["road_hiking:main", "road_path_casing:casing", "road_path:main", "road_hiking_label:label"]);
    // the path entry itself keeps its own stack
    expect(entry("road:path")?.swatch.map((l) => l.id)).toEqual(["road_path_casing", "road_path"]);
  });

  it("only falls back to a bridge/tunnel copy when nothing else is rendered", () => {
    const bridgeOnly = features.filter((f) => f.layer.id.endsWith("_bridge"));
    const m = build({ features: bridgeOnly });
    const e = m.groups.flatMap((g) => g.entries).find((x) => x.key === "road:major_dark")!;
    expect(e.swatch.map((l) => l.id)).toEqual(["road_major_dark_bridge"]);
  });

  it("splits dynamic-key mains per feature value and matches their textures per value", () => {
    expect(entry("nature:wood")?.swatch.map((l) => l.id)).toEqual(["nature_natural", "nature_natural_texture"]);
    expect(entry("nature:farmland")?.swatch.map((l) => l.id)).toEqual(["nature_natural"]);
    expect(entry("nature:farmland")?.label).toBe("Farmland"); // no manifest label → humanized
    expect(group("nature")?.entries.map((e) => e.key)).toEqual(["nature:wood", "nature:farmland"]); // ordered before unordered
  });

  it("picks one named feature per type: inside the edge margin first, then lowest rank", () => {
    const town = entry("place:town");
    expect(town).toMatchObject({ kind: "instance", name: "Tulln an der Donau", label: "Stadt" });
    expect(town?.text).toMatchObject({ fontStack: ["Rosario Bold"], size: 14, color: "rgba(40,40,40,1)", haloWidth: 1 });
    expect(entry("place:village")).toMatchObject({ name: "Langenlebarn" });
    expect(group("place")?.entries.map((e) => e.key)).toEqual(["place:town", "place:village"]);
  });

  it("falls back to the edge feature when nothing else is on screen", () => {
    const only = features.filter((f) => f.properties.name === "Randstadt");
    const m = build({ features: only });
    expect(m.groups[0].entries[0]).toMatchObject({ key: "place:town", name: "Randstadt" });
  });

  it("drops entries hidden by the manifest and layers without a tag", () => {
    expect(entry("poi:bench")).toBeUndefined();
    expect(model.groups.some((g) => g.id === "poi")).toBe(false);
    expect(model.groups.flatMap((g) => g.entries).some((e) => e.swatch.some((l) => l.id === "custom-untagged"))).toBe(false);
  });

  it("carries the icon of instance labels", () => {
    const m = build({ manifest: { ...manifest, entries: { ...manifest.entries, "poi:bench": {} } } });
    const bench = m.groups.flatMap((g) => g.entries).find((e) => e.key === "poi:bench");
    expect(bench?.icon?.layout["icon-image"]).toEqual({ name: "sdf:bench" });
    expect(bench?.label).toBe("Bench");
  });

  it("works without a manifest", () => {
    const m = build({ manifest: undefined });
    expect(m.groups.map((g) => g.id).sort()).toEqual(["nature", "place", "poi", "road"]);
    expect(m.groups.find((g) => g.id === "road")?.label).toBe("Road");
  });
});

describe("helpers", () => {
  it("valueToNumbers accepts arrays and NumberArray-shaped objects", () => {
    expect(valueToNumbers([2, 3])).toEqual([2, 3]);
    expect(valueToNumbers({ values: [0.1, 8] })).toEqual([0.1, 8]);
    expect(valueToNumbers({ from: [1, 1], to: [2, 3] })).toEqual([2, 3]); // cross-faded: the current zoom's value
    expect(valueToNumbers({ from: [1, 1] })).toEqual([1, 1]);
    expect(valueToNumbers({ values: [] })).toBeUndefined();
    expect(valueToNumbers("2 3")).toBeUndefined();
    expect(valueToNumbers([1, "x"])).toBeUndefined();
  });

  it("valueToString handles strings, numbers, Color/Formatted-like objects and ResolvedImage-like objects", () => {
    expect(valueToString("a")).toBe("a");
    expect(valueToString(3)).toBe("3");
    expect(valueToString({ toString: () => "rgba(1,2,3,1)" })).toBe("rgba(1,2,3,1)");
    expect(valueToString({ name: "sdf:peak", available: true })).toBe("sdf:peak");
    expect(valueToString({ plain: true })).toBeUndefined();
    expect(valueToString(undefined)).toBeUndefined();
  });

  it("humanize + pickLabel", () => {
    expect(humanize("road:cycling_infra_lane")).toBe("Cycling infra lane");
    expect(humanize("poi")).toBe("Poi");
    expect(pickLabel({ de: "A", en: "B" }, "de")).toBe("A");
    expect(pickLabel({ en: "B" }, "fr")).toBe("B");
    expect(pickLabel({ it: "C" }, "fr")).toBe("C");
    expect(pickLabel(undefined, "de")).toBeUndefined();
  });

  it("geometryAnchor returns a representative position per geometry type", () => {
    expect(geometryAnchor({ type: "Point", coordinates: [1, 2] })).toEqual([1, 2]);
    expect(geometryAnchor({ type: "LineString", coordinates: [[0, 0], [2, 2], [4, 4]] })).toEqual([2, 2]);
    expect(geometryAnchor({ type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4]]] })).toEqual([2, 2]);
    expect(geometryAnchor({ type: "MultiLineString", coordinates: [[[0, 0]], [[1, 1], [3, 3], [5, 5]]] })).toEqual([3, 3]);
    expect(geometryAnchor(null)).toBeUndefined();
  });
});
