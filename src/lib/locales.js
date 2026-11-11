export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = ['en', 'pl'];

/** @param {unknown} value */
export function normalizeLocale(value) {
  if (value === 'pl') return 'pl';
  return DEFAULT_LOCALE;
}
