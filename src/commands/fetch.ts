import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheKey, outputDir, readCache, writeCache } from '../lib/cache.js';
import { message } from '../lib/messages.js';
import { enumerateDates } from '../lib/normalize.js';
import { getRevisionComments, getSitelinks, probeLanguages } from '../lib/wikidata.js';
import type { RevisionComment } from '../lib/wikidata.js';
import { getArticleViews, getProjectTotals, normalizeProject, toApiDate } from '../lib/wikimedia.js';
import { ACCESS, AGENT, ArticleNotFound, GRANULARITY, SkillError } from '../types.js';
import type { ArticleViews, DailyPoint, Lang, LanguageAvailability, ProjectTotals } from '../types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export { enumerateDates };

export interface FetchArgs {
  qid: string;
  langs: Lang[];
  from: string;
  to: string;
  noCache: boolean;
  out: string | null;
}

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
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  if (to > yesterday) {
    throw new SkillError('InvalidInput', `--to (${to}) is beyond the last day with data (${yesterday})`, { to });
  }
}

export async function loadSeries(
  project: string,
  title: string,
  from: string,
  to: string,
  noCache: boolean,
): Promise<{ views: ArticleViews; cached: boolean }> {
  const key = cacheKey({ project, title, start: from, end: to, access: ACCESS, agent: AGENT });

  if (!noCache) {
    const cached = await readCache<ArticleViews>(key);
    if (cached) {
      return { views: cached, cached: true };
    }
  }

  const views = await getArticleViews(project, title, from, to);
  await writeCache(key, views);
  return { views, cached: false };
}

export async function loadTotals(
  project: string,
  from: string,
  to: string,
  noCache: boolean,
): Promise<{ totals: ProjectTotals; cached: boolean }> {
  const key = cacheKey({ kind: 'totals', project, start: from, end: to, access: ACCESS, agent: AGENT });

  if (!noCache) {
    const cached = await readCache<ProjectTotals>(key);

    if (cached) {
      return { totals: cached, cached: true };
    }
  }

  const totals = await getProjectTotals(project, from, to);
  await writeCache(key, totals);

  return { totals, cached: false };
}

export async function loadRevisionComments(qid: string, since: string, noCache: boolean): Promise<RevisionComment[]> {
  const key = cacheKey({ kind: 'sitelink-history', qid, since });

  if (!noCache) {
    const cached = await readCache<RevisionComment[]>(key);

    if (cached) {
      return cached;
    }
  }

  const comments = await getRevisionComments(qid, since);
  await writeCache(key, comments);

  return comments;
}

export async function runFetch(args: FetchArgs): Promise<FetchOutput> {
  if (!/^Q\d+$/.test(args.qid)) {
    throw new SkillError('InvalidInput', `--qid "${args.qid}" is not a Wikidata item id`, { qid: args.qid });
  }
  if (args.langs.length === 0) {
    throw new SkillError('InvalidInput', '--langs is required, e.g. --langs pl,cs');
  }
  validateRange(args.from, args.to);

  const titles = await getSitelinks(args.qid);
  const series: FetchOutput['series'] = [];
  const stored: Array<{ lang: Lang; project: string; title: string; summary: SeriesSummary; points: DailyPoint[] }> = [];

  const missing = args.langs.filter((lang) => !titles[lang]);
  const unavailable: LanguageAvailability[] = await probeLanguages(
    args.qid,
    missing,
    titles['en'] ?? Object.values(titles)[0] ?? args.qid,
  );

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
        unavailable.push({
          lang,
          project,
          status: 'no_data',
          title,
          reason: message('NO_PAGEVIEWS_DATA', { project, title, from: args.from, to: args.to }),
          requiresConfirmation: false,
          searchQuery: null,
          searchHits: 0,
          alternatives: [],
        });
        continue;
      }
      if (error instanceof SkillError) {
        unavailable.push({
          lang,
          project,
          status: 'fetch_failed',
          title,
          reason: message('LANGUAGE_FETCH_FAILED', { code: error.code, message: error.message }),
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

  if (series.length === 0 && unavailable.some((entry) => entry.status === 'fetch_failed')) {
    throw new SkillError(
      'NetworkError',
      `No pageviews could be fetched for ${args.qid}: every requested language failed technically`,
      { qid: args.qid, from: args.from, to: args.to, unavailable },
    );
  }

  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const file = args.out ?? join(dir, `views-${args.qid}-${args.from}_${args.to}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
    'utf8',
  );

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
