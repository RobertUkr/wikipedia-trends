import { SkillError } from '../types.js';
import type { DailyPoint } from '../types.js';
import { DAY_MS, formatDay, parseDay } from './dates.js';
import { round } from './math.js';
import { mean } from './stats.js';

/** Moving-average window in days; the smoothed series is for charts only, never for fitting. */
export const SMOOTHING_WINDOW = 7;
/** Scale of the share of edition traffic: views per million edition views. */
export const PER_MILLION = 1_000_000;
/** Share of days with edition totals needed to use views per million; otherwise raw views are kept. */
export const MIN_TOTALS_COVERAGE = 0.9;

/** Unit of the analysed series: share of edition traffic, or raw counts when totals are missing. */
export type Unit = 'views_per_million' | 'raw_views';

/** One day's raw views, edition total and share per million (null without a total). */
export interface SharePoint {
  date: string;
  raw: number;
  total: number | null;
  perMillion: number | null;
}

/** Daily views on every date of the range, with filled flags and gap / zero-day counts. */
export interface AlignedSeries {
  dates: string[];
  values: number[];
  filled: boolean[];
  missingDays: number;
  longestGapDays: number;
  leadingGapDays: number;
  trailingGapDays: number;
  zeroDays: number;
}

/** One day of the output series: raw, share, analysed value, chart smoothing and whether it was filled. */
export interface NormalizedPoint {
  date: string;
  raw: number;
  perMillion: number | null;
  value: number;
  smoothed: number;
  filled: boolean;
}

/** Daily series ready for analysis, in per-million or raw units, with gap and coverage diagnostics. */
export interface NormalizedSeries {
  unit: Unit;
  dates: string[];
  values: number[];
  points: NormalizedPoint[];
  rawValues: number[];
  missingDays: number;
  longestGapDays: number;
  leadingGapDays: number;
  trailingGapDays: number;
  zeroDays: number;
  totalsCoverage: number;
}

/** Every UTC calendar date from `from` to `to` inclusive, as YYYY-MM-DD. */
export function enumerateDates(from: string, to: string): string[] {
  const start = parseDay(from);
  const end = parseDay(to);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new SkillError('InvalidInput', `Cannot enumerate dates between "${from}" and "${to}"`, { from, to });
  }

  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    dates.push(formatDay(cursor));
  }

  return dates;
}

/** Fills nulls linearly between known neighbours; edge nulls take the nearest known value. */
export function interpolate(values: Array<number | null>): { values: number[]; filled: boolean[] } {
  const filled = values.map((value) => value === null);
  const known = values.map((value, index) => (value === null ? -1 : index)).filter((index) => index >= 0);

  // Nothing to interpolate from.
  if (known.length === 0) {
    return { values: values.map(() => 0), filled };
  }

  // One forward pass: `before` is the last known index seen, `known[next]` the first known index ahead.
  let before: number | undefined;
  let next = 0;

  const result = values.map((value, index) => {
    if (value !== null) {
      before = index;
      next += 1;

      return value;
    }

    const after = known[next];

    if (before === undefined) {
      return values[after as number] as number;
    }

    if (after === undefined) {
      return values[before] as number;
    }

    const low = values[before] as number;
    const high = values[after] as number;
    const weight = (index - before) / (after - before);

    return low + (high - low) * weight;
  });

  return { values: result, filled };
}

/** Sums daily views per date across series, e.g. an article's title windows, sorted by date. */
export function mergeSeries(lists: DailyPoint[][]): DailyPoint[] {
  const sums = new Map<string, number>();

  for (const list of lists) {
    for (const point of list) {
      sums.set(point.date, (sums.get(point.date) ?? 0) + point.views);
    }
  }

  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, views]) => ({ date, views }));
}

/** Places views on every date of the range, separating edge gaps, unknown days and zero-view days. */
export function alignToRange(
  points: DailyPoint[],
  from: string,
  to: string,
  unknown: ReadonlySet<string> = new Set(),
): AlignedSeries {
  const dates = enumerateDates(from, to);
  const known = new Map(points.map((point) => [point.date, point.views]));
  const filled = dates.map((date) => !known.has(date));
  const firstKnown = filled.indexOf(false);
  const lastKnown = filled.lastIndexOf(false);
  const leadingGapDays = firstKnown === -1 ? dates.length : firstKnown;
  const trailingGapDays = lastKnown === -1 ? 0 : dates.length - 1 - lastKnown;
  const inside = (index: number) => index >= leadingGapDays && index < dates.length - trailingGapDays;
  // Inside days for a title the API has no data for are missing, not zero.
  const lost = dates.map((date, index) => inside(index) && filled[index] === true && unknown.has(date));
  // Other inside days the API omits had no views. Edge gaps stay null and take the nearest known value,
  // so a late-created article does not look like growth from nothing.
  const values = interpolate(
    dates.map((date, index) => known.get(date) ?? (inside(index) && !lost[index] ? 0 : null)),
  ).values;
  const absent = filled.filter(Boolean).length;
  const lostDays = lost.filter(Boolean).length;
  let longestLost = 0;
  let run = 0;

  for (const flag of lost) {
    run = flag ? run + 1 : 0;
    longestLost = Math.max(longestLost, run);
  }

  return {
    dates,
    values,
    filled,
    missingDays: leadingGapDays + trailingGapDays + lostDays,
    longestGapDays: Math.max(leadingGapDays, trailingGapDays, longestLost),
    leadingGapDays,
    trailingGapDays,
    zeroDays: absent - leadingGapDays - trailingGapDays - lostDays,
  };
}

/** Centred moving average, shrinking at the edges; for charts only, since smoothing narrows intervals. */
export function movingAverage(values: number[], window: number = SMOOTHING_WINDOW): number[] {
  const half = Math.floor(window / 2);

  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + half + 1);

    return mean(values.slice(start, end));
  });
}

/** Series summed into whole weeks, with each week's start date and the days used or dropped. */
export interface WeeklySeries {
  values: number[];
  dates: string[];
  weeks: number;
  daysUsed: number;
  daysDropped: number;
}

/** Weekly sums for trend fitting: daily views are autocorrelated and would make intervals too narrow. */
export function aggregateWeekly(values: number[], dates: string[]): WeeklySeries {
  if (values.length !== dates.length) {
    throw new SkillError('InvalidInput', 'values and dates must have the same length', {
      values: values.length,
      dates: dates.length,
    });
  }

  // Only whole weeks from the start of the range; a trailing partial week is dropped rather than under-counted.
  const weeks = Math.floor(values.length / 7);
  const weekly: number[] = [];
  const weekDates: string[] = [];

  for (let week = 0; week < weeks; week += 1) {
    const start = week * 7;
    const slice = values.slice(start, start + 7);

    weekly.push(slice.reduce((sum, value) => sum + value, 0));
    weekDates.push(dates[start] as string);
  }

  return {
    values: weekly,
    dates: weekDates,
    weeks,
    daysUsed: weeks * 7,
    daysDropped: values.length - weeks * 7,
  };
}

/** Divides each day's views by the edition's total that day, giving views per million. */
export function toShare(series: DailyPoint[], projectTotals: DailyPoint[]): SharePoint[] {
  const totals = new Map(projectTotals.map((point) => [point.date, point.views]));

  return series.map((point) => {
    const total = totals.get(point.date) ?? null;
    const perMillion = total !== null && total > 0 ? (point.views / total) * PER_MILLION : null;

    return {
      date: point.date,
      raw: point.views,
      total,
      perMillion: perMillion === null ? null : round(perMillion, 3),
    };
  });
}

/** Aligns, normalises to views per million when totals cover enough days, and smooths a daily series. */
export function normalizeSeries(
  points: DailyPoint[],
  projectTotals: DailyPoint[],
  from: string,
  to: string,
  unknown: ReadonlySet<string> = new Set(),
): NormalizedSeries {
  const aligned = alignToRange(points, from, to, unknown);
  const asDaily: DailyPoint[] = aligned.dates.map((date, index) => ({
    date,
    views: aligned.values[index] as number,
  }));

  const shares = toShare(asDaily, projectTotals);
  const covered = shares.filter((share) => share.perMillion !== null).length;
  const totalsCoverage = shares.length === 0 ? 0 : covered / shares.length;
  const useShare = totalsCoverage >= MIN_TOTALS_COVERAGE;
  const unit: Unit = useShare ? 'views_per_million' : 'raw_views';

  const values = useShare
    // Days without an edition total are interpolated from neighbouring shares.
    ? interpolate(shares.map((share) => share.perMillion)).values
    : aligned.values;

  const smoothed = movingAverage(values);
  const pointsOut: NormalizedPoint[] = aligned.dates.map((date, index) => ({
    date,
    raw: aligned.values[index] as number,
    perMillion: shares[index]?.perMillion ?? null,
    value: values[index] as number,
    smoothed: round(smoothed[index] as number, 3),
    filled: aligned.filled[index] === true,
  }));

  return {
    unit,
    dates: aligned.dates,
    values,
    points: pointsOut,
    rawValues: aligned.values,
    missingDays: aligned.missingDays,
    longestGapDays: aligned.longestGapDays,
    leadingGapDays: aligned.leadingGapDays,
    trailingGapDays: aligned.trailingGapDays,
    zeroDays: aligned.zeroDays,
    totalsCoverage: round(totalsCoverage, 3),
  };
}
