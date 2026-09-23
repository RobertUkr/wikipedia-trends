import { describe, expect, it } from 'vitest';
import {
  alignToRange,
  enumerateDates,
  interpolate,
  movingAverage,
  normalizeSeries,
  toShare,
} from '../src/lib/normalize.js';
import type { DailyPoint } from '../src/types.js';

function daily(from: string, values: number[]): DailyPoint[] {
  const dates = enumerateDates(from, new Date(Date.parse(`${from}T00:00:00Z`) + (values.length - 1) * 86400000)
    .toISOString()
    .slice(0, 10));

  return dates.map((date, index) => ({ date, views: values[index] as number }));
}

describe('interpolate', () => {
  it('fills an interior gap linearly', () => {
    expect(interpolate([10, null, null, 40]).values).toEqual([10, 20, 30, 40]);
  });

  it('holds the nearest value at the edges', () => {
    expect(interpolate([null, null, 5, 7]).values).toEqual([5, 5, 5, 7]);
    expect(interpolate([5, 7, null]).values).toEqual([5, 7, 7]);
  });

  it('marks which days were filled', () => {
    expect(interpolate([1, null, 3]).filled).toEqual([false, true, false]);
  });
});

describe('alignToRange', () => {
  it('puts the series on a full daily grid and reports the gaps', () => {
    const points: DailyPoint[] = [
      { date: '2024-01-01', views: 10 },
      { date: '2024-01-04', views: 40 },
    ];

    const aligned = alignToRange(points, '2024-01-01', '2024-01-04');

    expect(aligned.dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']);
    expect(aligned.values).toEqual([10, 20, 30, 40]);
    expect(aligned.missingDays).toBe(2);
    expect(aligned.longestGapDays).toBe(2);
  });
});

describe('movingAverage', () => {
  it('smooths with a centred window and keeps the series length', () => {
    const smoothed = movingAverage([0, 0, 0, 70, 0, 0, 0], 7);

    expect(smoothed).toHaveLength(7);
    expect(smoothed[3]).toBeCloseTo(10, 6);
    expect(Math.max(...smoothed)).toBeLessThan(70);
  });
});

describe('toShare', () => {
  it('expresses views as a share of that day of edition traffic, in per-million', () => {
    const series: DailyPoint[] = [{ date: '2024-01-01', views: 500 }];
    const totals: DailyPoint[] = [{ date: '2024-01-01', views: 5_000_000 }];

    expect(toShare(series, totals)[0]).toEqual({ date: '2024-01-01', raw: 500, total: 5_000_000, perMillion: 100 });
  });

  it('leaves the day empty when the edition total is missing or zero', () => {
    const series: DailyPoint[] = [
      { date: '2024-01-01', views: 5 },
      { date: '2024-01-02', views: 5 },
    ];
    const totals: DailyPoint[] = [{ date: '2024-01-02', views: 0 }];

    expect(toShare(series, totals).map((point) => point.perMillion)).toEqual([null, null]);
  });
});

describe('normalizeSeries', () => {
  it('normalises against edition traffic when the totals cover the range', () => {
    const series = daily('2024-01-01', [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    const totals = daily('2024-01-01', new Array(10).fill(10_000_000));
    const result = normalizeSeries(series, totals, '2024-01-01', '2024-01-10');

    expect(result.unit).toBe('views_per_million');
    expect(result.totalsCoverage).toBe(1);
    expect(result.values[0]).toBeCloseTo(10, 6);
    expect(result.values[9]).toBeCloseTo(100, 6);
    expect(result.rawValues[9]).toBe(1000);
  });

  it('falls back to raw counts when the totals are missing', () => {
    const series = daily('2024-01-01', [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    const result = normalizeSeries(series, [], '2024-01-01', '2024-01-10');

    expect(result.unit).toBe('raw_views');
    expect(result.totalsCoverage).toBe(0);
    expect(result.values).toEqual(result.rawValues);
  });

  it('keeps the raw series next to the smoothed one', () => {
    const series = daily('2024-01-01', [10, 10, 10, 100, 10, 10, 10, 10, 10, 10]);
    const result = normalizeSeries(series, [], '2024-01-01', '2024-01-10');

    expect(result.points[3]?.raw).toBe(100);
    expect(result.points[3]?.smoothed).toBeLessThan(40);
    expect(result.points).toHaveLength(10);
  });
});
