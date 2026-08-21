/**
 * Провайдер локали: состояние + сохранение в localStorage (default ru).
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  I18nContext,
  initialLocale,
  storeLocale,
  translate,
  type Locale,
  type TOptions,
} from "../i18n";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key: string, opts?: TOptions): string => translate(locale, key, opts),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
