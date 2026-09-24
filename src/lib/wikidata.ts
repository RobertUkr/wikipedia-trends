import { SkillError, TopicNotFound } from '../types.js';
import type {
  AlternativeArticle,
  ArticleSearchResult,
  Lang,
  LanguageAvailability,
  TopicCandidate,
  TopicResolution,
} from '../types.js';
import { message } from './messages.js';
import { normalizeProject, requestJson, searchArticles } from './wikimedia.js';
import type { RequestOptions } from './wikimedia.js';

const API = 'https://www.wikidata.org/w/api.php';
// Wikidata search results fetched; only the top INSPECT_LIMIT are checked for sitelinks.
const SEARCH_LIMIT = 7;
const INSPECT_LIMIT = 5;
// Candidates scoring within this of the top one are treated as competing matches.
const AMBIGUITY_DELTA = 0.12;
// A competing match needs at least 20% of the best-linked candidate's editions, so obscure namesakes do not make a topic ambiguous.
const NOTABILITY_RATIO = 0.2;
// Search hits checked per language that has no sitelink.
const SEARCH_HITS = 5;
// Minimum title similarity for a search hit to be offered as a possible alternative.
const ALTERNATIVE_MIN_SCORE = 0.5;

// Wikipedia sitelink keys such as "ukwiki" or "zh_min_nanwiki"; sister projects like "ukwikiquote" do not match.
const WIKI_SITE = /^([a-z0-9_-]+)wiki$/;
// Wikimedia wikis whose site id ends in "wiki" but which are not language editions of Wikipedia.
const NON_LANGUAGE_WIKIS = new Set([
  'commons',
  'species',
  'meta',
  'incubator',
  'sources',
  'wikidata',
  'mediawiki',
  'outreach',
  'foundation',
  'wikimania',
  'test',
  'test2',
  'beta',
  'strategy',
  'advisory',
  'usability',
  'quality',
  'vote',
  'sep11',
  'ten',
  'nostalgia',
]);

interface SearchEntry {
  id?: string;
  label?: string;
  description?: string;
  match?: { type?: string; language?: string; text?: string };
}

interface SearchResponse {
  search?: SearchEntry[];
}

interface EntitiesResponse {
  entities?: Record<string, { sitelinks?: Record<string, { site?: string; title?: string }> }>;
}

interface LabelsResponse {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value?: string }>;
      aliases?: Record<string, Array<{ value?: string }>>;
    }
  >;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Relevance of a Wikidata search entry to the query, from match quality, match type and search rank. */
export function scoreEntry(query: string, entry: SearchEntry, index: number): number {
  const target = normalize(query);
  const label = normalize(entry.label);
  const matched = normalize(entry.match?.text);

  let score = 0;
  if (matched === target || label === target) {
    score += 0.6;
  } else if (label.startsWith(target) || matched.startsWith(target)) {
    score += 0.35;
  } else if (label.includes(target) || matched.includes(target)) {
    score += 0.2;
  }

  if (entry.match?.type === 'label') {
    score += 0.2;
  } else if (entry.match?.type === 'alias') {
    score += 0.1;
  }

  // Rank bonus: 0.2 for the first result, nothing from the fifth on.
  score += Math.max(0, 0.2 - index * 0.05);
  return Math.round(score * 1000) / 1000;
}

/** Article title per language edition from Wikidata sitelinks, skipping sister projects and non-language wikis. */
export function sitelinksToTitles(sitelinks: Record<string, { site?: string; title?: string }>): Record<Lang, string> {
  const titles: Record<Lang, string> = {};
  for (const [site, link] of Object.entries(sitelinks)) {
    const match = WIKI_SITE.exec(site);
    const title = link?.title;
    if (!match || !title) {
      continue;
    }
    const prefix = match[1] as string;
    if (NON_LANGUAGE_WIKIS.has(prefix)) {
      continue;
    }
    // Site ids use underscores where language codes use hyphens: zh_min_nanwiki -> zh-min-nan.
    titles[prefix.replace(/_/g, '-')] = title;
  }
  return titles;
}

// One wbgetentities call covers all candidates, saving requests.
async function fetchSitelinkMap(
  qids: string[],
  opts: RequestOptions,
): Promise<Record<string, Record<Lang, string>>> {
  if (qids.length === 0) {
    return {};
  }
  const url = `${API}?${new URLSearchParams({
    action: 'wbgetentities',
    ids: qids.join('|'),
    props: 'sitelinks',
    format: 'json',
    formatversion: '2',
  }).toString()}`;

  const payload = await requestJson<EntitiesResponse>(url, opts);
  const result: Record<string, Record<Lang, string>> = {};
  for (const qid of qids) {
    result[qid] = sitelinksToTitles(payload.entities?.[qid]?.sitelinks ?? {});
  }
  return result;
}

export async function getSitelinks(qid: string, opts: RequestOptions = {}): Promise<Record<Lang, string>> {
  if (!/^Q\d+$/.test(qid)) {
    throw new SkillError('InvalidInput', `"${qid}" is not a Wikidata item id (expected Q123)`, { qid });
  }
  const map = await fetchSitelinkMap([qid], opts);
  const titles = map[qid] ?? {};
  if (Object.keys(titles).length === 0) {
    throw new SkillError('NoSitelink', `Wikidata item ${qid} has no Wikipedia sitelinks`, { qid });
  }
  return titles;
}

/** Resolves a topic query to a Wikidata item and its articles, falling back to Wikipedia search for phrases. */
export async function resolveTopic(
  query: string,
  sourceLang: string,
  opts: RequestOptions = {},
): Promise<TopicResolution> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new SkillError('InvalidInput', 'Topic query must not be empty');
  }

  const url = `${API}?${new URLSearchParams({
    action: 'wbsearchentities',
    search: trimmed,
    language: sourceLang,
    uselang: sourceLang,
    type: 'item',
    limit: String(SEARCH_LIMIT),
    format: 'json',
    formatversion: '2',
  }).toString()}`;

  const search = async (): Promise<Array<SearchEntry & { id: string }>> => {
    const payload = await requestJson<SearchResponse>(url, opts);
    return (payload.search ?? []).filter((entry): entry is SearchEntry & { id: string } =>
      typeof entry.id === 'string');
  };

  const entries = await search().then((found) => (found.length > 0 ? found : search()));

  if (entries.length === 0) {
    const fromArticles = await resolveByArticleSearch(trimmed, sourceLang, opts);
    if (!fromArticles) {
      throw new TopicNotFound(trimmed, sourceLang);
    }

    return fromArticles;
  }

  const scored = entries
    .map((entry, index) => ({ entry, score: scoreEntry(trimmed, entry, index) }))
    .sort((a, b) => b.score - a.score);

  const inspected = scored.slice(0, INSPECT_LIMIT);
  const sitelinkMap = await fetchSitelinkMap(
    inspected.map((item) => item.entry.id),
    opts,
  );

  // Items without Wikipedia articles and disambiguation pages cannot be analysed.
  const candidates: TopicCandidate[] = inspected
    .map((item) => ({
      qid: item.entry.id,
      label: item.entry.label ?? '',
      description: item.entry.description ?? '',
      score: item.score,
      wikiCount: Object.keys(sitelinkMap[item.entry.id] ?? {}).length,
    }))
    .filter((candidate) => candidate.wikiCount > 0 && !isDisambiguation(candidate, sitelinkMap[candidate.qid] ?? {}));
  // An item whose source-language article is titled exactly like the query stays in contention regardless of score.
  const namesArticle = (candidate: TopicCandidate) =>
    normalize(sitelinkMap[candidate.qid]?.[sourceLang]) === normalize(trimmed);

  const top = candidates[0];

  if (!top) {
    throw new SkillError(
      'NoSitelink',
      `No Wikidata item matching "${trimmed}" has Wikipedia articles`,
      { query: trimmed, lang: sourceLang, inspected: inspected.map((item) => item.entry.id) },
    );
  }

  const byScore = candidates.filter(
    (candidate) => top.score - candidate.score <= AMBIGUITY_DELTA || namesArticle(candidate),
  );
  // Of the competing matches, keep only those comparably notable to the best-linked one.
  const mostLinked = Math.max(...byScore.map((candidate) => candidate.wikiCount));
  const close = byScore
    .filter((candidate) => candidate.wikiCount >= mostLinked * NOTABILITY_RATIO)
    .sort((a, b) => b.score - a.score || b.wikiCount - a.wikiCount);
  const best = close[0] ?? top;

  return {
    qid: best.qid,
    label: best.label,
    description: best.description,
    titles: sitelinkMap[best.qid] ?? {},
    // Candidates are returned only when the user has a real choice to make.
    candidates: close.length > 1 ? close : [],
    others: candidates
      .filter((candidate) => candidate.qid !== best.qid)
      .map((candidate) => ({ ...candidate, titles: sitelinkMap[candidate.qid] ?? {} })),
    matchedBy: 'wikidata',
  };
}

interface ArticleEntitiesResponse {
  entities?: Record<
    string,
    {
      id?: string;
      labels?: Record<string, { value?: string }>;
      descriptions?: Record<string, { value?: string }>;
      sitelinks?: Record<string, { site?: string; title?: string }>;
    }
  >;
}

/** Fallback for phrases that are not item labels: Wikipedia search hits mapped to their Wikidata items. */
export async function resolveByArticleSearch(
  query: string,
  sourceLang: string,
  opts: RequestOptions = {},
): Promise<TopicResolution | null> {
  const found = await searchArticles(sourceLang, query, INSPECT_LIMIT, opts);
  if (found.hits.length === 0) {
    return null;
  }

  // Wikidata site id of the edition, e.g. zh-min-nan -> zh_min_nanwiki.
  const site = `${sourceLang.replace(/-/g, '_')}wiki`;
  const url = `${API}?${new URLSearchParams({
    action: 'wbgetentities',
    sites: site,
    titles: found.hits.map((hit) => hit.title).join('|'),
    props: 'labels|descriptions|sitelinks',
    languages: sourceLang,
    format: 'json',
    formatversion: '2',
  }).toString()}`;

  const payload = await requestJson<ArticleEntitiesResponse>(url, opts);
  const entities = Object.values(payload.entities ?? {}).filter(
    (entity): entity is typeof entity & { id: string } => typeof entity.id === 'string' && /^Q\d+$/.test(entity.id),
  );
  const byTitle = new Map(entities.map((entity) => [entity.sitelinks?.[site]?.title ?? '', entity]));

  const candidates: TopicCandidate[] = [];
  const titles: Record<string, Record<Lang, string>> = {};
  for (const hit of found.hits) {
    const entity = byTitle.get(hit.title);
    // Hits without an item are skipped; several hits on one item keep only the first.
    if (!entity || titles[entity.id]) {
      continue;
    }
    titles[entity.id] = sitelinksToTitles(entity.sitelinks ?? {});
    candidates.push({
      qid: entity.id,
      label: entity.labels?.[sourceLang]?.value ?? hit.title,
      description: entity.descriptions?.[sourceLang]?.value ?? '',
      score: 0,
      wikiCount: Object.keys(titles[entity.id] ?? {}).length,
    });
  }

  const first = candidates[0];
  if (!first) {
    return null;
  }

  return {
    qid: first.qid,
    label: first.label,
    description: first.description,
    titles: titles[first.qid] ?? {},
    candidates,
    others: candidates.slice(1).map((candidate) => ({ ...candidate, titles: titles[candidate.qid] ?? {} })),
    matchedBy: 'article_search',
  };
}

// Title qualifiers of disambiguation pages in en, uk, ru, pl, cs, de, fr and es.
const DISAMBIGUATION_TITLE = /\((disambiguation|значення|значения|ujednoznacznienie|rozcestník|begriffsklärung|homonymie|desambiguación)\)$/i;
// Wikidata descriptions of disambiguation items in en, uk, ru and pl.
const DISAMBIGUATION_DESCRIPTION = /disambiguation|сторінка значень|страница значений|strona ujednoznaczniająca/i;

/** Whether the item is a disambiguation page, judged by its description or any of its article titles. */
export function isDisambiguation(candidate: TopicCandidate, titles: Record<Lang, string>): boolean {
  return (
    DISAMBIGUATION_DESCRIPTION.test(candidate.description) ||
    Object.values(titles).some((title) => DISAMBIGUATION_TITLE.test(title))
  );
}

/** Similarity of an article title to the query, from 1 for identical down to word overlap. */
export function titleSimilarity(query: string, title: string): number {
  const left = normalize(query);
  const right = normalize(title);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }

  // Ignore a trailing qualifier such as "(film)".
  const bare = right.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (left === bare) {
    return 0.9;
  }
  if (bare.includes(left) || left.includes(bare)) {
    return 0.7;
  }

  // Otherwise Jaccard similarity of the word sets.
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(bare.split(/\s+/).filter(Boolean));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : Math.round((shared / union) * 100) / 100;
}

/** Classifies a language without a sitelink as no_article or possible_alternative from its search hits. */
export function classifySearchResult(lang: Lang, query: string, result: ArticleSearchResult): LanguageAvailability {
  const project = normalizeProject(lang);
  const alternatives: AlternativeArticle[] = result.hits
    .map((hit) => ({
      title: hit.title,
      score: titleSimilarity(query, hit.title),
      snippet: hit.snippet,
      url: `https://${project}/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      confirmed: false as const,
    }))
    .filter((candidate) => candidate.score >= ALTERNATIVE_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  if (alternatives.length > 0) {
    return {
      lang,
      project,
      status: 'possible_alternative',
      title: null,
      reason: message('POSSIBLE_ALTERNATIVE', { project, title: alternatives[0]?.title ?? '' }),
      requiresConfirmation: true,
      searchQuery: query,
      searchHits: result.totalHits,
      alternatives,
    };
  }

  return {
    lang,
    project,
    status: 'no_article',
    title: null,
    reason:
      result.totalHits > 0
        ? message('NO_ARTICLE_WITH_MENTIONS', { project, query, hits: result.totalHits })
        : message('NO_ARTICLE_NO_HITS', { project, query }),
    requiresConfirmation: false,
    searchQuery: query,
    searchHits: result.totalHits,
    alternatives: [],
  };
}

/** Item label per language, falling back to the first alias; used as the search query in each edition. */
export async function getLabels(
  qid: string,
  langs: Lang[],
  opts: RequestOptions = {},
): Promise<Record<Lang, string>> {
  if (langs.length === 0) {
    return {};
  }
  const url = `${API}?${new URLSearchParams({
    action: 'wbgetentities',
    ids: qid,
    props: 'labels|aliases',
    languages: langs.join('|'),
    format: 'json',
    formatversion: '2',
  }).toString()}`;

  const payload = await requestJson<LabelsResponse>(url, opts);
  const entity = payload.entities?.[qid];
  const labels: Record<Lang, string> = {};
  for (const lang of langs) {
    const value = entity?.labels?.[lang]?.value ?? entity?.aliases?.[lang]?.[0]?.value;
    if (value) {
      labels[lang] = value;
    }
  }
  return labels;
}

/** Checks languages without a sitelink by searching each edition for the item's label. */
export async function probeLanguages(
  qid: string,
  langs: Lang[],
  fallbackQuery: string,
  opts: RequestOptions = {},
): Promise<LanguageAvailability[]> {
  if (langs.length === 0) {
    return [];
  }

  const labels = await getLabels(qid, langs, opts);
  const results: LanguageAvailability[] = [];

  for (const lang of langs) {
    const query = labels[lang] ?? fallbackQuery;
    try {
      const search = await searchArticles(lang, query, SEARCH_HITS, opts);
      results.push(classifySearchResult(lang, query, search));
    } catch (error) {
      // A failed search is reported for that language instead of aborting the others.
      results.push({
        lang,
        project: normalizeProject(lang),
        status: 'fetch_failed',
        title: null,
        reason: message('SEARCH_FAILED', {
          project: normalizeProject(lang),
          error: error instanceof Error ? error.message : String(error),
        }),
        requiresConfirmation: false,
        searchQuery: query,
        searchHits: 0,
        alternatives: [],
      });
    }
  }

  return results;
}

/** Page limit when reading an item's revision history (500 revisions per page). */
export const MAX_HISTORY_PAGES = 20;

/** Edit summary of a Wikidata item revision, parsed for sitelink changes to trace renames. */
export interface RevisionComment {
  timestamp: string;
  comment: string;
}

interface RevisionsResponse {
  continue?: { rvcontinue?: string };
  query?: { pages?: Array<{ revisions?: Array<{ timestamp?: string; comment?: string }> }> };
}

/** Edit summaries of a Wikidata item, newest first, reaching back at least to the given date. */
export async function getRevisionComments(qid: string, since: string, opts: RequestOptions = {}): Promise<RevisionComment[]> {
  const comments: RevisionComment[] = [];
  let next: string | undefined;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'revisions',
      titles: qid,
      rvprop: 'timestamp|comment',
      // 500 is the per-request maximum for regular (non-bot) clients.
      rvlimit: '500',
      format: 'json',
      formatversion: '2',
    });

    // Continue from where the previous page of older revisions ended.
    if (next) {
      params.set('rvcontinue', next);
    }

    const payload = await requestJson<RevisionsResponse>(`${API}?${params.toString()}`, opts);
    const batch = (payload.query?.pages?.[0]?.revisions ?? []).map((revision) => ({
      timestamp: revision.timestamp ?? '',
      comment: revision.comment ?? '',
    }));

    comments.push(...batch);
    next = payload.continue?.rvcontinue;

    // Revisions come newest first, so stop once a page reaches past the start date.
    if (!next || (batch.at(-1)?.timestamp ?? '') < since) {
      break;
    }
  }

  return comments;
}
