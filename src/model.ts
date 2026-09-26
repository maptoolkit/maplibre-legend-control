import {
  LEGEND_METADATA_KEY,
  type GeometryLike,
  type LegendEntry,
  type LegendGroup,
  type LegendLabel,
  type LegendLayerTag,
  type LegendManifest,
  type LegendModel,
  type RenderedFeature,
  type SwatchLayer,
  type TextStyle,
} from "./types";
import { swatchVariantFor } from "./swatch";

/** Viewport geometry the instance selection needs; `project` maps [lng, lat] to CSS pixels. */
export type Viewport = {
  width: number;
  height: number;
  project: (lngLat: [number, number]) => { x: number; y: number };
};

export type BuildLegendModelInput = {
  /** Result of `map.queryRenderedFeatures()` for the whole viewport. */
  features: RenderedFeature[];
  /** `style.metadata["maptoolkit:legend"]`, may be missing for styles without legend metadata. */
  manifest?: LegendManifest | null;
  /** Layer id → index in `style.layers`, to stack swatches bottom to top. */
  layerOrder: Map<string, number>;
  /** Language code for manifest labels (`de`, `en`, …); falls back to `en`, then to the first label. */
  language: string;
  viewport: Viewport;
  /**
   * Whether a rendered label (its whole icon + text box) lies entirely inside
   * the visible area; labels for which this returns `false` are not listed.
   * Omitted = every rendered label counts.
   */
  isFullyVisible?: (feature: RenderedFeature) => boolean;
};

/** Order used for entries/groups the manifest does not order. */
const UNORDERED = 1_000_000;
/** Supporting roles that carry text — they never contribute strokes to a swatch. */
const TEXT_ROLES = new Set(["label", "shield"]);

/**
 * Turn an evaluated style value (string, number, Color, Formatted, ResolvedImage …)
 * into a string. Cross-faded properties (`fill-pattern`, `line-pattern`,
 * `fill-extrusion-pattern`) arrive as `{ from, to }` for the zoom transition;
 * `to` is the current value.
 */
export function valueToString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const obj = value as { name?: unknown; to?: unknown; from?: unknown; toString?: () => string };
    if (obj.to !== undefined || obj.from !== undefined) return valueToString(obj.to ?? obj.from); // CrossFaded
    if (typeof obj.name === "string") return obj.name; // ResolvedImage
    if (typeof obj.toString === "function" && obj.toString !== Object.prototype.toString) return obj.toString(); // Color, Formatted
  }
  return undefined;
}

/**
 * Numeric arrays arrive as plain arrays, as MapLibre `NumberArray` objects
 * (`{ values }`) or — for cross-faded properties such as `line-dasharray` — as
 * `{ from, to }` pairs for the zoom transition, of which `to` is the current value.
 */
export function valueToNumbers(value: unknown): number[] | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as { to?: unknown; from?: unknown; values?: unknown };
    if (obj.to !== undefined || obj.from !== undefined) return valueToNumbers(obj.to ?? obj.from);
    if (Array.isArray(obj.values)) return valueToNumbers(obj.values);
    return undefined;
  }
  if (!Array.isArray(value) || !value.length || !value.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  return value as number[];
}

/**
 * Identity of the underlying tile feature, so copies of one road drawn by its
 * blur, casing and main layer can be matched (same widths, same type, same
 * tile). Uses the feature id when the source provides one, else the
 * properties plus the geometry's end points.
 */
export function featureIdentity(feature: RenderedFeature): string {
  if (feature.id !== undefined && feature.id !== null) return `id:${feature.id}`;
  const coords = feature.geometry && Array.isArray(feature.geometry.coordinates) ? (feature.geometry.coordinates as unknown[]) : [];
  const flat = JSON.stringify(coords).slice(0, 80);
  return `p:${JSON.stringify(feature.properties ?? {})}|${feature.geometry?.type ?? ""}|${flat}`;
}

export function humanize(key: string): string {
  const raw = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  const text = raw.replace(/[_-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

export function pickLabel(label: LegendLabel | undefined, language: string): string | undefined {
  if (!label) return undefined;
  return label[language] ?? label.en ?? Object.values(label)[0];
}

/** A representative [lng, lat] for a geometry: the point, a line's middle vertex, a ring's vertex mean. */
export function geometryAnchor(geometry: GeometryLike): [number, number] | undefined {
  if (!geometry || !Array.isArray(geometry.coordinates)) return undefined;
  const c = geometry.coordinates as unknown[];
  const isPos = (v: unknown): v is [number, number] => Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number";
  const middle = (line: unknown[]): [number, number] | undefined => {
    const p = line[Math.floor(line.length / 2)];
    return isPos(p) ? [p[0], p[1]] : undefined;
  };
  const mean = (ring: unknown[]): [number, number] | undefined => {
    const pts = ring.filter(isPos);
    if (!pts.length) return undefined;
    const sum = pts.reduce<[number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
  };
  switch (geometry.type) {
    case "Point":
      return isPos(c) ? [c[0], c[1]] : undefined;
    case "MultiPoint":
      return isPos(c[0]) ? [c[0][0], c[0][1]] : undefined;
    case "LineString":
      return middle(c);
    case "MultiLineString": {
      const longest = (c as unknown[][]).reduce((a, b) => (b.length > a.length ? b : a), [] as unknown[]);
      return middle(longest);
    }
    case "Polygon":
      return Array.isArray(c[0]) ? mean(c[0] as unknown[]) : undefined;
    case "MultiPolygon": {
      const first = c[0] as unknown[] | undefined;
      return first && Array.isArray(first[0]) ? mean(first[0] as unknown[]) : undefined;
    }
    default:
      return undefined;
  }
}

function tagOf(feature: RenderedFeature): LegendLayerTag | undefined {
  const tag = feature.layer.metadata?.[LEGEND_METADATA_KEY];
  return tag && typeof tag === "object" ? (tag as LegendLayerTag) : undefined;
}

/**
 * The entry value a main layer gives this feature: a value the layer paints
 * differently ({@link LegendLayerTag.keyByValue}), else its dynamic or fixed key.
 */
function entryValueOf(tag: LegendLayerTag, feature: RenderedFeature): string | undefined {
  for (const rule of tag.keyByValue ?? []) {
    const value = valueToString(feature.properties?.[rule.property]);
    if (value !== undefined && rule.values[value]) return rule.values[value];
  }
  return tag.key ?? (tag.keyProperty ? valueToString(feature.properties?.[tag.keyProperty]) : undefined);
}

function swatchLayerOf(feature: RenderedFeature, role: string, layerOrder: Map<string, number>): SwatchLayer {
  return {
    id: feature.layer.id,
    type: feature.layer.type,
    role,
    order: layerOrder.get(feature.layer.id) ?? UNORDERED,
    paint: feature.layer.paint ?? {},
    layout: feature.layer.layout ?? {},
  };
}

function textStyleOf(feature: RenderedFeature): TextStyle {
  const layout = feature.layer.layout ?? {};
  const paint = feature.layer.paint ?? {};
  const fontStack = Array.isArray(layout["text-font"]) ? (layout["text-font"] as unknown[]).map(String) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const offset = valueToNumbers(layout["text-offset"]);
  // text-variable-anchor lists alternatives the collision pass chooses from; the first one is the preferred placement
  const variable = Array.isArray(layout["text-variable-anchor"]) ? valueToString((layout["text-variable-anchor"] as unknown[])[0]) : undefined;
  const placement = valueToString(layout["symbol-placement"]) ?? "point";
  const rotation = valueToString(layout["text-rotation-alignment"]) ?? "auto";
  return {
    alongLine: placement !== "point" && rotation !== "viewport",
    fontStack,
    size: num(layout["text-size"]),
    color: valueToString(paint["text-color"]),
    haloColor: valueToString(paint["text-halo-color"]),
    haloWidth: num(paint["text-halo-width"]),
    transform: valueToString(layout["text-transform"]),
    letterSpacing: num(layout["text-letter-spacing"]),
    anchor: valueToString(layout["text-anchor"]) ?? variable,
    offset: offset && offset.length >= 2 ? [offset[0], offset[1]] : undefined,
    justify: valueToString(layout["text-justify"]),
    maxWidth: num(layout["text-max-width"]),
    lineHeight: num(layout["text-line-height"]),
  };
}

type InstanceCandidate = {
  feature: RenderedFeature;
  name?: string;
  rank: number;
  distance: number;
};

/**
 * Build the legend model for one viewport: class entries for every rendered
 * main layer (with their supporting layers stacked into the swatch) and one
 * instance entry per key of the standalone label layers, choosing the most
 * prominent feature among those fully visible (lowest rank, named before
 * unnamed, then the one closest to the viewport centre).
 */
export function buildLegendModel(input: BuildLegendModelInput): LegendModel {
  const { features, layerOrder, language, viewport, isFullyVisible } = input;
  const manifest = input.manifest ?? {};
  const manifestEntries = manifest.entries ?? {};
  const manifestGroups = manifest.groups ?? {};

  const entries = new Map<string, LegendEntry>();
  /** main layer id → entry keys it produced (fixed key: one; dynamic key: one per rendered value) */
  const entriesOfMain = new Map<string, Set<string>>();
  const mainTags = new Map<string, LegendLayerTag>();
  /** entry key → rendered main copies (ground level preferred over bridges/tunnels) */
  const mainCopies = new Map<string, Array<{ feature: RenderedFeature; tag: LegendLayerTag }>>();
  /** entry key → identity of the representative main copy */
  const representative = new Map<string, string>();
  const candidates = new Map<string, InstanceCandidate[]>();
  const instanceTags = new Map<string, { tag: LegendLayerTag; feature: RenderedFeature }>();

  const isHiddenKey = (entryKey: string) => manifestEntries[entryKey]?.hidden === true;
  const groupHidden = (group: string) => manifestGroups[group]?.hidden === true;
  // Merges: an entry lists the keys it stands for; rendered keys are mapped to it first.
  const mergeTarget = new Map<string, string>();
  for (const [target, item] of Object.entries(manifestEntries)) for (const k of item.keys ?? []) mergeTarget.set(k, target);
  const resolveKey = (key: string) => mergeTarget.get(key) ?? key;

  // Pass 1 — main layers → class entries; standalone labels → candidates.
  for (const feature of features) {
    const tag = tagOf(feature);
    if (!tag || tag.hidden || !tag.group || groupHidden(tag.group)) continue;

    if (tag.instance) {
      // a dynamic key (one row per place type) or a fixed one (a shield, a
      // one-way arrow: the layer itself is the symbol, one row for all of them)
      const value = entryValueOf(tag, feature);
      if (!value) continue;
      const entryKey = resolveKey(`${tag.group}:${value}`);
      if (isHiddenKey(entryKey)) continue;
      const name = valueToString(feature.layer.layout?.["text-field"])?.trim() || undefined;
      if (!name && !feature.layer.layout?.["icon-image"]) continue; // nothing to show
      if (isFullyVisible && !isFullyVisible(feature)) continue; // cut by the edge (or the buffer) — not a legend candidate
      const rankRaw = tag.rankProperty ? Number(feature.properties?.[tag.rankProperty]) : NaN;
      const rank = Number.isFinite(rankRaw) ? rankRaw : Number.POSITIVE_INFINITY;
      const anchor = geometryAnchor(feature.geometry);
      let distance = Number.POSITIVE_INFINITY;
      if (anchor) {
        const p = viewport.project(anchor);
        distance = Math.hypot(p.x - viewport.width / 2, p.y - viewport.height / 2);
      }
      if (!candidates.has(entryKey)) candidates.set(entryKey, []);
      candidates.get(entryKey)!.push({ feature, name, rank, distance });
      if (!instanceTags.has(entryKey)) instanceTags.set(entryKey, { tag, feature });
      continue;
    }

    if (tag.role !== "main") continue;
    mainTags.set(feature.layer.id, tag);
    const value = entryValueOf(tag, feature);
    if (!value) continue;
    const entryKey = resolveKey(`${tag.group}:${value}`);
    if (isHiddenKey(entryKey)) continue;
    if (!entriesOfMain.has(feature.layer.id)) entriesOfMain.set(feature.layer.id, new Set());
    entriesOfMain.get(feature.layer.id)!.add(entryKey);
    if (!mainCopies.has(entryKey)) mainCopies.set(entryKey, []);
    mainCopies.get(entryKey)!.push({ feature, tag });
  }

  const copiesByIdentity = new Map<string, RenderedFeature[]>();
  for (const feature of features) {
    const id = featureIdentity(feature);
    if (!copiesByIdentity.has(id)) copiesByIdentity.set(id, []);
    copiesByIdentity.get(id)!.push(feature);
  }
  /**
   * The copies of one feature that an overlay entry stacks: same group, drawn,
   * no label. Crossing duplicates are normally left out — they render
   * differently from the ground-level copy — but where a stretch of the route
   * runs over a bridge or through a tunnel they are the only road the map
   * draws for it, and without them the band would stand alone.
   */
  const stackable = (feature: RenderedFeature, group: string) => {
    const copies = copiesByIdentity.get(featureIdentity(feature)) ?? [];
    const usable = (withCrossings: boolean) =>
      copies.filter((copy) => {
        const tag = tagOf(copy);
        if (!tag || tag.hidden || tag.instance || tag.group !== group || TEXT_ROLES.has(tag.role ?? "")) return false;
        return withCrossings || !tag.crossing;
      });
    const ground = usable(false);
    return ground.length > 1 ? ground : usable(true); // 1 = the band itself, nothing under it
  };

  /**
   * How well a copy shows its overlay, in tiers: no other overlay in its stack
   * first (a cleaner stretch always beats a busier one), then a road drawn
   * under the band at all (a bare band is the last resort), then a road at
   * ground level rather than crossing copies (a bridge's blur and shadow are
   * no road to show the route on, however many layers they add), then the
   * fullest stack.
   */
  const overlayScore = (copy: { feature: RenderedFeature; tag: LegendLayerTag }) => {
    const stack = stackable(copy.feature, copy.tag.group!);
    const others = stack.filter((other) => {
      const tag = tagOf(other);
      return tag?.overlay && tag.role === "main" && other.layer.id !== copy.feature.layer.id;
    }).length;
    const under = stack.length > 1;
    const crossing = stack.some((other) => tagOf(other)?.crossing);
    return (others ? 0 : 1000) + (under ? 100 : 0) + (crossing ? 0 : 10) + Math.min(stack.length, 9);
  };

  // Class entries: one main copy represents the entry — the first ground-level
  // one (a tunnel or bridge duplicate renders differently); its identity lets
  // the supporting layers contribute copies of the very same feature.
  /** entry key → the copy that represents it */
  const chosen = new Map<string, { feature: RenderedFeature; tag: LegendLayerTag }>();
  for (const [entryKey, copies] of mainCopies) {
    const ground = copies.filter((c) => !c.tag.crossing);
    const pool = ground.length ? ground : copies;
    // A route band on its own says little, and not every stretch of it has a
    // rendered road, so of the rendered copies an overlay takes the one that
    // shows it best: first one that carries no other overlay — a cycle route on
    // a plain road says what the row means, one on a cycle lane mixes two rows
    // into a swatch — and among those the one with the fullest stack. A stretch
    // sharing its road with another overlay is the last resort, not the default.
    const best = pool[0].tag.overlay ? pool.reduce((a, b) => (overlayScore(b) > overlayScore(a) ? b : a)) : pool[0];
    chosen.set(entryKey, best);
    representative.set(entryKey, featureIdentity(best.feature));
    const main = swatchLayerOf(best.feature, "main", layerOrder);
    entries.set(entryKey, {
      key: entryKey,
      group: best.tag.group!,
      kind: "class",
      label: pickLabel(manifestEntries[entryKey]?.label, language) ?? humanize(entryKey),
      swatch: [main],
      // The layer's position spreads sibling layers (they are consecutive in
      // the style, so they never share a shape); one layer holding many entries
      // spreads them by the key instead.
      variant: main.order + (best.tag.keyProperty ? swatchVariantFor(entryKey) : 0),
      order: manifestEntries[entryKey]?.order ?? UNORDERED,
    });
  }

  // Pass 2 — supporting layers stack into the entries of the mains they attach
  // to. Bridge/tunnel duplicates (shadows, tunnel casings) are left out; per
  // entry and layer the copy of the representative feature wins, so casing
  // gap and main width belong to the same road at the same zoom.
  const support = new Map<string, Map<string, { feature: RenderedFeature; role: string; score: number }>>();
  for (const feature of features) {
    const tag = tagOf(feature);
    if (!tag || tag.hidden || tag.crossing || !tag.attachesTo?.length) continue;
    const identity = featureIdentity(feature);
    for (const mainId of tag.attachesTo) {
      const produced = entriesOfMain.get(mainId);
      if (!produced) continue;
      const mainTag = mainTags.get(mainId);
      let targetKeys: string[];
      if (mainTag?.keyProperty || mainTag?.keyByValue) {
        // the main splits its features across entries — the copy's own values pick one
        const value = entryValueOf(mainTag, feature);
        const k = value ? resolveKey(`${mainTag.group}:${value}`) : undefined;
        targetKeys = k && produced.has(k) ? [k] : [];
      } else {
        targetKeys = [...produced];
      }
      for (const k of targetKeys) {
        if (!entries.has(k)) continue;
        const score = representative.get(k) === identity ? 1 : 0;
        if (!support.has(k)) support.set(k, new Map());
        const perLayer = support.get(k)!;
        const current = perLayer.get(feature.layer.id);
        if (!current || score > current.score) perLayer.set(feature.layer.id, { feature, role: tag.role ?? "support", score });
      }
    }
  }
  for (const [k, perLayer] of support) {
    const entry = entries.get(k)!;
    for (const { feature, role } of perLayer.values()) entry.swatch.push(swatchLayerOf(feature, role, layerOrder));
  }

  // Overlays (routes, cycle lanes) are drawn onto other roads: show the whole
  // rendered stack of the representative feature — every non-crossing copy of
  // it in the group, e.g. hiking band + path casing + path — not the band alone.
  for (const [entryKey, rep] of chosen) {
    const entry = entries.get(entryKey);
    if (!entry || !rep.tag.overlay) continue;
    const seen = new Set(entry.swatch.map((l) => l.id));
    for (const copy of stackable(rep.feature, rep.tag.group!)) {
      if (seen.has(copy.layer.id)) continue;
      seen.add(copy.layer.id);
      entry.swatch.push(swatchLayerOf(copy, tagOf(copy)!.role ?? "main", layerOrder));
    }
  }

  /**
   * The class entry a symbol sits on, among its anchor mains in view: first
   * one that drew the very same feature (a grade label and its path are one
   * feature), then, from a main that splits its features, the entry the
   * symbol's own values pick, else the first anchor in view.
   */
  const anchorEntryFor = (anchors: string[], feature: RenderedFeature): LegendEntry | undefined => {
    const own = new Set((copiesByIdentity.get(featureIdentity(feature)) ?? []).map((copy) => copy.layer.id));
    const ordered = [...anchors.filter((id) => own.has(id)), ...anchors.filter((id) => !own.has(id))];
    for (const mainId of ordered) {
      const produced = entriesOfMain.get(mainId);
      if (!produced?.size) continue;
      const mainTag = mainTags.get(mainId);
      const value = mainTag ? entryValueOf(mainTag, feature) : undefined;
      const picked = value && mainTag ? resolveKey(`${mainTag.group}:${value}`) : undefined;
      const entry = entries.get(picked && produced.has(picked) ? picked : [...produced][0]);
      if (entry?.kind === "class") return entry;
    }
    return undefined;
  };

  // Pass 3 — one instance entry per key: lowest rank, named before unnamed, then closest to the centre.
  for (const [entryKey, list] of candidates) {
    list.sort((a, b) => a.rank - b.rank || Number(Boolean(b.name)) - Number(Boolean(a.name)) || a.distance - b.distance);
    const best = list[0];
    const { tag } = instanceTags.get(entryKey)!;
    const layout = best.feature.layer.layout ?? {};
    const on = tag.anchors?.length ? anchorEntryFor(tag.anchors, best.feature) : undefined;
    entries.set(entryKey, {
      key: entryKey,
      group: tag.group!,
      kind: "instance",
      label: pickLabel(manifestEntries[entryKey]?.label, language) ?? humanize(entryKey),
      name: best.name,
      text: textStyleOf(best.feature),
      icon: layout["icon-image"] ? swatchLayerOf(best.feature, "icon", layerOrder) : undefined,
      anchor: on ? { key: on.key, swatch: on.swatch, variant: on.variant } : undefined,
      swatch: [],
      variant: 0, // instance entries draw the map's own symbol, not a shape
      order: manifestEntries[entryKey]?.order ?? UNORDERED,
    });
  }

  for (const entry of entries.values()) entry.swatch.sort((a, b) => a.order - b.order);

  // Groups in manifest order, entries in manifest order then by label/name.
  const groups = new Map<string, LegendGroup>();
  for (const entry of entries.values()) {
    if (!groups.has(entry.group)) {
      groups.set(entry.group, {
        id: entry.group,
        label: pickLabel(manifestGroups[entry.group]?.label, language) ?? humanize(entry.group),
        order: manifestGroups[entry.group]?.order ?? UNORDERED,
        entries: [],
      });
    }
    groups.get(entry.group)!.entries.push(entry);
  }
  const collator = new Intl.Collator(language);
  for (const g of groups.values())
    g.entries.sort((a, b) => a.order - b.order || collator.compare(a.label, b.label) || collator.compare(a.name ?? "", b.name ?? ""));

  return { groups: [...groups.values()].sort((a, b) => a.order - b.order || collator.compare(a.label, b.label)) };
}
