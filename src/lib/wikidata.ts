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
const SEARCH_LIMIT = 7;
const INSPECT_LIMIT = 5;
const AMBIGUITY_DELTA = 0.12;
const SEARCH_HITS = 5;
const ALTERNATIVE_MIN_SCORE = 0.5;

const WIKI_SITE = /^([a-z0-9_-]+)wiki$/;
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

  score += Math.max(0, 0.2 - index * 0.05);
  return Math.round(score * 1000) / 1000;
}

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
    titles[prefix.replace(/_/g, '-')] = title;
  }
  return titles;
}

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
    throw new TopicNotFound(trimmed, sourceLang);
  }

  const scored = entries
    .map((entry, index) => ({ entry, score: scoreEntry(trimmed, entry, index) }))
    .sort((a, b) => b.score - a.score);

  const inspected = scored.slice(0, INSPECT_LIMIT);
  const sitelinkMap = await fetchSitelinkMap(
    inspected.map((item) => item.entry.id),
    opts,
  );

  const candidates: TopicCandidate[] = inspected
    .map((item) => ({
      qid: item.entry.id,
      label: item.entry.label ?? '',
      description: item.entry.description ?? '',
      score: item.score,
      wikiCount: Object.keys(sitelinkMap[item.entry.id] ?? {}).length,
    }))
    .filter((candidate) => candidate.wikiCount > 0);

  const best = candidates[0];
  if (!best) {
    throw new SkillError(
      'NoSitelink',
      `No Wikidata item matching "${trimmed}" has Wikipedia articles`,
      { query: trimmed, lang: sourceLang, inspected: inspected.map((item) => item.entry.id) },
    );
  }

  const close = candidates.filter((candidate) => best.score - candidate.score <= AMBIGUITY_DELTA);

  return {
    qid: best.qid,
    label: best.label,
    description: best.description,
    titles: sitelinkMap[best.qid] ?? {},
    candidates: close.length > 1 ? close : [],
  };
}

export function titleSimilarity(query: string, title: string): number {
  const left = normalize(query);
  const right = normalize(title);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }

  const bare = right.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (left === bare) {
    return 0.9;
  }
  if (bare.includes(left) || left.includes(bare)) {
    return 0.7;
  }

  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(bare.split(/\s+/).filter(Boolean));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : Math.round((shared / union) * 100) / 100;
}

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
