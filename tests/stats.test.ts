import { describe, expect, it } from 'vitest';
import { aggregateWeekly } from '../src/lib/normalize.js';
import {
  spansZero,
  FLAT_BAND_PERCENT,
  WEEKS_PER_YEAR,
  detectOutliers,
  mad,
  median,
  movingMedian,
  seasonality,
  stdev,
  summarize,
  theilSen,
  toPoints,
  trendDirection,
  trendPercentPerYear,
  yoyChange,
} from '../src/lib/stats.js';

function mulberry32(seed: number): () => number {
  let state = seed;

  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number, sigma: number): number {
  const u = Math.max(random(), 1e-12);
  const v = random();

  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

function noisy(length: number, level: (index: number) => number, sigma: number, seed = 42): number[] {
  const random = mulberry32(seed);

  return Array.from({ length }, (_, index) => Math.max(0, level(index) + gaussian(random, sigma)));
}

function isoDates(length: number, start = '2023-09-01'): string[] {
  const begin = Date.parse(`${start}T00:00:00Z`);

  return Array.from({ length }, (_, index) => new Date(begin + index * 86400000).toISOString().slice(0, 10));
}

describe('descriptive statistics', () => {
  it('computes median, quantiles and spread', () => {
    const result = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    expect(result).toMatchObject({ n: 10, median: 5.5, mean: 5.5, min: 1, max: 10 });
    expect(result.p10).toBeCloseTo(1.9, 6);
    expect(result.p90).toBeCloseTo(9.1, 6);
    expect(result.cv).toBeCloseTo(stdev([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) / 5.5, 6);
  });

  it('uses the median absolute deviation, not the standard deviation', () => {
    const withSpike = [10, 10, 10, 10, 10, 1000];

    expect(median(withSpike)).toBe(10);
    expect(mad(withSpike)).toBe(0);
    expect(stdev(withSpike)).toBeGreaterThan(300);
  });

  it('smooths with a centred moving median', () => {
    expect(movingMedian([1, 1, 50, 1, 1], 3)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('theilSen', () => {
  it('recovers a known +10%/year growth from a noisy series', () => {
    const values = noisy(730, (index) => 100 + (10 * index) / 365, 3);
    const trend = trendPercentPerYear(values);

    expect(trend.percentPerYear).toBeGreaterThan(8.5);
    expect(trend.percentPerYear).toBeLessThan(11.5);
    expect(trend.baselineSource).toBe('intercept');
  });

  it('finds no trend in a flat series: the interval contains zero', () => {
    const values = noisy(730, () => 100, 8);
    const fit = theilSen(toPoints(values));

    expect(fit.ci95[0]).toBeLessThanOrEqual(0);
    expect(fit.ci95[1]).toBeGreaterThanOrEqual(0);
    expect(Math.abs(trendPercentPerYear(values).percentPerYear ?? 0)).toBeLessThan(2);
  });

  it('reports a falling series as negative, not as growth', () => {
    const values = noisy(730, (index) => 200 - (40 * index) / 365, 4);
    const fit = theilSen(toPoints(values));
    const trend = trendPercentPerYear(values);

    expect(fit.slope).toBeLessThan(0);
    expect(trend.percentPerYear).toBeLessThan(-15);
    expect(trend.ci95?.[1]).toBeLessThan(0);
  });

  it('never reports a decline steeper than -100%/year, even when a linear fit would cross zero', () => {
    const values = Array.from({ length: 35 }, (_, week) => 20 * Math.exp(-0.06 * week));
    const linear = theilSen(toPoints(values));
    const trend = trendPercentPerYear(values, WEEKS_PER_YEAR);

    expect((linear.slope * WEEKS_PER_YEAR * 100) / linear.intercept).toBeLessThan(-100);
    expect(trend.percentPerYear).toBeGreaterThan(-100);
    expect(trend.percentPerYear).toBeCloseTo((Math.exp(-0.06 * WEEKS_PER_YEAR) - 1) * 100, 0);
    expect(trend.direction).toBe('down');
  });

  it('reads weeks with zero views without failing the log fit', () => {
    const values = [4, 0, 3, 5, 0, 2, 1, 0, 1, 0, 1, 0];
    const trend = trendPercentPerYear(values, WEEKS_PER_YEAR);

    expect(trend.percentPerYear).not.toBeNull();
    expect(trend.percentPerYear).toBeGreaterThan(-100);
  });

  it('gives no percent when fewer than three periods have views', () => {
    expect(trendPercentPerYear([0, 0, 5, 0, 1, 0]).percentPerYear).toBeNull();
  });

  it('keeps the same up/down verdict as a linear fit, because a log keeps every pairwise sign', () => {
    const series = [
      noisy(104, (week) => 50 + week * 0.4, 6, 3),
      noisy(104, (week) => 80 - week * 0.3, 9, 5),
      noisy(104, () => 60, 10, 9),
    ];

    for (const values of series) {
      const linear = theilSen(toPoints(values)).ci95;
      const linearVerdict = linear[0] > 0 ? 'up' : linear[1] < 0 ? 'down' : 'spans';
      const { direction } = trendPercentPerYear(values, WEEKS_PER_YEAR);
      const logVerdict = direction === 'up' || direction === 'down' ? direction : 'spans';

      expect(logVerdict).toBe(linearVerdict);
    }
  });

  it('is unmoved by a spike that would drag an ordinary least squares fit', () => {
    const clean = noisy(400, () => 100, 5, 7);
    const spiked = clean.map((value, index) => (index >= 380 ? value * 40 : value));
    const fit = theilSen(toPoints(spiked));

    expect(Math.abs(fit.slope)).toBeLessThan(0.05);
  });

  it('rejects a series that is too short to fit', () => {
    expect(() => theilSen(toPoints([1, 2]))).toThrow(/at least 3 points/);
  });
});

describe('detectOutliers', () => {
  it('finds exactly the spiked days and leaves the trend flat once they are removed', () => {
    const base = noisy(300, () => 100, 6, 11);
    const spikeDays = [120, 121, 122, 123, 124];
    const values = base.map((value, index) => (spikeDays.includes(index) ? value * 10 : value));

    expect(detectOutliers(values)).toEqual(spikeDays);

    const cleaned = values.filter((_, index) => !spikeDays.includes(index));
    const fit = theilSen(toPoints(cleaned));

    expect(fit.ci95[0]).toBeLessThanOrEqual(0);
    expect(fit.ci95[1]).toBeGreaterThanOrEqual(0);
  });

  it('returns nothing for a series without spikes', () => {
    expect(detectOutliers(noisy(200, () => 100, 5, 3))).toEqual([]);
  });

  it('survives a constant series', () => {
    expect(detectOutliers([5, 5, 5, 5, 5])).toEqual([]);
  });
});

describe('seasonality', () => {
  it('extracts a yearly cycle and flattens the deseasonalised series', () => {
    const period = 365;
    const values = noisy(3 * period, (index) => 100 + 20 * Math.sin((2 * Math.PI * index) / period), 2, 5);
    const result = seasonality(values, period);

    expect(result.detected).toBe(true);
    expect(result.strength).toBeGreaterThan(0.7);
    expect(stdev(result.deseasonalized)).toBeLessThan(stdev(values) / 2.5);
    expect(stdev(result.deseasonalized)).toBeLessThan(7);
    expect(Math.max(...result.seasonal)).toBeGreaterThan(15);
  });

  it('refuses to report seasonality below three full cycles', () => {
    const result = seasonality(noisy(730, () => 100, 5), 365);

    expect(result.available).toBe(false);
    expect(result.reason?.code).toBe('INSUFFICIENT_CYCLES');
    expect(result.reason?.params).toEqual({ required: 3, cyclesAvailable: 2 });
    expect(result.cyclesAvailable).toBe(2);
    expect(result.detected).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.deseasonalized).toEqual(noisy(730, () => 100, 5));
  });

  it('refuses even when a strong cycle is visibly present but unidentifiable', () => {
    const twoCycles = noisy(730, (index) => 100 + 20 * Math.sin((2 * Math.PI * index) / 365), 2, 5);
    const result = seasonality(twoCycles, 365);

    expect(result.available).toBe(false);
    expect(result.strength).toBe(0);
  });

  it('does not invent a cycle in a flat series', () => {
    const result = seasonality(noisy(3 * 365, () => 100, 5, 9), 365);

    expect(result.strength).toBeLessThan(0.1);
    expect(result.detected).toBe(false);
  });

  it('discounts the variance a seasonal profile removes by chance alone', () => {
    const noise = noisy(3 * 365, () => 100, 5, 21);
    const sine = noisy(3 * 365, (index) => 100 + 20 * Math.sin((2 * Math.PI * index) / 365), 5, 21);

    expect(seasonality(noise, 365).strength).toBe(0);
    expect(seasonality(sine, 365).strength).toBeGreaterThan(0.5);
  });
});

describe('yoyChange', () => {
  it('measures a known 20% year-over-year step', () => {
    const values = noisy(730, (index) => (index < 365 ? 100 : 120), 3, 13);
    const result = yoyChange(values, isoDates(730));

    expect(result.changePercent).toBeGreaterThan(17);
    expect(result.changePercent).toBeLessThan(23);
  });

  it('refuses to answer on less than two years', () => {
    const result = yoyChange(noisy(500, () => 100, 3), isoDates(500));

    expect(result.changePercent).toBeNull();
    expect(result.reason?.code).toBe('YOY_TOO_SHORT');
    expect(result.reason?.params).toEqual({ required: 730, days: 500 });
  });
});

function ar1(length: number, phi: number, sigma: number, level: number, seed: number): number[] {
  const random = mulberry32(seed);
  let shock = 0;

  return Array.from({ length }, () => {
    shock = phi * shock + gaussian(random, sigma);

    return Math.max(0, level + shock);
  });
}

describe('autocorrelation', () => {
  it('reports a wider interval on weekly sums than a daily fit does under AR(1) noise', () => {
    const days = 728;
    const values = ar1(days, 0.8, 8, 100, 31);
    const dates = isoDates(days);

    const daily = trendPercentPerYear(values);

    const weekly = aggregateWeekly(values, dates);
    const weeklyTrend = trendPercentPerYear(weekly.values, WEEKS_PER_YEAR);

    const dailyWidth = (daily.ci95 as [number, number])[1] - (daily.ci95 as [number, number])[0];
    const weeklyWidth = (weeklyTrend.ci95 as [number, number])[1] - (weeklyTrend.ci95 as [number, number])[0];

    expect(weekly.weeks).toBe(104);
    expect(weeklyWidth).toBeGreaterThan(dailyWidth * 1.5);
  });

  it('keeps both fits pointed at the same slope, only the uncertainty changes', () => {
    const days = 728;
    const values = ar1(days, 0.8, 8, 100, 31).map((value, index) => value + (20 * index) / 365);
    const dates = isoDates(days);

    const daily = trendPercentPerYear(values);
    const weekly = aggregateWeekly(values, dates);
    const weeklyTrend = trendPercentPerYear(weekly.values, WEEKS_PER_YEAR);

    expect(daily.percentPerYear).toBeGreaterThan(10);
    expect(weeklyTrend.percentPerYear).toBeGreaterThan(10);
    expect(Math.abs((weeklyTrend.percentPerYear ?? 0) - (daily.percentPerYear ?? 0))).toBeLessThan(4);
  });
});

describe('aggregateWeekly', () => {
  it('sums whole weeks and drops the trailing partial week', () => {
    const weekly = aggregateWeekly(new Array(17).fill(2), isoDates(17));

    expect(weekly.values).toEqual([14, 14]);
    expect(weekly.weeks).toBe(2);
    expect(weekly.daysDropped).toBe(3);
    expect(weekly.dates).toEqual(['2023-09-01', '2023-09-08']);
  });
});

describe('trendDirection', () => {
  it('calls the reviewed +6.9% [-4.6, 16] case inconclusive, not growth', () => {
    expect(trendDirection([-4.6, 16])).toBe('inconclusive');
  });

  it('reports up and down only when the interval clears zero', () => {
    expect(trendDirection([2, 8])).toBe('up');
    expect(trendDirection([-8, -2])).toBe('down');
    expect(trendDirection([0, 8])).not.toBe('up');
  });

  it('reports flat only when the interval is narrow enough to rule out a meaningful change', () => {
    expect(trendDirection([-3, 4])).toBe('flat');
    expect(trendDirection([-FLAT_BAND_PERCENT, FLAT_BAND_PERCENT])).toBe('flat');
    expect(trendDirection([-FLAT_BAND_PERCENT - 0.1, 2])).toBe('inconclusive');
  });

  it('treats a missing interval as inconclusive', () => {
    expect(trendDirection(null)).toBe('inconclusive');
  });

  it('is attached to every trend the fit produces', () => {
    const rising = noisy(730, (index) => 100 + (30 * index) / 365, 3);
    const flat = noisy(730, () => 100, 1, 8);

    expect(trendPercentPerYear(rising).direction).toBe('up');
    expect(trendPercentPerYear(flat).direction).toBe('flat');
  });
});

describe('spansZero', () => {
  it('is true only when the interval includes zero', () => {
    expect(spansZero([-1, 2])).toBe(true);
    expect(spansZero([0, 2])).toBe(true);
    expect(spansZero([0.1, 2])).toBe(false);
    expect(spansZero([-3, -0.5])).toBe(false);
  });
});
