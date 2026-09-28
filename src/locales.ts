/**
 * The control's UI strings in the languages the Maptoolkit map maker offers.
 * They are written into the map's `locale` table on `onAdd` for the control's
 * language, like MapLibre's built-in controls read theirs — an entry the page
 * already set wins. Missing keys fall back to English.
 */
export type LegendLocale = {
  /** The panel's accessible name (there is no visible header). */
  "LegendControl.Title": string;
  /** The text of the toggle button (`button: "text"`). */
  "LegendControl.Label": string;
  /** Tooltip and accessible name of the toggle button. */
  "LegendControl.Toggle": string;
  /** Shown when nothing tagged is in view. */
  "LegendControl.Empty": string;
  /** Tooltip of a row's info button. */
  "LegendControl.Info": string;
};

const locale = (title: string, toggle: string, empty: string, info: string, label = title): LegendLocale => ({
  "LegendControl.Title": title,
  "LegendControl.Label": label,
  "LegendControl.Toggle": toggle,
  "LegendControl.Empty": empty,
  "LegendControl.Info": info,
});

export const LEGEND_LOCALES: Readonly<Record<string, LegendLocale>> = {
  en: locale("Legend", "Show or hide the legend", "Nothing to show in this view", "More about this"),
  de: locale("Legende", "Legende ein- oder ausblenden", "Nichts zu zeigen in diesem Ausschnitt", "Mehr dazu"),
  es: locale("Leyenda", "Mostrar u ocultar la leyenda", "Nada que mostrar en esta vista", "Más información"),
  it: locale("Legenda", "Mostra o nascondi la legenda", "Niente da mostrare in questa vista", "Maggiori informazioni"),
  fr: locale("Légende", "Afficher ou masquer la légende", "Rien à afficher dans cette vue", "En savoir plus"),
  hu: locale("Jelmagyarázat", "Jelmagyarázat megjelenítése vagy elrejtése", "Nincs megjeleníthető elem ebben a nézetben", "További információ"),
  cs: locale("Legenda", "Zobrazit nebo skrýt legendu", "V tomto výřezu není co zobrazit", "Více informací"),
  pl: locale("Legenda", "Pokaż lub ukryj legendę", "Brak elementów w tym widoku", "Więcej informacji"),
  zh: locale("图例", "显示或隐藏图例", "当前视图中没有可显示的内容", "了解更多"),
  ja: locale("凡例", "凡例を表示または非表示", "この範囲に表示できる項目はありません", "詳細"),
  ko: locale("범례", "범례 표시 또는 숨기기", "이 화면에 표시할 항목이 없습니다", "자세히 보기"),
  hi: locale("लेजेंड", "लेजेंड दिखाएँ या छिपाएँ", "इस दृश्य में दिखाने के लिए कुछ नहीं है", "और जानें"),
  ar: locale("مفتاح الخريطة", "إظهار أو إخفاء مفتاح الخريطة", "لا شيء لعرضه في هذا النطاق", "المزيد"),
};

/** The strings for a language code (`de`, `de-AT`, …), English where a language is not covered. */
export function legendLocaleFor(language: string | undefined): LegendLocale {
  return LEGEND_LOCALES[(language ?? "en").slice(0, 2).toLowerCase()] ?? LEGEND_LOCALES.en;
}
