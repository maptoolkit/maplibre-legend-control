import { describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import { LegendControl } from "../src/LegendControl";
import { features, layerOrder, manifest } from "./fixtures";

type MockMap = MaplibreMap & { _fire: (event: string) => void; _locale: Record<string, string> };

function createMockMap(options: { withFeatures?: boolean } = {}): MockMap {
  const listeners: Record<string, Array<() => void>> = {};
  const locale: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  Object.defineProperty(canvas, "clientHeight", { value: 300 });
  const mapContainer = document.createElement("div");
  Object.defineProperty(mapContainer, "clientWidth", { value: 400 });
  Object.defineProperty(mapContainer, "clientHeight", { value: 300 });
  const layers = [...layerOrder.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => ({ id, type: "line", source: "mtk" }));
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
    queryRenderedFeatures: () => (options.withFeatures === false ? [] : features),
    project: ([x, y]: [number, number]) => ({ x, y }),
    getImage: () => undefined,
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
    expect(container.querySelector(".maplibre-legend-control-title")?.textContent).toBe("Legend");
    expect(container.querySelector(".maplibre-legend-control-list")).not.toBeNull();
  });

  it("uses the map's locale table for the title", () => {
    const map = createMockMap();
    map._locale["LegendControl.Title"] = "Legende";
    const container = new LegendControl().onAdd(map);
    expect(container.querySelector(".maplibre-legend-control-title")?.textContent).toBe("Legende");
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
    expect(keys).toEqual(["place:town", "place:village", "road:major_dark", "road:minor", "road:hiking", "road:path", "nature:wood", "nature:farmland", "poi:fountain", "poi:peak"]);

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
    expect(strokes[2].getAttribute("stroke-linecap")).toBe("round");

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

  it("caps the list at 60 % of the map height and the panel at the map width", () => {
    const container = new LegendControl().onAdd(createMockMap());
    const list = container.querySelector(".maplibre-legend-control-list") as HTMLElement;
    expect(list.style.maxHeight).toBe("180px"); // 0.6 × 300, header has no height in jsdom
    expect(container.style.maxWidth).toBe("380px"); // map width − 20
  });

  it("aligns left-justified symbols at the column start, everything else on the centre axis", () => {
    vi.useFakeTimers();
    const container = new LegendControl({ language: "de", updateDelay: 0 }).onAdd(createMockMap());
    vi.runAllTimers();
    const town = container.querySelector('[data-key="place:town"] .maplibre-legend-control-visual') as HTMLElement;
    expect(town.classList.contains("maplibre-legend-control-visual-start")).toBe(false);
    const peak = container.querySelector('[data-key="poi:peak"] .maplibre-legend-control-visual') as HTMLElement;
    expect(peak.classList.contains("maplibre-legend-control-visual-start")).toBe(true);
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

    (container.querySelector(".maplibre-legend-control-header") as HTMLButtonElement).click();
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(false);
    expect(container.querySelectorAll(".maplibre-legend-control-entry").length).toBeGreaterThan(0);
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
