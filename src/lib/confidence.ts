import { message } from './messages.js';
import { theilSen, toPoints, trendDirection } from './stats.js';
import type { Message } from '../types.js';

export const VOLUME_FLOOR = 20;
export const VOLUME_CEILING = 500;
export const LENGTH_TARGET_DAYS = 730;
export const LENGTH_MINIMUM_DAYS = 180;
export const OUTLIER_BUDGET = 0.1;
export const GAP_SUSPICIOUS_DAYS = 14;
export const LOW_VOLUME_CAVEAT_AT = 0.35;

export const WEIGHTS = {
  volume: 0.3,
  length: 0.25,
  stability: 0.25,
  outlierShare: 0.1,
  continuity: 0.1,
} as const;

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type ComponentName = keyof typeof WEIGHTS;

export interface ConfidenceComponent {
  score: number;
  observed: number;
  detail: Message;
}

export interface TrendPair {
  absolutePercent: number | null;
  absoluteCi: [number, number] | null;
  relativePercent: number | null;
  relativeCi: [number, number] | null;
}

export interface ReversalInput {
  overallPercent: number;
  recentPercent: number;
  weeks: number;
}

export interface ConfidenceInput {
  values: number[];
  rawMedianViews: number;
  rangeDays: number;
  missingDays: number;
  longestGapDays: number;
  outlierDays: number;
  ci95: [number, number];
  normalized: boolean;
  weeks: number;
  trends: TrendPair | null;
  reversal: ReversalInput | null;
}

export interface ConfidenceReport {
  overall: ConfidenceLevel;
  score: number;
  components: Record<ComponentName, ConfidenceComponent>;
  caveats: Message[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function sign(value: number): number {
  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}

export function subsampleSlopes(values: number[]): number[] {
  const n = values.length;
  const windows: Array<[number, number]> = [
    [0, Math.floor(n / 2)],
    [Math.floor(n / 2), n],
    [0, Math.floor(n / 3)],
    [Math.floor(n / 3), Math.floor((2 * n) / 3)],
    [Math.floor((2 * n) / 3), n],
  ];

  const slopes: number[] = [];

  for (const [start, end] of windows) {
    const slice = values.slice(start, end);

    if (slice.length < 3) {
      continue;
    }

    slopes.push(theilSen(toPoints(slice)).slope);
  }

  return slopes;
}

function volumeComponent(rawMedianViews: number): ConfidenceComponent {
  const span = Math.log10(VOLUME_CEILING) - Math.log10(VOLUME_FLOOR);
  const position = rawMedianViews <= 0 ? 0 : (Math.log10(rawMedianViews) - Math.log10(VOLUME_FLOOR)) / span;

  return {
    score: round(clamp01(position)),
    observed: round(rawMedianViews, 1),
    detail: message('DETAIL_VOLUME', {
      median: Math.round(rawMedianViews),
      floor: VOLUME_FLOOR,
      ceiling: VOLUME_CEILING,
    }),
  };
}

function lengthComponent(rangeDays: number): ConfidenceComponent {
  return {
    score: round(clamp01(rangeDays / LENGTH_TARGET_DAYS)),
    observed: rangeDays,
    detail: message('DETAIL_LENGTH', { days: rangeDays, target: LENGTH_TARGET_DAYS }),
  };
}

function stabilityComponent(values: number[], ci95: [number, number], fullSlope: number): ConfidenceComponent {
  const spansZero = ci95[0] <= 0 && ci95[1] >= 0;
  const slopes = subsampleSlopes(values);

  if (slopes.length === 0) {
    return { score: 0, observed: 0, detail: message('DETAIL_STABILITY_TOO_SHORT') };
  }

  const agreeing = slopes.filter((slope) => sign(slope) === sign(fullSlope)).length;
  const agreement = agreeing / slopes.length;

  if (spansZero) {
    return {
      score: 1,
      observed: round(agreement),
      detail: message('DETAIL_STABILITY_SPANS_ZERO'),
    };
  }

  return {
    score: round(agreement),
    observed: round(agreement),
    detail: message('DETAIL_STABILITY', { agreeing, total: slopes.length }),
  };
}

function outlierComponent(outlierDays: number, rangeDays: number): ConfidenceComponent {
  const share = rangeDays === 0 ? 0 : outlierDays / rangeDays;

  return {
    score: round(clamp01(1 - share / OUTLIER_BUDGET)),
    observed: round(share, 4),
    detail: message('DETAIL_OUTLIERS', { days: outlierDays, total: rangeDays, budget: OUTLIER_BUDGET * 100 }),
  };
}

function continuityComponent(missingDays: number, longestGapDays: number, rangeDays: number): ConfidenceComponent {
  const share = rangeDays === 0 ? 0 : missingDays / rangeDays;
  const base = clamp01(1 - share * 3);
  const score = longestGapDays >= GAP_SUSPICIOUS_DAYS ? Math.min(base, 0.4) : base;

  return {
    score: round(score),
    observed: missingDays,
    detail: message('DETAIL_CONTINUITY', { missing: missingDays, longest: longestGapDays }),
  };
}

export function assessConfidence(input: ConfidenceInput): ConfidenceReport {
  const fullSlope = input.values.length >= 3 ? theilSen(toPoints(input.values)).slope : 0;

  const components: Record<ComponentName, ConfidenceComponent> = {
    volume: volumeComponent(input.rawMedianViews),
    length: lengthComponent(input.rangeDays),
    stability: stabilityComponent(input.values, input.ci95, fullSlope),
    outlierShare: outlierComponent(input.outlierDays, input.rangeDays),
    continuity: continuityComponent(input.missingDays, input.longestGapDays, input.rangeDays),
  };

  const score = round(
    (Object.keys(WEIGHTS) as ComponentName[]).reduce(
      (sum, name) => sum + WEIGHTS[name] * components[name].score,
      0,
    ),
  );

  const caveats = buildCaveats(input, components);
  const codes = new Set(caveats.map((caveat) => caveat.code));
  let overall: ConfidenceLevel = score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low';

  if (components.length.score < 0.35 && overall === 'high') {
    overall = 'medium';
  }

  if (components.volume.score < LOW_VOLUME_CAVEAT_AT && overall === 'high') {
    overall = 'medium';
  }

  if ((codes.has('SLOPE_SIGN_UNSTABLE') || codes.has('TREND_REVERSAL')) && overall === 'high') {
    overall = 'medium';
  }

  if (components.volume.score < 0.2) {
    overall = 'low';
  }

  return { overall, score, components, caveats };
}

export function buildCaveats(
  input: ConfidenceInput,
  components: Record<ComponentName, ConfidenceComponent>,
): Message[] {
  const caveats: Message[] = [];
  const spansZero = input.ci95[0] <= 0 && input.ci95[1] >= 0;

  if (components.volume.score < LOW_VOLUME_CAVEAT_AT) {
    caveats.push(
      message('LOW_VOLUME', {
        median: Math.round(input.rawMedianViews),
        floor: VOLUME_FLOOR,
        ceiling: VOLUME_CEILING,
      }),
    );
  }

  if (input.rangeDays < LENGTH_MINIMUM_DAYS) {
    caveats.push(message('SERIES_TOO_SHORT', { days: input.rangeDays, minimum: LENGTH_MINIMUM_DAYS }));
  } else if (components.length.score < 1) {
    caveats.push(message('SERIES_SHORTER_THAN_YOY', { days: input.rangeDays, target: LENGTH_TARGET_DAYS }));
  }

  if (spansZero) {
    caveats.push(message('INTERVAL_SPANS_ZERO'));
  } else if (components.stability.score < 1) {
    const total = 5;
    caveats.push(
      message('SLOPE_SIGN_UNSTABLE', {
        flipped: Math.round((1 - components.stability.score) * total),
        total,
      }),
    );
  }

  if (input.reversal) {
    caveats.push(
      message('TREND_REVERSAL', {
        overall: input.reversal.overallPercent,
        recent: input.reversal.recentPercent,
        weeks: input.reversal.weeks,
      }),
    );
  }

  if (input.trends && input.trends.relativePercent !== null && input.trends.absolutePercent !== null) {
    const absoluteFalling = trendDirection(input.trends.absoluteCi) === 'down';
    const relativeHolding = trendDirection(input.trends.relativeCi) === 'flat';

    caveats.push(
      absoluteFalling && relativeHolding
        ? message('EDITION_TRAFFIC_DECLINING', {
            absolute: input.trends.absolutePercent,
            relative: input.trends.relativePercent,
          })
        : message('ABSOLUTE_VS_RELATIVE', {
            absolute: input.trends.absolutePercent,
            relative: input.trends.relativePercent,
          }),
    );
  }

  if (input.outlierDays > 0) {
    caveats.push(message('SPIKES_EXCLUDED', { days: input.outlierDays }));
  }

  if (input.longestGapDays >= GAP_SUSPICIOUS_DAYS) {
    caveats.push(message('LONG_GAP_POSSIBLE_RENAME', { days: input.longestGapDays }));
  } else if (input.missingDays > 0) {
    caveats.push(message('GAPS_INTERPOLATED', { days: input.missingDays }));
  }

  if (!input.normalized) {
    caveats.push(message('RAW_COUNTS_NOT_COMPARABLE'));
  }

  caveats.push(message('WEEKLY_AGGREGATION', { weeks: input.weeks, days: input.rangeDays }));

  return caveats;
}
