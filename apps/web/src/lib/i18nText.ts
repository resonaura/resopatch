import type { Language } from './i18n/dictionaries';

export type I18nTextInput = string | Record<string, unknown> | null | undefined;

/**
 * Formats a text field that might be:
 *  - a plain string
 *  - a JSON string `{"en":"...","ru":"..."}`
 *  - an already-parsed object `{ en, ru }`
 *
 * Picks the active locale, then falls back to en → ru → first string value → raw string.
 */
export function formatI18nText(text: I18nTextInput, lang: Language): string {
  if (text == null) return '';

  if (typeof text === 'object') {
    return pickFromObject(text, lang);
  }

  const trimmed = String(text).trim();
  if (!trimmed) return '';

  const asObj = tryParseI18nObject(trimmed);
  if (asObj) return pickFromObject(asObj, lang);

  return String(text);
}

/**
 * Writes an edited display string back into a bilingual field.
 * Preserves other locales when the original was a JSON object; otherwise stores a plain string.
 */
export function mergeI18nText(original: I18nTextInput, lang: Language, nextDisplay: string): string {
  const value = nextDisplay.trim();
  const existing =
    original != null && typeof original === 'object'
      ? { ...original }
      : typeof original === 'string'
        ? tryParseI18nObject(original.trim())
        : null;

  if (existing) {
    const next: Record<string, unknown> = { ...existing, [lang]: value };
    // Drop empty lang keys but keep at least one locale if others remain.
    if (!value) delete next[lang];
    const hasAny = Object.values(next).some((v) => typeof v === 'string' && v.trim());
    if (!hasAny) return value;
    return JSON.stringify(next);
  }

  return value;
}

function tryParseI18nObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      // Require at least one string locale value so plain `{broken` isn't treated as i18n.
      const hasLocale = Object.values(obj).some((v) => typeof v === 'string');
      return hasLocale ? obj : null;
    }
  } catch {
    // plain text
  }
  return null;
}

function pickFromObject(obj: Record<string, unknown>, lang: Language): string {
  if (typeof obj[lang] === 'string' && obj[lang]) return obj[lang] as string;
  if (typeof obj.en === 'string' && obj.en) return obj.en;
  if (typeof obj.ru === 'string' && obj.ru) return obj.ru;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}
