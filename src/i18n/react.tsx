import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createTranslator, normalizeLanguage, type Language } from './core';
import { I18nContext } from './context';

const STORAGE_KEY = 'ai-gateway-language';

function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'en-US';
  return normalizeLanguage(window.localStorage.getItem(STORAGE_KEY) ?? window.navigator.language);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: createTranslator(language),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
