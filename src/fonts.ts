/**
 * Map a MapLibre font stack (glyph font names such as "Rosario Bold Italic",
 * "Alegreya Sans Small Caps Regular", "Inter-SemiBold") to CSS font
 * properties, so a legend can set the name in the map's typeface — provided
 * the matching web font is available to the page.
 */

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  book: 400,
  regular: 400,
  normal: 400,
  text: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

const STYLES = new Set(["italic", "oblique"]);
/** Weight prefixes that combine with the following word ("Semi Bold", "Extra Light"). */
const PREFIXES = new Set(["semi", "demi", "extra", "ultra"]);

export type CssFont = {
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** True for "Small Caps" faces — served as their own family on Google Fonts (`Alegreya SC`). */
  smallCaps: boolean;
};

/**
 * Parse the first font of a stack. Trailing weight/style words are consumed
 * ("Bold", "Bold Italic", "Semi Bold", "BoldItalic", "-SemiBold"); what remains
 * is the family. Returns `undefined` for an empty stack.
 */
export function parseFontStack(stack: string[] | string | undefined): CssFont | undefined {
  const first = Array.isArray(stack) ? stack[0] : stack;
  if (!first || typeof first !== "string") return undefined;

  // "Inter-SemiBold" / "DejaVuSans-BoldOblique" → "Inter SemiBold" / "DejaVuSans BoldOblique"
  const words = first.replace(/-/g, " ").trim().split(/\s+/);
  let weight = 400;
  let style: "normal" | "italic" = "normal";
  let smallCaps = false;

  // Consume style/weight tokens from the end, incl. glued forms ("BoldItalic").
  while (words.length > 1) {
    const raw = words[words.length - 1];
    const lower = raw.toLowerCase();
    let consumed = false;

    if (STYLES.has(lower)) {
      style = "italic";
      consumed = true;
    } else if (lower in WEIGHTS) {
      weight = WEIGHTS[lower];
      consumed = true;
      const prev = words[words.length - 2]?.toLowerCase();
      if (prev && PREFIXES.has(prev)) {
        const combined = prev + lower;
        if (combined in WEIGHTS) weight = WEIGHTS[combined];
        words.pop(); // drop the prefix as well
      }
    } else {
      // glued forms: "BoldItalic", "BoldOblique", "SemiBold", "ExtraLight"
      const m = /^([A-Za-z]+?)(Italic|Oblique)$/.exec(raw);
      if (m) {
        style = "italic";
        const w = m[1].toLowerCase();
        if (w in WEIGHTS) weight = WEIGHTS[w];
        else if (w) {
          words[words.length - 1] = m[1];
          continue;
        }
        consumed = true;
      } else if (lower === "caps" && words[words.length - 2]?.toLowerCase() === "small") {
        smallCaps = true;
        words.pop();
        consumed = true;
      }
    }
    if (!consumed) break;
    words.pop();
  }

  let family = words.join(" ");
  if (smallCaps) family = `${family} SC`;
  return { family, weight, style, smallCaps };
}

/** CSS declarations for a font stack, with a generic fallback family. */
export function fontStackToCss(stack: string[] | string | undefined, fallback = "sans-serif"): { fontFamily: string; fontWeight: string; fontStyle: string } | undefined {
  const parsed = parseFontStack(stack);
  if (!parsed) return undefined;
  return {
    fontFamily: `"${parsed.family}", ${fallback}`,
    fontWeight: String(parsed.weight),
    fontStyle: parsed.style,
  };
}
