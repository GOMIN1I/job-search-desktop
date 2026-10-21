// Справочник стран и регионов для проверки географии найма.
// Принцип: широкий регион (Worldwide, EMEA, Europe) НЕ доказывает найм из страны кандидата.
// Явное перечисление страны — доказывает; ограничение регионом без страны кандидата — исключает.

import { normalizeText } from "./text";

export interface CountryInfo {
  code: string;
  names: string[]; // нормализованные варианты на ru/en
  regions: string[]; // коды регионов, в которые страна безусловно входит
}

export const REGION_NAMES: Record<string, string[]> = {
  EU: ["eu", "european union", "евросоюз", "ес", "страны ес", "eu only"],
  EEA: ["eea", "european economic area"],
  EUROPE: ["europe", "европа", "european", "european timezones"],
  EMEA: ["emea"],
  CIS: ["cis", "снг", "страны снг"],
  NA: ["north america", "северная америка", "americas", "us canada", "usa canada"],
  LATAM: ["latam", "latin america", "латинская америка", "south america", "южная америка"],
  APAC: ["apac", "asia pacific", "asia", "азия"],
  MENA: ["mena", "middle east", "ближний восток"],
  AFRICA: ["africa", "африка"],
  OCEANIA: ["oceania", "anz"],
};

/** Регионы, которые для перечисленных стран лишь «возможно» включают их — всегда unknown. */
export const AMBIGUOUS_REGIONS = new Set(["EUROPE", "EMEA", "APAC", "MENA"]);

const C = (code: string, names: string[], regions: string[]): CountryInfo => ({ code, names, regions });

export const COUNTRIES: CountryInfo[] = [
  C("RU", ["russia", "россия", "рф", "russian federation", "российская федерация"], ["CIS"]),
  C("BY", ["belarus", "беларусь", "белоруссия"], ["CIS"]),
  C("KZ", ["kazakhstan", "казахстан"], ["CIS"]),
  C("UZ", ["uzbekistan", "узбекистан"], ["CIS"]),
  C("KG", ["kyrgyzstan", "киргизия", "кыргызстан"], ["CIS"]),
  C("AM", ["armenia", "армения"], ["CIS"]),
  C("AZ", ["azerbaijan", "азербайджан"], ["CIS"]),
  C("TJ", ["tajikistan", "таджикистан"], ["CIS"]),
  C("GE", ["georgia country", "грузия", "georgia (country)", "tbilisi"], []),
  C("UA", ["ukraine", "украина"], ["EUROPE"]),
  C("MD", ["moldova", "молдова"], ["EUROPE"]),
  C("RS", ["serbia", "сербия"], ["EUROPE"]),
  C("TR", ["turkey", "turkiye", "türkiye", "турция"], ["MENA"]),
  C("US", ["united states", "usa", "us", "u.s.", "u.s", "сша", "united states of america", "america"], ["NA"]),
  C("CA", ["canada", "канада"], ["NA"]),
  C("MX", ["mexico", "мексика"], ["LATAM", "NA"]),
  C("BR", ["brazil", "бразилия"], ["LATAM"]),
  C("AR", ["argentina", "аргентина"], ["LATAM"]),
  C("CO", ["colombia", "колумбия"], ["LATAM"]),
  C("CL", ["chile", "чили"], ["LATAM"]),
  C("PE", ["peru", "перу"], ["LATAM"]),
  C("GB", ["united kingdom", "uk", "u.k.", "great britain", "england", "великобритания", "британия"], ["EUROPE", "EMEA"]),
  C("IE", ["ireland", "ирландия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("DE", ["germany", "германия", "deutschland"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("FR", ["france", "франция"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("ES", ["spain", "испания"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("PT", ["portugal", "португалия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("IT", ["italy", "италия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("NL", ["netherlands", "нидерланды", "holland"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("BE", ["belgium", "бельгия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("PL", ["poland", "польша"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("CZ", ["czechia", "czech republic", "чехия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("SK", ["slovakia", "словакия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("AT", ["austria", "австрия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("CH", ["switzerland", "швейцария"], ["EUROPE", "EMEA"]),
  C("SE", ["sweden", "швеция"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("NO", ["norway", "норвегия"], ["EEA", "EUROPE", "EMEA"]),
  C("DK", ["denmark", "дания"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("FI", ["finland", "финляндия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("EE", ["estonia", "эстония"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("LV", ["latvia", "латвия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("LT", ["lithuania", "литва"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("RO", ["romania", "румыния"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("BG", ["bulgaria", "болгария"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("GR", ["greece", "греция"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("HU", ["hungary", "венгрия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("HR", ["croatia", "хорватия"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("SI", ["slovenia", "словения"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("CY", ["cyprus", "кипр"], ["EU", "EEA", "EUROPE", "EMEA"]),
  C("IL", ["israel", "израиль"], ["MENA", "EMEA"]),
  C("AE", ["uae", "united arab emirates", "оаэ", "dubai"], ["MENA", "EMEA"]),
  C("IN", ["india", "индия"], ["APAC"]),
  C("PH", ["philippines", "филиппины"], ["APAC"]),
  C("VN", ["vietnam", "вьетнам"], ["APAC"]),
  C("ID", ["indonesia", "индонезия"], ["APAC"]),
  C("MY", ["malaysia", "малайзия"], ["APAC"]),
  C("SG", ["singapore", "сингапур"], ["APAC"]),
  C("JP", ["japan", "япония"], ["APAC"]),
  C("CN", ["china", "китай"], ["APAC"]),
  C("TH", ["thailand", "таиланд"], ["APAC"]),
  C("AU", ["australia", "австралия"], ["APAC", "OCEANIA"]),
  C("NZ", ["new zealand", "новая зеландия"], ["APAC", "OCEANIA"]),
  C("ZA", ["south africa", "юар"], ["AFRICA", "EMEA"]),
  C("NG", ["nigeria", "нигерия"], ["AFRICA", "EMEA"]),
  C("KE", ["kenya", "кения"], ["AFRICA", "EMEA"]),
  C("EG", ["egypt", "египет"], ["AFRICA", "MENA", "EMEA"]),
];

// Города РФ/СНГ, которые встречаются в отечественных лентах без названия страны.
const CITY_COUNTRY: Record<string, string> = {
  "москва": "RU", "санкт-петербург": "RU", "петербург": "RU", "самара": "RU", "казань": "RU", "новосибирск": "RU",
  "екатеринбург": "RU", "нижний новгород": "RU", "краснодар": "RU", "ростов-на-дону": "RU", "уфа": "RU",
  "пермь": "RU", "воронеж": "RU", "челябинск": "RU", "томск": "RU", "иннополис": "RU", "тольятти": "RU",
  "минск": "BY", "алматы": "KZ", "астана": "KZ", "ташкент": "UZ", "ереван": "AM", "бишкек": "KG", "тбилиси": "GE",
};

export const WORLDWIDE_PHRASES = ["worldwide", "anywhere", "anywhere in the world", "global remote", "work from anywhere", "любая страна", "из любой точки мира", "из любой страны"];

export function countryByCode(code: string | null | undefined): CountryInfo | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code.toUpperCase()) ?? null;
}

export function countryName(code: string | null | undefined, lang: "ru" | "en" = "ru"): string {
  const c = countryByCode(code);
  if (!c) return code || (lang === "ru" ? "не указана" : "not set");
  const pick = lang === "ru" ? c.names.find((n) => /[а-я]/.test(n)) : c.names.find((n) => /^[a-z]/.test(n) && n.length > 3) ?? c.names[0];
  if (!pick) return c.code;
  if (lang === "ru" && pick === "рф") return "Россия";
  return pick.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function containsPhrase(text: string, phrase: string): boolean {
  const p = normalizeText(phrase);
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

/** Найти страны и регионы, упомянутые во фрагменте (структурированная локация). */
export function detectPlaces(fragment: string): { countries: string[]; regions: string[]; worldwide: boolean } {
  const text = normalizeText(fragment);
  const countries = new Set<string>();
  const regions = new Set<string>();
  for (const c of COUNTRIES) {
    for (const n of c.names) {
      // «us» как слово слишком часто встречается в английском тексте — учитываем только в коротких фрагментах.
      if ((n === "us" || n === "america") && text.length > 60) continue;
      if (containsPhrase(text, n)) {
        countries.add(c.code);
        break;
      }
    }
  }
  for (const [city, code] of Object.entries(CITY_COUNTRY)) if (containsPhrase(text, city)) countries.add(code);
  for (const [code, names] of Object.entries(REGION_NAMES)) if (names.some((n) => containsPhrase(text, n))) regions.add(code);
  // «Georgia» в США — штат; без явного указания страны не считаем.
  return { countries: [...countries], regions: [...regions], worldwide: WORLDWIDE_PHRASES.some((p) => containsPhrase(text, p)) };
}

export function countryInRegion(code: string, region: string): boolean {
  const c = countryByCode(code);
  return !!c && c.regions.includes(region);
}
