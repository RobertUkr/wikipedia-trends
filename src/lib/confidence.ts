import { clamp01, round } from './math.js';
import { message } from './messages.js';
import { spansZero, theilSen, toPoints, trendDirection } from './stats.js';
import type { Message } from '../types.js';

/** Median raw views/day at or below which the volume score is 0. */
export const VOLUME_FLOOR = 20;
/** Median raw views/day at which the volume score reaches 1 (log scale from the floor). */
export const VOLUME_CEILING = 500;
/** Range length for a full length score: two years, enough for year-over-year. */
export const LENGTH_TARGET_DAYS = 730;
/** Below this range length the series is flagged as too short for a trend. */
export const LENGTH_MINIMUM_DAYS = 180;
/** Share of spike days at which the outlier score reaches 0. */
export const OUTLIER_BUDGET = 0.1;
/** Gap length that suggests a rename, split or merge; caps continuity and adds a caveat. */
export const GAP_SUSPICIOUS_DAYS = 14;
/** Volume score below which LOW_VOLUME is raised and 'high' is ruled out (≈60 views/day). */
export const LOW_VOLUME_CAVEAT_AT = 0.35;
/** Length score below which 'high' is ruled out (≈255 days). */
export const SHORT_LENGTH_CAP_AT = 0.35;
/** Volume score below which the level is forced to 'low': under ≈38 views/day the counts are mostly noise. */
export const NOISE_VOLUME_AT = 0.2;
/** Highest continuity score allowed once a gap reaches GAP_SUSPICIOUS_DAYS. */
export const GAP_CONTINUITY_CAP = 0.4;
/** Weight of the missing-day share in continuity: about a third of the range missing drives it to 0. */
export const MISSING_DAY_WEIGHT = 3;

/** Weights of the five confidence components in the overall score; they sum to 1. */
export const WEIGHTS = {
  volume: 0.3,
  length: 0.25,
  stability: 0.25,
  outlierShare: 0.1,
  continuity: 0.1,
} as const;

/** Overall confidence verdict. */
export type ConfidenceLevel = 'low' | 'medium' | 'high';
/** Name of one confidence component. */
export type ComponentName = keyof typeof WEIGHTS;

/** Maps the weighted score to a level: high ≥ 0.7, medium ≥ 0.45, else low. */
export function levelFromScore(score: number): ConfidenceLevel {
  return score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low';
}

/** One component: its 0..1 score, the observed raw measure and a localisable explanation. */
export interface ConfidenceComponent {
  score: number;
  observed: number;
  detail: Message;
}

/** Absolute (raw views) and relative (share of edition) trends with their intervals. */
export interface TrendPair {
  absolutePercent: number | null;
  absoluteCi: [number, number] | null;
  relativePercent: number | null;
  relativeCi: [number, number] | null;
}

/** Whole-period vs recent trend when they point in opposite directions. */
export interface ReversalInput {
  overallPercent: number;
  recentPercent: number;
  weeks: number;
}

/** Everything the confidence assessment needs about one analysed series. */
export interface ConfidenceInput {
  values: number[];
  rawMedianViews: number;
  rangeDays: number;
  missingDays: number;
  longestGapDays: number;
  zeroDays?: number;
  formerTitles?: string[];
  outlierDays: number;
  ci95: [number, number];
  normalized: boolean;
  weeks: number;
  trends: TrendPair | null;
  reversal: ReversalInput | null;
}

/** Overall level, weighted score, per-component scores and the caveats behind them. */
export interface ConfidenceReport {
  overall: ConfidenceLevel;
  score: number;
  components: Record<ComponentName, ConfidenceComponent>;
  caveats: Message[];
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

/** Theil–Sen slopes of the two halves and three thirds, used to test whether the slope sign holds. */
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
  // Log scale: going from 20 to 50 views/day matters as much as from 200 to 500.
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
  const slopes = subsampleSlopes(values);

  if (slopes.length === 0) {
    return { score: 0, observed: 0, detail: message('DETAIL_STABILITY_TOO_SHORT') };
  }

  const agreeing = slopes.filter((slope) => sign(slope) === sign(fullSlope)).length;
  const agreement = agreeing / slopes.length;

  // With an interval spanning zero the sign is not claimed, so its instability is not penalised here.
  if (spansZero(ci95)) {
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
  const base = clamp01(1 - share * MISSING_DAY_WEIGHT);
  const score = longestGapDays >= GAP_SUSPICIOUS_DAYS ? Math.min(base, GAP_CONTINUITY_CAP) : base;

  return {
    score: round(score),
    observed: missingDays,
    detail: message('DETAIL_CONTINUITY', { missing: missingDays, longest: longestGapDays }),
  };
}

/** Five-component confidence vector and overall level for a trend, never contradicting its own caveats. */
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
  let overall = levelFromScore(score);

  // The caps below keep the level consistent with the caveats raised.
  const capsAtMedium =
    components.length.score < SHORT_LENGTH_CAP_AT ||
    components.volume.score < LOW_VOLUME_CAVEAT_AT ||
    codes.has('SLOPE_SIGN_UNSTABLE') ||
    codes.has('TREND_REVERSAL');

  if (capsAtMedium && overall === 'high') {
    overall = 'medium';
  }

  // Noise-level volume overrides whatever the other components say.
  if (components.volume.score < NOISE_VOLUME_AT) {
    overall = 'low';
  }

  return { overall, score, components, caveats };
}

/** Caveats explaining the limits of the result, as localisable { code, params } messages. */
export function buildCaveats(
  input: ConfidenceInput,
  components: Record<ComponentName, ConfidenceComponent>,
): Message[] {
  const caveats: Message[] = [];
  const includesZero = spansZero(input.ci95);
  const { formerTitles = [], zeroDays = 0 } = input;

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

  // The relative trend is the measure of interest; fall back to the absolute one when shares are unavailable.
  const primaryCi = input.trends ? (input.trends.relativeCi ?? input.trends.absoluteCi) : null;
  const inconclusive = primaryCi ? trendDirection(primaryCi) === 'inconclusive' : includesZero;

  if (includesZero) {
    // A 'flat' interval also spans zero but is a conclusion, so it gets no caveat.
    if (inconclusive) {
      caveats.push(message('INTERVAL_SPANS_ZERO'));
    }
  } else if (components.stability.score < 1 && components.stability.detail.code === 'DETAIL_STABILITY') {
    const { agreeing, total } = components.stability.detail.params as { agreeing: number; total: number };
    caveats.push(message('SLOPE_SIGN_UNSTABLE', { flipped: total - agreeing, total }));
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

  const absoluteDirection = trendDirection(input.trends?.absoluteCi ?? null);
  const relativeDirection = trendDirection(input.trends?.relativeCi ?? null);

  if (
    input.trends &&
    input.trends.relativePercent !== null &&
    input.trends.absolutePercent !== null &&
    absoluteDirection !== relativeDirection
  ) {
    // Raw views falling while the share holds means the edition shrinks, not interest in the topic.
    const absoluteFalling = absoluteDirection === 'down';
    const relativeHolding = relativeDirection === 'flat';
    const code = absoluteFalling && relativeHolding ? 'EDITION_TRAFFIC_DECLINING' : 'ABSOLUTE_VS_RELATIVE';

    caveats.push(
      message(code, { absolute: input.trends.absolutePercent, relative: input.trends.relativePercent }),
    );
    caveats.push(message('TWO_TRENDS_EXPLAINED'));
  }

  if (input.outlierDays > 0) {
    caveats.push(message('SPIKES_EXCLUDED', { days: input.outlierDays }));
  }

  if (input.longestGapDays >= GAP_SUSPICIOUS_DAYS) {
    caveats.push(message('LONG_GAP_POSSIBLE_RENAME', { days: input.longestGapDays }));
  }

  if (formerTitles.length > 1) {
    caveats.push(message('TITLE_HISTORY_MERGED', { titles: formerTitles.join(' → ') }));
  }

  if (zeroDays > 0) {
    caveats.push(message('ZERO_VIEW_DAYS', { days: zeroDays }));
  }

  if (!input.normalized) {
    caveats.push(message('RAW_COUNTS_NOT_COMPARABLE'));
  }

  caveats.push(message('WEEKLY_AGGREGATION', { weeks: input.weeks, days: input.rangeDays }));

  return caveats;
}
