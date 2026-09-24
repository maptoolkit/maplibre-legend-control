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
  const layers = [...layerOrder.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => ({ id, type: "line", source: "mtk" }));
  return {
    on: (event: string, listener: () => void) => {
      (listeners[event] ??= []).push(listener);
    },
    off: (event: string, listener: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((l) => l !== listener);
    },
    getCanvas: () => canvas,
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
    expect(groups).toEqual(["place", "road", "nature"]);
    const keys = [...container.querySelectorAll(".maplibre-legend-control-entry")].map((e) => (e as HTMLElement).dataset.key);
    expect(keys).toEqual(["place:town", "place:village", "road:major_dark", "road:minor", "nature:wood", "nature:farmland"]);

    const town = container.querySelector('[data-key="place:town"]') as HTMLElement;
    const name = town.querySelector(".maplibre-legend-control-name") as HTMLElement;
    expect(name.textContent).toBe("Tulln an der Donau");
    expect(name.style.fontFamily).toContain("Rosario");
    expect(name.style.fontWeight).toBe("700");
    expect(town.querySelector(".maplibre-legend-control-type")?.textContent).toBe("Stadt");

    const motorway = container.querySelector('[data-key="road:major_dark"]') as HTMLElement;
    expect(motorway.querySelector(".maplibre-legend-control-label")?.textContent).toBe("Hauptstraße");
    expect(motorway.querySelectorAll(".maplibre-legend-control-stroke")).toHaveLength(3); // blur + casing + main (label is no stroke)

    expect(control.getModel()?.groups).toHaveLength(3);
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
