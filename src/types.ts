/** Key of the per-layer tag and of the root manifest, as written by `@maptoolkit/style-family`. */
export const LEGEND_METADATA_KEY = "maptoolkit:legend";

/** Text per language code, e.g. `{ de: "Autobahn", en: "Motorway" }`. */
export type LegendLabel = Record<string, string>;

/**
 * The tag a style layer carries in `layer.metadata["maptoolkit:legend"]`.
 * See style-family-js/docs/styles.md#legend-metadata for the contract.
 */
export type LegendLayerTag = {
  hidden?: boolean;
  role?: string;
  group?: string;
  /** Fixed entry key (`${group}:${key}`). */
  key?: string;
  /** Feature property whose value is the entry key (`${group}:${properties[keyProperty]}`). */
  keyProperty?: string;
  /**
   * Property values the layer paints differently: a feature whose `property`
   * has one of these values belongs to that value's key instead of the layer's
   * own (`road_minor` → `road:minor_pedestrian`), first matching rule wins.
   */
  keyByValue?: Array<{ property: string; values: Record<string, string> }>;
  /** Supporting layers: the main layers whose entries this layer contributes to. */
  attachesTo?: string[];
  /**
   * The layer is a map symbol of its own — a place label, a road shield, a
   * one-way arrow — and gets a row showing it as drawn, never stacking into
   * another entry's swatch. With `keyProperty` one row per value, with `key`
   * one row for the layer.
   */
  instance?: boolean;
  /** Feature property ranking instance candidates (lower = more prominent). */
  rankProperty?: string;
  /**
   * Standalone symbol layers: the main layers the symbol sits on — a shield on
   * its route, a river name on its waterway. The row draws the symbol on the
   * swatch of the first of them in view, and bare when none is.
   */
  anchors?: string[];
  /** Set on bridge/tunnel duplicates of a layer; swatches prefer ground-level copies. */
  crossing?: string;
  /**
   * Main layers drawn onto other features (hiking/cycling routes, cycle lanes):
   * the swatch shows the whole rendered stack of the feature — the route with
   * the road it runs on — not the route layer alone.
   */
  overlay?: boolean;
};

export type LegendManifestItem = {
  label?: LegendLabel;
  order?: number;
  hidden?: boolean;
  /** Entry keys this entry stands for (merges): `place:village` for `place:hamlet`, `place:farm`, … */
  keys?: string[];
};

/** The root manifest in `style.metadata["maptoolkit:legend"]`. */
export type LegendManifest = {
  version?: number;
  /** Where the map's typefaces are served as web fonts: `css` is a stylesheet with their `@font-face` rules. */
  fonts?: { css?: string };
  groups?: Record<string, LegendManifestItem>;
  entries?: Record<string, LegendManifestItem>;
};

/** Minimal geometry shape — we only need coordinates for a representative point. */
export type GeometryLike = { type: string; coordinates?: unknown } | null | undefined;

/** The slice of a `MapGeoJSONFeature` the legend reads: the layer comes with per-feature evaluated paint/layout. */
export type RenderedLayer = {
  id: string;
  type: string;
  metadata?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

export type RenderedFeature = {
  /** Tile feature id when the source provides one; copies of one feature across layers share it. */
  id?: string | number;
  layer: RenderedLayer;
  properties: Record<string, unknown>;
  geometry: GeometryLike;
};

/** One layer's evaluated appearance, ready to be drawn into a swatch. */
export type SwatchLayer = {
  id: string;
  type: string;
  role: string;
  /** Position in the style's layer array — swatches stack bottom to top. */
  order: number;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
};

/** Evaluated text appearance and placement of an instance label, for rendering the name like the map does. */
export type TextStyle = {
  fontStack: string[];
  size?: number;
  color?: string;
  haloColor?: string;
  haloWidth?: number;
  transform?: string;
  letterSpacing?: number;
  /** `text-anchor` — which side of the text box sits at the symbol's anchor point. */
  anchor?: string;
  /** `text-offset` in ems, [x, y]. */
  offset?: [number, number];
  /** `text-justify` → text alignment. */
  justify?: string;
  /** `text-max-width` in ems (line wrapping). */
  maxWidth?: number;
  /** `text-line-height` as a factor. */
  lineHeight?: number;
  /**
   * The label follows its line on the map: `symbol-placement` line or
   * line-center with `text-rotation-alignment` map (or auto). A shield keeps
   * viewport alignment and stays upright.
   */
  alongLine?: boolean;
};

export type LegendEntry = {
  /** `${group}:${key}` */
  key: string;
  group: string;
  kind: "class" | "instance";
  /** Resolved display label (manifest label in the chosen language, or the humanized key). */
  label: string;
  /** Instance entries: the rendered name of the chosen feature (may be absent for icon-only POIs). */
  name?: string;
  text?: TextStyle;
  /** Instance entries with an icon (POIs), drawn together with the name like on the map. */
  icon?: SwatchLayer;
  /**
   * Instance entries: the class entry of the feature the symbol sits on, when
   * that feature is in view — the row shows the symbol on its swatch.
   */
  anchor?: { key: string; swatch: SwatchLayer[]; variant: number };
  /** Class entries: main + supporting layers, bottom to top. */
  swatch: SwatchLayer[];
  /**
   * Which shape of its family the swatch is drawn with (see `createSwatch`).
   * The main layer's position in the style, so layers that sit next to each
   * other — and end up next to each other in the legend — never share a shape;
   * for a layer with a dynamic key its entries are spread by the key's hash.
   */
  variant: number;
  order: number;
};

export type LegendGroup = { id: string; label: string; order: number; entries: LegendEntry[] };

export type LegendModel = { groups: LegendGroup[] };
