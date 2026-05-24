import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, t as translate, type Locale } from "./config";

type LocaleContextValue = {
  locale: Locale;
  t: (key: string) => string;
};

export const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: (key) => translate(key, DEFAULT_LOCALE),
});

export function useLocale() {
  return useContext(LocaleContext);
}
