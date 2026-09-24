import { SkillError } from '../types.js';
import type { Message } from '../types.js';
import { message } from './messages.js';

/** Modified z-score above which a day's residual counts as a spike (Iglewicz–Hoaglin 3.5). */
export const MODIFIED_Z_THRESHOLD = 3.5;
/** Normal quantile at 0.75: scales MAD to a standard-deviation equivalent in the modified z-score. */
export const MAD_TO_SIGMA = 0.6745;
/** Two-sided 95% normal critical value. */
export const Z95 = 1.959963985;
/** Cap on Theil–Sen input size; pairwise slopes grow as n², so longer series are thinned. */
export const MAX_FIT_POINTS = 1500;
/** Days per year: daily periods-per-year, seasonal period and year-over-year window. */
export const YEAR_DAYS = 365;
/** Weekly periods per year (≈52.14), used to annualise slopes fitted on weekly sums. */
export const WEEKS_PER_YEAR = 365 / 7;
/** Full yearly cycles required before seasonality is estimated. */
export const MIN_SEASONAL_CYCLES = 3;

/** One (x, y) observation; x is the day or week index. */
export interface Point {
  x: number;
  y: number;
}

/** Theil–Sen line with its 95% slope interval, point and pair counts, and whether input was thinned. */
export interface TrendFit {
  slope: number;
  intercept: number;
  ci95: [number, number];
  points: number;
  pairs: number;
  sampled: boolean;
}

/** Yearly seasonal profile, its bias-corrected strength and the deseasonalised series. */
export interface SeasonalityResult {
  available: boolean;
  reason: Message | null;
  period: number;
  cyclesAvailable: number;
  strength: number;
  seasonal: number[];
  deseasonalized: number[];
  detected: boolean;
}

/** Year-over-year change of the median over the last 365 days vs the 365 before. */
export interface YoyResult {
  changePercent: number | null;
  current: number | null;
  previous: number | null;
  windowDays: number;
  reason: Message | null;
}

/** Descriptive statistics of a series: median, mean, p10/p90, coefficient of variation, min/max. */
export interface Summary {
  n: number;
  median: number;
  mean: number;
  p10: number;
  p90: number;
  cv: number;
  min: number;
  max: number;
}

/** Arithmetic mean; 0 for an empty series. */
export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Linearly interpolated q-quantile (0..1); 0 for an empty series. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;

  if (lower === upper) {
    return low;
  }

  const high = sorted[upper] ?? low;

  return low + (high - low) * (position - lower);
}

/** Median; the robust centre used throughout instead of the mean. */
export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Median absolute deviation from the median, the robust spread behind spike detection. */
export function mad(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const center = median(values);

  return median(values.map((value) => Math.abs(value - center)));
}

/** Sample standard deviation (n − 1); 0 for fewer than 2 values. */
export function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const center = mean(values);
  const sum = values.reduce((acc, value) => acc + (value - center) ** 2, 0);

  return Math.sqrt(sum / (values.length - 1));
}

/** Turns a series into points indexed by position, so the slope is per day or per week. */
export function toPoints(values: number[]): Point[] {
  return values.map((y, x) => ({ x, y }));
}

function thin(points: Point[]): { points: Point[]; sampled: boolean } {
  if (points.length <= MAX_FIT_POINTS) {
    return { points, sampled: false };
  }

  // Keep every k-th point so the thinned series still spans the whole range evenly.
  const stride = Math.ceil(points.length / MAX_FIT_POINTS);

  return { points: points.filter((_, index) => index % stride === 0), sampled: true };
}

/** Theil–Sen slope (median of pairwise slopes) with a 95% interval, robust to spikes. */
export function theilSen(input: Point[]): TrendFit {
  const { points, sampled } = thin(input);
  const n = points.length;

  if (n < 3) {
    throw new SkillError('InvalidInput', `Theil-Sen needs at least 3 points, got ${n}`, { points: n });
  }

  const slopes = new Float64Array((n * (n - 1)) / 2);
  let count = 0;

  for (let i = 0; i < n; i += 1) {
    const a = points[i] as Point;

    for (let j = i + 1; j < n; j += 1) {
      const b = points[j] as Point;
      const dx = b.x - a.x;

      // Pairs with equal x have no defined slope and are skipped.
      if (dx !== 0) {
        slopes[count] = (b.y - a.y) / dx;
        count += 1;
      }
    }
  }

  // Typed-array sort is numeric, unlike the default Array#sort.
  const used = slopes.subarray(0, count).slice().sort();
  const slope = quantileSorted(used, 0.5);
  const intercept = median(points.map((point) => point.y - slope * point.x));

  // Variance of Kendall's S (no ties); the interval bounds are ranks of the sorted pairwise slopes (Sen 1968).
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const spread = Z95 * Math.sqrt(varS);
  const lowerIndex = clampIndex(Math.floor((count - spread) / 2), count);
  const upperIndex = clampIndex(Math.ceil((count + spread) / 2) - 1, count);

  return {
    slope,
    intercept,
    ci95: [used[lowerIndex] ?? slope, used[upperIndex] ?? slope],
    points: n,
    pairs: count,
    sampled,
  };
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}

function quantileSorted(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;

  if (lower === upper) {
    return low;
  }

  const high = sorted[upper] ?? low;

  return low + (high - low) * (position - lower);
}

/** Trend verdict derived from the 95% interval, not from the point estimate. */
export type Direction = 'up' | 'down' | 'flat' | 'inconclusive';

/** ±%/year band: an interval spanning zero but within it is 'flat', a wider one 'inconclusive'. */
export const FLAT_BAND_PERCENT = 5;

/** Compound %/year trend with its 95% interval, direction and the fitted baseline level. */
export interface TrendPercent {
  percentPerYear: number | null;
  ci95: [number, number] | null;
  direction: Direction;
  baseline: number;
  baselineSource: 'intercept' | 'median' | 'none';
}

export function trendDirection(ci95: [number, number] | null): Direction {
  if (ci95 === null) {
    return 'inconclusive';
  }

  const [low, high] = ci95;

  if (low > 0) {
    return 'up';
  }

  if (high < 0) {
    return 'down';
  }

  if (low >= -FLAT_BAND_PERCENT && high <= FLAT_BAND_PERCENT) {
    return 'flat';
  }

  return 'inconclusive';
}

/** Offset added before taking logs: 0 if all values are positive, else half the smallest positive; null if too few positives. */
export function logOffset(values: number[]): number | null {
  const positive = values.filter((value) => value > 0);

  if (positive.length < 3) {
    return null;
  }

  if (positive.length === values.length) {
    return 0;
  }

  return Math.min(...positive) / 2;
}

/** Converts a log-slope per period into a compound %/year, which can never fall below −100%. */
export function compoundPercent(logSlope: number, periodsPerYear: number): number {
  return (Math.exp(logSlope * periodsPerYear) - 1) * 100;
}

/** Compound %/year trend from a Theil–Sen fit on log values; pass WEEKS_PER_YEAR for weekly series. */
export function trendPercentPerYear(values: number[], periodsPerYear: number = YEAR_DAYS): TrendPercent {
  const offset = logOffset(values);

  if (offset === null) {
    return { percentPerYear: null, ci95: null, direction: 'inconclusive', baseline: 0, baselineSource: 'none' };
  }

  const logFit = theilSen(toPoints(values.map((value) => Math.log(Math.max(value, 0) + offset))));
  // Unrounded bounds decide the direction so rounding cannot flip a bound across zero or the flat band.
  const exact: [number, number] = [
    compoundPercent(logFit.ci95[0], periodsPerYear),
    compoundPercent(logFit.ci95[1], periodsPerYear),
  ];

  return {
    percentPerYear: round1(compoundPercent(logFit.slope, periodsPerYear)),
    ci95: [round1(exact[0]), round1(exact[1])],
    direction: trendDirection(exact),
    // Back-transforms the intercept to the original scale: the fitted level at the first point.
    baseline: Math.exp(logFit.intercept) - offset,
    baselineSource: 'intercept',
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Indices of spike values by modified z-score (median and MAD), so news events do not become trends. */
export function detectOutliers(values: number[], threshold: number = MODIFIED_Z_THRESHOLD): number[] {
  if (values.length < 3) {
    return [];
  }

  const center = median(values);
  let scale = mad(values);

  // MAD is 0 when over half the values are equal (e.g. many zero days); fall back to the mean absolute deviation.
  if (scale === 0) {
    scale = mean(values.map((value) => Math.abs(value - center))) / MAD_TO_SIGMA;
  }

  // A constant series has no spikes.
  if (scale === 0) {
    return [];
  }

  const indices: number[] = [];

  values.forEach((value, index) => {
    const score = Math.abs((MAD_TO_SIGMA * (value - center)) / scale);

    if (score > threshold) {
      indices.push(index);
    }
  });

  return indices;
}

/** Centred moving median, shrinking at the edges; the robust trend line for seasonality. */
export function movingMedian(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);

  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + half + 1);

    return median(values.slice(start, end));
  });
}

/** Yearly seasonal profile (moving-median trend, mean detrended value per day of year) and its strength. */
export function seasonality(values: number[], period: number = YEAR_DAYS): SeasonalityResult {
  const cyclesAvailable = Math.round((values.length / period) * 100) / 100;

  if (cyclesAvailable < MIN_SEASONAL_CYCLES) {
    return {
      available: false,
      reason: message('INSUFFICIENT_CYCLES', { required: MIN_SEASONAL_CYCLES, cyclesAvailable }),
      period,
      cyclesAvailable,
      strength: 0,
      seasonal: values.map(() => 0),
      deseasonalized: [...values],
      detected: false,
    };
  }

  // An odd window keeps the moving median centred on each day.
  const trend = movingMedian(values, period % 2 === 0 ? period + 1 : period);
  const detrended = values.map((value, index) => value - (trend[index] ?? 0));
  const buckets: number[][] = Array.from({ length: period }, () => []);

  detrended.forEach((value, index) => {
    (buckets[index % period] as number[]).push(value);
  });

  const rawProfile = buckets.map((bucket) => (bucket.length > 0 ? mean(bucket) : 0));
  // Centre the profile so it only redistributes views across the year and does not shift the level.
  const profileCenter = mean(rawProfile);
  const profile = rawProfile.map((value) => value - profileCenter);
  const seasonal = values.map((_, index) => profile[index % period] ?? 0);
  const deseasonalized = values.map((value, index) => value - (seasonal[index] ?? 0));

  const residualBefore = values.map((value, index) => value - (trend[index] ?? 0));
  const residualAfter = deseasonalized.map((value, index) => value - (trend[index] ?? 0));
  const varBefore = stdev(residualBefore) ** 2;
  const varAfter = stdev(residualAfter) ** 2;
  const rawStrength = varBefore === 0 ? 0 : 1 - varAfter / varBefore;
  // A profile with one free value per period removes about period/n of the variance even from noise; discount that.
  const byChance = Math.min(0.99, period / values.length);
  const strength = Math.max(0, Math.min(1, (rawStrength - byChance) / (1 - byChance)));

  return {
    available: true,
    reason: null,
    period,
    cyclesAvailable,
    strength: Math.round(strength * 1000) / 1000,
    seasonal,
    deseasonalized,
    detected: strength >= 0.3,
  };
}

/** Percent change of the median of the last 365 days vs the previous 365; needs 730 days. */
export function yoyChange(values: number[], dates: string[]): YoyResult {
  const n = values.length;

  if (n < 2 * YEAR_DAYS) {
    return {
      changePercent: null,
      current: null,
      previous: null,
      windowDays: YEAR_DAYS,
      reason: message('YOY_TOO_SHORT', { required: 2 * YEAR_DAYS, days: n }),
    };
  }

  if (dates.length !== n) {
    throw new SkillError('InvalidInput', 'values and dates must have the same length', {
      values: n,
      dates: dates.length,
    });
  }

  const current = median(values.slice(n - YEAR_DAYS));
  const previous = median(values.slice(n - 2 * YEAR_DAYS, n - YEAR_DAYS));

  // A zero previous-year median has no meaningful percent change.
  if (previous === 0) {
    return {
      changePercent: null,
      current,
      previous,
      windowDays: YEAR_DAYS,
      reason: message('YOY_ZERO_BASE'),
    };
  }

  return {
    changePercent: Math.round(((current - previous) / previous) * 1000) / 10,
    current,
    previous,
    windowDays: YEAR_DAYS,
    reason: null,
  };
}

/** Descriptive summary of a series for the output. */
export function summarize(values: number[]): Summary {
  const average = mean(values);

  return {
    n: values.length,
    median: median(values),
    mean: average,
    p10: quantile(values, 0.1),
    p90: quantile(values, 0.9),
    cv: average === 0 ? 0 : stdev(values) / average,
    min: values.length > 0 ? Math.min(...values) : 0,
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}
