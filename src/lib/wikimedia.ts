import {
  ACCESS,
  AGENT,
  ArticleNotFound,
  GRANULARITY,
  HttpError,
  NetworkError,
  SkillError,
} from '../types.js';
import type { ArticleSearchHit, ArticleSearchResult, ArticleViews, DailyPoint, ProjectTotals } from '../types.js';

const REST_BASE = 'https://wikimedia.org/api/rest_v1';
const VERSION = '0.1.0';
const DEFAULT_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MIN_INTERVAL_MS = 150;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface RequestOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
}

export function userAgent(): string {
  const contact = process.env['WIKIMEDIA_CONTACT']?.trim();
  const suffix = contact && contact.length > 0 ? contact : 'local CLI; set WIKIMEDIA_CONTACT to a contact address';
  return `wikipedia-trends/${VERSION} (${suffix}) node/${process.versions.node}`;
}

export function normalizeProject(project: string): string {
  const value = project.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!value) {
    throw new SkillError('InvalidInput', 'Project must not be empty');
  }
  if (!value.includes('.')) {
    return `${value}.wikipedia.org`;
  }
  if (value.endsWith('.wikipedia')) {
    return `${value}.org`;
  }
  return value;
}

export function toApiDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new SkillError('InvalidInput', `Date must be YYYY-MM-DD, got "${date}"`, { date });
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SkillError('InvalidInput', `Date "${date}" is not a valid calendar date`, { date });
  }
  return date.replace(/-/g, '');
}

function fromTimestamp(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function retryDelay(attempt: number, response: Response | null, opts: RequestOptions): number {
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, max);
    }
  }
  const exponential = base * 2 ** attempt;
  return Math.min(exponential + Math.random() * base, max);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return serial(async () => {
    let lastError: SkillError | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const gap = lastRequestAt + minInterval - Date.now();
      if (gap > 0) {
        await sleep(gap);
      }
      lastRequestAt = Date.now();

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'user-agent': userAgent(), accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        lastError = new NetworkError(url, cause);
        if (attempt === retries) break;
        await sleep(retryDelay(attempt, null, opts));
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const body = await response.text().catch(() => '');
      lastError = new HttpError(response.status, url, body);
      if (!isRetryable(response.status) || attempt === retries) break;
      await sleep(retryDelay(attempt, response, opts));
    }

    throw lastError ?? new NetworkError(url, 'unknown failure');
  });
}

export function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function articleSearchUrl(project: string, query: string, limit: number): string {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: String(limit),
    srprop: 'snippet',
    srinfo: 'totalhits',
    format: 'json',
    formatversion: '2',
  });
  return `https://${normalizeProject(project)}/w/api.php?${params.toString()}`;
}

interface SearchApiResponse {
  query?: {
    searchinfo?: { totalhits?: number };
    search?: Array<{ title?: string; pageid?: number; snippet?: string }>;
  };
}

export async function searchArticles(
  project: string,
  query: string,
  limit = 5,
  opts: RequestOptions = {},
): Promise<ArticleSearchResult> {
  const normalized = normalizeProject(project);
  const payload = await requestJson<SearchApiResponse>(articleSearchUrl(project, query, limit), opts);

  const hits: ArticleSearchHit[] = (payload.query?.search ?? [])
    .filter((hit): hit is { title: string; pageid?: number; snippet?: string } => typeof hit.title === 'string')
    .map((hit) => ({
      title: hit.title,
      pageid: hit.pageid ?? 0,
      snippet: stripMarkup(hit.snippet ?? ''),
    }));

  return {
    project: normalized,
    query,
    totalHits: payload.query?.searchinfo?.totalhits ?? hits.length,
    hits,
  };
}

function encodeTitle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, '_'));
}

interface PerArticleResponse {
  items?: Array<{ timestamp?: string; views?: number }>;
}

export function articleViewsUrl(project: string, title: string, start: string, end: string): string {
  return [
    REST_BASE,
    'metrics/pageviews/per-article',
    normalizeProject(project),
    ACCESS,
    AGENT,
    encodeTitle(title),
    GRANULARITY,
    toApiDate(start),
    toApiDate(end),
  ].join('/');
}

export function projectTotalsUrl(project: string, start: string, end: string): string {
  return [
    REST_BASE,
    'metrics/pageviews/aggregate',
    normalizeProject(project),
    ACCESS,
    AGENT,
    GRANULARITY,
    toApiDate(start),
    toApiDate(end),
  ].join('/');
}

function toPoints(items: Array<{ timestamp?: string; views?: number }> | undefined): DailyPoint[] {
  return (items ?? [])
    .filter((item): item is { timestamp: string; views: number } =>
      typeof item.timestamp === 'string' && typeof item.views === 'number')
    .map((item) => ({ date: fromTimestamp(item.timestamp), views: item.views }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getArticleViews(
  project: string,
  title: string,
  start: string,
  end: string,
  opts: RequestOptions = {},
): Promise<ArticleViews> {
  const normalized = normalizeProject(project);
  const url = articleViewsUrl(project, title, start, end);

  let payload: PerArticleResponse;
  try {
    payload = await requestJson<PerArticleResponse>(url, opts);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new ArticleNotFound(normalized, title, start, end);
    }
    throw error;
  }

  const points = toPoints(payload.items);
  if (points.length === 0) {
    throw new ArticleNotFound(normalized, title, start, end);
  }

  return {
    project: normalized,
    title,
    access: ACCESS,
    agent: AGENT,
    granularity: GRANULARITY,
    points,
  };
}

export async function getProjectTotals(
  project: string,
  start: string,
  end: string,
  opts: RequestOptions = {},
): Promise<ProjectTotals> {
  const normalized = normalizeProject(project);
  const url = projectTotalsUrl(project, start, end);

  let payload: PerArticleResponse;
  try {
    payload = await requestJson<PerArticleResponse>(url, opts);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new SkillError('ArticleNotFound', `No aggregate pageviews for ${normalized} between ${start} and ${end}`, {
        project: normalized,
        start,
        end,
      });
    }
    throw error;
  }

  return {
    project: normalized,
    access: ACCESS,
    agent: AGENT,
    granularity: GRANULARITY,
    points: toPoints(payload.items),
  };
}
