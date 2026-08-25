import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Language = "id" | "en";

const STORAGE_KEY = "sport_center_lang";

type I18nContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (id: string, en: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLang(): Language {
  if (typeof window === "undefined") return "id";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "en" ? "en" : "id";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLang);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Language) => setLangState(next);
  const t = (id: string, en: string) => (lang === "en" ? en : id);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useLang(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: "id",
      setLang: () => {},
      t: (id: string) => id,
    };
  }
  return ctx;
}
