import { LEGEND_METADATA_KEY as KEY, type RenderedFeature, type LegendManifest } from "../src/types";

/** Mimics the `toString()` of MapLibre's evaluated Color / Formatted values. */
const asToString = (s: string) => ({ toString: () => s });

export const manifest: LegendManifest = {
  version: 1,
  fonts: { css: "https://static.example.org/webfonts/webfonts.css" },
  groups: {
    place: { label: { de: "Orte", en: "Places" }, order: 10 },
    road: { label: { de: "Straßen und Verkehr", en: "Roads and transport" }, order: 20 },
    nature: { label: { de: "Landschaft", en: "Landscape" }, order: 40 },
  },
  entries: {
    "road:major_dark": { label: { de: "Hauptstraße", en: "Major road" }, order: 1 },
    "road:minor": { label: { de: "Nebenstraße", en: "Minor road" }, order: 3 },
    "road:minor_pedestrian": { label: { de: "Fußgängerzone", en: "Pedestrian zone" }, order: 3 },
    "nature:wood": { label: { de: "Wald", en: "Forest" }, order: 1 },
    "place:town": { label: { de: "Stadt", en: "Town" }, order: 2 },
    "place:village": { label: { de: "Dorf", en: "Village" }, order: 3, keys: ["place:hamlet", "place:farm"] },
    "poi:bench": { hidden: true },
  },
};

export const layerOrder = new Map<string, number>([
  ["nature_natural", 1],
  ["nature_natural_texture", 2],
  ["road_hiking", 2.5],
  ["road_cycling_route", 2.6],
  ["road_cycling_infra_lane", 2.7],
  ["road_major_blur", 3],
  ["road_path_casing", 3.2],
  ["road_path", 3.4],
  ["road_major_casing", 4],
  ["road_minor", 5],
  ["road_major_dark", 6],
  ["road_major_blur_bridge", 6.5],
  ["road_major_dark_bridge", 6.7],
  ["road_major_label", 7],
  ["poi_generic_label_rank_3", 8],
  ["poi_peak_label_rank_3", 8.5],
  ["place_point_label_rank_3", 9],
  ["road_hiking_label", 9.5],
  ["custom-untagged", 10],
]);

/** road_minor's tag: every copy of a layer carries the same one. */
const MINOR_TAG = {
  key: "minor",
  keyByValue: [
    { property: "subtype", values: { pedestrian: "minor_pedestrian" } },
    { property: "type", values: { track: "minor_track" } },
  ],
};

const road = (
  id: string,
  role: string,
  extra: Record<string, unknown>,
  type: string,
  props: Record<string, unknown>,
  coords: number[][],
  paint: Record<string, unknown> = {},
): RenderedFeature => ({
  layer: {
    id,
    type: "line",
    metadata: { [KEY]: { role, group: "road", ...extra } },
    paint: {
      "line-color": asToString(`rgba(${role === "casing" ? "0,0,0" : "255,80,80"},1)`),
      "line-width": role === "casing" ? 1 : 5,
      ...(role === "casing" ? { "line-gap-width": 5 } : {}),
      ...paint,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  },
  properties: { type, ...props },
  geometry: { type: "LineString", coordinates: coords },
});

const place = (name: string, type: string, rank: number, lngLat: [number, number], font = "Rosario Bold"): RenderedFeature => ({
  layer: {
    id: "place_point_label_rank_3",
    type: "symbol",
    metadata: { [KEY]: { role: "label", group: "place", instance: true, keyProperty: "type", rankProperty: "rank" } },
    paint: { "text-color": asToString("rgba(40,40,40,1)"), "text-halo-color": asToString("rgba(255,255,255,1)"), "text-halo-width": 1 },
    layout: { "text-field": asToString(name), "text-font": [font], "text-size": 14, "text-transform": "none" },
  },
  properties: { type, rank, name },
  geometry: { type: "Point", coordinates: lngLat },
});

/** Viewport 400×300; `project` maps lng/lat 1:1 onto pixels for readable fixtures. */
export const viewport = { width: 400, height: 300, project: ([x, y]: [number, number]) => ({ x, y }) };

/**
 * Mimics `map.queryRenderedFeatures(box)` for the fixtures: symbols count as
 * intersecting a box when their anchor lies inside it (a stand-in for the
 * placed icon+text box), other geometries always match.
 */
export function queryFixtures(list: RenderedFeature[], box?: [[number, number], [number, number]]): RenderedFeature[] {
  if (!box) return list;
  const [[x0, y0], [x1, y1]] = box;
  return list.filter((f) => {
    if (f.layer.type !== "symbol") return true;
    const raw = f.geometry?.coordinates as number[] | number[][] | undefined;
    // line-placed symbols (a road shield) carry the line: take its first point as the anchor
    const c = (Array.isArray(raw?.[0]) ? raw[0] : raw) as [number, number] | undefined;
    if (!c || typeof c[0] !== "number") return true;
    return c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1;
  });
}

export const features: RenderedFeature[] = [
  // motorway: three copies of one road (blur, casing, main) + its label
  road("road_major_blur", "blur", { attachesTo: ["road_major_dark"] }, "motorway", {}, [
    [10, 10],
    [50, 10],
  ]),
  road("road_major_casing", "casing", { attachesTo: ["road_major_dark", "road_minor"] }, "motorway", {}, [
    [10, 10],
    [50, 10],
  ]),
  road("road_major_dark", "main", { key: "major_dark" }, "motorway", {}, [
    [10, 10],
    [50, 10],
  ]),
  // a second, wider road drawn by the same layers — its casing must not be picked for the motorway entry
  road(
    "road_major_casing",
    "casing",
    { attachesTo: ["road_major_dark", "road_minor"] },
    "trunk",
    {},
    [
      [60, 60],
      [90, 60],
    ],
    { "line-gap-width": 9 },
  ),
  road(
    "road_major_dark",
    "main",
    { key: "major_dark" },
    "trunk",
    {},
    [
      [60, 60],
      [90, 60],
    ],
    { "line-width": 9 },
  ),
  // bridge duplicates: a main copy on a bridge and its shadow — neither may shape the swatch
  road(
    "road_major_dark_bridge",
    "main",
    { key: "major_dark", crossing: "bridge" },
    "motorway",
    {},
    [
      [70, 70],
      [80, 70],
    ],
    { "line-width": 7 },
  ),
  road(
    "road_major_blur_bridge",
    "blur",
    { attachesTo: ["road_major_dark", "road_major_dark_bridge"], crossing: "bridge" },
    "motorway",
    {},
    [
      [70, 70],
      [80, 70],
    ],
    { "line-width": 12 },
  ),
  {
    layer: {
      id: "road_major_label",
      type: "symbol",
      metadata: { [KEY]: { role: "label", group: "road", attachesTo: ["road_major_dark"] } },
      paint: {},
      layout: { "text-field": asToString("A22") },
    },
    properties: { type: "motorway", name: "A22" },
    geometry: {
      type: "LineString",
      coordinates: [
        [10, 10],
        [50, 10],
      ],
    },
  },
  // a minor road, casing attaches to it too; dashed like MapLibre reports it (cross-faded { from, to })
  road(
    "road_minor",
    "main",
    MINOR_TAG,
    "service",
    {},
    [
      [100, 100],
      [150, 100],
    ],
    { "line-dasharray": { from: [2, 3], to: [2, 3] } },
  ),
  // a pedestrian street from the same layer, which the style paints in another
  // colour: its own entry, and the casing copy follows the feature into it
  road("road_major_casing", "casing", { attachesTo: ["road_major_dark", "road_minor"] }, "minor", { subtype: "pedestrian" }, [
    [160, 100],
    [200, 100],
  ]),
  road(
    "road_minor",
    "main",
    MINOR_TAG,
    "minor",
    { subtype: "pedestrian" },
    [
      [160, 100],
      [200, 100],
    ],
    { "line-color": asToString("rgba(250,240,200,1)") },
  ),
  // a cycle route sharing its way with a cycle lane: two overlays in one stack,
  // so this stretch must lose to the one below that runs on a plain road
  road("road_cycling_route", "main", { key: "cycling_route", overlay: true }, "minor", { cycling: "lane" }, [
    [300, 300],
    [340, 300],
  ]),
  road("road_cycling_infra_lane", "main", { key: "cycling_infra_lane", overlay: true }, "minor", { cycling: "lane" }, [
    [300, 300],
    [340, 300],
  ]),
  road("road_minor", "main", MINOR_TAG, "minor", { cycling: "lane" }, [
    [300, 300],
    [340, 300],
  ]),
  // the same route on a plain road — the clean example, whatever the query order
  road("road_cycling_route", "main", { key: "cycling_route", overlay: true }, "minor", { cycling: "none" }, [
    [360, 300],
    [400, 300],
  ]),
  road("road_minor", "main", MINOR_TAG, "minor", { cycling: "none" }, [
    [360, 300],
    [400, 300],
  ]),
  // a road shield: its own row, the symbol as the map draws it (icon + the number on it)
  {
    layer: {
      id: "road_major_shield",
      type: "symbol",
      metadata: { [KEY]: { role: "shield", group: "road", instance: true, key: "major_shield" } },
      paint: {},
      layout: {
        "icon-image": { name: "sdf:square" },
        "icon-text-fit": "both",
        "icon-text-fit-padding": [2, 5, 4, 5], // more at the bottom: the number sits high in the shield
        "text-field": asToString("A22"),
      },
    },
    properties: { type: "motorway", ref: "A22" },
    geometry: {
      type: "LineString",
      coordinates: [
        [180, 150],
        [240, 150],
      ], // mid-viewport, so the edge buffer keeps it
    },
  },
  // a stretch of the route on a bridge: the road under it is drawn by crossing
  // layers only, which a ground-level stretch beats — but they beat a bare band
  road(
    "road_hiking",
    "main",
    { key: "hiking", overlay: true },
    "path",
    { walking_network: "iwn" },
    [
      [300, 200],
      [320, 200],
    ],
    { "line-width": 9 },
  ),
  road(
    "road_path_bridge",
    "main",
    { key: "path", crossing: "bridge" },
    "path",
    { walking_network: "iwn" },
    [
      [300, 200],
      [320, 200],
    ],
    { "line-width": 2 },
  ),
  // a stretch of the route drawn on its own (the road it runs on is out of this zoom).
  // It comes first in query order, so it must not be the copy that represents the entry.
  road(
    "road_hiking",
    "main",
    { key: "hiking", overlay: true },
    "track",
    { walking_network: "rwn" },
    [
      [260, 200],
      [280, 200],
    ],
    { "line-width": 9 },
  ),
  // a hiking route: a wide band drawn BELOW the path it runs on (same feature, three copies)
  road(
    "road_hiking",
    "main",
    { key: "hiking", overlay: true },
    "path",
    { walking_network: "rwn" },
    [
      [200, 200],
      [240, 200],
    ],
    { "line-width": 9, "line-opacity": 0.4, "line-color": asToString("rgba(220,60,60,1)") },
  ),
  road(
    "road_path_casing",
    "casing",
    { attachesTo: ["road_path"] },
    "path",
    { walking_network: "rwn" },
    [
      [200, 200],
      [240, 200],
    ],
    { "line-gap-width": 2 },
  ),
  road(
    "road_path",
    "main",
    { key: "path" },
    "path",
    { walking_network: "rwn" },
    [
      [200, 200],
      [240, 200],
    ],
    { "line-width": 2 },
  ),
  road("road_hiking_label", "label", { attachesTo: ["road_hiking"] }, "path", { walking_network: "rwn" }, [
    [200, 200],
    [240, 200],
  ]),
  // dynamic landcover: two polygons of different type, one texture copy per type
  {
    layer: {
      id: "nature_natural",
      type: "fill",
      metadata: { [KEY]: { role: "main", group: "nature", keyProperty: "type" } },
      paint: { "fill-color": asToString("rgba(120,180,90,1)") },
      layout: {},
    },
    properties: { type: "wood" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  },
  {
    layer: {
      id: "nature_natural",
      type: "fill",
      metadata: { [KEY]: { role: "main", group: "nature", keyProperty: "type" } },
      paint: { "fill-color": asToString("rgba(200,200,120,1)") },
      layout: {},
    },
    properties: { type: "farmland" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  },
  {
    layer: {
      id: "nature_natural_texture",
      type: "fill",
      metadata: { [KEY]: { role: "texture", group: "nature", attachesTo: ["nature_natural"] } },
      paint: { "fill-pattern": { name: "nature:wood" } },
      layout: {},
    },
    properties: { type: "wood" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  },
  // places: two towns (one at the edge, one inside with worse rank), a village; the inside one must win
  place("Randstadt", "town", 5, [5, 150]), // 5 px from the left edge — inside the 5 % buffer (20 px), cut off
  place("Tulln an der Donau", "town", 12, [200, 150]),
  place("Tulln an der Donau", "town", 12, [200, 150]), // duplicate copy from a neighbouring tile
  place("Langenlebarn", "village", 15, [220, 160], "Rosario Regular"),
  place("Staasdorf", "hamlet", 9, [230, 170], "Rosario Regular"), // merged into place:village — and more prominent than the village
  // POI: hidden by the manifest
  {
    layer: {
      id: "poi_generic_label_rank_3",
      type: "symbol",
      metadata: { [KEY]: { role: "label", group: "poi", instance: true, keyProperty: "type", rankProperty: "rank_new" } },
      paint: {},
      layout: {
        "text-field": asToString("Bankerl"),
        "text-font": ["Rosario Semibold"],
        "text-size": 12,
        "text-anchor": "top",
        "text-justify": "center",
        "text-offset": [0, 0.8],
        "icon-image": { name: "sdf:bench" },
        "icon-size": 1,
      },
    },
    properties: { type: "bench", rank_new: 20 },
    geometry: { type: "Point", coordinates: [200, 100] },
  },
  // an unnamed POI: icon only, still a legend entry for its type
  {
    layer: {
      id: "poi_generic_label_rank_3",
      type: "symbol",
      metadata: { [KEY]: { role: "label", group: "poi", instance: true, keyProperty: "type", rankProperty: "rank_new" } },
      paint: {},
      layout: { "text-field": asToString(""), "text-font": ["Rosario Semibold"], "text-anchor": "top", "icon-image": { name: "sdf:fountain" } },
    },
    properties: { type: "fountain", rank_new: 18 },
    geometry: { type: "Point", coordinates: [210, 110] },
  },
  // a peak: text-only label, left-justified (the template's poi_peak_label layers)
  {
    layer: {
      id: "poi_peak_label_rank_3",
      type: "symbol",
      metadata: { [KEY]: { role: "label", group: "poi", instance: true, keyProperty: "type", rankProperty: "rank_new" } },
      paint: { "text-color": asToString("rgba(90,60,30,1)") },
      layout: {
        "text-field": asToString("Großglockner\n3798 m"),
        "text-font": ["Rosario Medium Italic"],
        "text-size": 11,
        "text-anchor": "center",
        "text-justify": "left",
      },
    },
    properties: { type: "peak", rank_new: 5 },
    geometry: { type: "Point", coordinates: [300, 120] },
  },
  // untagged custom layer → ignored
  { layer: { id: "custom-untagged", type: "fill", paint: {}, layout: {} }, properties: { type: "x" }, geometry: { type: "Point", coordinates: [1, 1] } },
];
