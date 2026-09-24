import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { outputDir } from '../lib/cache.js';
import { message, renderAll } from '../lib/messages.js';
import type { Locale } from '../lib/messages.js';
import { getSitelinks, probeLanguages } from '../lib/wikidata.js';
import { normalizeProject } from '../lib/wikimedia.js';
import { ArticleNotFound, SkillError } from '../types.js';
import type { Lang, LanguageAvailability, Message } from '../types.js';
import { ARTIFACT_SCHEMA, analyzeLanguage, trendReport } from './analyze.js';
import type { LanguageAnalysis } from './analyze.js';
import type { Direction } from '../lib/stats.js';

export const WEIGHTS = { growth: 0.5, level: 0.3, confidence: 0.2 } as const;

export const CRITERION =
  'perspective = 0.5*growth + 0.3*level + 0.2*confidence. growth is the Theil-Sen trend in %/year and level is the ' +
  'median views per million of the edition traffic; both are min-max scaled across the compared languages only, so ' +
  'the score ranks these languages against each other and says nothing in absolute terms. confidence is the composite ' +
  'confidence score of that language.';

export interface CompareArgs {
  qid: string;
  langs: Lang[];
  from: string;
  to: string;
  noCache: boolean;
  out: string | null;
  locale: Locale | null;
}

export interface RankedLanguage {
  rank: number;
  lang: Lang;
  title: string;
  medianPerMillion: number | null;
  percentPerYear: number | null;
  ci95: [number, number] | null;
  direction: Direction;
  absolutePercentPerYear: number | null;
  recentPercentPerYear: number | null;
  recentDirection: Direction | null;
  confidence: string;
  confidenceScore: number;
  perspective: number;
  notes: Message[];
}

export interface CompareOutput {
  ok: true;
  command: 'compare';
  qid: string;
  range: { from: string; to: string; days: number };
  granularity: 'weekly';
  n_effective: number;
  unit: string;
  comparable: boolean;
  criterion: string;
  ranking: RankedLanguage[];
  unavailable: LanguageAvailability[];
  caveats: Message[];
  caveatsText?: string[];
  file: string;
}

export function minMaxScale(values: number[]): number[] {
  if (values.length <= 1) {
    return values.map(() => 0.5);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) {
    return values.map(() => 0.5);
  }

  return values.map((value) => (value - min) / (max - min));
}

export function rank(analyses: LanguageAnalysis[]): RankedLanguage[] {
  const measured = analyses.filter((item) => item.trend.percentPerYear !== null);
  const scaled = minMaxScale(measured.map((item) => item.trend.percentPerYear as number));
  const growth = analyses.map((item) => {
    const position = measured.indexOf(item);

    return position === -1 ? 0 : (scaled[position] ?? 0.5);
  });
  const perMillion = analyses.filter((item) => item.unit === 'views_per_million');
  const scaledLevel = minMaxScale(perMillion.map((item) => item.level.median));
  const level = analyses.map((item) => {
    const position = perMillion.indexOf(item);

    return position === -1 ? 0.5 : (scaledLevel[position] ?? 0.5);
  });

  return analyses
    .map((item, index) => {
      const perspective =
        WEIGHTS.growth * (growth[index] ?? 0.5) +
        WEIGHTS.level * (level[index] ?? 0.5) +
        WEIGHTS.confidence * item.confidence.score;

      const notes: Message[] = [];

      if (item.trend.direction === 'inconclusive') {
        notes.push(message('NOTE_SPANS_ZERO'));
      }

      if (item.confidence.overall === 'low') {
        notes.push(message('NOTE_LOW_CONFIDENCE'));
      }

      if (item.unit !== 'views_per_million') {
        notes.push(message('NOTE_RAW_COUNTS'));
      }

      if (item.reversal) {
        notes.push(message('NOTE_TREND_REVERSAL'));
      }

      return {
        rank: 0,
        lang: item.lang,
        title: item.title,
        medianPerMillion: item.unit === 'views_per_million' ? Math.round(item.level.median * 100) / 100 : null,
        percentPerYear: item.trend.percentPerYear,
        ci95: item.trend.ci95,
        direction: item.trend.direction,
        absolutePercentPerYear: item.absoluteTrend.percentPerYear,
        recentPercentPerYear: item.recentTrend?.percentPerYear ?? null,
        recentDirection: item.recentTrend?.direction ?? null,
        confidence: item.confidence.overall,
        confidenceScore: item.confidence.score,
        perspective: Math.round(perspective * 1000) / 1000,
        notes: notes.length > 0 ? notes : [message('NOTE_NO_RESERVATIONS')],
      };
    })
    .sort((a, b) => b.perspective - a.perspective)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function runCompare(args: CompareArgs): Promise<CompareOutput> {
  if (!/^Q\d+$/.test(args.qid)) {
    throw new SkillError('InvalidInput', `--qid "${args.qid}" is not a Wikidata item id`, { qid: args.qid });
  }

  if (args.langs.length < 2) {
    throw new SkillError('InvalidInput', 'compare needs at least two languages, e.g. --langs cs,uk', {
      langs: args.langs,
    });
  }

  const titles = await getSitelinks(args.qid);
  const missing = args.langs.filter((lang) => !titles[lang]);
  const unavailable: LanguageAvailability[] = await probeLanguages(
    args.qid,
    missing,
    titles['en'] ?? Object.values(titles)[0] ?? args.qid,
  );

  const analyses: LanguageAnalysis[] = [];

  for (const lang of args.langs) {
    const title = titles[lang];

    if (!title) {
      continue;
    }

    try {
      analyses.push(await analyzeLanguage(args.qid, lang, title, args.from, args.to, args.noCache));
    } catch (error) {
      if (error instanceof SkillError) {
        unavailable.push({
          lang,
          project: normalizeProject(lang),
          status: error.code === 'ShortHistory' ? 'short_history' : error instanceof ArticleNotFound ? 'no_data' : 'fetch_failed',
          title,
          reason:
            error.code === 'ShortHistory'
              ? message('SHORT_HISTORY', {
                  title,
                  first: String(error.details?.['first'] ?? ''),
                  last: String(error.details?.['last'] ?? ''),
                })
              : message('LANGUAGE_FETCH_FAILED', { code: error.code, message: error.message }),
          requiresConfirmation: false,
          searchQuery: null,
          searchHits: 0,
          alternatives: [],
        });
        continue;
      }

      throw error;
    }
  }

  if (analyses.length < 2) {
    throw new SkillError(
      'InvalidInput',
      `compare needs at least two languages with data, got ${analyses.length}`,
      { qid: args.qid, unavailable },
    );
  }

  const ranking = rank(analyses);
  const comparable = analyses.every((item) => item.unit === 'views_per_million');
  const caveats = buildCompareCaveats(analyses, comparable);

  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const file = args.out ?? join(dir, `compare-${args.qid}.json`);

  await writeFile(
    file,
    JSON.stringify(
      {
        schema: ARTIFACT_SCHEMA,
        kind: 'compare',
        qid: args.qid,
        from: args.from,
        to: args.to,
        days: analyses[0]?.days ?? 0,
        comparedAt: new Date().toISOString(),
        caveats,
        criterion: CRITERION,
        weights: WEIGHTS,
        comparable,
        ranking,
        unavailable,
        languages: analyses.map((item) => ({
          lang: item.lang,
          project: item.project,
          title: item.title,
          unit: item.unit,
          days: item.days,
          primary: item.primary,
          trend: trendReport(item.fit, item.trend),
          absoluteTrend: trendReport(item.absoluteFit, item.absoluteTrend),
          relativeTrend: item.relativeTrend ? trendReport(item.fit, item.relativeTrend) : null,
          recentTrend:
            item.recentFit && item.recentTrend
              ? {
                  ...trendReport(item.recentFit, item.recentTrend),
                  weeks: item.recentWeeks,
                  from: item.recentFrom,
                  startWeek: item.weekly.weeks - item.recentWeeks,
                }
              : null,
          reversal: item.reversal,
          missingDays: item.series.missingDays,
          zeroDays: item.series.zeroDays,
          yoy: item.yoy,
          level: item.level,
          rawLevel: item.rawLevel,
          seasonality: {
            available: item.season.available,
            detected: item.season.detected,
            strength: item.season.strength,
            cyclesAvailable: item.season.cyclesAvailable,
            reason: item.season.reason,
          },
          granularity: 'weekly',
          n_effective: item.weekly.weeks,
          outliers: { excluded: item.outlierIndices.length, dates: item.outlierDates },
          confidence: item.confidence,
          points: item.series.points,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    ok: true,
    command: 'compare',
    qid: args.qid,
    range: { from: args.from, to: args.to, days: analyses[0]?.days ?? 0 },
    granularity: 'weekly',
    n_effective: analyses[0]?.weekly.weeks ?? 0,
    unit: comparable ? 'views_per_million' : 'mixed',
    comparable,
    criterion: CRITERION,
    ranking,
    unavailable,
    caveats,
    ...(args.locale ? { caveatsText: renderAll(caveats, args.locale) } : {}),
    file,
  };
}

export function buildCompareCaveats(analyses: LanguageAnalysis[], comparable: boolean): Message[] {
  const caveats: Message[] = [];
  const weak = analyses.filter((item) => item.confidence.overall === 'low').map((item) => item.lang);
  const undecided = analyses.filter((item) => item.trend.direction === 'inconclusive').map((item) => item.lang);
  const spiky = analyses.filter((item) => item.outlierIndices.length > 0);
  const declining = analyses.filter((item) => (item.trend.percentPerYear ?? 0) < 0 && item.fit.ci95[1] < 0);

  if (!comparable) {
    caveats.push(message('MIXED_UNITS'));
  }

  if (declining.length === analyses.length && analyses.length > 0) {
    caveats.push(message('ALL_LANGUAGES_DECLINING'));
  }

  if (weak.length > 0) {
    caveats.push(message('LOW_CONFIDENCE_LANGUAGES', { langs: weak.join(', ') }));
  }

  if (undecided.length > 0) {
    caveats.push(message('SPANS_ZERO_LANGUAGES', { langs: undecided.join(', ') }));
  }

  if (spiky.length > 0) {
    caveats.push(
      message('SPIKES_BY_LANGUAGE', {
        detail: spiky.map((item) => `${item.lang} ${item.outlierIndices.length}`).join(', '),
      }),
    );
  }

  caveats.push(message('EDITION_IS_NOT_A_COUNTRY'));

  return caveats;
}
