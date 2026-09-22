import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { outputDir } from '../lib/cache.js';
import { probeLanguages, resolveTopic } from '../lib/wikidata.js';
import { SkillError } from '../types.js';
import type { Lang, LanguageAvailability } from '../types.js';

const SAMPLE_LANGS = ['en', 'de', 'fr', 'es', 'pl'];
const SAMPLE_LIMIT = 6;

export interface ResolveArgs {
  topic: string;
  lang: string;
  langs: Lang[];
}

export interface ResolveOutput {
  ok: true;
  command: 'resolve';
  qid: string;
  label: string;
  description: string;
  ambiguous: boolean;
  candidates: Array<{ qid: string; label: string; description: string; score: number; wikiCount: number }>;
  languageCount: number;
  titles: Record<Lang, string>;
  unavailable: LanguageAvailability[];
  titlesFile: string;
}

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

export async function runResolve(args: ResolveArgs): Promise<ResolveOutput> {
  if (!args.topic.trim()) {
    throw new SkillError('InvalidInput', '--topic is required');
  }
  if (!/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(args.lang)) {
    throw new SkillError('InvalidInput', `--lang "${args.lang}" is not a language code`, { lang: args.lang });
  }

  const resolution = await resolveTopic(args.topic, args.lang);
  const missing = args.langs.filter((lang) => !resolution.titles[lang]);
  const unavailable = await probeLanguages(
    resolution.qid,
    missing,
    resolution.titles['en'] ?? resolution.label ?? args.topic,
  );

  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, `resolve-${resolution.qid}.json`);
  await writeFile(
    file,
    JSON.stringify(
      { query: args.topic, sourceLang: args.lang, resolvedAt: new Date().toISOString(), ...resolution, unavailable },
      null,
      2,
    ),
    'utf8',
  );

  return {
    ok: true,
    command: 'resolve',
    qid: resolution.qid,
    label: resolution.label,
    description: resolution.description,
    ambiguous: resolution.candidates.length > 0,
    candidates: resolution.candidates,
    languageCount: Object.keys(resolution.titles).length,
    titles: pickSample(resolution.titles, args.lang, args.langs),
    unavailable,
    titlesFile: file,
  };
}
