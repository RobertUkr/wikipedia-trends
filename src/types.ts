/** Wikipedia language edition code, e.g. "uk" or "zh-min-nan". */
export type Lang = string;

/** Pageviews API access filter: desktop and mobile combined. */
export const ACCESS = 'all-access';
/** Pageviews API agent filter: human readers only, excluding spiders and detected automated traffic. */
export const AGENT = 'user';
/** Pageviews API granularity: one data point per day. */
export const GRANULARITY = 'daily';

/** A Wikidata item considered for the topic; wikiCount is how many Wikipedia editions have an article on it. */
export interface TopicCandidate {
  qid: string;
  label: string;
  description: string;
  score: number;
  wikiCount: number;
}

/** Resolved topic: the chosen Wikidata item, its article title per language and the alternatives. */
export interface TopicResolution {
  qid: string;
  label: string;
  description: string;
  titles: Record<Lang, string>;
  candidates: TopicCandidate[];
  /** Remaining inspected items with their titles, used to suggest better-covered alternatives. */
  others: Array<TopicCandidate & { titles: Record<Lang, string> }>;
  /** Whether the item came from Wikidata search or from the Wikipedia article search fallback. */
  matchedBy: 'wikidata' | 'article_search';
}

/** Views on one day; date is YYYY-MM-DD. */
export interface DailyPoint {
  date: string;
  views: number;
}

/** Daily pageviews of one article in one edition. */
export interface ArticleViews {
  project: string;
  title: string;
  access: string;
  agent: string;
  granularity: string;
  points: DailyPoint[];
}

/** Daily pageviews of a whole edition, used to turn article views into a share per million. */
export interface ProjectTotals {
  project: string;
  access: string;
  agent: string;
  granularity: string;
  points: DailyPoint[];
}

/** Codes of localized texts (caveats, verdicts, report and chart labels); en/uk dictionaries live in lib/messages.ts. */
export type MessageCode =
  | 'LOW_VOLUME'
  | 'SERIES_TOO_SHORT'
  | 'SERIES_SHORTER_THAN_YOY'
  | 'INTERVAL_SPANS_ZERO'
  | 'SLOPE_SIGN_UNSTABLE'
  | 'SPIKES_EXCLUDED'
  | 'LONG_GAP_POSSIBLE_RENAME'
  | 'ZERO_VIEW_DAYS'
  | 'SHORT_HISTORY'
  | 'TITLE_HISTORY_MERGED'
  | 'RAW_COUNTS_NOT_COMPARABLE'
  | 'WEEKLY_AGGREGATION'
  | 'ABSOLUTE_VS_RELATIVE'
  | 'TWO_TRENDS_EXPLAINED'
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
  | 'INSUFFICIENT_CYCLES'
  | 'DIRECTION_UP'
  | 'DIRECTION_DOWN'
  | 'DIRECTION_FLAT'
  | 'DIRECTION_INCONCLUSIVE'
  | 'CONFIDENCE_LOW'
  | 'CONFIDENCE_MEDIUM'
  | 'CONFIDENCE_HIGH'
  | 'HEADLINE_SINGLE'
  | 'HEADLINE_GROWING'
  | 'HEADLINE_ALL_DOWN'
  | 'HEADLINE_NO_CLEAR_DIRECTION'
  | 'HEADLINE_MIXED_DOWN'
  | 'RESEARCH_LANGUAGE_LINE'
  | 'RESEARCH_NEEDS_CHOICE'
  | 'RESEARCH_SEARCH_MATCHES'
  | 'RESEARCH_NO_ARTICLES'
  | 'RESEARCH_UNAVAILABLE_TITLE'
  | 'RESEARCH_REPORT_LINE'
  | 'RESEARCH_REPORT_LINE_LANGS'
  | 'RESEARCH_MORE_CAVEATS'
  | 'TRUST_LOW'
  | 'TRUST_MEDIUM'
  | 'TRUST_HIGH'
  | 'COMPONENT_VOLUME'
  | 'COMPONENT_LENGTH'
  | 'COMPONENT_STABILITY'
  | 'COMPONENT_OUTLIERS'
  | 'COMPONENT_CONTINUITY'
  | 'RECOMMEND_LANGUAGE'
  | 'RECOMMEND_ORDER'
  | 'RECOMMEND_NONE_ALL_DOWN'
  | 'RECOMMEND_NONE_LOW_CONFIDENCE'
  | 'RECOMMEND_NONE_NO_DIRECTION'
  | 'RESEARCH_CANDIDATE'
  | 'RESEARCH_CANDIDATE_COVERAGE'
  | 'REPORT_SUBTITLE'
  | 'REPORT_TABLE_LANG'
  | 'REPORT_TABLE_RELATIVE'
  | 'REPORT_TABLE_CI'
  | 'REPORT_TABLE_RECENT'
  | 'REPORT_TABLE_MEDIAN'
  | 'REPORT_TABLE_CONFIDENCE'
  | 'REPORT_TREND_CELL'
  | 'REPORT_CAVEATS_TITLE'
  | 'REPORT_MORE_CAVEATS'
  | 'REPORT_LANG_CAVEAT'
  | 'REPORT_CHART_EXCLUDED'
  | 'REPORT_FOOTER_SOURCE'
  | 'REPORT_FOOTER_GENERATED'
  | 'REPORT_FOOTER_RANGE'
  | 'REPORT_FOOTER_MISSING'
  | 'REPORT_FOOTER_NO_MISSING'
  | 'REPORT_FOOTER_ZERO_DAYS'
  | 'REPORT_CONFIDENCE_CELL'
  | 'REPORT_CONFIDENCE_CAPPED'
  | 'CHART_Y_LABEL'
  | 'CHART_LEGEND_RAW'
  | 'CHART_LEGEND_SMOOTHED'
  | 'CHART_LEGEND_TREND'
  | 'CHART_LEGEND_OUTLIERS'
  | 'CHART_RECENT_MARKER'
  | 'CHART_NO_DATA';

/** Value substituted into a message; can itself be a nested message. */
export type MessageParam = string | number | Message;

/** Language-neutral message, rendered to text by lib/messages.ts. */
export interface Message {
  code: MessageCode;
  params: Record<string, MessageParam>;
}

/** One Wikipedia full-text search hit; snippet is plain text. */
export interface ArticleSearchHit {
  title: string;
  pageid: number;
  snippet: string;
}

/** Wikipedia full-text search result; totalHits counts all matches, not only the returned hits. */
export interface ArticleSearchResult {
  project: string;
  query: string;
  totalHits: number;
  hits: ArticleSearchHit[];
}

/** Whether a language edition could be analysed and, if not, why. */
export type LanguageStatus =
  | 'available'
  | 'short_history'
  | 'no_article'
  | 'possible_alternative'
  | 'no_data'
  | 'fetch_failed';

/** Similarly titled article found by search; never used without the user's confirmation. */
export interface AlternativeArticle {
  title: string;
  score: number;
  snippet: string;
  url: string;
  confirmed: false;
}

/** A language that yields no trend, with the reason and any search alternatives. */
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

/** Machine-readable error codes reported by the CLI. */
export type ErrorCode =
  | 'InvalidInput'
  | 'TopicNotFound'
  | 'ArticleNotFound'
  | 'ShortHistory'
  | 'NoSitelink'
  | 'HttpError'
  | 'NetworkError';

/** Base CLI error with a machine-readable code and structured details. */
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

/** Non-success HTTP response; the body kept in details is truncated to 200 characters. */
export class HttpError extends SkillError {
  readonly status: number;

  constructor(status: number, url: string, body: string) {
    super('HttpError', `HTTP ${status} for ${url}`, { status, url, body: body.slice(0, 200) });
    this.status = status;
  }
}

/** The Pageviews API has no data for the article in the requested range. */
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

/** No Wikidata item matches the topic query. */
export class TopicNotFound extends SkillError {
  constructor(query: string, lang: string) {
    super('TopicNotFound', `Wikidata has no item matching "${query}" (search language: ${lang})`, { query, lang });
  }
}

/** Request failed without an HTTP response, e.g. a connection error or timeout. */
export class NetworkError extends SkillError {
  constructor(url: string, cause: unknown) {
    super('NetworkError', `Request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      url,
    });
  }
}
