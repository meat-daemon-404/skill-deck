import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

interface I18nContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  toggleLang: () => void;
  t: (zh: string, en: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => {},
  toggleLang: () => {},
  t: (zh) => zh,
});

function readStoredLang(): Lang {
  try {
    const val = localStorage.getItem('skilldeck-lang');
    if (val === 'en' || val === 'zh') return val;
  } catch {
    // Ignore storage errors
  }
  return 'zh';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang());

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title =
      lang === 'zh'
        ? 'SkillDeck — AI Agent 超级总控与免疫中心'
        : 'SkillDeck — AI Agent SuperAgent & Immune Control Tower';
  }, [lang]);

  function setLang(next: Lang) {
    setLangState(next);
    try {
      localStorage.setItem('skilldeck-lang', next);
    } catch {
      // Ignore storage errors
    }
  }

  function toggleLang() {
    setLang(lang === 'zh' ? 'en' : 'zh');
  }

  function t(zh: string, en: string): string {
    return lang === 'zh' ? zh : en;
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
