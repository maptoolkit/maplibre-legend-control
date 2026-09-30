/**
 * The control's UI strings in the languages the Maptoolkit map maker offers.
 * They are written into the map's `locale` table on `onAdd` for the control's
 * language, like MapLibre's built-in controls read theirs — an entry the page
 * already set wins. Missing keys fall back to English.
 */
export type LegendLocale = {
  /** The panel's accessible name (there is no visible header). */
  "LegendControl.Title": string;
  /** The word on the toggle button (`button: "icon-text"`, `"style-control"`, `"attribution"`). */
  "LegendControl.Label": string;
  /** Tooltip and accessible name of the toggle button. */
  "LegendControl.Toggle": string;
  /** Shown when nothing tagged is in view. */
  "LegendControl.Empty": string;
  /** Tooltip of a row's info button. */
  "LegendControl.Info": string;
  /** Tooltip and accessible name of the panel's close button. */
  "LegendControl.Close": string;
};

const locale = (title: string, toggle: string, empty: string, info: string, close: string, label = title): LegendLocale => ({
  "LegendControl.Title": title,
  "LegendControl.Label": label,
  "LegendControl.Toggle": toggle,
  "LegendControl.Empty": empty,
  "LegendControl.Info": info,
  "LegendControl.Close": close,
});

export const LEGEND_LOCALES: Readonly<Record<string, LegendLocale>> = {
  en: locale("Legend", "Show or hide the legend", "Nothing to show in this view", "More about this", "Close the legend"),
  de: locale("Legende", "Legende ein- oder ausblenden", "Nichts zu zeigen in diesem Ausschnitt", "Mehr dazu", "Legende schließen"),
  es: locale("Leyenda", "Mostrar u ocultar la leyenda", "Nada que mostrar en esta vista", "Más información", "Cerrar la leyenda"),
  it: locale("Legenda", "Mostra o nascondi la legenda", "Niente da mostrare in questa vista", "Maggiori informazioni", "Chiudi la legenda"),
  fr: locale("Légende", "Afficher ou masquer la légende", "Rien à afficher dans cette vue", "En savoir plus", "Fermer la légende"),
  hu: locale(
    "Jelmagyarázat",
    "Jelmagyarázat megjelenítése vagy elrejtése",
    "Nincs megjeleníthető elem ebben a nézetben",
    "További információ",
    "Jelmagyarázat bezárása",
  ),
  cs: locale("Legenda", "Zobrazit nebo skrýt legendu", "V tomto výřezu není co zobrazit", "Více informací", "Zavřít legendu"),
  pl: locale("Legenda", "Pokaż lub ukryj legendę", "Brak elementów w tym widoku", "Więcej informacji", "Zamknij legendę"),
  zh: locale("图例", "显示或隐藏图例", "当前视图中没有可显示的内容", "了解更多", "关闭图例"),
  ja: locale("凡例", "凡例を表示または非表示", "この範囲に表示できる項目はありません", "詳細", "凡例を閉じる"),
  ko: locale("범례", "범례 표시 또는 숨기기", "이 화면에 표시할 항목이 없습니다", "자세히 보기", "범례 닫기"),
  hi: locale("लेजेंड", "लेजेंड दिखाएँ या छिपाएँ", "इस दृश्य में दिखाने के लिए कुछ नहीं है", "और जानें", "लेजेंड बंद करें"),
  ar: locale("مفتاح الخريطة", "إظهار أو إخفاء مفتاح الخريطة", "لا شيء لعرضه في هذا النطاق", "المزيد", "إغلاق مفتاح الخريطة"),
};

/** The strings for a language code (`de`, `de-AT`, …), English where a language is not covered. */
export function legendLocaleFor(language: string | undefined): LegendLocale {
  return LEGEND_LOCALES[(language ?? "en").slice(0, 2).toLowerCase()] ?? LEGEND_LOCALES.en;
}
