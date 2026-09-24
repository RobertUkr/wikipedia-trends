import { normalizeProject } from '../lib/wikimedia.js';
import type { Lang, LanguageAvailability, Message } from '../types.js';

/** Unavailable entry for an edition whose article exists but whose data could not be used. */
export function failedLanguage(
  lang: Lang,
  title: string,
  status: LanguageAvailability['status'],
  reason: Message,
): LanguageAvailability {
  return {
    lang,
    project: normalizeProject(lang),
    status,
    title,
    reason,
    requiresConfirmation: false,
    searchQuery: null,
    searchHits: 0,
    alternatives: [],
  };
}

/** Search query for probing editions without an article: the English title, else any title, else the QID. */
export function fallbackQuery(titles: Record<Lang, string>, qid: string): string {
  return titles['en'] ?? Object.values(titles)[0] ?? qid;
}
