import { LEGEND_METADATA_KEY as KEY, type RenderedFeature, type LegendManifest } from "../src/types";

/** Mimics the `toString()` of MapLibre's evaluated Color / Formatted values. */
const asToString = (s: string) => ({ toString: () => s });

export const manifest: LegendManifest = {
  version: 1,
  groups: {
    place: { label: { de: "Orte", en: "Places" }, order: 10 },
    road: { label: { de: "Straßen und Verkehr", en: "Roads and transport" }, order: 20 },
    nature: { label: { de: "Landschaft", en: "Landscape" }, order: 40 },
  },
  entries: {
    "road:major_dark": { label: { de: "Hauptstraße", en: "Major road" }, order: 1 },
    "road:minor": { label: { de: "Nebenstraße", en: "Minor road" }, order: 3 },
    "nature:wood": { label: { de: "Wald", en: "Forest" }, order: 1 },
    "place:town": { label: { de: "Stadt", en: "Town" }, order: 2 },
    "place:village": { label: { de: "Dorf", en: "Village" }, order: 3 },
    "poi:bench": { hidden: true },
  },
};

export const layerOrder = new Map<string, number>([
  ["nature_natural", 1],
  ["nature_natural_texture", 2],
  ["road_major_blur", 3],
  ["road_major_casing", 4],
  ["road_minor", 5],
  ["road_major_dark", 6],
  ["road_major_blur_bridge", 6.5],
  ["road_major_dark_bridge", 6.7],
  ["road_major_label", 7],
  ["poi_generic_label_rank_3", 8],
  ["place_point_label_rank_3", 9],
  ["custom-untagged", 10],
]);

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

export const features: RenderedFeature[] = [
  // motorway: three copies of one road (blur, casing, main) + its label
  road("road_major_blur", "blur", { attachesTo: ["road_major_dark"] }, "motorway", {}, [[10, 10], [50, 10]]),
  road("road_major_casing", "casing", { attachesTo: ["road_major_dark", "road_minor"] }, "motorway", {}, [[10, 10], [50, 10]]),
  road("road_major_dark", "main", { key: "major_dark" }, "motorway", {}, [[10, 10], [50, 10]]),
  // a second, wider road drawn by the same layers — its casing must not be picked for the motorway entry
  road("road_major_casing", "casing", { attachesTo: ["road_major_dark", "road_minor"] }, "trunk", {}, [[60, 60], [90, 60]], { "line-gap-width": 9 }),
  road("road_major_dark", "main", { key: "major_dark" }, "trunk", {}, [[60, 60], [90, 60]], { "line-width": 9 }),
  // bridge duplicates: a main copy on a bridge and its shadow — neither may shape the swatch
  road("road_major_dark_bridge", "main", { key: "major_dark", crossing: "bridge" }, "motorway", {}, [[70, 70], [80, 70]], { "line-width": 7 }),
  road("road_major_blur_bridge", "blur", { attachesTo: ["road_major_dark", "road_major_dark_bridge"], crossing: "bridge" }, "motorway", {}, [[70, 70], [80, 70]], { "line-width": 12 }),
  {
    layer: { id: "road_major_label", type: "symbol", metadata: { [KEY]: { role: "label", group: "road", attachesTo: ["road_major_dark"] } }, paint: {}, layout: { "text-field": asToString("A22") } },
    properties: { type: "motorway", name: "A22" },
    geometry: { type: "LineString", coordinates: [[10, 10], [50, 10]] },
  },
  // a minor road, casing attaches to it too; dashed like MapLibre reports it (NumberArray-shaped)
  road("road_minor", "main", { key: "minor" }, "service", {}, [[100, 100], [150, 100]], { "line-dasharray": { values: [2, 3] } }),
  // dynamic landcover: two polygons of different type, one texture copy per type
  {
    layer: { id: "nature_natural", type: "fill", metadata: { [KEY]: { role: "main", group: "nature", keyProperty: "type" } }, paint: { "fill-color": asToString("rgba(120,180,90,1)") }, layout: {} },
    properties: { type: "wood" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  },
  {
    layer: { id: "nature_natural", type: "fill", metadata: { [KEY]: { role: "main", group: "nature", keyProperty: "type" } }, paint: { "fill-color": asToString("rgba(200,200,120,1)") }, layout: {} },
    properties: { type: "farmland" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  },
  {
    layer: { id: "nature_natural_texture", type: "fill", metadata: { [KEY]: { role: "texture", group: "nature", attachesTo: ["nature_natural"] } }, paint: { "fill-pattern": { name: "nature:wood" } }, layout: {} },
    properties: { type: "wood" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  },
  // places: two towns (one at the edge, one inside with worse rank), a village; the inside one must win
  place("Randstadt", "town", 5, [5, 150]), // 5 px from the left edge — within the 24 px margin
  place("Tulln an der Donau", "town", 12, [200, 150]),
  place("Tulln an der Donau", "town", 12, [200, 150]), // duplicate copy from a neighbouring tile
  place("Langenlebarn", "village", 15, [220, 160], "Rosario Regular"),
  // POI: hidden by the manifest
  {
    layer: {
      id: "poi_generic_label_rank_3",
      type: "symbol",
      metadata: { [KEY]: { role: "label", group: "poi", instance: true, keyProperty: "type", rankProperty: "rank_new" } },
      paint: {},
      layout: { "text-field": asToString("Bankerl"), "text-font": ["Rosario Semibold"], "icon-image": { name: "sdf:bench" } },
    },
    properties: { type: "bench", rank_new: 20 },
    geometry: { type: "Point", coordinates: [200, 100] },
  },
  // untagged custom layer → ignored
  { layer: { id: "custom-untagged", type: "fill", paint: {}, layout: {} }, properties: { type: "x" }, geometry: { type: "Point", coordinates: [1, 1] } },
];
