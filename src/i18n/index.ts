import type { I18nKey, Locale, TranslationMap } from './keys';
import { EN } from './en';
import { ES } from './es';

export type { I18nKey, Locale, TranslationMap } from './keys';
export { EN } from './en';
export { ES } from './es';

const REGISTRY: Record<Locale, TranslationMap> = { en: EN, es: ES };

export interface Translator {
  locale: Locale;
  t(key: I18nKey): string;
}

export function createTranslator(locale: Locale): Translator {
  const table = REGISTRY[locale];
  return {
    locale,
    t(key: I18nKey): string {
      // Fallback to key itself if missing — surfaces bugs loudly in dev.
      return table[key] ?? key;
    },
  };
}
