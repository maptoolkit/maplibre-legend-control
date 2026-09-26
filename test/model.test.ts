import { describe, expect, it } from "vitest";
import { buildLegendModel, geometryAnchor, humanize, pickLabel, valueToNumbers, valueToString } from "../src/model";
import type { RenderedFeature } from "../src/types";
import { swatchVariantFor } from "../src/swatch";
import { features, layerOrder, manifest, queryFixtures, viewport } from "./fixtures";

/** The control's edge test, reproduced for the fixtures: cut = touches one of the four 5 % bands. */
const fullyVisible = (list = features) => {
  const w = viewport.width,
    h = viewport.height,
    bx = Math.round(w * 0.05),
    by = Math.round(h * 0.05);
  const bands: Array<[[number, number], [number, number]]> = [
    [
      [0, 0],
      [w, by],
    ],
    [
      [0, h - by],
      [w, h],
    ],
    [
      [0, 0],
      [bx, h],
    ],
    [
      [w - bx, 0],
      [w, h],
    ],
  ];
  const cut = new Set(bands.flatMap((b) => queryFixtures(list, b)).filter((f) => f.layer.type === "symbol"));
  return (f: (typeof features)[number]) => !cut.has(f);
};

const build = (overrides: Partial<Parameters<typeof buildLegendModel>[0]> = {}) =>
  buildLegendModel({ features, manifest, layerOrder, language: "de", viewport, isFullyVisible: fullyVisible(), ...overrides });

describe("buildLegendModel", () => {
  const model = build();
  const group = (id: string) => model.groups.find((g) => g.id === id);
  const entry = (key: string) => model.groups.flatMap((g) => g.entries).find((e) => e.key === key);

  it("orders groups by the manifest and labels them in the requested language", () => {
    expect(model.groups.map((g) => g.id)).toEqual(["place", "road", "nature", "poi"]);
    expect(group("road")?.label).toBe("Straßen und Verkehr");
    expect(build({ language: "en" }).groups.find((g) => g.id === "road")?.label).toBe("Roads and transport");
  });

  it("makes one class entry per main layer key and stacks its supporting layers bottom to top", () => {
    const motorway = entry("road:major_dark");
    expect(motorway).toMatchObject({ kind: "class", label: "Hauptstraße" });
    expect(motorway?.swatch.map((l) => `${l.id}:${l.role}`)).toEqual([
      "road_major_blur:blur",
      "road_major_casing:casing",
      "road_major_dark:main",
      "road_major_label:label",
    ]);
    // the casing also attaches to the minor road, the blur does not
    expect(entry("road:minor")?.swatch.map((l) => l.id)).toEqual(["road_major_casing", "road_minor"]);
  });

  it("makes a row of a symbol layer with a fixed key, showing it as the map draws it", () => {
    const shield = entry("road:major_shield")!;
    expect(shield.kind).toBe("instance");
    expect(shield.name).toBe("A22"); // the rendered text, not the layer id
    expect(shield.icon?.id).toBe("road_major_shield");
    expect(shield.swatch).toEqual([]); // the symbol is the row, there is nothing to stack
  });

  it("represents an overlay by a stretch that carries no other overlay", () => {
    const route = entry("road:cycling_route")!;
    // the route runs on a cycle lane in one place and on a plain road in another: the plain one shows what the row means
    expect(route.swatch.map((l) => l.id)).toEqual(["road_cycling_route", "road_minor"]);
    expect(route.swatch.map((l) => l.id)).not.toContain("road_cycling_infra_lane");
    // with only the shared stretch rendered, the combination is the last resort rather than nothing
    const shared = features.filter((f) => f.properties.cycling !== "none");
    const combined = build({ features: shared, isFullyVisible: fullyVisible(shared) })
      .groups.flatMap((g) => g.entries)
      .find((e) => e.key === "road:cycling_route")!;
    expect(combined.swatch.map((l) => l.id)).toContain("road_cycling_infra_lane");
  });

  it("gives a property value its own entry where the layer paints it differently", () => {
    const plain = entry("road:minor")!;
    const pedestrian = entry("road:minor_pedestrian")!;
    expect(pedestrian.label).toBe("Fußgängerzone");
    // both come from road_minor, each with its own feature — and the casing copy follows its feature
    expect(plain.swatch.map((l) => l.id)).toEqual(["road_major_casing", "road_minor"]);
    expect(pedestrian.swatch.map((l) => l.id)).toEqual(["road_major_casing", "road_minor"]);
    const colorOf = (e: typeof plain) => String(e.swatch.find((l) => l.role === "main")?.paint["line-color"]);
    expect(colorOf(pedestrian)).toBe("rgba(250,240,200,1)");
    expect(colorOf(plain)).not.toBe(colorOf(pedestrian));
  });

  it("takes the swatch shape from the main layer's position, and from the key where one layer holds many entries", () => {
    // layers drawn next to each other are next to each other in the legend: different positions, so different shapes
    expect(entry("road:minor")?.variant).toBe(5);
    expect(entry("road:major_dark")?.variant).toBe(6); // the ground-level copy, not the bridge at 6.7
    expect(entry("road:path")?.variant).toBe(3.4);
    // nature_natural carries every landcover type: one position, so the key spreads them
    expect(entry("nature:wood")?.variant).toBe(1 + swatchVariantFor("nature:wood"));
    expect(entry("nature:farmland")?.variant).toBe(1 + swatchVariantFor("nature:farmland"));
    expect(entry("nature:wood")?.variant).not.toBe(entry("nature:farmland")?.variant);
    // instance entries draw the map's own symbol
    expect(entry("place:town")?.variant).toBe(0);
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
    // the first rendered stretch runs on a road this zoom does not draw; the entry takes the one with the fuller stack
    expect(hiking.swatch.map((l) => `${l.id}:${l.role}`)).toEqual(["road_hiking:main", "road_path_casing:casing", "road_path:main", "road_hiking_label:label"]);
    expect(hiking.swatch.find((l) => l.role === "main")?.paint["line-opacity"]).toBe(0.4); // the band of that stretch, not the bare one
  });

  it("stacks the crossing copies where a route runs over a bridge and nothing else is drawn under it", () => {
    // only the bridge stretch is rendered: its road comes from a crossing layer, and the band must not stand alone
    const onlyBridge = features.filter(
      (f) => !(f.layer.id.startsWith("road_path") && !f.layer.id.endsWith("_bridge")) || f.properties.walking_network === "iwn",
    );
    const model = build({ features: onlyBridge, isFullyVisible: fullyVisible(onlyBridge) });
    const hiking = model.groups.flatMap((g) => g.entries).find((e) => e.key === "road:hiking")!;
    expect(hiking.swatch.map((l) => l.id)).toContain("road_path_bridge");
    // the path entry itself keeps its own stack
    expect(entry("road:path")?.swatch.map((l) => l.id)).toEqual(["road_path_casing", "road_path"]);
  });

  it("prefers a ground-level stretch over a bridge stretch even when the bridge stacks more layers", () => {
    const KEY = "maptoolkit:legend";
    const copy = (id: string, tag: Record<string, unknown>, featureId: number, x: number): RenderedFeature => ({
      id: featureId,
      layer: { id, type: "line", metadata: { [KEY]: { group: "road", ...tag } }, paint: { "line-color": "rgba(90,90,90,1)", "line-width": 2 }, layout: {} },
      properties: { type: "path" },
      geometry: {
        type: "LineString",
        coordinates: [
          [x, 150],
          [x + 40, 150],
        ],
      },
    });
    const order = new Map([
      ["road_path", 1],
      ["road_path_blur_bridge", 2],
      ["road_path_bridge", 3],
      ["road_cycling_route_mtb", 4],
    ]);
    const mtb = { role: "main", key: "cycling_route_mtb", overlay: true };
    // the bridge stretch comes first in query order and stacks three layers, the plain path only two
    const bridge = [
      copy("road_cycling_route_mtb", mtb, 2, 300),
      copy("road_path_bridge", { role: "main", key: "path", crossing: "bridge" }, 2, 300),
      copy("road_path_blur_bridge", { role: "blur", attachesTo: ["road_path_bridge"], crossing: "bridge" }, 2, 300),
    ];
    const ground = [copy("road_cycling_route_mtb", mtb, 1, 100), copy("road_path", { role: "main", key: "path" }, 1, 100)];
    const stackOf = (list: RenderedFeature[]) =>
      buildLegendModel({ features: list, manifest: {}, layerOrder: order, language: "de", viewport })
        .groups.flatMap((g) => g.entries)
        .find((e) => e.key === "road:cycling_route_mtb")!
        .swatch.map((l) => l.id);
    expect(stackOf([...bridge, ...ground])).toEqual(["road_path", "road_cycling_route_mtb"]); // no bridge blur under the route
    expect(stackOf(bridge)).toEqual(["road_path_blur_bridge", "road_path_bridge", "road_cycling_route_mtb"]); // only the bridge in view: its copies, not a bare band
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

  it("picks one named feature per type among the fully visible ones: lowest rank first", () => {
    const town = entry("place:town");
    expect(town).toMatchObject({ kind: "instance", name: "Tulln an der Donau", label: "Stadt" });
    expect(town?.text).toMatchObject({ fontStack: ["Rosario Bold"], size: 14, color: "rgba(40,40,40,1)", haloWidth: 1, anchor: undefined });
    // the hamlet is merged into the village entry (manifest keys) and wins by rank
    expect(entry("place:village")).toMatchObject({ name: "Staasdorf", label: "Dorf" });
    expect(entry("place:hamlet")).toBeUndefined();
    expect(group("place")?.entries.map((e) => e.key)).toEqual(["place:town", "place:village"]);
  });

  it("merges stop when the target is hidden and vanish without the manifest", () => {
    const hidden = build({
      manifest: { ...manifest, entries: { ...manifest.entries, "place:village": { ...manifest.entries!["place:village"], hidden: true } } },
    });
    expect(hidden.groups.find((g) => g.id === "place")?.entries.map((e) => e.key)).toEqual(["place:town"]);
    const plain = build({ manifest: undefined });
    expect(
      plain.groups
        .find((g) => g.id === "place")
        ?.entries.map((e) => e.key)
        .sort(),
    ).toEqual(["place:hamlet", "place:town", "place:village"]);
  });

  it("drops labels cut by the edge buffer instead of falling back to them", () => {
    const only = features.filter((f) => f.properties.name === "Randstadt");
    expect(build({ features: only, isFullyVisible: fullyVisible(only) }).groups).toEqual([]);
    // without a visibility test every rendered label counts (edgeBuffer: 0)
    expect(build({ features: only, isFullyVisible: undefined }).groups[0]?.entries[0]).toMatchObject({ key: "place:town", name: "Randstadt" });
  });

  it("drops entries hidden by the manifest and layers without a tag", () => {
    expect(entry("poi:bench")).toBeUndefined();
    expect(model.groups.find((g) => g.id === "poi")?.entries.map((e) => e.key)).toEqual(["poi:fountain", "poi:peak"]); // the bench is hidden
    expect(model.groups.flatMap((g) => g.entries).some((e) => e.swatch.some((l) => l.id === "custom-untagged"))).toBe(false);
  });

  it("carries icon and placement of instance labels, and accepts icon-only symbols", () => {
    const m = build({ manifest: { ...manifest, entries: { ...manifest.entries, "poi:bench": {} } } });
    const bench = m.groups.flatMap((g) => g.entries).find((e) => e.key === "poi:bench");
    expect(bench?.icon?.layout["icon-image"]).toEqual({ name: "sdf:bench" });
    expect(bench?.label).toBe("Bench");
    expect(bench?.text).toMatchObject({ anchor: "top", offset: [0, 0.8], justify: "center", size: 12 });
    const fountain = m.groups.flatMap((g) => g.entries).find((e) => e.key === "poi:fountain");
    expect(fountain).toMatchObject({ kind: "instance", name: undefined, label: "Fountain" });
    expect(fountain?.icon?.layout["icon-image"]).toEqual({ name: "sdf:fountain" });
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
    expect(valueToString({ from: { name: "nature:wood" }, to: { name: "nature:wood" } })).toBe("nature:wood"); // cross-faded fill-pattern
    expect(valueToString({ to: "x" })).toBe("x");
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
    expect(
      geometryAnchor({
        type: "LineString",
        coordinates: [
          [0, 0],
          [2, 2],
          [4, 4],
        ],
      }),
    ).toEqual([2, 2]);
    expect(
      geometryAnchor({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
        ],
      }),
    ).toEqual([2, 2]);
    expect(
      geometryAnchor({
        type: "MultiLineString",
        coordinates: [
          [[0, 0]],
          [
            [1, 1],
            [3, 3],
            [5, 5],
          ],
        ],
      }),
    ).toEqual([3, 3]);
    expect(geometryAnchor(null)).toBeUndefined();
  });
});

describe("a symbol on its feature", () => {
  const KEY = "maptoolkit:legend";
  const line = (id: string, tag: Record<string, unknown>, props: Record<string, unknown>, featureId: number, x = 100): RenderedFeature => ({
    id: featureId,
    layer: { id, type: "line", metadata: { [KEY]: { group: "road", ...tag } }, paint: { "line-color": "rgba(90,90,90,1)", "line-width": 2 }, layout: {} },
    properties: props,
    geometry: {
      type: "LineString",
      coordinates: [
        [x, 150],
        [x + 60, 150],
      ],
    },
  });
  const label = (id: string, tag: Record<string, unknown>, props: Record<string, unknown>, featureId: number): RenderedFeature => ({
    ...line(id, { ...tag, instance: true }, props, featureId, 180),
    layer: { id, type: "symbol", metadata: { [KEY]: { group: "road", instance: true, ...tag } }, paint: {}, layout: { "text-field": "T4" } },
  });
  const order = new Map([
    ["road_path", 1],
    ["road_path_mountain", 2],
    ["road_minor", 3],
    ["road_path_scale_label", 9],
    ["road_minor_oneway_arrows", 10],
  ]);
  const model = (features: RenderedFeature[]) => buildLegendModel({ features, manifest: {}, layerOrder: order, language: "de", viewport });
  const find = (features: RenderedFeature[], key: string) =>
    model(features)
      .groups.flatMap((g) => g.entries)
      .find((e) => e.key === key);

  it("shows the shield of the fixtures on the motorway it names, with that row's own shape", () => {
    const all = buildLegendModel({ features, manifest, layerOrder, language: "de", viewport, isFullyVisible: fullyVisible() });
    const rows = all.groups.flatMap((g) => g.entries);
    const shield = rows.find((e) => e.key === "road:major_shield")!;
    const motorway = rows.find((e) => e.key === "road:major_dark")!;
    expect(shield.anchor?.key).toBe("road:major_dark");
    expect(shield.anchor?.swatch).toBe(motorway.swatch); // the very stack, casing and blur included
    expect(shield.anchor?.variant).toBe(motorway.variant);
  });

  it("prefers the anchor that drew the very same feature over the first one in view", () => {
    const path = line("road_path", { role: "main", key: "path" }, { type: "path" }, 1);
    const mountain = line("road_path_mountain", { role: "main", key: "path_mountain" }, { type: "path", subtype: "mountain" }, 2);
    // the grade label is drawn from the mountain path's own feature (id 2)
    const grade = label(
      "road_path_scale_label",
      { role: "label", key: "path_scale_label", anchors: ["road_path", "road_path_mountain"] },
      { sac_scale: "T4" },
      2,
    );
    expect(find([path, mountain, grade], "road:path_scale_label")?.anchor?.key).toBe("road:path_mountain");
    // unrelated feature: the first anchor in view
    const other = { ...grade, id: 7 };
    expect(find([path, mountain, other], "road:path_scale_label")?.anchor?.key).toBe("road:path");
  });

  it("lets the symbol's own values pick the entry of a main that splits its features", () => {
    const byValue = [{ property: "subtype", values: { pedestrian: "minor_pedestrian" } }];
    const street = line("road_minor", { role: "main", key: "minor", keyByValue: byValue }, { type: "minor" }, 1);
    const zone = line("road_minor", { role: "main", key: "minor", keyByValue: byValue }, { type: "minor", subtype: "pedestrian" }, 2, 300);
    const arrow = label("road_minor_oneway_arrows", { role: "arrows", key: "minor_oneway_arrows", anchors: ["road_minor"] }, { subtype: "pedestrian" }, 5);
    expect(find([street, zone, arrow], "road:minor_oneway_arrows")?.anchor?.key).toBe("road:minor_pedestrian");
  });

  it("knows whether a label follows its line on the map", () => {
    const along = label("road_hiking_label", { role: "label", key: "hiking_label", anchors: ["road_path"] }, {}, 3);
    along.layer.layout = { "text-field": "Nordalpenweg", "symbol-placement": "line" }; // rotation auto → map
    const upright = label("road_major_shield", { role: "shield", key: "major_shield", anchors: ["road_path"] }, {}, 4);
    upright.layer.layout = { "text-field": "A22", "symbol-placement": "line", "text-rotation-alignment": "viewport" };
    const point = label("road_major_junction_label", { role: "label", key: "major_junction_label", anchors: ["road_path"] }, {}, 5);
    point.layer.layout = { "text-field": "Tulln" };
    const rows = model([along, upright, point]).groups.flatMap((g) => g.entries);
    expect(rows.find((e) => e.key === "road:hiking_label")?.text?.alongLine).toBe(true);
    expect(rows.find((e) => e.key === "road:major_shield")?.text?.alongLine).toBe(false);
    expect(rows.find((e) => e.key === "road:major_junction_label")?.text?.alongLine).toBe(false);
  });

  it("draws the symbol bare when none of its anchors is in view", () => {
    const grade = label("road_path_scale_label", { role: "label", key: "path_scale_label", anchors: ["road_path"] }, {}, 2);
    const row = find([grade], "road:path_scale_label");
    expect(row).toBeDefined();
    expect(row?.anchor).toBeUndefined();
  });
});
