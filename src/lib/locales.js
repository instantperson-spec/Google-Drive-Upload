export const DEFAULT_LOCALE = 'en';

/** @param {unknown} value */
export function normalizeLocale(value) {
  if (value === 'pl') return 'pl';
  return DEFAULT_LOCALE;
}
