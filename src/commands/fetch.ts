import { join } from 'node:path';
import { cacheKey, outputDir, readCache, writeArtifact, writeCache } from '../lib/cache.js';
import { DAY_MS, formatDay } from '../lib/dates.js';
import { message } from '../lib/messages.js';
import { enumerateDates } from '../lib/normalize.js';
import { assertQidArg, getRevisionComments, getSitelinks, probeLanguages } from '../lib/wikidata.js';
import type { RevisionComment } from '../lib/wikidata.js';
import { getArticleViews, getProjectTotals, normalizeProject, toApiDate } from '../lib/wikimedia.js';
import { ACCESS, AGENT, ArticleNotFound, GRANULARITY, SkillError } from '../types.js';
import type { ArticleViews, DailyPoint, Lang, LanguageAvailability, ProjectTotals } from '../types.js';
import { failedLanguage, fallbackQuery } from './unavailable.js';

/** Arguments of the fetch command. */
export interface FetchArgs {
  qid: string;
  langs: Lang[];
  from: string;
  to: string;
  noCache: boolean;
  out: string | null;
}

/** Coverage of one fetched series over the requested range. */
export interface SeriesSummary {
  points: number;
  expectedDays: number;
  missingDays: number;
  longestGapDays: number;
  firstGap: string | null;
  total: number;
  first: string | null;
  last: string | null;
}

/** Compact stdout JSON of the fetch command; the daily points go to the output file. */
export interface FetchOutput {
  ok: true;
  command: 'fetch';
  qid: string;
  range: { from: string; to: string; days: number };
  access: string;
  agent: string;
  file: string;
  coverage: { requested: number; available: number; unavailable: number };
  series: Array<{
    lang: Lang;
    project: string;
    title: string;
    points: number;
    missingDays: number;
    longestGapDays: number;
    total: number;
    first: string | null;
    last: string | null;
    cached: boolean;
  }>;
  unavailable: LanguageAvailability[];
}

/** Counts missing days and the longest gap of a raw series against the requested range. */
export function summarizeSeries(points: DailyPoint[], from: string, to: string): SeriesSummary {
  const expected = enumerateDates(from, to);
  const seen = new Set(points.map((point) => point.date));

  let missingDays = 0;
  let longestGapDays = 0;
  let currentGap = 0;
  let firstGap: string | null = null;

  for (const date of expected) {
    if (seen.has(date)) {
      currentGap = 0;
      continue;
    }

    missingDays += 1;
    currentGap += 1;
    longestGapDays = Math.max(longestGapDays, currentGap);
    firstGap ??= date;
  }

  return {
    points: points.length,
    expectedDays: expected.length,
    missingDays,
    longestGapDays,
    firstGap,
    total: points.reduce((sum, point) => sum + point.views, 0),
    first: points[0]?.date ?? null,
    last: points[points.length - 1]?.date ?? null,
  };
}

function validateRange(from: string, to: string): void {
  toApiDate(from);
  toApiDate(to);

  if (from > to) {
    throw new SkillError('InvalidInput', `--from (${from}) must not be after --to (${to})`, { from, to });
  }

  const yesterday = formatDay(Date.now() - DAY_MS);

  if (to > yesterday) {
    throw new SkillError('InvalidInput', `--to (${to}) is beyond the last day with data (${yesterday})`, { to });
  }
}

async function cachedOrLoad<T>(key: string, noCache: boolean, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  if (!noCache) {
    const cached = await readCache<T>(key);

    if (cached) {
      return { value: cached, cached: true };
    }
  }

  const value = await load();
  await writeCache(key, value);

  return { value, cached: false };
}

/** Daily views of one article, from the 24-hour cache unless noCache is set. */
export async function loadSeries(
  project: string,
  title: string,
  from: string,
  to: string,
  noCache: boolean,
): Promise<{ views: ArticleViews; cached: boolean }> {
  const key = cacheKey({ project, title, start: from, end: to, access: ACCESS, agent: AGENT });
  const { value, cached } = await cachedOrLoad(key, noCache, () => getArticleViews(project, title, from, to));

  return { views: value, cached };
}

/** Daily total views of a whole edition, the denominator of views per million. */
export async function loadTotals(
  project: string,
  from: string,
  to: string,
  noCache: boolean,
): Promise<{ totals: ProjectTotals; cached: boolean }> {
  const key = cacheKey({ kind: 'totals', project, start: from, end: to, access: ACCESS, agent: AGENT });
  const { value, cached } = await cachedOrLoad(key, noCache, () => getProjectTotals(project, from, to));

  return { totals: value, cached };
}

/** Wikidata revision comments of the item since a date, used to trace article renames. */
export async function loadRevisionComments(qid: string, since: string, noCache: boolean): Promise<RevisionComment[]> {
  const key = cacheKey({ kind: 'sitelink-history', qid, since });

  return (await cachedOrLoad(key, noCache, () => getRevisionComments(qid, since))).value;
}

/** fetch command: daily views per edition written to a file, with unavailable editions and their reasons. */
export async function runFetch(args: FetchArgs): Promise<FetchOutput> {
  assertQidArg(args.qid);

  if (args.langs.length === 0) {
    throw new SkillError('InvalidInput', '--langs is required, e.g. --langs pl,cs');
  }

  validateRange(args.from, args.to);

  const titles = await getSitelinks(args.qid);
  const series: FetchOutput['series'] = [];
  const stored: Array<{ lang: Lang; project: string; title: string; summary: SeriesSummary; points: DailyPoint[] }> = [];

  const missing = args.langs.filter((lang) => !titles[lang]);
  const unavailable: LanguageAvailability[] = await probeLanguages(args.qid, missing, fallbackQuery(titles, args.qid));

  for (const lang of args.langs) {
    const title = titles[lang];

    if (!title) {
      continue;
    }

    const project = normalizeProject(lang);

    try {
      const { views, cached } = await loadSeries(project, title, args.from, args.to, args.noCache);
      const summary = summarizeSeries(views.points, args.from, args.to);
      stored.push({ lang, project, title, summary, points: views.points });
      series.push({
        lang,
        project,
        title,
        points: summary.points,
        missingDays: summary.missingDays,
        longestGapDays: summary.longestGapDays,
        total: summary.total,
        first: summary.first,
        last: summary.last,
        cached,
      });
    } catch (error) {
      if (error instanceof ArticleNotFound) {
        unavailable.push(
          failedLanguage(lang, title, 'no_data', message('NO_PAGEVIEWS_DATA', { project, title, from: args.from, to: args.to })),
        );
        continue;
      }

      if (error instanceof SkillError) {
        unavailable.push(
          failedLanguage(lang, title, 'fetch_failed', message('LANGUAGE_FETCH_FAILED', { code: error.code, message: error.message })),
        );
        continue;
      }

      throw error;
    }
  }

  // Missing articles or data are findings; only technical failure in every language is an error.
  if (series.length === 0 && unavailable.some((entry) => entry.status === 'fetch_failed')) {
    throw new SkillError(
      'NetworkError',
      `No pageviews could be fetched for ${args.qid}: every requested language failed technically`,
      { qid: args.qid, from: args.from, to: args.to, unavailable },
    );
  }

  const file = args.out ?? join(outputDir(), `views-${args.qid}-${args.from}_${args.to}.json`);

  await writeArtifact(file, {
    qid: args.qid,
    from: args.from,
    to: args.to,
    access: ACCESS,
    agent: AGENT,
    granularity: GRANULARITY,
    fetchedAt: new Date().toISOString(),
    coverage: { requested: args.langs.length, available: series.length, unavailable: unavailable.length },
    series: stored,
    unavailable,
  });

  return {
    ok: true,
    command: 'fetch',
    qid: args.qid,
    range: { from: args.from, to: args.to, days: enumerateDates(args.from, args.to).length },
    access: ACCESS,
    agent: AGENT,
    file,
    coverage: { requested: args.langs.length, available: series.length, unavailable: unavailable.length },
    series,
    unavailable,
  };
}
