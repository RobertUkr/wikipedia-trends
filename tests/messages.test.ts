import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LOCALES, isLocale, message, render, renderAll } from '../src/lib/messages.js';
import type { Locale } from '../src/lib/messages.js';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((found) => found[1] as string).sort();
}

describe('dictionaries', () => {
  it('cover exactly the same codes in every locale', () => {
    const [first, ...rest] = LOCALES;
    const reference = Object.keys(DICTIONARIES[first as Locale]).sort();

    expect(reference.length).toBeGreaterThan(5);

    for (const locale of rest) {
      expect(Object.keys(DICTIONARIES[locale]).sort()).toEqual(reference);
    }
  });

  it('use the same placeholders in every locale, so no translation silently drops a number', () => {
    for (const code of Object.keys(DICTIONARIES.en) as Array<keyof typeof DICTIONARIES.en>) {
      expect(placeholders(DICTIONARIES.uk[code]), `placeholders differ for ${code}`).toEqual(
        placeholders(DICTIONARIES.en[code]),
      );
    }
  });

  it('never leaves a template empty', () => {
    for (const locale of LOCALES) {
      for (const [code, template] of Object.entries(DICTIONARIES[locale])) {
        expect(template.trim().length, `${locale}/${code} is empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe('render', () => {
  it('substitutes parameters in both locales', () => {
    const reason = message('NO_ARTICLE_WITH_MENTIONS', { project: 'pl.wikipedia.org', query: 'post', hits: 6 });

    expect(render(reason, 'en')).toContain('mentions "post" in 6 article(s)');
    expect(render(reason, 'uk')).toContain('згадує «post» у 6 статтях');
    expect(render(reason, 'uk')).not.toContain('{');
  });

  it('defaults to English', () => {
    const reason = message('SEARCH_FAILED', { project: 'pl.wikipedia.org', error: 'timeout' });

    expect(render(reason)).toBe('Search on pl.wikipedia.org failed: timeout');
  });

  it('leaves a placeholder visible when the parameter is missing instead of printing undefined', () => {
    expect(render({ code: 'NO_ARTICLE_NO_HITS', params: {} }, 'en')).toContain('{project}');
  });

  it('renders a whole list', () => {
    const rendered = renderAll(
      [
        message('NO_ARTICLE_NO_HITS', { project: 'pl.wikipedia.org', query: 'post' }),
        message('POSSIBLE_ALTERNATIVE', { project: 'pl.wikipedia.org', title: 'Post' }),
      ],
      'uk',
    );

    expect(rendered).toHaveLength(2);
    expect(rendered[1]).toContain('Не підтверджено');
  });
});

describe('isLocale', () => {
  it('accepts the supported locales and rejects anything else', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});
