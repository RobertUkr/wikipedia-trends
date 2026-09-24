import { describe, expect, it } from 'vitest';
import { CRITERION, WEIGHTS, buildCompareCaveats, minMaxScale, rank } from '../src/commands/compare.js';
import type { LanguageAnalysis } from '../src/commands/analyze.js';
import { trendDirection } from '../src/lib/stats.js';
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
