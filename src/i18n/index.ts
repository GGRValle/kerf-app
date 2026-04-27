import type { I18nKey, Locale, TranslationMap } from './keys.js';
import { EN } from './en.js';
import { ES } from './es.js';

export type { I18nKey, Locale, TranslationMap } from './keys.js';
export { EN } from './en.js';
export { ES } from './es.js';

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
