import type { Message, MessageCode } from '../types.js';

export type Locale = 'en' | 'uk';

export const LOCALES: Locale[] = ['en', 'uk'];
export const DEFAULT_LOCALE: Locale = 'en';

const EN: Record<MessageCode, string> = {
  NO_ARTICLE_WITH_MENTIONS:
    '{project} mentions "{query}" in {hits} article(s) but has no article about the topic itself',
  NO_ARTICLE_NO_HITS: '{project} has no article and no search hits for "{query}"',
  POSSIBLE_ALTERNATIVE:
    '{project} has no article linked to this topic, but "{title}" has a similar title. Unconfirmed: ask the user ' +
    'before treating it as the same topic.',
  SEARCH_FAILED: 'Search on {project} failed: {error}',
  NO_PAGEVIEWS_DATA:
    '{project} has the article "{title}" but the Pageviews API returns no data between {from} and {to}',
  LANGUAGE_FETCH_FAILED: '{code}: {message}',
};

const UK: Record<MessageCode, string> = {
  NO_ARTICLE_WITH_MENTIONS:
    '{project} згадує «{query}» у {hits} статтях, але окремої статті про тему немає',
  NO_ARTICLE_NO_HITS: '{project} не має ані статті, ані результатів пошуку за «{query}»',
  POSSIBLE_ALTERNATIVE:
    '{project} не має статті, привʼязаної до цієї теми, але «{title}» має схожу назву. Не підтверджено: спитайте ' +
    'користувача, перш ніж вважати це тією самою темою.',
  SEARCH_FAILED: 'Пошук у {project} не вдався: {error}',
  NO_PAGEVIEWS_DATA:
    '{project} має статтю «{title}», але Pageviews API не повертає даних між {from} і {to}',
  LANGUAGE_FETCH_FAILED: '{code}: {message}',
};

export const DICTIONARIES: Record<Locale, Record<MessageCode, string>> = { en: EN, uk: UK };

export function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value);
}

export function render(message: Message, locale: Locale = DEFAULT_LOCALE): string {
  const template = DICTIONARIES[locale][message.code];

  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = message.params[key];

    return value === undefined ? placeholder : String(value);
  });
}

export function renderAll(messages: Message[], locale: Locale = DEFAULT_LOCALE): string[] {
  return messages.map((message) => render(message, locale));
}

export function message(code: MessageCode, params: Record<string, string | number> = {}): Message {
  return { code, params };
}
