(function () {
  const DEFAULT_LOCALE = 'en';
  const PRIMARY_CHINESE_LOCALE = 'zh-Hans';
  const BUNDLES = ['common.json', 'errors.json', 'web.json'];
  const dictionaries = new Map();
  let currentLocale = DEFAULT_LOCALE;

  function normalizeLocale(input) {
    try {
      const locale = new Intl.Locale(input || DEFAULT_LOCALE).maximize();
      if (locale.language === 'zh') {
        return locale.script === 'Hant' ? 'zh-Hant' : PRIMARY_CHINESE_LOCALE;
      }
    } catch (_) {
      // Fall through to default.
    }
    return DEFAULT_LOCALE;
  }

  function detectLocale() {
    return normalizeLocale(
      localStorage.getItem('ironclaw_locale') ||
      navigator.language ||
      (navigator.languages && navigator.languages[0]) ||
      DEFAULT_LOCALE
    );
  }

  function fallbackChain(locale) {
    if (locale === 'zh-Hant') return ['zh-Hant', PRIMARY_CHINESE_LOCALE, DEFAULT_LOCALE];
    if (locale === PRIMARY_CHINESE_LOCALE) return [PRIMARY_CHINESE_LOCALE, DEFAULT_LOCALE];
    return [DEFAULT_LOCALE];
  }

  async function fetchBundle(locale, bundle) {
    const res = await fetch(`/locales/${encodeURIComponent(locale)}/${bundle}`, {
      cache: 'no-store',
    });
    if (!res.ok) return {};
    return res.json();
  }

  async function ensureLocale(locale) {
    if (dictionaries.has(locale)) return;

    const merged = {};
    for (const bundle of BUNDLES) {
      Object.assign(merged, await fetchBundle(locale, bundle));
    }
    dictionaries.set(locale, merged);
  }

  async function loadLocale(locale) {
    const normalized = normalizeLocale(locale);
    const chain = fallbackChain(normalized);

    for (const loc of chain) {
      await ensureLocale(loc);
    }

    currentLocale = normalized;
    document.documentElement.lang = normalized;
    localStorage.setItem('ironclaw_locale', normalized);
  }

  function t(key, vars) {
    const chain = fallbackChain(currentLocale);
    let template = key;

    for (const loc of chain) {
      const candidate = dictionaries.get(loc)?.[key];
      if (candidate != null) {
        template = candidate;
        break;
      }
    }

    return template.replace(/\{(\w+)\}/g, function (_, name) {
      return String((vars && vars[name] != null) ? vars[name] : `{${name}}`);
    });
  }

  function applyI18n(root) {
    const node = root || document;

    node.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });

    node.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });

    node.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.dataset.i18nTitle));
    });
  }

  window.i18n = {
    detectLocale,
    loadLocale,
    t,
    applyI18n,
    getLocale: function () {
      return currentLocale;
    },
  };
})();
