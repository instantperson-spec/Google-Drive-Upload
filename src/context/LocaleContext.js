'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import { DEFAULT_LOCALE, normalizeLocale } from '@/lib/locales';
import en from '@/i18n/en.json';
import pl from '@/i18n/pl.json';

const MESSAGES = { en, pl };

const LocaleContext = createContext({
  locale: DEFAULT_LOCALE,
  t: (key) => key,
});

function resolvePath(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function interpolate(template, vars) {
  if (!template || typeof template !== 'string') return template ?? '';
  let out = template;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${key}}`, String(value));
    }
  }
  return out;
}

export function LocaleProvider({ locale, children }) {
  const normalized = normalizeLocale(locale);

  useEffect(() => {
    document.documentElement.lang = normalized;
  }, [normalized]);

  const value = useMemo(() => {
    const primary = MESSAGES[normalized] ?? MESSAGES.en;
    const fallback = MESSAGES.en;

    const t = (key, vars) => {
      const raw = resolvePath(primary, key) ?? resolvePath(fallback, key) ?? key;
      return interpolate(raw, vars);
    };

    return { locale: normalized, t };
  }, [normalized]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT() {
  return useContext(LocaleContext).t;
}
