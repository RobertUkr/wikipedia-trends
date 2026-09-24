import { SkillError } from '../types.js';
import type { DailyPoint } from '../types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SMOOTHING_WINDOW = 7;
export const PER_MILLION = 1_000_000;
export const MIN_TOTALS_COVERAGE = 0.9;

export type Unit = 'views_per_million' | 'raw_views';

export interface SharePoint {
  date: string;
  raw: number;
  total: number | null;
  perMillion: number | null;
}

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

export interface NormalizedPoint {
  date: string;
  raw: number;
  perMillion: number | null;
  value: number;
  smoothed: number;
  filled: boolean;
}

export interface NormalizedSeries {
  unit: Unit;
  dates: string[];
  values: number[];
  smoothed: number[];
  points: NormalizedPoint[];
  rawValues: number[];
  missingDays: number;
  longestGapDays: number;
  leadingGapDays: number;
  trailingGapDays: number;
  zeroDays: number;
  filledDays: number;
  totalsCoverage: number;
}

export function enumerateDates(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new SkillError('InvalidInput', `Cannot enumerate dates between "${from}" and "${to}"`, { from, to });
  }

  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }

  return dates;
}

export function interpolate(values: Array<number | null>): { values: number[]; filled: boolean[] } {
  const filled = values.map((value) => value === null);
  const known = values.map((value, index) => (value === null ? -1 : index)).filter((index) => index >= 0);

  if (known.length === 0) {
    return { values: values.map(() => 0), filled };
  }

  const result = values.map((value, index) => {
    if (value !== null) {
      return value;
    }

    const before = [...known].reverse().find((candidate) => candidate < index);
    const after = known.find((candidate) => candidate > index);

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

export function mergeSeries(lists: DailyPoint[][]): DailyPoint[] {
  const sums = new Map<string, number>();

  for (const list of lists) {
    for (const point of list) {
      sums.set(point.date, (sums.get(point.date) ?? 0) + point.views);
    }
  }

  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, views]) => ({ date, views }));
}

export function alignToRange(
  points: DailyPoint[],
  from: string,
  to: string,
  unknown: ReadonlySet<string> = new Set(),
): AlignedSeries {
  const dates = enumerateDates(from, to);
  const known = new Map(points.map((point) => [point.date, point.views]));
  const filled = dates.map((date) => !known.has(date));
  const leadingGapDays = filled.indexOf(false) === -1 ? dates.length : filled.indexOf(false);
  const trailingGapDays = filled.lastIndexOf(false) === -1 ? 0 : dates.length - 1 - filled.lastIndexOf(false);
  const inside = (index: number) => index >= leadingGapDays && index < dates.length - trailingGapDays;
  const lost = dates.map((date, index) => inside(index) && !known.has(date) && unknown.has(date));
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

export function movingAverage(values: number[], window: number = SMOOTHING_WINDOW): number[] {
  const half = Math.floor(window / 2);

  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length, index + half + 1);
    const slice = values.slice(start, end);

    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export interface WeeklySeries {
  values: number[];
  dates: string[];
  weeks: number;
  daysUsed: number;
  daysDropped: number;
}

export function aggregateWeekly(values: number[], dates: string[]): WeeklySeries {
  if (values.length !== dates.length) {
    throw new SkillError('InvalidInput', 'values and dates must have the same length', {
      values: values.length,
      dates: dates.length,
    });
  }

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

export function toShare(series: DailyPoint[], projectTotals: DailyPoint[]): SharePoint[] {
  const totals = new Map(projectTotals.map((point) => [point.date, point.views]));

  return series.map((point) => {
    const total = totals.get(point.date) ?? null;
    const perMillion = total !== null && total > 0 ? (point.views / total) * PER_MILLION : null;

    return {
      date: point.date,
      raw: point.views,
      total,
      perMillion: perMillion === null ? null : Math.round(perMillion * 1000) / 1000,
    };
  });
}

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
    ? interpolate(shares.map((share) => share.perMillion)).values
    : aligned.values;

  const smoothed = movingAverage(values);
  const pointsOut: NormalizedPoint[] = aligned.dates.map((date, index) => ({
    date,
    raw: aligned.values[index] as number,
    perMillion: shares[index]?.perMillion ?? null,
    value: values[index] as number,
    smoothed: Math.round((smoothed[index] as number) * 1000) / 1000,
    filled: aligned.filled[index] === true,
  }));

  return {
    unit,
    dates: aligned.dates,
    values,
    smoothed,
    points: pointsOut,
    rawValues: aligned.values,
    missingDays: aligned.missingDays,
    longestGapDays: aligned.longestGapDays,
    leadingGapDays: aligned.leadingGapDays,
    trailingGapDays: aligned.trailingGapDays,
    zeroDays: aligned.zeroDays,
    filledDays: aligned.missingDays,
    totalsCoverage: Math.round(totalsCoverage * 1000) / 1000,
  };
}
