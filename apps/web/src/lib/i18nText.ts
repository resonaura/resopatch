import type { Language } from './i18n/dictionaries';

/** Formats a text field that might be stored as JSON `{"en": "...", "ru": "..."}` or a plain string.
 *  Returns the language-specific version if JSON object, otherwise the plain string fallback. */
export function formatI18nText(text: string | null | undefined, lang: Language): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        if (parsed[lang]) return String(parsed[lang]);
        if (parsed.en) return String(parsed.en);
        if (parsed.ru) return String(parsed.ru);
      }
    } catch {
      // plain text fallback
    }
  }
  return text;
}
