export type Lang = string;

export const ACCESS = 'all-access';
export const AGENT = 'user';
export const GRANULARITY = 'daily';

export interface TopicCandidate {
  qid: string;
  label: string;
  description: string;
  score: number;
  wikiCount: number;
}

export interface TopicResolution {
  qid: string;
  label: string;
  description: string;
  titles: Record<Lang, string>;
  candidates: TopicCandidate[];
}

export interface DailyPoint {
  date: string;
  views: number;
}

export interface ArticleViews {
  project: string;
  title: string;
  access: string;
  agent: string;
  granularity: string;
  points: DailyPoint[];
}

export interface ProjectTotals {
  project: string;
  access: string;
  agent: string;
  granularity: string;
  points: DailyPoint[];
}

export type MessageCode =
  | 'LOW_VOLUME'
  | 'SERIES_TOO_SHORT'
  | 'SERIES_SHORTER_THAN_YOY'
  | 'INTERVAL_SPANS_ZERO'
  | 'SLOPE_SIGN_UNSTABLE'
  | 'SPIKES_EXCLUDED'
  | 'LONG_GAP_POSSIBLE_RENAME'
  | 'GAPS_INTERPOLATED'
  | 'RAW_COUNTS_NOT_COMPARABLE'
  | 'WEEKLY_AGGREGATION'
  | 'ABSOLUTE_VS_RELATIVE'
  | 'EDITION_TRAFFIC_DECLINING'
  | 'TREND_REVERSAL'
  | 'NOTE_TREND_REVERSAL'
  | 'DETAIL_VOLUME'
  | 'DETAIL_LENGTH'
  | 'DETAIL_STABILITY'
  | 'DETAIL_STABILITY_SPANS_ZERO'
  | 'DETAIL_STABILITY_TOO_SHORT'
  | 'DETAIL_OUTLIERS'
  | 'DETAIL_CONTINUITY'
  | 'ALL_LANGUAGES_DECLINING'
  | 'LOW_CONFIDENCE_LANGUAGES'
  | 'SPANS_ZERO_LANGUAGES'
  | 'SPIKES_BY_LANGUAGE'
  | 'EDITION_IS_NOT_A_COUNTRY'
  | 'MIXED_UNITS'
  | 'NOTE_SPANS_ZERO'
  | 'NOTE_LOW_CONFIDENCE'
  | 'NOTE_RAW_COUNTS'
  | 'NOTE_NO_RESERVATIONS'
  | 'NO_ARTICLE_WITH_MENTIONS'
  | 'NO_ARTICLE_NO_HITS'
  | 'POSSIBLE_ALTERNATIVE'
  | 'SEARCH_FAILED'
  | 'NO_PAGEVIEWS_DATA'
  | 'LANGUAGE_FETCH_FAILED'
  | 'NO_SITELINK'
  | 'YOY_TOO_SHORT'
  | 'YOY_ZERO_BASE'
  | 'INSUFFICIENT_CYCLES';

export interface Message {
  code: MessageCode;
  params: Record<string, string | number>;
}

export interface ArticleSearchHit {
  title: string;
  pageid: number;
  snippet: string;
}

export interface ArticleSearchResult {
  project: string;
  query: string;
  totalHits: number;
  hits: ArticleSearchHit[];
}

export type LanguageStatus =
  | 'available'
  | 'no_article'
  | 'possible_alternative'
  | 'no_data'
  | 'fetch_failed';

export interface AlternativeArticle {
  title: string;
  score: number;
  snippet: string;
  url: string;
  confirmed: false;
}

export interface LanguageAvailability {
  lang: Lang;
  project: string;
  status: Exclude<LanguageStatus, 'available'>;
  title: string | null;
  reason: Message;
  requiresConfirmation: boolean;
  searchQuery: string | null;
  searchHits: number;
  alternatives: AlternativeArticle[];
}

export type ErrorCode =
  | 'InvalidInput'
  | 'TopicNotFound'
  | 'ArticleNotFound'
  | 'NoSitelink'
  | 'HttpError'
  | 'NetworkError';

export class SkillError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = code;
    this.code = code;
    this.details = details;
  }
}

export class HttpError extends SkillError {
  readonly status: number;

  constructor(status: number, url: string, body: string) {
    super('HttpError', `HTTP ${status} for ${url}`, { status, url, body: body.slice(0, 200) });
    this.status = status;
  }
}

export class ArticleNotFound extends SkillError {
  constructor(project: string, title: string, start: string, end: string) {
    super('ArticleNotFound', `No pageviews data for "${title}" on ${project} between ${start} and ${end}`, {
      project,
      title,
      start,
      end,
    });
  }
}

export class TopicNotFound extends SkillError {
  constructor(query: string, lang: string) {
    super('TopicNotFound', `Wikidata has no item matching "${query}" (search language: ${lang})`, { query, lang });
  }
}

export class NetworkError extends SkillError {
  constructor(url: string, cause: unknown) {
    super('NetworkError', `Request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      url,
    });
  }
}
