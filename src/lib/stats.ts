import { SkillError } from '../types.js';
import type { Message } from '../types.js';
import { message } from './messages.js';

export const MODIFIED_Z_THRESHOLD = 3.5;
export const MAD_TO_SIGMA = 0.6745;
export const Z95 = 1.959963985;
export const MAX_FIT_POINTS = 1500;
export const YEAR_DAYS = 365;
export const WEEKS_PER_YEAR = 365 / 7;
export const MIN_SEASONAL_CYCLES = 3;

export interface Point {
  x: number;
  y: number;
}

export interface TrendFit {
  slope: number;
  intercept: number;
  ci95: [number, number];
  points: number;
  pairs: number;
  sampled: boolean;
}

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

export interface YoyResult {
  changePercent: number | null;
  current: number | null;
  previous: number | null;
  windowDays: number;
  reason: Message | null;
}

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

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

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

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function mad(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const center = median(values);

  return median(values.map((value) => Math.abs(value - center)));
}

export function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const center = mean(values);
  const sum = values.reduce((acc, value) => acc + (value - center) ** 2, 0);

  return Math.sqrt(sum / (values.length - 1));
}

export function toPoints(values: number[]): Point[] {
  return values.map((y, x) => ({ x, y }));
}

function thin(points: Point[]): { points: Point[]; sampled: boolean } {
  if (points.length <= MAX_FIT_POINTS) {
    return { points, sampled: false };
  }

  const stride = Math.ceil(points.length / MAX_FIT_POINTS);

  return { points: points.filter((_, index) => index % stride === 0), sampled: true };
}

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

      if (dx !== 0) {
        slopes[count] = (b.y - a.y) / dx;
        count += 1;
      }
    }
  }

  const used = slopes.subarray(0, count).slice().sort();
  const slope = quantileSorted(used, 0.5);
  const intercept = median(points.map((point) => point.y - slope * point.x));

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

export interface TrendPercent {
  percentPerYear: number | null;
  ci95: [number, number] | null;
  baseline: number;
  baselineSource: 'intercept' | 'median' | 'none';
}

export function trendPercentPerYear(
  fit: TrendFit,
  values: number[],
  periodsPerYear: number = YEAR_DAYS,
): TrendPercent {
  const fromIntercept = fit.intercept;
  const fromMedian = median(values);

  if (fromIntercept > 0) {
    return {
      percentPerYear: round1((fit.slope * periodsPerYear * 100) / fromIntercept),
      ci95: [
        round1((fit.ci95[0] * periodsPerYear * 100) / fromIntercept),
        round1((fit.ci95[1] * periodsPerYear * 100) / fromIntercept),
      ],
      baseline: fromIntercept,
      baselineSource: 'intercept',
    };
  }

  if (fromMedian > 0) {
    return {
      percentPerYear: round1((fit.slope * periodsPerYear * 100) / fromMedian),
      ci95: [
        round1((fit.ci95[0] * periodsPerYear * 100) / fromMedian),
        round1((fit.ci95[1] * periodsPerYear * 100) / fromMedian),
      ],
      baseline: fromMedian,
      baselineSource: 'median',
    };
  }

  return { percentPerYear: null, ci95: null, baseline: 0, baselineSource: 'none' };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function detectOutliers(values: number[], threshold: number = MODIFIED_Z_THRESHOLD): number[] {
  if (values.length < 3) {
    return [];
  }

  const center = median(values);
  let scale = mad(values);

  if (scale === 0) {
    scale = mean(values.map((value) => Math.abs(value - center))) / MAD_TO_SIGMA;
  }

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

export function movingMedian(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);

  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + half + 1);

    return median(values.slice(start, end));
  });
}

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

  const trend = movingMedian(values, period % 2 === 0 ? period + 1 : period);
  const detrended = values.map((value, index) => value - (trend[index] ?? 0));
  const buckets: number[][] = Array.from({ length: period }, () => []);

  detrended.forEach((value, index) => {
    (buckets[index % period] as number[]).push(value);
  });

  const rawProfile = buckets.map((bucket) => (bucket.length > 0 ? mean(bucket) : 0));
  const profileCenter = mean(rawProfile);
  const profile = rawProfile.map((value) => value - profileCenter);
  const seasonal = values.map((_, index) => profile[index % period] ?? 0);
  const deseasonalized = values.map((value, index) => value - (seasonal[index] ?? 0));

  const residualBefore = values.map((value, index) => value - (trend[index] ?? 0));
  const residualAfter = deseasonalized.map((value, index) => value - (trend[index] ?? 0));
  const varBefore = stdev(residualBefore) ** 2;
  const varAfter = stdev(residualAfter) ** 2;
  const rawStrength = varBefore === 0 ? 0 : 1 - varAfter / varBefore;
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
