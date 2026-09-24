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
// One request per 300 ms caps the rate at 200/minute, Wikimedia's limit for a client with a compliant User-Agent.
const DEFAULT_MIN_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 20_000;

/** Per-call overrides of retry, pacing and timeout settings. */
export interface RequestOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
}

/** Contact put in the User-Agent when WIKIMEDIA_CONTACT is not set; forks should set their own. */
export const DEFAULT_CONTACT = 'https://github.com/RobertUkr';

/** Contact for the User-Agent and whether it came from WIKIMEDIA_CONTACT or the default. */
export function contact(): { value: string; source: 'env' | 'default' } {
  const configured = process.env['WIKIMEDIA_CONTACT']?.trim();

  if (configured && configured.length > 0) {
    return { value: configured, source: 'env' };
  }

  return { value: DEFAULT_CONTACT, source: 'default' };
}

/** Warning to print when the default contact is in use, or null when WIKIMEDIA_CONTACT is set. */
export function contactWarning(): string | null {
  if (contact().source === 'env') {
    return null;
  }

  return (
    `WIKIMEDIA_CONTACT is not set; requests identify themselves with the default contact ${DEFAULT_CONTACT}. ` +
    'Set it to your own email or URL if you run a fork or a larger volume.'
  );
}

/** User-Agent with tool name, version and contact, as Wikimedia's User-Agent policy requires.
 * Without a contact the client can fall into the anonymous tier of about 10 requests/minute. */
export function userAgent(): string {
  return `wikipedia-trends/${VERSION} (${contact().value}) node/${process.versions.node}`;
}

/** Project host for a language code or URL, e.g. "uk" -> "uk.wikipedia.org". */
export function normalizeProject(project: string): string {
  const value = project.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!value) {
    throw new SkillError('InvalidInput', 'Project must not be empty');
  }
  if (!value.includes('.')) {
    return `${value}.wikipedia.org`;
  }
  // Accept "uk.wikipedia" without the TLD.
  if (value.endsWith('.wikipedia')) {
    return `${value}.org`;
  }
  return value;
}

/** Converts YYYY-MM-DD to the YYYYMMDD form the Pageviews API expects, rejecting invalid dates. */
export function toApiDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new SkillError('InvalidInput', `Date must be YYYY-MM-DD, got "${date}"`, { date });
  }
  // The round trip through Date rejects impossible dates such as 2025-02-30.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new SkillError('InvalidInput', `Date "${date}" is not a valid calendar date`, { date });
  }
  return date.replace(/-/g, '');
}

// Pageviews timestamps are YYYYMMDDHH; only the date part is kept.
function fromTimestamp(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Module-wide queue and clock: all requests go out one at a time and are paced together.
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

// Runs the task after the previous one; the chain swallows failures so one failed request does not block the queue.
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
  // Retry-After (in seconds) takes precedence over backoff, still capped at maxDelayMs.
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, max);
    }
  }
  // Exponential backoff plus up to one base delay of random jitter.
  const exponential = base * 2 ** attempt;
  return Math.min(exponential + Math.random() * base, max);
}

// Rate limiting (429) and server errors are transient; other 4xx responses will not succeed on retry.
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** GETs JSON one request at a time, with pacing, a timeout and retries on network errors, 429 and 5xx. */
export async function requestJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return serial(async () => {
    let lastError: SkillError | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // The minimum interval applies to retries as well.
      const gap = lastRequestAt + minInterval - Date.now();
      if (gap > 0) {
        await sleep(gap);
      }
      lastRequestAt = Date.now();

      let response: Response;
      let body = '';
      try {
        response = await fetch(url, {
          headers: { 'user-agent': userAgent(), accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        // An error body is best-effort: it only goes into the HttpError details.
        body = response.ok ? await response.text() : await response.text().catch(() => '');
      } catch (cause) {
        lastError = new NetworkError(url, cause);
        if (attempt === retries) break;
        await sleep(retryDelay(attempt, null, opts));
        continue;
      }

      if (response.ok) {
        return JSON.parse(body) as T;
      }

      lastError = new HttpError(response.status, url, body);
      if (!isRetryable(response.status) || attempt === retries) break;
      await sleep(retryDelay(attempt, response, opts));
    }

    throw lastError ?? new NetworkError(url, 'unknown failure');
  });
}

/** Plain text from a search snippet: strips HTML tags and decodes common entities. */
export function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** MediaWiki full-text search URL over the articles (main namespace) of one edition. */
export function articleSearchUrl(project: string, query: string, limit: number): string {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: String(limit),
    srprop: 'snippet',
    // The total match count is reported as mentions when no article matches.
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

/** Searches an edition's articles for the query; returns the top hits and the total match count. */
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

/** A rename from the move log; date is YYYY-MM-DD. */
export interface PageMove {
  date: string;
  from: string;
  to: string;
}

interface MoveLogResponse {
  query?: { logevents?: Array<{ timestamp?: string; title?: string; params?: { target_title?: string } }> };
}

/** Moves logged under a former title, used to confirm and date a rename traced from Wikidata. */
export async function getMovesFrom(project: string, title: string, opts: RequestOptions = {}): Promise<PageMove[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'logevents',
    letype: 'move',
    letitle: title,
    leprop: 'title|details|timestamp',
    lelimit: '50',
    format: 'json',
    formatversion: '2',
  });
  const payload = await requestJson<MoveLogResponse>(`https://${normalizeProject(project)}/w/api.php?${params.toString()}`, opts);

  return (payload.query?.logevents ?? [])
    // Entries without a timestamp or target cannot date a rename.
    .filter((event) => event.timestamp && event.params?.target_title)
    .map((event) => ({ date: (event.timestamp as string).slice(0, 10), from: event.title ?? title, to: event.params?.target_title as string }));
}

/** A redirect to an article and the timestamp of its latest revision. */
export interface PageRedirect {
  title: string;
  lastEdited: string;
}

interface RedirectsResponse {
  query?: { pages?: Array<{ title?: string; revisions?: Array<{ timestamp?: string }> }> };
}

/** Redirects to an article, used as candidate former titles when a rename is not named in Wikidata. */
export async function getRedirectsTo(project: string, title: string, opts: RequestOptions = {}): Promise<PageRedirect[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'redirects',
    titles: title,
    grdnamespace: '0',
    // One page of up to the API maximum; continuation is not followed.
    grdlimit: 'max',
    prop: 'revisions',
    // The latest revision time lets the caller try redirects closest to the rename first.
    rvprop: 'timestamp',
    format: 'json',
    formatversion: '2',
  });
  const payload = await requestJson<RedirectsResponse>(`https://${normalizeProject(project)}/w/api.php?${params.toString()}`, opts);

  return (payload.query?.pages ?? [])
    .filter((page) => page.title)
    .map((page) => ({ title: page.title as string, lastEdited: page.revisions?.[0]?.timestamp ?? '' }));
}

/** Pageviews API URL for one article's daily user views over a date range. */
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

/** Pageviews API URL for an edition's aggregate daily user views over a date range. */
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

/** Daily user pageviews of one article; throws ArticleNotFound when the API has no data for the range. */
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
    // The Pageviews API answers 404 when it has no data for the title in the range.
    if (error instanceof HttpError && error.status === 404) {
      throw new ArticleNotFound(normalized, title, start, end);
    }
    throw error;
  }

  const points = toPoints(payload.items);
  // An empty series is treated the same as a 404.
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

/** Daily user pageviews of a whole edition, the denominator for per-million shares. */
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
