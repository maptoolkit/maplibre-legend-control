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
  /** Features whose anchor lies within this many CSS pixels of the viewport edge lose against inner ones. */
  edgeMargin: number;
};

/** Order used for entries/groups the manifest does not order. */
const UNORDERED = 1_000_000;
/** Supporting roles that carry text — they never contribute strokes to a swatch. */
const TEXT_ROLES = new Set(["label", "shield"]);

/** Turn an evaluated style value (string, number, Color, Formatted, ResolvedImage …) into a string. */
export function valueToString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const named = value as { name?: unknown; toString?: () => string };
    if (typeof named.name === "string") return named.name; // ResolvedImage
    if (typeof named.toString === "function" && named.toString !== Object.prototype.toString) return named.toString(); // Color, Formatted
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
  return {
    fontStack,
    size: num(layout["text-size"]),
    color: valueToString(paint["text-color"]),
    haloColor: valueToString(paint["text-halo-color"]),
    haloWidth: num(paint["text-halo-width"]),
    transform: valueToString(layout["text-transform"]),
    letterSpacing: num(layout["text-letter-spacing"]),
  };
}

type InstanceCandidate = {
  feature: RenderedFeature;
  name: string;
  rank: number;
  inside: boolean;
  distance: number;
};

/**
 * Build the legend model for one viewport: class entries for every rendered
 * main layer (with their supporting layers stacked into the swatch) and one
 * instance entry per key of the standalone label layers, choosing the most
 * prominent named feature (lowest rank, edge features last, then the one
 * closest to the viewport centre).
 */
export function buildLegendModel(input: BuildLegendModelInput): LegendModel {
  const { features, layerOrder, language, viewport, edgeMargin } = input;
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

  // Pass 1 — main layers → class entries; standalone labels → candidates.
  for (const feature of features) {
    const tag = tagOf(feature);
    if (!tag || tag.hidden || !tag.group || groupHidden(tag.group)) continue;

    if (tag.instance) {
      const value = tag.keyProperty ? valueToString(feature.properties?.[tag.keyProperty]) : undefined;
      if (!value) continue;
      const entryKey = `${tag.group}:${value}`;
      if (isHiddenKey(entryKey)) continue;
      const name = valueToString(feature.layer.layout?.["text-field"])?.trim();
      if (!name) continue;
      const rankRaw = tag.rankProperty ? Number(feature.properties?.[tag.rankProperty]) : NaN;
      const rank = Number.isFinite(rankRaw) ? rankRaw : Number.POSITIVE_INFINITY;
      const anchor = geometryAnchor(feature.geometry);
      let inside = false;
      let distance = Number.POSITIVE_INFINITY;
      if (anchor) {
        const p = viewport.project(anchor);
        inside = p.x >= edgeMargin && p.y >= edgeMargin && p.x <= viewport.width - edgeMargin && p.y <= viewport.height - edgeMargin;
        distance = Math.hypot(p.x - viewport.width / 2, p.y - viewport.height / 2);
      }
      if (!candidates.has(entryKey)) candidates.set(entryKey, []);
      candidates.get(entryKey)!.push({ feature, name, rank, inside, distance });
      if (!instanceTags.has(entryKey)) instanceTags.set(entryKey, { tag, feature });
      continue;
    }

    if (tag.role !== "main") continue;
    mainTags.set(feature.layer.id, tag);
    const value = tag.key ?? (tag.keyProperty ? valueToString(feature.properties?.[tag.keyProperty]) : undefined);
    if (!value) continue;
    const entryKey = `${tag.group}:${value}`;
    if (isHiddenKey(entryKey)) continue;
    if (!entriesOfMain.has(feature.layer.id)) entriesOfMain.set(feature.layer.id, new Set());
    entriesOfMain.get(feature.layer.id)!.add(entryKey);
    if (!mainCopies.has(entryKey)) mainCopies.set(entryKey, []);
    mainCopies.get(entryKey)!.push({ feature, tag });
  }

  // Class entries: one main copy represents the entry — the first ground-level
  // one (a tunnel or bridge duplicate renders differently); its identity lets
  // the supporting layers contribute copies of the very same feature.
  for (const [entryKey, copies] of mainCopies) {
    const best = copies.find((c) => !c.tag.crossing) ?? copies[0];
    representative.set(entryKey, featureIdentity(best.feature));
    entries.set(entryKey, {
      key: entryKey,
      group: best.tag.group!,
      kind: "class",
      label: pickLabel(manifestEntries[entryKey]?.label, language) ?? humanize(entryKey),
      swatch: [swatchLayerOf(best.feature, "main", layerOrder)],
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
      if (mainTag?.keyProperty) {
        const value = valueToString(feature.properties?.[mainTag.keyProperty]);
        const k = value ? `${mainTag.group}:${value}` : undefined;
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
  const copiesByIdentity = new Map<string, RenderedFeature[]>();
  for (const feature of features) {
    const id = featureIdentity(feature);
    if (!copiesByIdentity.has(id)) copiesByIdentity.set(id, []);
    copiesByIdentity.get(id)!.push(feature);
  }
  for (const [entryKey, copies] of mainCopies) {
    const entry = entries.get(entryKey);
    const rep = copies.find((c) => !c.tag.crossing) ?? copies[0];
    if (!entry || !rep.tag.overlay) continue;
    const seen = new Set(entry.swatch.map((l) => l.id));
    for (const copy of copiesByIdentity.get(featureIdentity(rep.feature)) ?? []) {
      const tag = tagOf(copy);
      if (!tag || tag.hidden || tag.crossing || tag.group !== rep.tag.group || tag.instance || seen.has(copy.layer.id)) continue;
      if (TEXT_ROLES.has(tag.role ?? "")) continue;
      seen.add(copy.layer.id);
      entry.swatch.push(swatchLayerOf(copy, tag.role ?? "main", layerOrder));
    }
  }

  // Pass 3 — one instance entry per key: inside the margin first, then lowest rank, then closest to the centre.
  for (const [entryKey, list] of candidates) {
    list.sort((a, b) => Number(b.inside) - Number(a.inside) || a.rank - b.rank || a.distance - b.distance);
    const best = list[0];
    const { tag } = instanceTags.get(entryKey)!;
    const layout = best.feature.layer.layout ?? {};
    entries.set(entryKey, {
      key: entryKey,
      group: tag.group!,
      kind: "instance",
      label: pickLabel(manifestEntries[entryKey]?.label, language) ?? humanize(entryKey),
      name: best.name,
      text: textStyleOf(best.feature),
      icon: layout["icon-image"] ? swatchLayerOf(best.feature, "icon", layerOrder) : undefined,
      swatch: [],
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
  for (const g of groups.values()) g.entries.sort((a, b) => a.order - b.order || collator.compare(a.label, b.label) || collator.compare(a.name ?? "", b.name ?? ""));

  return { groups: [...groups.values()].sort((a, b) => a.order - b.order || collator.compare(a.label, b.label)) };
}
