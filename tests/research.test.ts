import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSummary, defaultRange, languageLine, runResearch } from '../src/commands/research.js';
import type { ReportLanguage } from '../src/lib/report.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('defaultRange', () => {
  it('ends two days back, because the newest day is often not published yet, and spans whole years', () => {
    expect(defaultRange(2, new Date('2026-09-24T10:00:00Z'))).toEqual({ from: '2024-09-23', to: '2026-09-22' });
    expect(defaultRange(3, new Date('2026-03-01T00:00:00Z'))).toEqual({ from: '2023-02-28', to: '2026-02-27' });
  });
});

describe('languageLine', () => {
  const item: ReportLanguage = {
    lang: 'uk',
    title: 'Астрономія',
    unit: 'views_per_million',
    trend: { percentPerYear: -35.6, ci95: [-45.1, -27.6], direction: 'down', slopePerWeek: -1, intercept: 90, ci95Slope: [-1.2, -0.8] },
    relativeTrend: { percentPerYear: -35.6, ci95: [-45.1, -27.6], direction: 'down', slopePerWeek: -1, intercept: 90, ci95Slope: [-1.2, -0.8] },
    recentTrend: {
      percentPerYear: 6.9,
      ci95: [-4.6, 16],
      direction: 'inconclusive',
      slopePerWeek: 0.4,
      intercept: 80,
      ci95Slope: [-0.3, 1],
      weeks: 35,
      from: '2026-01-15',
    },
    weeks: 104,
    medianPerMillion: 10.1289,
    confidence: { overall: 'low', score: 0.62, caveats: [] },
    outlierDates: [],
    missingDays: 0,
    points: [],
  };

  it('gives the model a ready sentence with every number copied from the analysis', () => {
    const line = languageLine(item, 'uk');

    expect(line.text).toBe(
      'uk: падає (-35.6%/рік, 95% [-45.1; -27.6]); останні тижні — без ясного напрямку (+6.9%/рік); достовірність — низька',
    );
    expect(line.medianPerMillion).toBe(10.13);
    expect(line.recentDirection).toBe('inconclusive');
  });

  it('never words an inconclusive recent trend as growth, in either locale', () => {
    expect(languageLine(item, 'en').text).toContain('recent weeks: no clear direction (+6.9%/yr)');
    expect(languageLine(item, 'uk').text).not.toContain('зростає');
  });
});

describe('buildSummary', () => {
  const base = {
    headline: 'Інтерес падає.',
    verdicts: ['Довіра (cs): достовірність низька.', 'Рекомендація: жодну мову рекомендувати не можна.'],
    caveats: ['Перше.', 'Друге.'],
    moreCaveats: 2,
    unavailable: [{ lang: 'pl', reason: 'немає статті' }],
    report: '/tmp/r.pdf',
    locale: 'uk' as const,
  };

  it('assembles a block the model can paste without writing a word of its own', () => {
    const summary = buildSummary({
      ...base,
      languages: [{ text: 'cs: падає (-35%/рік)' }, { text: 'uk: падає (-43.5%/рік)' }] as never,
    });

    expect(summary.split('\n')).toEqual([
      '**Інтерес падає.**',
      '',
      'Довіра (cs): достовірність низька.',
      'Рекомендація: жодну мову рекомендувати не можна.',
      '',
      '- cs: падає (-35%/рік)',
      '- uk: падає (-43.5%/рік)',
      '',
      '**Застереження**',
      '- Перше.',
      '- Друге.',
      '- Решта застережень (2) — у PDF.',
      '',
      '**Мови без даних**',
      '- pl: немає статті',
      '',
      'PDF-звіт: /tmp/r.pdf',
    ]);
  });

  it('does not repeat the single language line, the headline already carries its numbers', () => {
    const summary = buildSummary({ ...base, languages: [{ text: 'uk: падає (-35.6%/рік)' }] as never });

    expect(summary).not.toContain('- uk: падає');
  });
});

describe('runResearch', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-research-'));
    process.env['WIKIPEDIA_TRENDS_CACHE_DIR'] = join(dir, 'cache');
    process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'] = join(dir, 'output');
  });

  afterEach(async () => {
    delete process.env['WIKIPEDIA_TRENDS_CACHE_DIR'];
    delete process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'];
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it('stops and hands back the candidates instead of guessing an ambiguous topic', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            search: [
              { id: 'Q308', label: 'Меркурій', description: 'планета', match: { type: 'label', text: 'Меркурій' } },
              { id: 'Q1150', label: 'Меркурій', description: 'бог', match: { type: 'label', text: 'Меркурій' } },
            ],
          }),
        )
        .mockResolvedValueOnce(
          json({
            entities: {
              Q308: { sitelinks: { ukwiki: { site: 'ukwiki', title: 'Меркурій (планета)' } } },
              Q1150: { sitelinks: { ukwiki: { site: 'ukwiki', title: 'Меркурій (міфологія)' } } },
            },
          }),
        ),
    );

    const result = await runResearch({
      topic: 'меркурій',
      qid: null,
      lang: 'uk',
      langs: ['uk'],
      from: '2024-01-01',
      to: '2024-12-31',
      years: 2,
      locale: 'uk',
      noCache: true,
    });

    expect(result.status).toBe('needs_choice');
    expect(result.status === 'needs_choice' ? result.candidates.map((item) => item.qid) : []).toEqual(['Q308', 'Q1150']);
  });

  it('reports that no requested edition has an article without running an analysis', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const target = String(url);

      if (target.includes('wbsearchentities')) {
        return Promise.resolve(
          json({ search: [{ id: 'Q1', label: 'Тема', description: '', match: { type: 'label', text: 'Тема' } }] }),
        );
      }

      if (target.includes('props=sitelinks')) {
        return Promise.resolve(json({ entities: { Q1: { sitelinks: { ukwiki: { site: 'ukwiki', title: 'Тема' } } } } }));
      }

      if (target.includes('props=labels')) {
        return Promise.resolve(json({ entities: { Q1: { labels: {}, aliases: {} } } }));
      }

      if (target.includes('list=search')) {
        return Promise.resolve(json({ query: { searchinfo: { totalhits: 0 }, search: [] } }));
      }

      throw new Error(`unexpected request: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runResearch({
      topic: 'тема',
      qid: null,
      lang: 'uk',
      langs: ['pl'],
      from: '2024-01-01',
      to: '2024-12-31',
      years: 2,
      locale: 'uk',
      noCache: true,
    });

    expect(result.status).toBe('no_articles');
    expect(result.unavailable).toEqual([
      expect.objectContaining({ lang: 'pl', status: 'no_article' }),
    ]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('per-article'))).toBe(false);
  });
});
