import { describe, expect, it } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import { LegendControl } from "../src/LegendControl";

function createMockMap(): MaplibreMap {
  const locale: Record<string, string> = {};
  return {
    on: () => {},
    off: () => {},
    _locale: locale,
    _getUIString: (key: string) => {
      const value = locale[key];
      if (value == null) throw new Error(`Missing UI string '${key}'`);
      return value;
    },
  } as unknown as MaplibreMap;
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
    (map as unknown as { _locale: Record<string, string> })._locale["LegendControl.Title"] = "Legende";
    const container = new LegendControl().onAdd(map);

    expect(container.querySelector(".maplibre-legend-control-title")?.textContent).toBe("Legende");
  });

  it("starts collapsed when configured", () => {
    const container = new LegendControl({ collapsed: true }).onAdd(createMockMap());
    expect(container.classList.contains("maplibre-legend-control-collapsed")).toBe(true);
  });

  it("removes the container on remove", () => {
    const control = new LegendControl();
    const container = control.onAdd(createMockMap());
    document.body.appendChild(container);

    control.onRemove();

    expect(document.body.contains(container)).toBe(false);
  });

  it("defaults to the top-right position", () => {
    const control = new LegendControl();
    expect(control.getDefaultPosition()).toBe("top-right");
  });
});
