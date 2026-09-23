import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '../src/lib/messages.js';
import {
  chartSeries,
  headline,
  missingDaysDetail,
  pickTopic,
  renderReport,
  selectCaveats,
  signed,
  trendBand,
} from '../src/lib/report.js';
import type { ReportInput, ReportLanguage, ReportTrend } from '../src/lib/report.js';
import type { Direction } from '../src/lib/stats.js';

function trend(percent: number, ci: [number, number], direction: Direction): ReportTrend {
  return { percentPerYear: percent, ci95: ci, direction, slopePerWeek: -0.5, intercept: 100, ci95Slope: [-0.7, -0.3] };
}

function language(lang: string, overall: ReportTrend, extra: Partial<ReportLanguage> = {}): ReportLanguage {
  const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];

  return {
    lang,
    title: `Title ${lang}`,
    unit: 'views_per_million',
    trend: overall,
    relativeTrend: overall,
    recentTrend: { ...trend(1, [-4, 6], 'inconclusive'), weeks: 20, from: '2024-01-02' },
    weeks: 3,
    medianPerMillion: 12.5,
    confidence: { overall: 'medium', score: 0.8, caveats: [] },
    outlierDates: [],
    missingDays: 0,
    points: dates.map((date) => ({ date, perMillion: 10, smoothed: 10 })),
    ...extra,
  };
}

function input(languages: ReportLanguage[]): ReportInput {
  return {
    qid: 'Q1',
    from: '2024-01-01',
    to: '2024-01-03',
    days: 3,
    topic: 'Тема',
    languages,
    caveats: [],
    source: 'test',
  };
}

describe('headline', () => {
  it('names the growing leader and its recent direction', () => {
    const result = headline(
      input([
        language('en', trend(12, [4, 20], 'up')),
        language('de', trend(-5, [-9, -1], 'down')),
      ]),
    );

    expect(result.code).toBe('HEADLINE_GROWING');
    expect(render(result, 'uk')).toContain('лідер — en, +12%/рік');
    expect(render(result, 'uk')).toContain('в останні тижні — без ясного напрямку');
  });

  it('says rank 1 is the slowest decline when everything falls', () => {
    const result = headline(
      input([
        language('en', trend(-7.7, [-11.7, -3.5], 'down')),
        language('uk', trend(-10.6, [-15.3, -6.2], 'down')),
      ]),
    );

    expect(result.code).toBe('HEADLINE_ALL_DOWN');
    expect(render(result, 'uk')).toContain('найповільніше — en, -7.7%/рік');
  });

  it('keeps a clear decline visible when the other language is unclear', () => {
    const result = headline(
      input([
        language('cs', trend(-25.8, [-30.8, -21], 'down')),
        language('uk', trend(-9, [-34.9, 2.7], 'inconclusive')),
      ]),
    );

    expect(result.code).toBe('HEADLINE_MIXED_DOWN');
    expect(result.params).toMatchObject({ down: 'cs', others: 'uk' });
  });

  it('refuses to recommend anything when no language has a direction', () => {
    const result = headline(
      input([
        language('cs', trend(1, [-6, 8], 'inconclusive')),
        language('uk', trend(0.5, [-2, 3], 'flat')),
      ]),
    );

    expect(result.code).toBe('HEADLINE_NO_CLEAR_DIRECTION');
  });

  it('never words an inconclusive recent trend as growth', () => {
    const result = headline(input([language('en', trend(-7.7, [-11.7, -3.5], 'down'))]));
    const text = render(result, 'uk');

    expect(result.code).toBe('HEADLINE_SINGLE');
    expect(text).toContain('за період — падає');
    expect(text).toContain('в останні тижні — без ясного напрямку');
    expect(text).not.toContain('зростає');
  });
});

describe('trendBand', () => {
  it('converts weekly sums to a daily level and pivots the band at the middle', () => {
    const band = trendBand(
      { percentPerYear: 0, ci95: [-1, 1], direction: 'flat', slopePerWeek: 0, intercept: 70, ci95Slope: [-1, 1] },
      5,
      '2024-01-01',
    );

    expect(band.value).toEqual([10, 10, 10, 10, 10]);
    expect(band.lower[2]).toBeCloseTo(10, 6);
    expect(band.upper[2]).toBeCloseTo(10, 6);
    expect((band.upper[0] ?? 0) - (band.lower[0] ?? 0)).toBeGreaterThan(0);
    expect(band.dates[0]).toBe('2024-01-04');
  });

  it('keeps lower under upper on both sides of the pivot', () => {
    const band = trendBand(trend(-5, [-8, -2], 'down'), 9, '2024-01-01');

    band.lower.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(band.upper[index] ?? Number.NEGATIVE_INFINITY);
    });
  });
});

describe('chartSeries', () => {
  it('plots only normalised languages and reports the rest', () => {
    const result = chartSeries(
      input([
        language('en', trend(-5, [-9, -1], 'down')),
        language('xx', trend(-5, [-9, -1], 'down'), { unit: 'raw_views' }),
      ]),
    );

    expect(result.series.map((item) => item.id)).toEqual(['en']);
    expect(result.excluded).toEqual(['xx']);
  });
});

describe('selectCaveats', () => {
  it('tags language caveats with their language and adds the weekly note once', () => {
    const caveats = selectCaveats(
      input([
        language('en', trend(-5, [-9, -1], 'down'), {
          confidence: {
            overall: 'medium',
            score: 0.8,
            caveats: [
              { code: 'SLOPE_SIGN_UNSTABLE', params: { flipped: 2, total: 5 } },
              { code: 'WEEKLY_AGGREGATION', params: { weeks: 156, days: 1097 } },
            ],
          },
        }),
        language('de', trend(-5, [-9, -1], 'down'), {
          confidence: { overall: 'medium', score: 0.8, caveats: [{ code: 'WEEKLY_AGGREGATION', params: { weeks: 156, days: 1097 } }] },
        }),
      ]),
    );

    expect(render(caveats[0] as never, 'uk')).toMatch(/^en: Нахил міняє знак/);
    expect(caveats.filter((item) => item.code === 'WEEKLY_AGGREGATION')).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('prefers the article title in the report language', () => {
    const languages = [
      { lang: 'en', title: 'Artificial intelligence' },
      { lang: 'uk', title: 'Штучний інтелект' },
    ];

    expect(pickTopic(languages, 'uk', 'Q11660')).toBe('Штучний інтелект');
    expect(pickTopic([{ lang: 'de', title: 'KI' }], 'uk', 'Q11660')).toBe('KI');
    expect(pickTopic([], 'uk', 'Q11660')).toBe('Q11660');
  });

  it('signs positive numbers and leaves the rest alone', () => {
    expect(signed(6.9)).toBe('+6.9');
    expect(signed(-4.6)).toBe('-4.6');
    expect(signed(0)).toBe('0');
    expect(signed(null)).toBe('—');
  });

  it('lists the languages with missing days', () => {
    const detail = missingDaysDetail(
      input([language('cs', trend(-5, [-9, -1], 'down'), { missingDays: 2 }), language('uk', trend(-5, [-9, -1], 'down'))]),
    );

    expect(render(detail, 'uk')).toBe('Пропущені дні, інтерпольовано: cs 2');
  });
});

describe('renderReport', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-report-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a one-page PDF with the DejaVu fonts embedded and the SVG next to it', async () => {
    const pdfPath = join(dir, 'report.pdf');
    const result = await renderReport(
      input([
        language('cs', trend(-25.8, [-30.8, -21], 'down'), { title: 'Přerušovaný půst' }),
        language('uk', trend(-9, [-34.9, 2.7], 'inconclusive'), { title: 'Інтервальне голодування' }),
      ]),
      'uk',
      pdfPath,
    );

    const pdf = await readFile(result.pdf);
    const raw = pdf.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]+\+DejaVuSans\b/);
    expect(raw).toMatch(/\/BaseFont \/[A-Z]+\+DejaVuSans-Bold/);
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
    expect(raw).toMatch(/\/Type \/Pages[\s\S]*?\/Count 1\b/);

    const svg = await readFile(result.svg, 'utf8');

    expect(svg).toContain('перегляди на мільйон трафіку розділу');
    expect(result.headline.code).toBe('HEADLINE_MIXED_DOWN');
  });
});
