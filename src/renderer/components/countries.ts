// Названия стран на языке интерфейса (средствами Intl, без справочников в бандле).
export function countryLabel(code: string, lang: "ru" | "en"): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
