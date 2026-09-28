import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import { LegendControl } from "../src/LegendControl";
import { features, layerOrder, manifest, queryFixtures } from "./fixtures";

type MockMap = MaplibreMap & { _fire: (event: string) => void; _locale: Record<string, string> };

function createMockMap(options: { withFeatures?: boolean; background?: string | null } = {}): MockMap {
  const listeners: Record<string, Array<() => void>> = {};
  const locale: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  Object.defineProperty(canvas, "clientHeight", { value: 300 });
  const mapContainer = document.createElement("div");
  Object.defineProperty(mapContainer, "clientWidth", { value: 400 });
  Object.defineProperty(mapContainer, "clientHeight", { value: 300 });
  const layers: Array<Record<string, unknown>> = [...layerOrder.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => ({ id, type: "line", source: "mtk" }));
  const background = options.background === null ? undefined : (options.background ?? "rgba(240,244,236,1)");
  if (background)
    layers.unshift({
      id: "background",
      type: "background",
      paint: { "background-color": ["interpolate", ["linear"], ["zoom"], 11, background, 14, background] },
    });
  return {
    on: (event: string, listener: () => void) => {
      (listeners[event] ??= []).push(listener);
    },
    off: (event: string, listener: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((l) => l !== listener);
    },
    getCanvas: () => canvas,
    getContainer: () => mapContainer,
    getStyle: () => ({ version: 8, sources: {}, layers, metadata: { "maptoolkit:legend": manifest } }),
    queryRenderedFeatures: (box?: [[number, number], [number, number]]) => (options.withFeatures === false ? [] : queryFixtures(features, box)),
    project: ([x, y]: [number, number]) => ({ x, y }),
    getImage: () => undefined,
    // MapLibre's internal style object: evaluated paint of a layer at the current zoom
    style: { getLayer: (id: string) => (id === "background" && background ? { paint: { get: () => ({ toString: () => background }) } } : undefined) },
    _locale: locale,
    _getUIString: (key: string) => {
      const value = locale[key];
      if (value == null) throw new Error(`Missing UI string '${key}'`);
      return value;
    },
    _fire: (event: string) => (listeners[event] ?? []).forEach((l) => l()),
  } as unknown as MockMap;
}

describe("LegendControl", () => {
  it("creates a container element on add", () => {
    const control = new LegendControl();
    const container = control.onAdd(createMockMap());

    expect(container).toBeInstanceOf(HTMLElement);
    expect(container.classList.contains("maplibregl-ctrl")).toBe(true);
    expect(container.classList.contains("maplibre-legend-control")).toBe(true);
    expect(container.querySelector(".maplibre-legend-control-panel")?.getAttribute("aria-label")).toBe("Legend"); // the title is the panel's accessible name only
    expect(container.querySelector(".maplibre-legend-control-header")).toBeNull(); // no header row
    expect(container.querySelector(".maplibre-legend-control-list")).not.toBeNull();
  });

  it("uses the map's locale table for the title", () => {
    const map = createMockMap();
    map._locale["LegendControl.Title"] = "Legende";
    const container = new LegendControl().onAdd(map);
    expect(container.querySelector(".maplibre-legend-control-panel")?.getAttribute("aria-label")).toBe("Legende");
  });

  it("renders a MapLibre control button that shows and hides the panel", () => {
    const map = createMockMap();
    map._locale["LegendControl.Toggle"] = "Legende ein-/ausblenden";
    const container = new LegendControl({ language: "de" }).onAdd(map);
    expect(container.classList.contains("maplibre-legend-control-with-toggle")).toBe(true);
    const button = container.querySelector(".maplibre-legend-control-toggle.maplibregl-ctrl-group button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Legende ein-/ausblenden"); // the page's own locale entry wins
    // the default button is the word for "legend" in the control's language
    expect(button.textContent).toBe("Legende");
    expect(button.classList.contains("maplibre-legend-control-toggle-text")).toBe(true);
    expect(button.querySelector(".maplibregl-ctrl-icon")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    button.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows an icon instead of the word on request, and speaks the map maker's languages", () => {
    const icon = new LegendControl({ button: "icon" }).onAdd(createMockMap()).querySelector(".maplibre-legend-control-toggle button")!;
    expect(icon.querySelector(".maplibregl-ctrl-icon")).not.toBeNull();
    expect(icon.textContent).toBe("");
    // every language of the map maker has its own strings; an unknown one falls back to English
    for (const [language, label, info] of [
      ["fr", "Légende", "En savoir plus"],
      ["ja", "凡例", "詳細"],
      ["ar", "مفتاح الخريطة", "المزيد"],
      ["xx", "Legend", "More about this"],
    ]) {
      const map = createMockMap();
      new LegendControl({ language }).onAdd(map);
      expect(map._locale["LegendControl.Label"]).toBe(label);
      expect(map._locale["LegendControl.Info"]).toBe(info);
    }
  });

  it("keeps the button when the panel is hidden — only a control without a button hides entirely", () => {
    // the stylesheet is not loaded in jsdom, so check the rules it must contain
    const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    expect(css).toContain(".maplibre-legend-control.maplibre-legend-control-collapsed .maplibre-legend-control-panel {");
    expect(css).toContain(".maplibre-legend-control.maplibre-legend-control-collapsed:not(.maplibre-legend-control-with-toggle) {");
    expect(css).not.toMatch(/\.maplibre-legend-control\.maplibre-legend-control-collapsed \{/); // would hide the button too
    // names wrap at spaces and hyphens like on the map, never inside a word
    expect(css).not.toMatch(/overflow-wrap:\s*(anywhere|break-word)/);
    expect(css).not.toMatch(/word-break:\s*break-(all|word)/);
    expect(css).toMatch(/min-width:\s*min-content/); // a long word widens the column instead of spilling over it
  });

  it("has no button with toggle: false — the host provides the trigger", () => {
    const container = new LegendControl({ toggle: false, collapsed: true }).onAdd(createMockMap());
    expect(container.querySelector(".maplibre-legend-control-toggle")).toBeNull();
    expect(container.classList.contains("maplibre-legend-control-with-toggle")).toBe(false);
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
  });

  it("renders groups and entries from the rendered features once the map is idle", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const control = new LegendControl({ language: "de", updateDelay: 0 });
    const container = control.onAdd(map);
    map._fire("idle");
    vi.runAllTimers();

    const groups = [...container.querySelectorAll(".maplibre-legend-control-group")].map((g) => (g as HTMLElement).dataset.group);
    expect(groups).toEqual(["place", "road", "nature", "poi"]);
    const keys = [...container.querySelectorAll(".maplibre-legend-control-entry")].map((e) => (e as HTMLElement).dataset.key);
    expect(keys).toEqual([
      "place:town",
      "place:village",
      "road:major_dark",
      "road:minor_pedestrian",
      "road:minor",
      "road:cycling_infra_lane",
      "road:cycling_route",
      "road:hiking",
      "road:major_shield",
      "road:path",
      "nature:wood",
      "nature:farmland",
      "poi:fountain",
      "poi:peak",
    ]);

    // left column: the map label in the map font; right column: the type
    const town = container.querySelector('[data-key="place:town"]') as HTMLElement;
    const name = town.querySelector(".maplibre-legend-control-visual .maplibre-legend-control-symbol-text") as HTMLElement;
    expect(name.textContent).toBe("Tulln an der Donau");
    expect(name.style.fontFamily).toContain("Rosario");
    expect(name.style.fontWeight).toBe("700");
    expect(name.style.fontSize).toBe("14px");
    expect(town.querySelector(".maplibre-legend-control-symbol-icon")).toBeNull(); // no dot, no icon: the label is the symbol
    expect(town.querySelector(":scope > .maplibre-legend-control-label")?.textContent).toBe("Stadt");

    const motorway = container.querySelector('[data-key="road:major_dark"]') as HTMLElement;
    expect(motorway.querySelector(".maplibre-legend-control-label")?.textContent).toBe("Hauptstraße");
    const strokes = [...motorway.querySelectorAll("path.maplibre-legend-control-stroke")];
    expect(strokes).toHaveLength(3); // blur + casing + main (label is no stroke)
    expect(strokes.map((p) => p.getAttribute("stroke-width"))).toEqual(["5", "7", "5"]); // casing = gap 5 + 2 × 1
    expect(strokes[2].getAttribute("stroke-linecap")).toBe("butt"); // solid strokes end flush

    const minor = container.querySelector('[data-key="road:minor"] path.maplibre-legend-control-stroke-main') as SVGPathElement;
    expect(minor.getAttribute("stroke-dasharray")).toBe("10 15"); // [2, 3] × width 5
    expect(minor.getAttribute("stroke-dashoffset")).toBe("-17.5"); // first dash starts half a gap in
    expect(minor.getAttribute("stroke-linecap")).toBe("round"); // dashed strokes keep the layer's cap

    expect(control.getModel()?.groups).toHaveLength(4);
    vi.useRealTimers();
  });

  it("draws POI symbols as icon plus label like the map: text below an icon with text-anchor top", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const container = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const fountain = container.querySelector('[data-key="poi:fountain"]') as HTMLElement;
    expect(fountain).not.toBeNull();
    const symbol = fountain.querySelector(".maplibre-legend-control-symbol") as HTMLElement;
    expect(symbol.classList.contains("maplibre-legend-control-symbol-single")).toBe(true); // icon only, no text
    expect(symbol.querySelector(".maplibre-legend-control-symbol-icon")).not.toBeNull();
    expect(fountain.querySelector(":scope > .maplibre-legend-control-label")?.textContent).toBe("Fountain");
    vi.useRealTimers();
  });

  it("reads the tags from the style sheet MapLibre holds, not from the rendered layers", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    // the sheet after a diff-based style switch: the casing is hidden there, while the rendered features still carry the old tag
    (map as unknown as { style: Record<string, unknown> }).style.stylesheet = {
      layers: features
        .map((f) => f.layer.id)
        .filter((id, i, all) => all.indexOf(id) === i)
        .map((id) => ({
          id,
          metadata: id === "road_major_casing" ? { "maptoolkit:legend": { hidden: true } } : features.find((f) => f.layer.id === id)!.layer.metadata,
        })),
    };
    const container = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const road = container.querySelector('[data-key="road:major_dark"]') as HTMLElement;
    expect(road.querySelector(".maplibre-legend-control-stroke-casing")).toBeNull(); // the sheet's tag won
    expect(road.querySelector(".maplibre-legend-control-stroke-main")).not.toBeNull();
    vi.useRealTimers();
  });

  it("never grows past the map's edge: the room is measured from the panel's own edge", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const control = new LegendControl({ language: "de", updateDelay: 0 });
    const container = control.onAdd(map);
    vi.runAllTimers();
    const panel = container.querySelector(".maplibre-legend-control-panel") as HTMLElement;
    expect(panel.style.maxWidth).toBe("380px"); // no layout yet (jsdom): the estimate, map width − 20
    // mounted 62 px into a 400 px map, as the style editor's panel column does: the room ends at the map's right edge
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(map.getContainer(), "getBoundingClientRect").mockReturnValue(rect(0, 400));
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(62, 300));
    (control as unknown as { _fitToMap: () => void })._fitToMap();
    expect(panel.style.maxWidth).toBe("328px"); // 400 − 62 − 10
    // in a right-hand corner the panel's right edge is the fixed one
    const corner = document.createElement("div");
    corner.className = "maplibregl-ctrl-top-right";
    corner.appendChild(container);
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(90, 300)); // right edge at 390
    (control as unknown as { _fitToMap: () => void })._fitToMap();
    expect(panel.style.maxWidth).toBe("380px"); // 390 − 0 − 10
    vi.useRealTimers();
  });

  it("caps a name at the smaller of a share of the map and a pixel width", () => {
    vi.useFakeTimers();
    // the mock map is 400 px wide: 50 % = 200 px beats the 260 px default
    const wide = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    const town = wide.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(town.style.maxWidth).toBe("140px"); // the map's own wrapping width, below the cap
    expect(town.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(false);
    // a tight cap cuts the longest word
    const tight = new LegendControl({ language: "de", updateDelay: 0, maxNameWidth: { px: 30, fraction: 0.5 } }).onAdd(createMockMap());
    vi.runAllTimers();
    const cut = tight.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(cut.style.minWidth).toBe("30px");
    expect(cut.classList.contains("maplibre-legend-control-symbol-text-cut")).toBe(true);
    // no cap at all
    const free = new LegendControl({ language: "de", updateDelay: 0, maxNameWidth: false }).onAdd(createMockMap());
    vi.runAllTimers();
    expect((free.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement).style.minWidth).toBe("");
    vi.useRealTimers();
  });

  it("offers an entry's document behind a circled i after the description", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const container = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const road = container.querySelector('[data-key="road:major_dark"] > .maplibre-legend-control-label') as HTMLElement;
    const info = road.querySelector("a.maplibre-legend-control-info") as HTMLAnchorElement;
    expect(info).not.toBeNull();
    expect(info.href).toBe("https://example.org/roads.pdf");
    expect(info.target).toBe("_blank");
    expect(info.rel).toBe("noopener noreferrer");
    expect(info.getAttribute("aria-label")).toBe("Mehr dazu"); // the control's German strings, overridable via the map locale
    expect(info.querySelector("svg circle")).not.toBeNull();
    expect(road.textContent).toBe("Hauptstraße"); // the button adds no text
    expect(container.querySelector('[data-key="road:minor"] .maplibre-legend-control-info')).toBeNull(); // no link, no button
    vi.useRealTimers();
  });

  it("shows a shield on the road it belongs to when that road is in view", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const container = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    const shield = container.querySelector('[data-key="road:major_shield"]') as HTMLElement;
    expect(shield).not.toBeNull();
    const on = shield.querySelector(".maplibre-legend-control-symbol-on") as HTMLElement;
    expect(on).not.toBeNull();
    expect(on.querySelector(".maplibre-legend-control-swatch-line")).not.toBeNull(); // the motorway's stack
    expect(on.querySelector(".maplibre-legend-control-symbol-text")?.textContent).toBe("A22"); // the shield on it
    // the road reaches beyond the shield: the symbol sizes the box, the padding is the reach, the swatch fills it all
    const css = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    expect(css).toMatch(/symbol-on\s*\{[^}]*padding:\s*0 var\(--legend-control-symbol-reach\)/);
    expect(css).toMatch(/symbol-on-fill\s*\{[^}]*padding:\s*var\(--legend-control-symbol-reach-y\) var\(--legend-control-symbol-reach\)/);
    expect(css).toMatch(/symbol-on > \.maplibre-legend-control-swatch\s*\{[^}]*inset:\s*0/);
    // a place name has nothing to sit on: the symbol alone
    const place = container.querySelector('[data-key="place:town"] .maplibre-legend-control-visual') as HTMLElement;
    expect(place.querySelector(".maplibre-legend-control-symbol-on")).toBeNull();
    vi.useRealTimers();
  });

  it("caps the list at 60 % of the map height and the panel at the map width", () => {
    const container = new LegendControl().onAdd(createMockMap());
    const list = container.querySelector(".maplibre-legend-control-list") as HTMLElement;
    expect(list.style.maxHeight).toBe("180px"); // 0.6 × 300
    expect((container.querySelector(".maplibre-legend-control-panel") as HTMLElement).style.maxWidth).toBe("380px"); // map width − 20
  });

  it("centres every block on the column axis and keeps text-justify inside the block", () => {
    vi.useFakeTimers();
    const container = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    for (const visual of container.querySelectorAll(".maplibre-legend-control-visual")) {
      expect(visual.className).toBe("maplibre-legend-control-visual"); // no per-entry alignment class
    }
    const peakText = container.querySelector('[data-key="poi:peak"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(peakText.style.textAlign).toBe("left"); // "Großglockner" / "3798 m" stay left-aligned to each other
    const townText = container.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text') as HTMLElement;
    expect(townText.style.textAlign).toBe(""); // no justify on the layer → the stylesheet's centre
    vi.useRealTimers();
  });

  it("paints the panel in the style's background colour, light text on dark", () => {
    vi.useFakeTimers();
    const light = new LegendControl({ updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(light.style.getPropertyValue("--legend-control-bg-color")).toBe("rgba(240,244,236,1)");
    expect(light.style.getPropertyValue("--legend-control-color-fg-strong")).toBe("");
    expect(light.classList.contains("maplibre-legend-control-dark")).toBe(false);

    const dark = new LegendControl({ updateDelay: 0 }).onAdd(createMockMap({ background: "rgba(24,26,34,1)" }));
    vi.runAllTimers();
    expect(dark.style.getPropertyValue("--legend-control-bg-color")).toBe("rgba(24,26,34,1)");
    expect(dark.style.getPropertyValue("--legend-control-color-fg-strong")).not.toBe("");
    expect(dark.classList.contains("maplibre-legend-control-dark")).toBe(true);

    const none = new LegendControl({ updateDelay: 0 }).onAdd(createMockMap({ background: null }));
    vi.runAllTimers();
    expect(none.style.getPropertyValue("--legend-control-bg-color")).toBe("hsl(90, 23%, 95%)");

    const fixed = new LegendControl({ updateDelay: 0, background: "#123456" }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(fixed.style.getPropertyValue("--legend-control-bg-color")).toBe("#123456");
    expect(fixed.classList.contains("maplibre-legend-control-dark")).toBe(true);
    vi.useRealTimers();
  });

  it("queries the four edge bands and leaves labels touching them out", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const spy = vi.spyOn(map, "queryRenderedFeatures");
    const control = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    // one full query + four band queries (top, bottom, left, right — 5 % of 400×300)
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0] ?? null))).toEqual([
      "null",
      JSON.stringify([
        [0, 0],
        [400, 15],
      ]),
      JSON.stringify([
        [0, 285],
        [400, 300],
      ]),
      JSON.stringify([
        [0, 0],
        [20, 300],
      ]),
      JSON.stringify([
        [380, 0],
        [400, 300],
      ]),
    ]);
    const town = control.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text');
    expect(town?.textContent).toBe("Tulln an der Donau"); // Randstadt at x = 5 sits in the left band

    const all = new LegendControl({ language: "de", updateDelay: 0, edgeBuffer: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(all.querySelector('[data-key="place:town"] .maplibre-legend-control-symbol-text')?.textContent).toBe("Randstadt"); // rank 5 beats 12 once the edge no longer matters
    vi.useRealTimers();
  });

  it("shows an empty state when nothing tagged is rendered", () => {
    vi.useFakeTimers();
    const map = createMockMap({ withFeatures: false });
    const container = new LegendControl({ updateDelay: 0 }).onAdd(map);
    vi.runAllTimers();
    expect(container.querySelector(".maplibre-legend-control-empty")?.textContent).toBe("Nothing to show in this view");
    vi.useRealTimers();
  });

  it("defers updates while collapsed and catches up on open", () => {
    vi.useFakeTimers();
    const map = createMockMap();
    const control = new LegendControl({ collapsed: true, updateDelay: 0 });
    const container = control.onAdd(map);
    vi.runAllTimers();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
    expect(container.querySelectorAll(".maplibre-legend-control-entry")).toHaveLength(0);

    control.open();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(container.querySelectorAll(".maplibre-legend-control-entry").length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it("links the style's web-font stylesheet into the page once", () => {
    vi.useFakeTimers();
    const href = "https://static.example.org/webfonts/webfonts.css"; // fonts.css of the fixture manifest
    const count = () => [...document.head.querySelectorAll('link[rel="stylesheet"]')].filter((l) => l.getAttribute("href") === href).length;
    const control = new LegendControl({ updateDelay: 0 });
    control.onAdd(createMockMap());
    vi.runAllTimers();
    expect(count()).toBe(1); // exactly one link in the page, however many controls and updates came before
    control.update();
    new LegendControl({ updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(count()).toBe(1);
    vi.useRealTimers();
  });

  it("takes the fonts option over the manifest, and links nothing with false", () => {
    vi.useFakeTimers();
    const own = "https://fonts.example.com/own.css";
    new LegendControl({ updateDelay: 0, fonts: own }).onAdd(createMockMap());
    vi.runAllTimers();
    expect([...document.head.querySelectorAll("link")].some((l) => l.getAttribute("href") === own)).toBe(true);
    const links = document.head.querySelectorAll("link").length;
    new LegendControl({ updateDelay: 0, fonts: false }).onAdd(createMockMap());
    vi.runAllTimers();
    expect(document.head.querySelectorAll("link").length).toBe(links);
    vi.useRealTimers();
  });

  it("restricts the legend to the configured groups", () => {
    vi.useFakeTimers();
    const container = new LegendControl({ groups: ["place"], updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    expect([...container.querySelectorAll(".maplibre-legend-control-group")].map((g) => (g as HTMLElement).dataset.group)).toEqual(["place"]);
    vi.useRealTimers();
  });

  it("removes the container and the idle listener on remove", () => {
    const map = createMockMap();
    const control = new LegendControl();
    const container = control.onAdd(map);
    document.body.appendChild(container);

    control.onRemove();

    expect(document.body.contains(container)).toBe(false);
    map._fire("idle"); // must not throw or schedule anything
  });

  it("defaults to the top-right position", () => {
    expect(new LegendControl().getDefaultPosition()).toBe("top-right");
  });
});
