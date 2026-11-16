(() => {
  const STORAGE_KEY = 'studioConsole.locale';
  let locale = 'en';
  let messages = {};

  function resolvePath(obj, path) {
    return String(path || '')
      .split('.')
      .reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
  }

  function interpolate(template, vars) {
    if (template == null) return '';
    let out = String(template);
    if (vars && typeof vars === 'object') {
      for (const [key, value] of Object.entries(vars)) {
        out = out.replaceAll(`{${key}}`, String(value ?? ''));
      }
    }
    return out;
  }

  function t(key, vars) {
    const raw = resolvePath(messages, key);
    if (raw == null) return key;
    return interpolate(raw, vars);
  }

  function applyDom(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute(
        'placeholder',
        t(el.getAttribute('data-i18n-placeholder'))
      );
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    document.title = t('meta.title');
    document.documentElement.lang = locale;
    root.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-lang') === locale);
    });
  }

  async function setLocale(next) {
    locale = next === 'pl' ? 'pl' : 'en';
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    const res = await fetch(`/i18n/${locale}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load i18n/${locale}.json`);
    messages = await res.json();
    applyDom();
    window.dispatchEvent(
      new CustomEvent('studio-locale', { detail: { locale } })
    );
    return locale;
  }

  async function init() {
    let saved = 'en';
    try {
      saved = localStorage.getItem(STORAGE_KEY) || 'en';
    } catch {
      /* ignore */
    }
    await setLocale(saved);
  }

  window.StudioI18n = {
    t,
    setLocale,
    getLocale: () => locale,
    init,
    applyDom,
  };
})();
