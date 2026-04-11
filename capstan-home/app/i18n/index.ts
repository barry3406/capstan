export type { Locale } from "./translations.js";
export { locales, localeNames, t } from "./translations.js";

import type { Locale } from "./translations.js";
import { locales } from "./translations.js";

// Get current locale from URL query param or Accept-Language header
export function getLocale(request?: Request): Locale {
  if (!request) return "en";
  const url = new URL(request.url);
  const param = url.searchParams.get("lang");
  if (param && locales.includes(param as Locale)) return param as Locale;
  // Check Accept-Language header as fallback
  const accept = request.headers.get("accept-language") ?? "";
  for (const locale of locales) {
    if (accept.includes(locale) || accept.includes(locale.split("-")[0]!)) return locale;
  }
  return "en";
}
