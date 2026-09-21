import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dictionaries, type Language, type TranslationKey } from './dictionaries';

const STORAGE_KEY = 'resopatch_language';
const DEFAULT_LANGUAGE: Language = 'en';

function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'ru' ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      let text: string = dictionaries[language][key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
      }
      return text;
    },
    [language],
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
