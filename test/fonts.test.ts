import { describe, expect, it } from "vitest";
import { fontStackToCss, parseFontStack } from "../src/fonts";

describe("parseFontStack", () => {
  it.each([
    ["Rosario Bold", { family: "Rosario", weight: 700, style: "normal", smallCaps: false }],
    ["Rosario Bold Italic", { family: "Rosario", weight: 700, style: "italic", smallCaps: false }],
    ["Alegreya Sans Medium Italic", { family: "Alegreya Sans", weight: 500, style: "italic", smallCaps: false }],
    ["Alegreya Sans Small Caps Bold", { family: "Alegreya Sans SC", weight: 700, style: "normal", smallCaps: true }],
    ["Metropolis Semi Bold", { family: "Metropolis", weight: 600, style: "normal", smallCaps: false }],
    ["Metropolis Extra Bold Italic", { family: "Metropolis", weight: 800, style: "italic", smallCaps: false }],
    ["Metropolis Regular Italic", { family: "Metropolis", weight: 400, style: "italic", smallCaps: false }],
    ["Noto Sans Regular", { family: "Noto Sans", weight: 400, style: "normal", smallCaps: false }],
    ["Inter-SemiBold", { family: "Inter", weight: 600, style: "normal", smallCaps: false }],
    ["DejaVuSans-BoldOblique", { family: "DejaVuSans", weight: 700, style: "italic", smallCaps: false }],
    ["PlusJakartaSans-ExtraLightItalic", { family: "PlusJakartaSans", weight: 200, style: "italic", smallCaps: false }],
    ["Ysabeau Thin", { family: "Ysabeau", weight: 100, style: "normal", smallCaps: false }],
    ["Fraunces Soft Black", { family: "Fraunces Soft", weight: 900, style: "normal", smallCaps: false }],
    ["Bellefair Regular", { family: "Bellefair", weight: 400, style: "normal", smallCaps: false }],
  ])("%s", (input, expected) => {
    expect(parseFontStack([input])).toEqual(expected);
  });

  it("takes the first font of a stack and handles empty input", () => {
    expect(parseFontStack(["Rosario Bold", "Noto Sans Regular"])?.family).toBe("Rosario");
    expect(parseFontStack([])).toBeUndefined();
    expect(parseFontStack(undefined)).toBeUndefined();
  });

  it("fontStackToCss adds a generic fallback", () => {
    expect(fontStackToCss(["Rosario Bold Italic"])).toEqual({ fontFamily: '"Rosario", sans-serif', fontWeight: "700", fontStyle: "italic" });
    expect(fontStackToCss(["Alegreya Regular"], "serif")?.fontFamily).toBe('"Alegreya", serif');
    // the fallback matches the typeface: slabs and serifs stay serifs, scripts cursive, the mono monospace
    expect(fontStackToCss(["Epunda Slab Semibold"])?.fontFamily).toBe('"Epunda Slab", serif');
    expect(fontStackToCss(["Alegreya Small Caps Bold"])?.fontFamily).toBe('"Alegreya SC", serif');
    expect(fontStackToCss(["Fraunces Soft Regular"])?.fontFamily).toBe('"Fraunces Soft", serif');
    expect(fontStackToCss(["Lobster Regular"])?.fontFamily).toBe('"Lobster", cursive');
    expect(fontStackToCss(["SUSE Mono Medium"])?.fontFamily).toBe('"SUSE Mono", monospace');
    expect(fontStackToCss(["Ysabeau Small Caps Bold"])?.fontFamily).toBe('"Ysabeau SC", sans-serif');
  });
});
