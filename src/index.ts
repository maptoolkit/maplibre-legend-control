import "./style.css";

export { LegendControl, defaultLegendControlOptions, FALLBACK_BACKGROUND, backgroundColorOf, isDark } from "./LegendControl";
export type { LegendControlOptions } from "./LegendControl";
export { buildLegendModel } from "./model";
export type { BuildLegendModelInput, Viewport } from "./model";
export { parseFontStack, fontStackToCss } from "./fonts";
export {
  createSwatch,
  createSymbolPreview,
  applyTextStyle,
  textPlacement,
  swatchVariantFor,
  lineShapeFamilyFor,
  LINE_SHAPES,
  fillShapeFamilyFor,
  FILL_SHAPES,
} from "./swatch";
export type { FillShapeFamily, LineShapeFamily } from "./swatch";
export type { CssFont } from "./fonts";
export { LEGEND_METADATA_KEY } from "./types";
export { LEGEND_LOCALES, legendLocaleFor } from "./locales";
export type { LegendLocale } from "./locales";
export type {
  LegendLayerTag,
  LegendManifest,
  LegendManifestItem,
  LegendLabel,
  LegendModel,
  LegendGroup,
  LegendEntry,
  SwatchLayer,
  TextStyle,
  RenderedFeature,
} from "./types";
