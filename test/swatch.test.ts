import { describe, expect, it } from "vitest";
import { createLineSwatch, createSymbolPreview, lineVariantFor, LINE_VARIANTS, textPlacement } from "../src/swatch";
import type { TextStyle } from "../src/types";

const cases: Array<[Partial<TextStyle> | undefined, ReturnType<typeof textPlacement>]> = [
  [{ anchor: "top", offset: [0, 0.8] }, "below"],
  [{ anchor: "bottom" }, "above"],
  [{ anchor: "left" }, "right"],
  [{ anchor: "right" }, "left"],
  [{ anchor: "top-left" }, "below"],
  [{ anchor: "center", offset: [0, 1] }, "below"],
  [{ anchor: "center", offset: [-1.2, 0] }, "left"],
  [{ anchor: "center" }, "overlay"],
  [undefined, "overlay"],
];

describe("textPlacement", () => {
  it.each(cases)("%j → %s", (text, expected) => {
    expect(textPlacement(text ? { fontStack: [], ...text } : undefined)).toBe(expected);
  });
});

describe("createSymbolPreview", () => {
  it("arranges icon and text by placement and keeps a text-only symbol plain", () => {
    const icon = { id: "poi", type: "symbol", role: "icon", order: 1, paint: {}, layout: { "icon-image": { name: "sdf:bench" } } };
    const both = createSymbolPreview({ name: "Bankerl", text: { fontStack: ["Rosario Bold"], size: 12, anchor: "top", offset: [0, 0.8] }, icon });
    expect(both.classList.contains("maplibre-legend-control-symbol-below")).toBe(true);
    expect(both.children).toHaveLength(2);
    expect((both.lastElementChild as HTMLElement).style.fontFamily).toContain("Rosario");

    const textOnly = createSymbolPreview({ name: "Tulln", text: { fontStack: ["Rosario Bold"], size: 14 } });
    expect(textOnly.classList.contains("maplibre-legend-control-symbol-single")).toBe(true);
    expect(textOnly.children).toHaveLength(1);
  });
});

describe("line variants", () => {
  it("assigns a stable variant per key within range", () => {
    expect(lineVariantFor("road:major_dark")).toBe(lineVariantFor("road:major_dark"));
    for (const k of ["road:major_dark", "road:minor", "road:path", "water:waterway", "border:admin_country"]) {
      const v = lineVariantFor(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(LINE_VARIANTS);
    }
    const distinct = new Set(["road:major_dark", "road:minor", "road:path", "water:waterway", "border:admin_country", "road:rail"].map(lineVariantFor));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("draws the chosen curve", () => {
    const layer = { id: "l", type: "line", role: "main", order: 0, paint: { "line-color": "rgba(0,0,0,1)", "line-width": 2 }, layout: {} };
    const a = createLineSwatch([layer], 0).querySelector("path")?.getAttribute("d");
    const b = createLineSwatch([layer], 1).querySelector("path")?.getAttribute("d");
    expect(a).not.toBe(b);
    expect(createLineSwatch([layer], LINE_VARIANTS).querySelector("path")?.getAttribute("d")).toBe(a); // wraps around
  });
});
