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
};

export type LegendManifestItem = { label?: LegendLabel; order?: number; hidden?: boolean };

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

/** Evaluated text appearance of an instance label, for rendering the name in the map font. */
export type TextStyle = {
  fontStack: string[];
  size?: number;
  color?: string;
  haloColor?: string;
  haloWidth?: number;
  transform?: string;
  letterSpacing?: number;
};

export type LegendEntry = {
  /** `${group}:${key}` */
  key: string;
  group: string;
  kind: "class" | "instance";
  /** Resolved display label (manifest label in the chosen language, or the humanized key). */
  label: string;
  /** Instance entries: the rendered name of the chosen feature. */
  name?: string;
  text?: TextStyle;
  /** Instance entries with an icon (POIs). */
  icon?: SwatchLayer;
  /** Class entries: main + supporting layers, bottom to top. */
  swatch: SwatchLayer[];
  order: number;
};

export type LegendGroup = { id: string; label: string; order: number; entries: LegendEntry[] };

export type LegendModel = { groups: LegendGroup[] };
