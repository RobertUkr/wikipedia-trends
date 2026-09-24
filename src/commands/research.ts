import { readFile } from 'node:fs/promises';
import { render } from '../lib/messages.js';
import type { Locale } from '../lib/messages.js';
import { confidenceMessage, directionMessage, selectCaveats, signed, verdictLines } from '../lib/report.js';
import type { ReportLanguage } from '../lib/report.js';
import { toApiDate } from '../lib/wikimedia.js';
import { SkillError } from '../types.js';
import type { Lang, LanguageAvailability } from '../types.js';
import { runAnalyze } from './analyze.js';
import { runCompare } from './compare.js';
import { artifactPath, runReport, toReportInput } from './report.js';
import { runResolve } from './resolve.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_YEARS = 2;
export const DATA_LAG_DAYS = 2;
export const MAX_CAVEATS = 8;

export interface ResearchArgs {
  topic: string | null;
  qid: string | null;
  lang: Lang;
  langs: Lang[];
  from: string | null;
  to: string | null;
  years: number;
  locale: Locale;
  noCache: boolean;
}

export interface ResearchLanguage {
  lang: Lang;
  title: string;
  direction: string;
  percentPerYear: number | null;
  ci95: [number, number] | null;
  recentDirection: string | null;
  recentPercentPerYear: number | null;
  confidence: string;
  medianPerMillion: number;
  text: string;
}

export type ResearchOutput =
  | {
      ok: true;
      command: 'research';
      status: 'done';
      qid: string;
      topic: string;
      range: { from: string; to: string };
      locale: Locale;
      headline: string;
      summary: string;
      languages: ResearchLanguage[];
      unavailable: Array<{ lang: Lang; status: string; reason: string }>;
      caveats: string[];
      moreCaveats: number;
      report: string;
      artifact: string;
    }
  | {
      ok: true;
      command: 'research';
      status: 'needs_choice' | 'no_articles';
      topic: string;
      message: string;
      summary: string;
      candidates: Array<{ qid: string; label: string; description: string }>;
      unavailable: Array<{ lang: Lang; status: string; reason: string }>;
    };

export function defaultRange(years: number, today: Date = new Date()): { from: string; to: string } {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DATA_LAG_DAYS * DAY_MS);
  const start = new Date(Date.UTC(end.getUTCFullYear() - years, end.getUTCMonth(), end.getUTCDate()) + DAY_MS);

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function describeUnavailable(items: LanguageAvailability[], locale: Locale): Array<{ lang: Lang; status: string; reason: string }> {
  return items.map((item) => ({ lang: item.lang, status: item.status, reason: render(item.reason, locale) }));
}

export function buildSummary(parts: {
  headline: string;
  verdicts: string[];
  languages: ResearchLanguage[];
  caveats: string[];
  moreCaveats: number;
  unavailable: Array<{ lang: Lang; reason: string }>;
  report: string;
  locale: Locale;
}): string {
  const t = (code: 'REPORT_CAVEATS_TITLE' | 'RESEARCH_UNAVAILABLE_TITLE', params = {}) =>
    render({ code, params }, parts.locale);
  const lines: string[] = [`**${parts.headline}**`, '', ...parts.verdicts];

  if (parts.languages.length > 1) {
    lines.push('', ...parts.languages.map((item) => `- ${item.text}`));
  }

  if (parts.caveats.length > 0) {
    lines.push('', `**${t('REPORT_CAVEATS_TITLE')}**`, ...parts.caveats.map((caveat) => `- ${caveat}`));
  }

  if (parts.moreCaveats > 0) {
    lines.push(`- ${render({ code: 'RESEARCH_MORE_CAVEATS', params: { count: parts.moreCaveats } }, parts.locale)}`);
  }

  if (parts.unavailable.length > 0) {
    lines.push('', `**${t('RESEARCH_UNAVAILABLE_TITLE')}**`, ...parts.unavailable.map((item) => `- ${item.lang}: ${item.reason}`));
  }

  lines.push('', render({ code: 'RESEARCH_REPORT_LINE', params: { path: parts.report } }, parts.locale));

  return lines.join('\n');
}

export function languageLine(item: ReportLanguage, locale: Locale): ResearchLanguage {
  const primary = item.relativeTrend ?? item.trend;
  const recent = item.recentTrend;

  return {
    lang: item.lang,
    title: item.title,
    direction: primary.direction,
    percentPerYear: primary.percentPerYear,
    ci95: primary.ci95,
    recentDirection: recent?.direction ?? null,
    recentPercentPerYear: recent?.percentPerYear ?? null,
    confidence: item.confidence.overall,
    medianPerMillion: Math.round(item.medianPerMillion * 100) / 100,
    text: render(
      {
        code: 'RESEARCH_LANGUAGE_LINE',
        params: {
          lang: item.lang,
          direction: directionMessage(primary.direction),
          percent: signed(primary.percentPerYear),
          low: signed(primary.ci95?.[0] ?? null),
          high: signed(primary.ci95?.[1] ?? null),
          recent: directionMessage(recent?.direction ?? 'inconclusive'),
          recentPercent: signed(recent?.percentPerYear ?? null),
          confidence: confidenceMessage(item.confidence.overall),
        },
      },
      locale,
    ),
  };
}

export async function runResearch(args: ResearchArgs): Promise<ResearchOutput> {
  if (!args.topic && !args.qid) {
    throw new SkillError('InvalidInput', 'research needs --topic or --qid');
  }

  if (args.langs.length === 0) {
    throw new SkillError('InvalidInput', '--langs is required, e.g. --langs uk,pl');
  }

  const range = args.from && args.to ? { from: args.from, to: args.to } : defaultRange(args.years);
  toApiDate(range.from);
  toApiDate(range.to);

  let qid = args.qid;
  let topic = args.topic ?? args.qid ?? '';
  let langs = args.langs;
  let unavailable: LanguageAvailability[] = [];

  if (!qid) {
    const resolved = await runResolve({ topic: args.topic as string, lang: args.lang, langs: args.langs });

    if (resolved.ambiguous) {
      const message = render({ code: 'RESEARCH_NEEDS_CHOICE', params: { topic } }, args.locale);
      const candidates = resolved.candidates.map((item) => ({
        qid: item.qid,
        label: item.label,
        description: item.description,
      }));

      return {
        ok: true,
        command: 'research',
        status: 'needs_choice',
        topic,
        message,
        summary: [
          message,
          '',
          ...candidates.map(
            (item) => `- ${render({ code: 'RESEARCH_CANDIDATE', params: { ...item } }, args.locale)}`,
          ),
        ].join('\n'),
        candidates,
        unavailable: [],
      };
    }

    qid = resolved.qid;
    topic = resolved.label || topic;
    unavailable = resolved.unavailable;
    const missing = new Set(unavailable.map((item) => item.lang));
    langs = args.langs.filter((lang) => !missing.has(lang));
  }

  if (langs.length === 0) {
    const message = render({ code: 'RESEARCH_NO_ARTICLES', params: { topic, langs: args.langs.join(', ') } }, args.locale);
    const missing = describeUnavailable(unavailable, args.locale);

    return {
      ok: true,
      command: 'research',
      status: 'no_articles',
      topic,
      message,
      summary: [message, '', ...missing.map((item) => `- ${item.lang}: ${item.reason}`)].join('\n'),
      candidates: [],
      unavailable: missing,
    };
  }

  const artifact = artifactPath(qid, langs, range.from, range.to);

  if (langs.length === 1) {
    await runAnalyze({ qid, lang: langs[0] as string, from: range.from, to: range.to, noCache: args.noCache, out: artifact, locale: null });
  } else {
    const compared = await runCompare({ qid, langs, from: range.from, to: range.to, noCache: args.noCache, out: artifact, locale: null });
    unavailable = [...unavailable, ...compared.unavailable.filter((item) => !unavailable.some((known) => known.lang === item.lang))];
    const failed = new Set(compared.unavailable.map((item) => item.lang));
    langs = langs.filter((lang) => !failed.has(lang));
  }

  const report = await runReport({
    qid,
    langs,
    from: range.from,
    to: range.to,
    locale: args.locale,
    artifact,
    noCache: args.noCache,
  });

  const stored = JSON.parse(await readFile(artifact, 'utf8')) as Parameters<typeof toReportInput>[0];
  const input = toReportInput(stored, langs, args.locale, artifact);
  const allCaveats = selectCaveats(input).map((caveat) => render(caveat, args.locale));
  const caveats = allCaveats.slice(0, MAX_CAVEATS);
  const moreCaveats = Math.max(0, allCaveats.length - MAX_CAVEATS);
  const languages = input.languages.map((item) => languageLine(item, args.locale));
  const missing = describeUnavailable(unavailable, args.locale);

  return {
    ok: true,
    command: 'research',
    status: 'done',
    qid,
    topic: input.topic,
    range,
    locale: args.locale,
    headline: report.headline,
    summary: buildSummary({
      headline: report.headline,
      verdicts: verdictLines(input).map((line) => render(line, args.locale)),
      languages,
      caveats,
      moreCaveats,
      unavailable: missing,
      report: report.file,
      locale: args.locale,
    }),
    languages,
    unavailable: missing,
    caveats,
    moreCaveats,
    report: report.file,
    artifact,
  };
}
