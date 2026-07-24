import type { TranslationKey } from './i18n/dictionaries';

/**
 * Maps ownerRole string from backend/DB to localized format using i18n dictionary.
 *
 * Russian:
 *   - Андрей -> Андрей
 *   - Даня-вокал / Даня -> Даня
 *   - Даня-барабанщик -> Даня (барабанщик)
 *
 * English:
 *   - Андрей -> Andrii
 *   - Даня-вокал / Даня -> Dan
 *   - Даня-барабанщик -> Dan Drummer
 */
export function formatOwnerRole(
  ownerRole: string | undefined | null,
  t: (key: TranslationKey) => string,
): string {
  if (!ownerRole) return '';
  const trimmed = ownerRole.trim();
  if (trimmed === 'Андрей' || trimmed === 'Andrii' || trimmed === 'andrii') return t('ownerRole.andrii');
  if (trimmed === 'Даня-вокал' || trimmed === 'Даня' || trimmed === 'Dan' || trimmed === 'danVox') return t('ownerRole.danVox');
  if (trimmed === 'Даня-барабанщик' || trimmed === 'Dan Drummer' || trimmed === 'danDrummer') return t('ownerRole.danDrummer');
  return trimmed;
}
