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

    expect(reference.length).toBeGreaterThan(30);

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
    const caveat = message('LOW_VOLUME', { median: 6, floor: 20, ceiling: 500 });

    expect(render(caveat, 'en')).toContain('around 6 views a day');
    expect(render(caveat, 'uk')).toContain('близько 6 переглядів на день');
    expect(render(caveat, 'uk')).not.toContain('{');
  });

  it('defaults to English', () => {
    expect(render(message('NOTE_SPANS_ZERO'))).toBe(DICTIONARIES.en.NOTE_SPANS_ZERO);
  });

  it('leaves a placeholder visible when the parameter is missing instead of printing undefined', () => {
    expect(render({ code: 'ZERO_VIEW_DAYS', params: {} }, 'en')).toContain('{days}');
  });

  it('renders a whole list', () => {
    const rendered = renderAll([message('NOTE_SPANS_ZERO'), message('NOTE_LOW_CONFIDENCE')], 'uk');

    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain('нуль');
  });
});

describe('isLocale', () => {
  it('accepts the supported locales and rejects anything else', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});
