import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { outputDir } from '../lib/cache.js';
import { render } from '../lib/messages.js';
import type { Locale } from '../lib/messages.js';
import { openFile } from '../lib/open.js';
import { MAX_REPORT_LANGS, pickTopic, renderReport, reportFileName } from '../lib/report.js';
import type { ReportInput, ReportLanguage, ReportTrend } from '../lib/report.js';
import { SkillError } from '../types.js';
import type { Lang, Message } from '../types.js';
import { ARTIFACT_SCHEMA, runAnalyze } from './analyze.js';
import { runCompare } from './compare.js';

export interface ReportArgs {
  qid: string;
  langs: Lang[];
  from: string;
  to: string;
  locale: Locale;
  artifact: string | null;
  noCache: boolean;
  topic?: string;
  fileName?: string;
  unavailable?: Array<{ lang: string; reason: string }>;
}

export interface ReportOutput {
  ok: true;
  command: 'report';
  qid: string;
  langs: Lang[];
  locale: Locale;
  file: string;
  svg: string;
  artifact: string;
  artifactReused: boolean;
  opened: boolean;
  headline: string;
}

interface StoredLanguage {
  lang: string;
  title: string;
  unit: 'views_per_million' | 'raw_views';
  trend?: ReportTrend;
  primary?: 'relative' | 'absolute';
  absoluteTrend: ReportTrend;
  relativeTrend: ReportTrend | null;
  recentTrend: (ReportTrend & { weeks: number; from: string | null }) | null;
  n_effective: number;
  level: { median: number };
  confidence: ReportLanguage['confidence'];
  outliers: { dates: string[] };
  missingDays?: number;
  zeroDays?: number;
  coverage?: { missingDays: number; zeroDays?: number };
  points: Array<{ date: string; perMillion: number | null; smoothed: number }>;
}

interface StoredArtifact extends Partial<StoredLanguage> {
  schema?: number;
  kind?: 'analyze' | 'compare';
  qid: string;
  from: string;
  to: string;
  days?: number;
  caveats?: Message[];
  languages?: StoredLanguage[];
  ranking?: Array<{ lang: string }>;
}

export function artifactPath(qid: string, langs: Lang[]): string {
  return langs.length === 1 ? join(outputDir(), `analyze-${qid}-${langs[0]}.json`) : join(outputDir(), `compare-${qid}.json`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

export function isUsable(artifact: StoredArtifact, langs: Lang[], from: string, to: string): boolean {
  if (artifact.schema !== ARTIFACT_SCHEMA || artifact.from !== from || artifact.to !== to) {
    return false;
  }

  const available = artifact.kind === 'compare' ? (artifact.languages ?? []).map((item) => item.lang) : [artifact.lang];

  return langs.every((lang) => available.includes(lang));
}

function toLanguage(stored: StoredLanguage): ReportLanguage {
  const primaryTrend =
    stored.trend ?? (stored.primary === 'relative' && stored.relativeTrend ? stored.relativeTrend : stored.absoluteTrend);

  return {
    lang: stored.lang,
    title: stored.title,
    unit: stored.unit,
    trend: primaryTrend,
    relativeTrend: stored.relativeTrend,
    recentTrend: stored.recentTrend,
    weeks: stored.n_effective,
    medianPerMillion: stored.level.median,
    confidence: stored.confidence,
    outlierDates: stored.outliers.dates,
    missingDays: stored.missingDays ?? stored.coverage?.missingDays ?? 0,
    zeroDays: stored.zeroDays ?? stored.coverage?.zeroDays ?? 0,
    points: stored.points.map((point) => ({ date: point.date, perMillion: point.perMillion, smoothed: point.smoothed })),
  };
}

export function toReportInput(
  artifact: StoredArtifact,
  langs: Lang[],
  locale: Locale,
  source: string,
  topic?: string,
  unavailable: Array<{ lang: string; reason: string }> = [],
): ReportInput {
  const stored =
    artifact.kind === 'compare'
      ? (artifact.languages ?? [])
      : [artifact as unknown as StoredLanguage];

  const byLang = new Map(stored.map((item) => [item.lang, item]));
  const languages = langs
    .map((lang) => byLang.get(lang))
    .filter((item): item is StoredLanguage => item !== undefined)
    .map(toLanguage);

  return {
    qid: artifact.qid,
    from: artifact.from,
    to: artifact.to,
    days: artifact.days ?? languages[0]?.points.length ?? 0,
    topic: topic ?? pickTopic(languages, locale, artifact.qid),
    languages,
    caveats: artifact.kind === 'compare' ? (artifact.caveats ?? []) : [],
    ranking: (artifact.ranking ?? []).map((item) => item.lang).filter((lang) => langs.includes(lang)),
    source,
    unavailable,
  };
}

export async function runReport(args: ReportArgs): Promise<ReportOutput> {
  if (!/^Q\d+$/.test(args.qid)) {
    throw new SkillError('InvalidInput', `--qid "${args.qid}" is not a Wikidata item id`, { qid: args.qid });
  }

  if (args.langs.length === 0) {
    throw new SkillError('InvalidInput', '--langs is required, e.g. --langs en,de,uk');
  }

  if (args.langs.length > MAX_REPORT_LANGS) {
    throw new SkillError('InvalidInput', `a one-page report holds at most ${MAX_REPORT_LANGS} editions`, { langs: args.langs });
  }

  const path = args.artifact ?? artifactPath(args.qid, args.langs);
  let artifactReused = false;

  if (await exists(path)) {
    const stored = JSON.parse(await readFile(path, 'utf8')) as StoredArtifact;
    artifactReused = isUsable(stored, args.langs, args.from, args.to);
  }

  if (!artifactReused) {
    if (args.artifact) {
      throw new SkillError('InvalidInput', `Artifact ${args.artifact} is missing, outdated or lacks ${args.langs.join(', ')}`, {
        artifact: args.artifact,
        schema: ARTIFACT_SCHEMA,
      });
    }

    if (args.langs.length === 1) {
      await runAnalyze({
        qid: args.qid,
        lang: args.langs[0] as string,
        from: args.from,
        to: args.to,
        noCache: args.noCache,
        out: path,
        locale: null,
      });
    } else {
      await runCompare({
        qid: args.qid,
        langs: args.langs,
        from: args.from,
        to: args.to,
        noCache: args.noCache,
        out: path,
        locale: null,
      });
    }
  }

  const artifact = JSON.parse(await readFile(path, 'utf8')) as StoredArtifact;
  const input = toReportInput(artifact, args.langs, args.locale, path, args.topic, args.unavailable);

  if (input.languages.length === 0) {
    throw new SkillError('ArticleNotFound', `None of ${args.langs.join(', ')} has data in ${path}`, { artifact: path });
  }

  const pdf = join(
    outputDir(),
    reportFileName(args.fileName ?? input.languages.find((item) => item.lang === 'en')?.title ?? args.qid, args.qid),
  );

  const rendered = await renderReport(input, args.locale, pdf);
  const opened = openFile(rendered.pdf);

  return {
    ok: true,
    command: 'report',
    qid: args.qid,
    langs: input.languages.map((item) => item.lang),
    locale: args.locale,
    file: rendered.pdf,
    svg: rendered.svg,
    artifact: path,
    artifactReused,
    opened,
    headline: render(rendered.headline, args.locale),
  };
}
