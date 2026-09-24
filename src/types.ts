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
  /** Supporting layers: the main layers whose entries this layer contributes to. */
  attachesTo?: string[];
  /** Standalone labels: one entry per key value, showing the most prominent named feature. */
  instance?: boolean;
  /** Feature property ranking instance candidates (lower = more prominent). */
  rankProperty?: string;
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
  /** Class entries: main + supporting layers, bottom to top. */
  swatch: SwatchLayer[];
  order: number;
};

export type LegendGroup = { id: string; label: string; order: number; entries: LegendEntry[] };

export type LegendModel = { groups: LegendGroup[] };
