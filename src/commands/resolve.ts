import { join } from 'node:path';
import { outputDir, writeArtifact } from '../lib/cache.js';
import { probeLanguages, resolveTopic } from '../lib/wikidata.js';
import { SkillError } from '../types.js';
import type { Lang, LanguageAvailability } from '../types.js';

// Editions sampled into titles when no --langs are given.
const SAMPLE_LANGS = ['en', 'de', 'fr', 'es', 'pl'];
const SAMPLE_LIMIT = 6;

/** Arguments of the resolve command. */
export interface ResolveArgs {
  topic: string;
  lang: string;
  langs: Lang[];
}

/** Resolved Wikidata item: article titles, candidates to choose from and requested editions without an article. */
export interface ResolveOutput {
  ok: true;
  command: 'resolve';
  qid: string;
  label: string;
  description: string;
  ambiguous: boolean;
  matchedBy: 'wikidata' | 'article_search';
  candidates: Array<{ qid: string; label: string; description: string; score: number; wikiCount: number; langs: Lang[] }>;
  languageCount: number;
  titles: Record<Lang, string>;
  unavailable: LanguageAvailability[];
  titlesFile: string;
}

// stdout carries only a sample of titles; the full list is in titlesFile.
function pickSample(titles: Record<Lang, string>, sourceLang: string, requested: Lang[]): Record<Lang, string> {
  const wanted = requested.length > 0 ? [sourceLang, ...requested] : [sourceLang, ...SAMPLE_LANGS];
  const sample: Record<Lang, string> = {};

  for (const lang of wanted) {
    const title = titles[lang];

    if (title && !(lang in sample) && Object.keys(sample).length < SAMPLE_LIMIT) {
      sample[lang] = title;
    }
  }

  return sample;
}

/** resolve command: topic to Wikidata QID and the article title in each edition. */
export async function runResolve(args: ResolveArgs): Promise<ResolveOutput> {
  if (!args.topic.trim()) {
    throw new SkillError('InvalidInput', '--topic is required');
  }

  if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(args.lang)) {
    throw new SkillError('InvalidInput', `--lang "${args.lang}" is not a language code`, { lang: args.lang });
  }

  const resolution = await resolveTopic(args.topic, args.lang);
  const covered = (titles: Record<Lang, string>) => args.langs.filter((lang) => titles[lang]);
  const titlesOf = new Map([
    [resolution.qid, resolution.titles],
    ...resolution.others.map((other) => [other.qid, other.titles] as const),
  ]);
  // Other matches covering more of the requested editions than the top match are offered as candidates too.
  const widest = Math.max(0, ...resolution.others.map((other) => covered(other.titles).length));
  const better = resolution.others.filter(
    (other) =>
      covered(other.titles).length === widest &&
      widest > covered(resolution.titles).length &&
      !resolution.candidates.some((item) => item.qid === other.qid),
  );
  const listed =
    resolution.candidates.length > 0
      ? resolution.candidates
      : [
          {
            qid: resolution.qid,
            label: resolution.label,
            description: resolution.description,
            score: 0,
            wikiCount: Object.keys(resolution.titles).length,
          },
        ];
  const chosen =
    better.length > 0 ? [...listed, ...better.map(({ titles: _titles, ...candidate }) => candidate)] : resolution.candidates;
  const candidates = chosen.map((item) => ({ ...item, langs: covered(titlesOf.get(item.qid) ?? {}) }));
  const missing = args.langs.filter((lang) => !resolution.titles[lang]);
  const unavailable = await probeLanguages(
    resolution.qid,
    missing,
    resolution.titles['en'] ?? resolution.label ?? args.topic,
  );

  const file = join(outputDir(), `resolve-${resolution.qid}.json`);

  await writeArtifact(file, { query: args.topic, sourceLang: args.lang, resolvedAt: new Date().toISOString(), ...resolution, unavailable });

  return {
    ok: true,
    command: 'resolve',
    qid: resolution.qid,
    label: resolution.label,
    description: resolution.description,
    // An article-search match is always a choice for the user: the query was a phrase, not a concept.
    ambiguous: candidates.length > 0 || resolution.matchedBy === 'article_search',
    matchedBy: resolution.matchedBy,
    candidates,
    languageCount: Object.keys(resolution.titles).length,
    titles: pickSample(resolution.titles, args.lang, args.langs),
    unavailable,
    titlesFile: file,
  };
}
