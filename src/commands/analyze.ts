import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { outputDir } from '../lib/cache.js';
import { assessConfidence } from '../lib/confidence.js';
import type { ConfidenceReport } from '../lib/confidence.js';
import { renderAll } from '../lib/messages.js';
import type { Locale } from '../lib/messages.js';
import { aggregateWeekly, enumerateDates, interpolate, mergeSeries, normalizeSeries } from '../lib/normalize.js';
import type { NormalizedSeries, Unit, WeeklySeries } from '../lib/normalize.js';
import {
  WEEKS_PER_YEAR,
  detectOutliers,
  median,
  seasonality,
  summarize,
  theilSen,
  toPoints,
  trendPercentPerYear,
  yoyChange,
} from '../lib/stats.js';
import type { Direction, SeasonalityResult, Summary, TrendFit, TrendPercent, YoyResult } from '../lib/stats.js';
import type { ReversalInput } from '../lib/confidence.js';
import { getSitelinks } from '../lib/wikidata.js';
import { getMovesFrom, getRedirectsTo, normalizeProject } from '../lib/wikimedia.js';
import { parseSitelinkEvent, titleWindows } from '../lib/history.js';
import type { SitelinkEvent } from '../lib/history.js';
import type { RevisionComment } from '../lib/wikidata.js';
import { ArticleNotFound, SkillError } from '../types.js';
import type { DailyPoint, Lang, Message } from '../types.js';
import { loadRevisionComments, loadSeries, loadTotals } from './fetch.js';

/** Fewest days in range for which a trend is attempted at all. */
export const MIN_ANALYSIS_DAYS = 30;
/** Version of the analyze/compare artifacts; report reuses only artifacts of this version. */
export const ARTIFACT_SCHEMA = 5;
/** Longest gap at either end of the series before the analysis refuses with ShortHistory. */
export const MAX_EDGE_GAP_DAYS = 90;
/** How many former-title candidates are checked against the move log for one rename. */
export const MAX_MOVE_LOOKUPS = 5;
/** How many days a Wikidata sitelink update may trail the actual page move. */
export const MAX_RENAME_LAG_DAYS = 30;
/** Fewest weeks in the recent window for a recent trend to be fitted. */
export const MIN_RECENT_WEEKS = 4;

/** Rounded trend of one series for artifacts and stdout: %/year with its 95% interval plus the weekly linear fit. */
export interface TrendReport {
  percentPerYear: number | null;
  ci95: [number, number] | null;
  direction: Direction;
  slopePerWeek: number;
  intercept: number;
  ci95Slope: [number, number];
  baseline: number;
  baselineSource: string;
}

function spansZero(ci: [number, number]): boolean {
  return ci[0] <= 0 && ci[1] >= 0;
}

/** Rounds a Theil-Sen fit and its %/year trend into a TrendReport. */
export function trendReport(fit: TrendFit, trend: TrendPercent): TrendReport {
  return {
    percentPerYear: trend.percentPerYear,
    ci95: trend.ci95,
    direction: trend.direction,
    slopePerWeek: Math.round(fit.slope * 1e6) / 1e6,
    intercept: Math.round(fit.intercept * 1e6) / 1e6,
    ci95Slope: [Math.round(fit.ci95[0] * 1e6) / 1e6, Math.round(fit.ci95[1] * 1e6) / 1e6],
    baseline: Math.round(trend.baseline * 1000) / 1000,
    baselineSource: trend.baselineSource,
  };
}

/** Arguments of the analyze command. */
export interface AnalyzeArgs {
  qid: string;
  lang: Lang;
  from: string;
  to: string;
  noCache: boolean;
  out: string | null;
  locale: Locale | null;
}

/** Full in-memory analysis of one language edition, shared by analyze and compare. */
export interface LanguageAnalysis {
  lang: Lang;
  project: string;
  title: string;
  unit: Unit;
  days: number;
  weekly: WeeklySeries;
  weeklyAbsolute: WeeklySeries;
  primary: 'relative' | 'absolute';
  fit: TrendFit;
  trend: TrendPercent;
  absoluteFit: TrendFit;
  absoluteTrend: TrendPercent;
  relativeTrend: TrendPercent | null;
  recentFit: TrendFit | null;
  recentTrend: TrendPercent | null;
  recentWeeks: number;
  recentFrom: string | null;
  reversal: ReversalInput | null;
  yoy: YoyResult;
  level: Summary;
  rawLevel: Summary;
  season: SeasonalityResult;
  outlierIndices: number[];
  outlierDates: string[];
  confidence: ConfidenceReport;
  series: NormalizedSeries;
  analysisValues: number[];
  totalsAvailable: boolean;
}

/** Compact stdout JSON of the analyze command; the full series goes to the artifact file. */
export interface AnalyzeOutput {
  ok: true;
  command: 'analyze';
  qid: string;
  lang: Lang;
  project: string;
  title: string;
  unit: Unit;
  range: { from: string; to: string; days: number };
  granularity: 'weekly';
  n_effective: number;
  primary: 'relative' | 'absolute';
  absoluteTrend: TrendReport;
  relativeTrend: TrendReport | null;
  recentTrend: (TrendReport & { weeks: number; from: string }) | null;
  yoy: { changePercent: number | null; current: number | null; previous: number | null; reason: Message | null };
  level: { median: number; p10: number; p90: number; cv: number; medianRawViews: number };
  seasonality: { available: boolean; detected: boolean; strength: number; cyclesAvailable: number; reason: Message | null };
  outliers: { excluded: number; share: number; dates: string[] };
  confidence: { overall: string; score: number } & Record<string, number | string>;
  caveats: Message[];
  caveatsText?: string[];
  file: string;
}

/** Trend, confidence and caveats for one edition's article, following its renames within the range. */
export async function analyzeLanguage(
  qid: string,
  lang: Lang,
  title: string,
  from: string,
  to: string,
  noCache: boolean,
): Promise<LanguageAnalysis> {
  const project = normalizeProject(lang);
  const site = `${lang.replace(/-/g, '_')}wiki`;
  // Wikidata sitelink history tells which title the article had on which day.
  const history = await loadRevisionComments(qid, from, noCache).catch(() => [] as RevisionComment[]);
  const events = history
    .map((revision) => parseSitelinkEvent(revision.comment, revision.timestamp, site))
    .filter((event): event is SitelinkEvent => event !== null);
  const firstSet = events.filter((event) => event.kind === 'set').sort((a, b) => a.at.localeCompare(b.at))[0];

  // The earliest sitelink edit falls inside the range but does not name the old title, so it is recovered from the wiki.
  if (firstSet && firstSet.previous === null && firstSet.title && firstSet.date > from) {
    const renamedAt = Date.parse(firstSet.at);
    // A move leaves the old title as a redirect: candidates are redirects to the new title, closest to the rename first.
    const redirects = (await getRedirectsTo(project, firstSet.title).catch(() => []))
      .sort((a, b) => Math.abs(Date.parse(a.lastEdited) - renamedAt) - Math.abs(Date.parse(b.lastEdited) - renamedAt))
      .map((redirect) => redirect.title);
    const seen = [...new Set([...events.map((event) => event.title), ...redirects].filter((value): value is string => !!value))];

    // The sitelink may be updated up to MAX_RENAME_LAG_DAYS after the actual move.
    const earliest = new Date(renamedAt - MAX_RENAME_LAG_DAYS * 86400000).toISOString().slice(0, 10);

    // A candidate is confirmed only by a logged move to the new title; the switch is then dated to the move itself.
    for (const candidate of seen.filter((value) => value !== firstSet.title).slice(0, MAX_MOVE_LOOKUPS)) {
      const moves = await getMovesFrom(project, candidate).catch(() => []);
      const move = moves
        .filter((item) => item.to === firstSet.title && item.date <= firstSet.date && item.date >= earliest)
        .sort((a, b) => b.date.localeCompare(a.date))[0];

      if (move) {
        firstSet.previous = candidate;
        firstSet.date = move.date;
        break;
      }
    }
  }

  // Each title is fetched only for the days it was the title of this article.
  const windows = titleWindows(events, title, from, to);
  const parts: DailyPoint[][] = [];
  const unknownDays = new Set<string>();

  for (const window of windows) {
    try {
      parts.push((await loadSeries(project, window.title, window.from, window.to, noCache)).views.points);
    } catch (error) {
      if (!(error instanceof ArticleNotFound)) {
        throw error;
      }

      // No data under a former title: these days are gaps, not zero views.
      for (const date of enumerateDates(window.from, window.to)) {
        unknownDays.add(date);
      }
    }
  }

  const merged = mergeSeries(parts);

  if (merged.length === 0) {
    throw new ArticleNotFound(project, title, from, to);
  }

  const formerTitles = [...new Set(windows.map((window) => window.title))];

  let totalsPoints: Array<{ date: string; views: number }> = [];
  let totalsAvailable = true;

  try {
    const { totals } = await loadTotals(project, from, to, noCache);
    totalsPoints = totals.points;
  } catch {
    totalsAvailable = false;
  }

  const edgeGap = (value: NormalizedSeries) => Math.max(value.leadingGapDays, value.trailingGapDays);
  const series = normalizeSeries(merged, totalsPoints, from, to, unknownDays);

  // A long gap at an edge usually means an untraced rename, a late creation or a merge; a trend on it would mislead.
  if (edgeGap(series) > MAX_EDGE_GAP_DAYS) {
    const first = series.dates[series.leadingGapDays] ?? to;
    const last = series.dates[series.dates.length - 1 - series.trailingGapDays] ?? from;

    throw new SkillError(
      'ShortHistory',
      `${project} has data for "${title}" only from ${first} to ${last}; the article was probably renamed, created or merged`,
      { project, title, first, last },
    );
  }

  if (series.values.length < MIN_ANALYSIS_DAYS) {
    throw new SkillError(
      'InvalidInput',
      `${project} has ${series.values.length} days in range, at least ${MIN_ANALYSIS_DAYS} are needed to analyse a trend`,
      { project, days: series.values.length },
    );
  }

  // This daily fit only finds spike days by their residuals; it is not the trend.
  const firstFit = theilSen(toPoints(series.values));
  const residuals = series.values.map((value, index) => value - (firstFit.intercept + firstFit.slope * index));
  const outlierIndices = detectOutliers(residuals);
  const outlierSet = new Set(outlierIndices);

  // Spikes are interpolated away so a news event does not become a trend.
  const repaired = interpolate(series.values.map((value, index) => (outlierSet.has(index) ? null : value))).values;
  const repairedRaw = interpolate(series.rawValues.map((value, index) => (outlierSet.has(index) ? null : value))).values;
  // Daily views are autocorrelated and give too narrow an interval, so the trend is fitted on weekly sums.
  const weekly = aggregateWeekly(repaired, series.dates);
  const weeklyAbsolute = aggregateWeekly(repairedRaw, series.dates);

  if (weekly.weeks < 3) {
    throw new SkillError(
      'InvalidInput',
      `${project} has ${weekly.weeks} full weeks in range, at least 3 are needed to fit a weekly trend`,
      { project, weeks: weekly.weeks },
    );
  }

  const normalized = series.unit === 'views_per_million';
  const absoluteFit = theilSen(toPoints(weeklyAbsolute.values));
  const absoluteTrend = trendPercentPerYear(weeklyAbsolute.values, WEEKS_PER_YEAR);
  const relativeFit = normalized ? theilSen(toPoints(weekly.values)) : null;
  const relativeTrend = relativeFit ? trendPercentPerYear(weekly.values, WEEKS_PER_YEAR) : null;

  // The relative (per-million) trend is the verdict; the absolute one also carries the edition's own movement.
  // Without edition totals only the absolute trend exists and it becomes the primary one.
  const fit = relativeFit ?? absoluteFit;
  const trend = relativeTrend ?? absoluteTrend;
  const primaryWeekly = normalized ? weekly : weeklyAbsolute;

  // The recent trend is fitted on the last third of the weekly series.
  const recentStart = Math.floor((primaryWeekly.values.length * 2) / 3);
  const recentValues = primaryWeekly.values.slice(recentStart);
  const recentFit = recentValues.length >= MIN_RECENT_WEEKS ? theilSen(toPoints(recentValues)) : null;
  const recentTrend = recentFit ? trendPercentPerYear(recentValues, WEEKS_PER_YEAR) : null;

  // A reversal counts only when both the whole-period and the recent interval exclude zero.
  const reversal =
    recentFit !== null &&
    recentTrend?.percentPerYear !== null &&
    recentTrend !== null &&
    trend.percentPerYear !== null &&
    Math.sign(trend.percentPerYear) !== Math.sign(recentTrend.percentPerYear ?? 0) &&
    !spansZero(fit.ci95) &&
    !spansZero(recentFit.ci95)
      ? {
          overallPercent: trend.percentPerYear,
          recentPercent: recentTrend.percentPerYear ?? 0,
          weeks: recentValues.length,
        }
      : null;

  const season = seasonality(repaired);
  const yoy = yoyChange(repaired, series.dates);
  const level = summarize(repaired);
  const rawLevel = summarize(series.rawValues);

  const confidence = assessConfidence({
    values: primaryWeekly.values,
    rawMedianViews: median(series.rawValues),
    rangeDays: series.values.length,
    missingDays: series.missingDays,
    longestGapDays: series.longestGapDays,
    zeroDays: series.zeroDays,
    formerTitles: formerTitles.length > 1 ? formerTitles : [],
    outlierDays: outlierIndices.length,
    ci95: fit.ci95,
    normalized,
    weeks: weekly.weeks,
    trends: {
      absolutePercent: absoluteTrend.percentPerYear,
      absoluteCi: absoluteTrend.ci95,
      relativePercent: relativeTrend?.percentPerYear ?? null,
      relativeCi: relativeTrend?.ci95 ?? null,
    },
    reversal,
  });

  return {
    lang,
    project,
    title,
    unit: series.unit,
    days: series.values.length,
    weekly,
    weeklyAbsolute,
    primary: normalized ? 'relative' : 'absolute',
    fit,
    trend,
    absoluteFit,
    absoluteTrend,
    relativeTrend,
    recentFit,
    recentTrend,
    recentWeeks: recentValues.length,
    recentFrom: recentFit ? (primaryWeekly.dates[recentStart] ?? null) : null,
    reversal,
    yoy,
    level,
    rawLevel,
    season,
    outlierIndices,
    outlierDates: outlierIndices.map((index) => series.dates[index] as string),
    confidence,
    series,
    analysisValues: repaired,
    totalsAvailable,
  };
}

/** analyze command: one edition's trend and confidence, with the full analysis saved as an artifact for report. */
export async function runAnalyze(args: AnalyzeArgs): Promise<AnalyzeOutput> {
  if (!/^Q\d+$/.test(args.qid)) {
    throw new SkillError('InvalidInput', `--qid "${args.qid}" is not a Wikidata item id`, { qid: args.qid });
  }

  const titles = await getSitelinks(args.qid);
  const title = titles[args.lang];

  if (!title) {
    throw new SkillError('NoSitelink', `${args.qid} has no ${args.lang}.wikipedia article`, {
      qid: args.qid,
      lang: args.lang,
      available: Object.keys(titles).length,
      reason: { code: 'NO_SITELINK', params: { qid: args.qid, lang: args.lang } },
    });
  }

  const analysis = await analyzeLanguage(args.qid, args.lang, title, args.from, args.to, args.noCache);

  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const file = args.out ?? join(dir, `analyze-${args.qid}-${args.lang}.json`);

  await writeFile(
    file,
    JSON.stringify(
      {
        schema: ARTIFACT_SCHEMA,
        kind: 'analyze',
        qid: args.qid,
        lang: args.lang,
        project: analysis.project,
        title: analysis.title,
        from: args.from,
        to: args.to,
        days: analysis.days,
        unit: analysis.unit,
        analysedAt: new Date().toISOString(),
        primary: analysis.primary,
        absoluteTrend: trendReport(analysis.absoluteFit, analysis.absoluteTrend),
        relativeTrend: analysis.relativeTrend ? trendReport(analysis.fit, analysis.relativeTrend) : null,
        recentTrend:
          analysis.recentFit && analysis.recentTrend
            ? {
                ...trendReport(analysis.recentFit, analysis.recentTrend),
                weeks: analysis.recentWeeks,
                from: analysis.recentFrom,
                startWeek: analysis.weekly.weeks - analysis.recentWeeks,
              }
            : null,
        reversal: analysis.reversal,
        yoy: analysis.yoy,
        level: analysis.level,
        rawLevel: analysis.rawLevel,
        granularity: 'weekly',
        n_effective: analysis.weekly.weeks,
        weeklyValues: analysis.weekly.values,
        seasonality: {
          available: analysis.season.available,
          reason: analysis.season.reason,
          detected: analysis.season.detected,
          strength: analysis.season.strength,
          cyclesAvailable: analysis.season.cyclesAvailable,
          profile: analysis.season.available ? analysis.season.seasonal.slice(0, analysis.season.period) : [],
        },
        outliers: { indices: analysis.outlierIndices, dates: analysis.outlierDates },
        confidence: analysis.confidence,
        coverage: {
          missingDays: analysis.series.missingDays,
          zeroDays: analysis.series.zeroDays,
          longestGapDays: analysis.series.longestGapDays,
          totalsCoverage: analysis.series.totalsCoverage,
        },
        points: analysis.series.points,
        deseasonalized: analysis.season.deseasonalized,
      },
      null,
      2,
    ),
    'utf8',
  );

  const components = analysis.confidence.components;

  return {
    ok: true,
    command: 'analyze',
    qid: args.qid,
    lang: args.lang,
    project: analysis.project,
    title: analysis.title,
    unit: analysis.unit,
    range: { from: args.from, to: args.to, days: analysis.days },
    granularity: 'weekly',
    n_effective: analysis.weekly.weeks,
    primary: analysis.primary,
    absoluteTrend: trendReport(analysis.absoluteFit, analysis.absoluteTrend),
    relativeTrend: analysis.relativeTrend ? trendReport(analysis.fit, analysis.relativeTrend) : null,
    recentTrend:
      analysis.recentFit && analysis.recentTrend
        ? {
            ...trendReport(analysis.recentFit, analysis.recentTrend),
            weeks: analysis.recentWeeks,
            from: analysis.recentFrom ?? args.from,
          }
        : null,
    yoy: {
      changePercent: analysis.yoy.changePercent,
      current: analysis.yoy.current === null ? null : Math.round(analysis.yoy.current * 100) / 100,
      previous: analysis.yoy.previous === null ? null : Math.round(analysis.yoy.previous * 100) / 100,
      reason: analysis.yoy.reason,
    },
    level: {
      median: Math.round(analysis.level.median * 100) / 100,
      p10: Math.round(analysis.level.p10 * 100) / 100,
      p90: Math.round(analysis.level.p90 * 100) / 100,
      cv: Math.round(analysis.level.cv * 100) / 100,
      medianRawViews: Math.round(analysis.rawLevel.median),
    },
    seasonality: {
      available: analysis.season.available,
      detected: analysis.season.detected,
      strength: analysis.season.strength,
      cyclesAvailable: analysis.season.cyclesAvailable,
      reason: analysis.season.reason,
    },
    outliers: {
      excluded: analysis.outlierIndices.length,
      share: Math.round((analysis.outlierIndices.length / analysis.days) * 10000) / 10000,
      dates: analysis.outlierDates.slice(0, 5),
    },
    confidence: {
      overall: analysis.confidence.overall,
      score: analysis.confidence.score,
      volume: components.volume.score,
      length: components.length.score,
      stability: components.stability.score,
      outlierShare: components.outlierShare.score,
      continuity: components.continuity.score,
    },
    caveats: analysis.confidence.caveats,
    ...(args.locale ? { caveatsText: renderAll(analysis.confidence.caveats, args.locale) } : {}),
    file,
  };
}
