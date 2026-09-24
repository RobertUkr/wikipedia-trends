import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRITERION, WEIGHTS, buildCompareCaveats, minMaxScale, rank, runCompare } from '../src/commands/compare.js';
import { analyzeLanguage } from '../src/commands/analyze.js';
import type { LanguageAnalysis } from '../src/commands/analyze.js';
import { trendDirection } from '../src/lib/stats.js';
import type { TrendFit, TrendPercent } from '../src/lib/stats.js';
import type { Message } from '../src/types.js';

function codes(messages: Message[]): string[] {
  return messages.map((item) => item.code);
}

interface FakeOptions {
  lang: string;
  percentPerYear: number;
  ci95: [number, number];
  median: number;
  confidenceScore: number;
  overall?: 'low' | 'medium' | 'high';
  outliers?: number;
  unit?: 'views_per_million' | 'raw_views';
}

function analysis(options: FakeOptions): LanguageAnalysis {
  return {
    lang: options.lang,
    project: `${options.lang}.wikipedia.org`,
    title: `Article ${options.lang}`,
    unit: options.unit ?? 'views_per_million',
    trend: {
      percentPerYear: options.percentPerYear,
      ci95: options.ci95,
      direction: trendDirection(options.ci95),
      baseline: 10,
      baselineSource: 'intercept',
    },
    level: { median: options.median },
    confidence: { overall: options.overall ?? 'high', score: options.confidenceScore, caveats: [] },
    fit: { ci95: options.ci95 },
    absoluteTrend: { percentPerYear: options.percentPerYear - 5, ci95: options.ci95, baseline: 10, baselineSource: 'intercept' },
    recentTrend: { percentPerYear: options.percentPerYear, ci95: options.ci95, baseline: 10, baselineSource: 'intercept' },
    reversal: null,
    weekly: { weeks: 104, values: [], dates: [], daysUsed: 728, daysDropped: 2 },
    outlierIndices: new Array(options.outliers ?? 0).fill(0),
  } as unknown as LanguageAnalysis;
}

describe('minMaxScale', () => {
  it('maps the extremes to 0 and 1', () => {
    expect(minMaxScale([10, 20, 30])).toEqual([0, 0.5, 1]);
  });

  it('gives a neutral 0.5 when there is nothing to separate', () => {
    expect(minMaxScale([7, 7])).toEqual([0.5, 0.5]);
    expect(minMaxScale([7])).toEqual([0.5]);
  });
});

describe('rank', () => {
  it('follows the published criterion exactly', () => {
    const ranked = rank([
      analysis({ lang: 'a', percentPerYear: 40, ci95: [30, 50], median: 10, confidenceScore: 0.8 }),
      analysis({ lang: 'b', percentPerYear: 0, ci95: [-5, 5], median: 100, confidenceScore: 0.4 }),
    ]);

    const first = ranked.find((item) => item.lang === 'a');
    const second = ranked.find((item) => item.lang === 'b');

    expect(first?.perspective).toBeCloseTo(WEIGHTS.growth * 1 + WEIGHTS.level * 0 + WEIGHTS.confidence * 0.8, 3);
    expect(second?.perspective).toBeCloseTo(WEIGHTS.growth * 0 + WEIGHTS.level * 1 + WEIGHTS.confidence * 0.4, 3);
    expect(first?.rank).toBe(1);
    expect(CRITERION).toContain('0.5*growth');
  });

  it('marks a language whose interval spans zero', () => {
    const ranked = rank([
      analysis({ lang: 'a', percentPerYear: 40, ci95: [30, 50], median: 10, confidenceScore: 0.8 }),
      analysis({ lang: 'b', percentPerYear: 1, ci95: [-20, 22], median: 10, confidenceScore: 0.8 }),
      analysis({ lang: 'c', percentPerYear: 0, ci95: [-3, 3], median: 10, confidenceScore: 0.8 }),
    ]);

    expect(codes(ranked.find((item) => item.lang === 'b')?.notes ?? [])).toContain('NOTE_SPANS_ZERO');
    expect(codes(ranked.find((item) => item.lang === 'c')?.notes ?? [])).not.toContain('NOTE_SPANS_ZERO');
    expect(codes(ranked.find((item) => item.lang === 'a')?.notes ?? [])).toEqual(['NOTE_NO_RESERVATIONS']);
  });

  it('puts a language whose trend could not be measured below one with a measured decline', () => {
    const unmeasured = analysis({ lang: 'uk', percentPerYear: 0, ci95: [-1, 1], median: 0, confidenceScore: 0.3, overall: 'low' });
    const ranked = rank([
      analysis({ lang: 'en', percentPerYear: -4.8, ci95: [-8.6, -1.2], median: 8.28, confidenceScore: 0.7 }),
      { ...unmeasured, trend: { ...unmeasured.trend, percentPerYear: null } } as typeof unmeasured,
    ]);

    expect(ranked.map((item) => item.lang)).toEqual(['en', 'uk']);
  });

  it('keeps raw counts out of the level comparison instead of scaling them against per-million values', () => {
    const ranked = rank([
      analysis({ lang: 'a', percentPerYear: 10, ci95: [5, 15], median: 10, confidenceScore: 0.8 }),
      analysis({ lang: 'b', percentPerYear: 10, ci95: [5, 15], median: 20, confidenceScore: 0.8 }),
      analysis({ lang: 'c', percentPerYear: 10, ci95: [5, 15], median: 5000, confidenceScore: 0.8, unit: 'raw_views' }),
    ]);

    const raw = ranked.find((item) => item.lang === 'c');

    expect(raw?.perspective).toBeCloseTo(WEIGHTS.growth * 0.5 + WEIGHTS.level * 0.5 + WEIGHTS.confidence * 0.8, 3);
    expect(raw?.medianPerMillion).toBeNull();
    expect(ranked[0]?.lang).toBe('b');
  });

  it('warns that a low-confidence position is indicative only', () => {
    const ranked = rank([
      analysis({ lang: 'a', percentPerYear: 40, ci95: [30, 50], median: 10, confidenceScore: 0.2, overall: 'low' }),
      analysis({ lang: 'b', percentPerYear: 10, ci95: [5, 15], median: 10, confidenceScore: 0.9 }),
    ]);

    expect(codes(ranked.find((item) => item.lang === 'a')?.notes ?? [])).toContain('NOTE_LOW_CONFIDENCE');
  });
});

describe('buildCompareCaveats', () => {
  it('says plainly that rank 1 is the slowest decline when everything falls', () => {
    const caveats = buildCompareCaveats(
      [
        analysis({ lang: 'cs', percentPerYear: -34, ci95: [-39, -29], median: 3, confidenceScore: 0.6 }),
        analysis({ lang: 'uk', percentPerYear: -44, ci95: [-49, -40], median: 4, confidenceScore: 0.6 }),
      ],
      true,
    );

    expect(codes(caveats)).toContain('ALL_LANGUAGES_DECLINING');
  });

  it('stays silent about decline when one language grows', () => {
    const caveats = buildCompareCaveats(
      [
        analysis({ lang: 'cs', percentPerYear: -34, ci95: [-39, -29], median: 3, confidenceScore: 0.6 }),
        analysis({ lang: 'uk', percentPerYear: 12, ci95: [8, 16], median: 4, confidenceScore: 0.6 }),
      ],
      true,
    );

    expect(codes(caveats)).not.toContain('ALL_LANGUAGES_DECLINING');
  });

  it('flags a ranking that mixes units', () => {
    const caveats = buildCompareCaveats(
      [analysis({ lang: 'cs', percentPerYear: 5, ci95: [1, 9], median: 3, confidenceScore: 0.6, unit: 'raw_views' })],
      false,
    );

    expect(codes(caveats)).toContain('MIXED_UNITS');
  });
});

describe('runCompare', () => {
  const DAYS = 728;
  const START = '2024-01-01';
  const DATES = Array.from({ length: DAYS }, (_, index) =>
    new Date(Date.parse(`${START}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10),
  );
  const LAST_DAY = DATES[DAYS - 1] as string;
  const SITELINKS = {
    entities: {
      Q1: {
        sitelinks: {
          enwiki: { site: 'enwiki', title: 'Topic' },
          dewiki: { site: 'dewiki', title: 'Thema' },
          frwiki: { site: 'frwiki', title: 'Sujet' },
        },
      },
    },
  };

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  function series(shape: (index: number) => number, from = 0) {
    return {
      items: DATES.map((date, index) => ({ timestamp: `${date.replace(/-/g, '')}00`, views: Math.max(1, Math.round(shape(index))) })).slice(from),
    };
  }

  function router() {
    return vi.fn().mockImplementation((url: string) => {
      const target = String(url);

      if (target.includes('props=sitelinks')) {
        return Promise.resolve(json(SITELINKS));
      }

      if (target.includes('prop=revisions')) {
        return Promise.resolve(json({ query: { pages: [{ revisions: [] }] } }));
      }

      if (target.includes('per-article') && target.includes('fr.wikipedia')) {
        return Promise.resolve(json(series(() => 50, DAYS - 120)));
      }

      if (target.includes('per-article') && target.includes('de.wikipedia')) {
        return Promise.resolve(json(series((index) => 3000 - (500 * index) / 365)));
      }

      if (target.includes('per-article')) {
        return Promise.resolve(json(series((index) => (index % 97 === 50 ? 20000 : 2000 + (600 * index) / 365))));
      }

      if (target.includes('aggregate')) {
        return Promise.resolve(json(series(() => 2_000_000_000)));
      }

      throw new Error(`unexpected request: ${target}`);
    });
  }

  function roundTo(value: number, digits: number): number {
    return Math.round(value * 10 ** digits) / 10 ** digits;
  }

  function expectedTrend(fit: TrendFit, trend: TrendPercent) {
    return {
      percentPerYear: trend.percentPerYear,
      ci95: trend.ci95,
      direction: trend.direction,
      slopePerWeek: roundTo(fit.slope, 6),
      intercept: roundTo(fit.intercept, 6),
      ci95Slope: [roundTo(fit.ci95[0], 6), roundTo(fit.ci95[1], 6)],
      baseline: roundTo(trend.baseline, 3),
      baselineSource: trend.baselineSource,
    };
  }

  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-compare-'));
    process.env['WIKIPEDIA_TRENDS_CACHE_DIR'] = join(dir, 'cache');
    process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'] = join(dir, 'output');
  });

  afterEach(async () => {
    delete process.env['WIKIPEDIA_TRENDS_CACHE_DIR'];
    delete process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'];
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it('ranks the editions with data, lists a short history as unavailable and stores rounded trends', async () => {
    vi.stubGlobal('fetch', router());

    const result = await runCompare({ qid: 'Q1', langs: ['en', 'de', 'fr'], from: START, to: LAST_DAY, noCache: true, out: null, locale: null });
    const analyses = {
      en: await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true),
      de: await analyzeLanguage('Q1', 'de', 'Thema', START, LAST_DAY, true),
    };

    expect(Object.keys(result)).toEqual([
      'ok',
      'command',
      'qid',
      'range',
      'granularity',
      'n_effective',
      'unit',
      'comparable',
      'criterion',
      'ranking',
      'unavailable',
      'caveats',
      'file',
    ]);
    expect(result.range).toEqual({ from: START, to: LAST_DAY, days: analyses.en.days });
    expect(result.ranking.map((item) => item.lang).sort()).toEqual(['de', 'en']);

    for (const row of result.ranking) {
      const analysis = analyses[row.lang as 'en' | 'de'];

      expect(row.medianPerMillion).toBe(roundTo(analysis.level.median, 2));
      expect(row.perspective).toBe(roundTo(row.perspective, 3));
      expect(row.recentPercentPerYear).toBe(analysis.recentTrend?.percentPerYear ?? null);
    }

    expect(result.unavailable).toEqual([
      {
        lang: 'fr',
        project: 'fr.wikipedia.org',
        status: 'short_history',
        title: 'Sujet',
        reason: { code: 'SHORT_HISTORY', params: { title: 'Sujet', first: DATES[DAYS - 120], last: LAST_DAY } },
        requiresConfirmation: false,
        searchQuery: null,
        searchHits: 0,
        alternatives: [],
      },
    ]);
    expect(result.file).toBe(join(dir, 'output', 'compare-Q1.json'));

    const stored = JSON.parse(await readFile(result.file, 'utf8')) as {
      unavailable: unknown;
      languages: Array<Record<string, unknown> & { lang: 'en' | 'de' }>;
    };

    expect(stored.unavailable).toEqual(result.unavailable);
    expect(stored.languages.map((item) => item.lang)).toEqual(['en', 'de']);

    for (const item of stored.languages) {
      const analysis = analyses[item.lang];

      expect(item['trend']).toEqual(expectedTrend(analysis.fit, analysis.trend));
      expect(item['absoluteTrend']).toEqual(expectedTrend(analysis.absoluteFit, analysis.absoluteTrend));
      expect(item['relativeTrend']).toEqual(expectedTrend(analysis.fit, analysis.relativeTrend as TrendPercent));
      expect(item['recentTrend']).toEqual({
        ...expectedTrend(analysis.recentFit as TrendFit, analysis.recentTrend as TrendPercent),
        weeks: analysis.recentWeeks,
        from: analysis.recentFrom,
        startWeek: analysis.weekly.weeks - analysis.recentWeeks,
      });
    }
  });

  it('rejects a malformed qid before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runCompare({ qid: 'q1', langs: ['en', 'de'], from: START, to: LAST_DAY, noCache: true, out: null, locale: null }),
    ).rejects.toMatchObject({ code: 'InvalidInput', message: '--qid "q1" is not a Wikidata item id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
