import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { packageRoot } from './cache.js';
import { CHART_HEIGHT, CHART_WIDTH, FONT_FAMILY, lineChart } from './chart.js';
import type { ChartSeries, TrendBand } from './chart.js';
import { levelFromScore } from './confidence.js';
import { addDays } from './dates.js';
import type { ComponentName, ConfidenceComponent, ConfidenceLevel } from './confidence.js';
import { message, render } from './messages.js';
import type { Locale } from './messages.js';
import type { Direction } from './stats.js';
import type { Message, MessageCode } from '../types.js';

/** Regular PDF font: bundled DejaVu Sans, because the PDF standard fonts have no Cyrillic glyphs. */
export const FONT_REGULAR = 'DejaVuSans';
/** Bold counterpart of FONT_REGULAR. */
export const FONT_BOLD = 'DejaVuSans-Bold';
/** Page margin in points on every side. */
export const PAGE_MARGIN = 36;

// A4 in PDF points.
const PAGE = { width: 595.28, height: 841.89 };
const CONTENT_WIDTH = PAGE.width - PAGE_MARGIN * 2;
// Kept free at the bottom of the page for the three footer lines.
const FOOTER_HEIGHT = 40;
// Top of the footer's first line, at the bottom of the page wherever the content ended.
const FOOTER_TOP = PAGE.height - PAGE_MARGIN - FOOTER_HEIGHT + 8;
// Room kept for the "more caveats" line while caveats still fit.
const MORE_CAVEATS_LINE_HEIGHT = 12;
// Table column widths in points; the last column takes whatever is left of the content width.
const FIXED_COLUMNS = [112, 104, 70, 104, 54];
const LAST_COLUMN = FIXED_COLUMNS.reduce((rest, width) => rest - width, CONTENT_WIDTH);
// Padding inside a table cell on every side.
const CELL_PAD = 3;

/** Per-language caveats printed in the PDF, in print order; codes not listed are left off the page. */
export const LANGUAGE_CAVEAT_PRIORITY: MessageCode[] = [
  'TREND_REVERSAL',
  'TITLE_HISTORY_MERGED',
  'EDITION_TRAFFIC_DECLINING',
  'ABSOLUTE_VS_RELATIVE',
  'SLOPE_SIGN_UNSTABLE',
  'LOW_VOLUME',
  'LONG_GAP_POSSIBLE_RENAME',
  'ZERO_VIEW_DAYS',
  'INTERVAL_SPANS_ZERO',
  'RAW_COUNTS_NOT_COMPARABLE',
];

/** Above this many languages the report switches to compact mode so it stays on one page. */
export const COMPACT_FROM_LANGS = 4;
/** Most languages one report holds and still fits a single page. */
export const MAX_REPORT_LANGS = 8;
/** Caveats that read the same for every language, so the PDF prints them once, not per language. */
export const ONCE_PER_REPORT: MessageCode[] = ['TWO_TRENDS_EXPLAINED', 'WEEKLY_AGGREGATION'];

/** A fitted trend: percent per year with its 95% interval, plus the weekly linear fit drawn on the chart. */
export interface ReportTrend {
  percentPerYear: number | null;
  ci95: [number, number] | null;
  direction: Direction;
  slopePerWeek: number;
  intercept: number;
  ci95Slope: [number, number];
}

/** One day of the series in views per million, with its 7-day average used only for the chart. */
export interface ReportPoint {
  date: string;
  perMillion: number | null;
  smoothed: number;
}

/** Everything the report shows for one language edition. */
export interface ReportLanguage {
  lang: string;
  title: string;
  // raw_views when edition totals were unavailable; such a language is not comparable and is left off the chart.
  unit: 'views_per_million' | 'raw_views';
  trend: ReportTrend;
  relativeTrend: ReportTrend | null;
  // Same fit on the last third of the weekly series; `from` is where that period starts.
  recentTrend: (ReportTrend & { weeks: number; from: string | null }) | null;
  weeks: number;
  medianPerMillion: number;
  confidence: {
    overall: ConfidenceLevel;
    score: number;
    caveats: Message[];
    components?: Record<ComponentName, ConfidenceComponent>;
  };
  outlierDates: string[];
  missingDays: number;
  zeroDays?: number;
  points: ReportPoint[];
}

/** Input for one PDF report: the topic, its languages, report-wide caveats and the compare ranking. */
export interface ReportInput {
  qid: string;
  from: string;
  to: string;
  days: number;
  topic: string;
  languages: ReportLanguage[];
  caveats: Message[];
  ranking: string[];
  source: string;
  unavailable?: Array<{ lang: string; reason: string }>;
}

/** Paths of the written PDF and SVG chart, plus the headline that became the PDF subject. */
export interface RenderedReport {
  pdf: string;
  svg: string;
  headline: Message;
}

const DIRECTION_CODES: Record<Direction, MessageCode> = {
  up: 'DIRECTION_UP',
  down: 'DIRECTION_DOWN',
  flat: 'DIRECTION_FLAT',
  inconclusive: 'DIRECTION_INCONCLUSIVE',
};

const CONFIDENCE_CODES: Record<ConfidenceLevel, MessageCode> = {
  low: 'CONFIDENCE_LOW',
  medium: 'CONFIDENCE_MEDIUM',
  high: 'CONFIDENCE_HIGH',
};

/** Localisable word for a trend direction. */
export function directionMessage(direction: Direction): Message {
  return message(DIRECTION_CODES[direction]);
}

/** Localisable word for a confidence level. */
export function confidenceMessage(level: ConfidenceLevel): Message {
  return message(CONFIDENCE_CODES[level]);
}

/** Number with an explicit plus for positive values; an em dash when the value is missing. */
export function signed(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return value > 0 ? `+${value}` : String(value);
}

/** Report topic: the article title in the report locale, else the English one, else the first available. */
export function pickTopic(languages: Array<{ lang: string; title: string }>, locale: Locale, fallback: string): string {
  const preferred = languages.find((item) => item.lang === locale) ?? languages.find((item) => item.lang === 'en');

  return preferred?.title ?? languages[0]?.title ?? fallback;
}

/** PDF file name: an ASCII slug of the title plus the QID, or the QID alone when nothing Latin survives. */
export function reportFileName(name: string, qid: string): string {
  const slug = name
    // NFKD plus stripping combining marks turns accented Latin letters into plain ASCII.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

  const id = qid.toLowerCase();

  return slug ? `${slug}-${id}.pdf` : `${id}.pdf`;
}

// Fastest growth first; a missing percent sorts last, and two missing ones tie instead of giving NaN.
function byGrowth(a: ReportLanguage, b: ReportLanguage): number {
  const left = a.trend.percentPerYear ?? Number.NEGATIVE_INFINITY;
  const right = b.trend.percentPerYear ?? Number.NEGATIVE_INFINITY;

  if (left === right) {
    return 0;
  }

  return right - left;
}

// The share of edition traffic is the measure of interest; raw views are only the fallback.
function primaryTrend(item: ReportLanguage): ReportTrend {
  return item.relativeTrend ?? item.trend;
}

function langList(items: ReportLanguage[]): string {
  return items.map((item) => item.lang).join(', ');
}

/** Headline verdict for the report, worded from the trend direction, never from the percent alone. */
export function headline(input: ReportInput): Message {
  const languages = input.languages;
  const topic = input.topic;

  if (languages.length === 1) {
    const only = languages[0] as ReportLanguage;

    const primary = primaryTrend(only);

    return message('HEADLINE_SINGLE', {
      topic,
      lang: only.lang,
      direction: directionMessage(primary.direction),
      percent: signed(primary.percentPerYear),
      low: signed(primary.ci95?.[0] ?? null),
      high: signed(primary.ci95?.[1] ?? null),
      recent: directionMessage(only.recentTrend?.direction ?? 'inconclusive'),
      since: only.recentTrend?.from ?? '—',
      recentPercent: signed(only.recentTrend?.percentPerYear ?? null),
      confidence: confidenceMessage(only.confidence.overall),
    });
  }

  // Only a confirmed rise counts as growth; the fastest-growing language leads the headline.
  const growing = languages
    .filter((item) => item.trend.direction === 'up')
    .sort(byGrowth);

  const leader = growing[0];

  if (leader) {
    return message('HEADLINE_GROWING', {
      topic,
      langs: langList(growing),
      leader: leader.lang,
      percent: signed(leader.trend.percentPerYear),
      recent: directionMessage(leader.recentTrend?.direction ?? 'inconclusive'),
      since: leader.recentTrend?.from ?? '—',
      confidence: confidenceMessage(leader.confidence.overall),
    });
  }

  if (languages.length > 0 && languages.every((item) => item.trend.direction === 'down')) {
    // When everything declines, the named language is the slowest decline, which is still not growth.
    const slowest = [...languages].sort(byGrowth)[0];

    return message('HEADLINE_ALL_DOWN', {
      topic,
      langs: langList(languages),
      leader: slowest?.lang ?? '',
      percent: signed(slowest?.trend.percentPerYear ?? null),
      recent: directionMessage(slowest?.recentTrend?.direction ?? 'inconclusive'),
      since: slowest?.recentTrend?.from ?? '—',
    });
  }

  const declining = languages.filter((item) => item.trend.direction === 'down');

  if (declining.length > 0) {
    return message('HEADLINE_MIXED_DOWN', {
      topic,
      down: langList(declining),
      others: langList(languages.filter((item) => item.trend.direction !== 'down')),
    });
  }

  return message('HEADLINE_NO_CLEAR_DIRECTION', {
    topic,
    langs: langList(languages),
  });
}

// Also the tie-break: on equal scores the component listed first is reported as the weakest.
const COMPONENT_ORDER: ComponentName[] = ['volume', 'stability', 'length', 'outlierShare', 'continuity'];

const COMPONENT_CODES: Record<ComponentName, MessageCode> = {
  volume: 'COMPONENT_VOLUME',
  length: 'COMPONENT_LENGTH',
  stability: 'COMPONENT_STABILITY',
  outlierShare: 'COMPONENT_OUTLIERS',
  continuity: 'COMPONENT_CONTINUITY',
};

const TRUST_CODES: Record<ConfidenceLevel, MessageCode> = {
  low: 'TRUST_LOW',
  medium: 'TRUST_MEDIUM',
  high: 'TRUST_HIGH',
};

/** Confidence component with the lowest score, i.e. the main reason to distrust the result. */
export function weakestComponent(
  components: Record<ComponentName, ConfidenceComponent>,
): { name: ComponentName; component: ConfidenceComponent } {
  let weakest: ComponentName = COMPONENT_ORDER[0] as ComponentName;

  for (const name of COMPONENT_ORDER) {
    if (components[name].score < components[weakest].score) {
      weakest = name;
    }
  }

  return { name: weakest, component: components[weakest] };
}

/** Trust line for one language naming its weakest confidence component; null when components are unknown. */
export function trustLine(item: ReportLanguage): Message | null {
  if (!item.confidence.components) {
    return null;
  }

  const { name, component } = weakestComponent(item.confidence.components);

  return message(TRUST_CODES[item.confidence.overall], {
    lang: item.lang,
    weakest: message(COMPONENT_CODES[name]),
    detail: component.detail,
  });
}

/** Launch recommendation: a growing language whose confidence is not low; null for a single language. */
export function recommendation(input: ReportInput): Message | null {
  const languages = input.languages;

  if (languages.length < 2) {
    return null;
  }

  const growing = languages.filter((item) => item.trend.direction === 'up').sort(byGrowth);
  // Growth measured with low confidence is not enough to recommend a language.
  const trusted = growing.find((item) => item.confidence.overall !== 'low');

  if (trusted) {
    return message('RECOMMEND_LANGUAGE', {
      lang: trusted.lang,
      percent: signed(trusted.trend.percentPerYear),
      confidence: confidenceMessage(trusted.confidence.overall),
    });
  }

  if (growing.length > 0) {
    return message('RECOMMEND_NONE_LOW_CONFIDENCE', { langs: langList(growing) });
  }

  if (languages.every((item) => item.trend.direction === 'down')) {
    const slowest = [...languages].sort(byGrowth)[0] as ReportLanguage;

    return message('RECOMMEND_NONE_ALL_DOWN', { leader: slowest.lang, percent: signed(slowest.trend.percentPerYear) });
  }

  return message('RECOMMEND_NONE_NO_DIRECTION');
}

/** "What to check next" order from the compare ranking; null when there is nothing to order. */
export function explorationOrder(input: ReportInput): Message | null {
  if (input.languages.length < 2 || input.ranking.length < 2) {
    return null;
  }

  return message('RECOMMEND_ORDER', { order: input.ranking.join(' → ') });
}

/** The recommendation and the exploration order, whichever of them apply. */
export function decisionLines(input: ReportInput): Message[] {
  return [recommendation(input), explorationOrder(input)].filter((line): line is Message => line !== null);
}

/** Lines under the headline: per-language trust lines, then the recommendation and the exploration order. */
export function verdictLines(input: ReportInput): Message[] {
  const lines = input.languages.map(trustLine).filter((line): line is Message => line !== null);

  return [...lines, ...decisionLines(input)];
}

/** Chart band for a weekly trend: fitted line and 95% slope interval, as per-day values at mid-week dates. */
export function trendBand(trend: ReportTrend, weeks: number, from: string): TrendBand {
  // The slope interval is pivoted on the middle of the series, so the band is narrowest there and fans out.
  const pivot = (weeks - 1) / 2;
  const pivotValue = trend.intercept + trend.slopePerWeek * pivot;
  const band: TrendBand = { dates: [], value: [], lower: [], upper: [] };

  for (let week = 0; week < weeks; week += 1) {
    const low = pivotValue + trend.ci95Slope[0] * (week - pivot);
    const high = pivotValue + trend.ci95Slope[1] * (week - pivot);

    // Weekly sums divided by 7 match the daily scale of the plotted points.
    band.dates.push(addDays(from, week * 7 + 3));
    band.value.push((trend.intercept + trend.slopePerWeek * week) / 7);
    band.lower.push(Math.min(low, high) / 7);
    band.upper.push(Math.max(low, high) / 7);
  }

  return band;
}

/** Chart series per language; raw-count languages are returned as excluded because their scale is not comparable. */
export function chartSeries(input: ReportInput): { series: ChartSeries[]; excluded: string[] } {
  const series: ChartSeries[] = [];
  const excluded: string[] = [];

  for (const item of input.languages) {
    if (item.unit !== 'views_per_million') {
      excluded.push(item.lang);
      continue;
    }

    const trend = primaryTrend(item);

    series.push({
      id: item.lang,
      label: item.lang,
      dates: item.points.map((point) => point.date),
      raw: item.points.map((point) => point.perMillion),
      smoothed: item.points.map((point) => point.smoothed),
      trend: trendBand(trend, item.weeks, input.from),
      outliers: item.outlierDates,
    });
  }

  return { series, excluded };
}

/** Caveats for the PDF: report-wide ones, each language's in priority order, then the once-per-report notes. */
export function selectCaveats(input: ReportInput): Message[] {
  const selected: Message[] = [...input.caveats];

  for (const item of input.languages) {
    const byCode = new Map(item.confidence.caveats.map((caveat) => [caveat.code, caveat]));

    for (const code of LANGUAGE_CAVEAT_PRIORITY) {
      const caveat = byCode.get(code);

      if (caveat) {
        selected.push(message('REPORT_LANG_CAVEAT', { lang: item.lang, text: caveat }));
      }
    }
  }

  const shared = input.languages.flatMap((item) => item.confidence.caveats);

  for (const code of ONCE_PER_REPORT) {
    const caveat = shared.find((item) => item.code === code);

    if (caveat) {
      selected.push(caveat);
    }
  }

  return selected;
}

/** Footer note listing, per language, the gap days that were filled in. */
export function missingDaysDetail(input: ReportInput): Message {
  const gaps = input.languages.filter((item) => item.missingDays > 0);

  if (gaps.length === 0) {
    return message('REPORT_FOOTER_NO_MISSING');
  }

  return message('REPORT_FOOTER_MISSING', {
    detail: gaps.map((item) => `${item.lang} ${item.missingDays}`).join(', '),
  });
}

/** Footer note listing, per language, the days with zero views; null when there are none. */
export function zeroDaysDetail(input: ReportInput): Message | null {
  const zero = input.languages.filter((item) => (item.zeroDays ?? 0) > 0);

  if (zero.length === 0) {
    return null;
  }

  return message('REPORT_FOOTER_ZERO_DAYS', {
    detail: zero.map((item) => `${item.lang} ${item.zeroDays}`).join(', '),
  });
}

/** Confidence cell: level with its score, or "lowered" when a caveat rule capped the level below the score. */
export function confidenceCell(confidence: ReportLanguage['confidence']): Message {
  const level = confidenceMessage(confidence.overall);

  if (levelFromScore(confidence.score) === confidence.overall) {
    return message('REPORT_CONFIDENCE_CELL', { level, score: confidence.score });
  }

  return message('REPORT_CONFIDENCE_CAPPED', { level });
}

function fontPath(name: string): string {
  return join(packageRoot(), 'assets', 'fonts', `${name}.ttf`);
}

function trendCell(trend: ReportTrend | null, locale: Locale): string {
  if (!trend) {
    return '—';
  }

  return render(
    message('REPORT_TREND_CELL', { direction: directionMessage(trend.direction), percent: signed(trend.percentPerYear) }),
    locale,
  );
}

function ciCell(trend: ReportTrend | null): string {
  if (!trend?.ci95) {
    return '—';
  }

  return `[${signed(trend.ci95[0])}; ${signed(trend.ci95[1])}]`;
}

/** Renders the one-page A4 PDF report next to its SVG chart and returns both paths. */
export async function renderReport(input: ReportInput, locale: Locale, pdfPath: string): Promise<RenderedReport> {
  const t = (code: MessageCode, params: Record<string, string | number | Message> = {}) =>
    render(message(code, params), locale);

  const { series, excluded } = chartSeries(input);
  // The chart gets one marker: the start of the recent period of the first language that has one.
  const marker = input.languages.find((item) => item.recentTrend?.from)?.recentTrend?.from ?? null;
  const svg = lineChart(series, {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    yLabel: t('CHART_Y_LABEL'),
    marker: marker ? { date: marker, label: t('CHART_RECENT_MARKER') } : null,
    legend: {
      raw: t('CHART_LEGEND_RAW'),
      smoothed: t('CHART_LEGEND_SMOOTHED'),
      trend: t('CHART_LEGEND_TREND'),
      outliers: t('CHART_LEGEND_OUTLIERS'),
    },
    fontFamily: FONT_FAMILY,
    emptyLabel: t('CHART_NO_DATA'),
  });

  const svgPath = pdfPath.replace(/\.pdf$/, '.svg');
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(svgPath, svg, 'utf8');

  const summary = headline(input);
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: { Title: input.topic, Subject: render(summary, locale), Creator: 'wikipedia-trends' },
  });

  doc.registerFont(FONT_REGULAR, fontPath(FONT_REGULAR));
  doc.registerFont(FONT_BOLD, fontPath(FONT_BOLD));

  const stream = createWriteStream(pdfPath);
  doc.pipe(stream);

  const left = PAGE_MARGIN;
  let y = PAGE_MARGIN;

  doc.font(FONT_BOLD).fontSize(17).fillColor('#111827').text(input.topic, left, y, { width: CONTENT_WIDTH });
  y = doc.y + 2;

  doc
    .font(FONT_REGULAR)
    .fontSize(9)
    .fillColor('#4b5563')
    .text(t('REPORT_SUBTITLE', { langs: langList(input.languages), from: input.from, to: input.to }), left, y, {
      width: CONTENT_WIDTH,
    });
  y = doc.y + 8;

  doc.font(FONT_BOLD).fontSize(11).fillColor('#111827').text(render(summary, locale), left, y, { width: CONTENT_WIDTH });
  y = doc.y + 4;

  // With many languages, per-language trust lines and article titles are dropped so the page still fits.
  const compact = input.languages.length > COMPACT_FROM_LANGS;
  const lines = compact ? decisionLines(input) : verdictLines(input);

  for (const line of lines) {
    doc.font(FONT_REGULAR).fontSize(8.5).fillColor('#1f2937').text(render(line, locale), left, y, { width: CONTENT_WIDTH });
    y = doc.y + 2;
  }

  y += 6;

  SVGtoPDF(doc, svg, left + (CONTENT_WIDTH - CHART_WIDTH) / 2, y, {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    // Every SVG font maps to the embedded DejaVu, so Cyrillic labels render in the PDF.
    fontCallback: (_family: string, bold: boolean) => (bold ? FONT_BOLD : FONT_REGULAR),
  });
  y += CHART_HEIGHT + 6;

  if (excluded.length > 0) {
    doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#6b7280').text(t('REPORT_CHART_EXCLUDED', { langs: excluded.join(', ') }), left, y, {
      width: CONTENT_WIDTH,
    });
    y = doc.y + 4;
  }

  const widths = [...FIXED_COLUMNS, LAST_COLUMN];
  const columns = [
    t('REPORT_TABLE_LANG'),
    t('REPORT_TABLE_RELATIVE'),
    t('REPORT_TABLE_CI'),
    t('REPORT_TABLE_RECENT'),
    t('REPORT_TABLE_MEDIAN'),
    t('REPORT_TABLE_CONFIDENCE'),
  ].map((label, index) => ({ label, width: widths[index] ?? 60 }));
  const cellWidth = (index: number) => (columns[index]?.width ?? 60) - CELL_PAD * 2;

  const drawRow = (cells: string[], bold: boolean, shaded: boolean, subtitle: string | null = null) => {
    const firstWidth = cellWidth(0);
    const subtitleHeight = subtitle ? doc.font(FONT_REGULAR).fontSize(7).heightOfString(subtitle, { width: firstWidth }) : 0;
    doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(8);
    // The first cell also carries the article title under the language code, so it counts both.
    const height =
      Math.max(
        ...cells.map((cell, index) => doc.heightOfString(cell, { width: cellWidth(index) })),
        doc.heightOfString(cells[0] ?? '', { width: firstWidth }) + subtitleHeight,
      ) + CELL_PAD * 2;

    if (shaded) {
      doc.rect(left, y, CONTENT_WIDTH, height).fill('#f3f4f6');
    }

    let x = left;
    cells.forEach((cell, index) => {
      const width = columns[index]?.width ?? 60;
      const font = bold || index === 0 ? FONT_BOLD : FONT_REGULAR;
      doc.fillColor('#111827').font(font).fontSize(8).text(cell, x + CELL_PAD, y + CELL_PAD, { width: cellWidth(index) });

      if (index === 0 && subtitle) {
        doc.fillColor('#4b5563').font(FONT_REGULAR).fontSize(7).text(subtitle, x + CELL_PAD, doc.y, { width: cellWidth(index) });
      }

      x += width;
    });

    y += height;
  };

  drawRow(columns.map((column) => column.label), true, true);

  for (const item of input.languages) {
    const primary = primaryTrend(item);
    drawRow(
      [
        item.lang,
        trendCell(primary, locale),
        ciCell(primary),
        trendCell(item.recentTrend, locale),
        String(Math.round(item.medianPerMillion * 100) / 100),
        render(confidenceCell(item.confidence), locale),
      ],
      false,
      false,
      compact ? null : item.title,
    );
    doc.moveTo(left, y).lineTo(left + CONTENT_WIDTH, y).lineWidth(0.3).strokeColor('#e5e7eb').stroke();
  }

  const unavailable = input.unavailable ?? [];

  if (unavailable.length > 0) {
    y += 10;
    doc.font(FONT_BOLD).fontSize(10).fillColor('#111827').text(t('RESEARCH_UNAVAILABLE_TITLE'), left, y, { width: CONTENT_WIDTH });
    y = doc.y + 3;
    doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#1f2937');

    for (const item of unavailable) {
      doc.text(`• ${item.lang}: ${item.reason}`, left, y, { width: CONTENT_WIDTH });
      y = doc.y + 2;
    }
  }

  y += 10;
  doc.font(FONT_BOLD).fontSize(10).fillColor('#111827').text(t('REPORT_CAVEATS_TITLE'), left, y, { width: CONTENT_WIDTH });
  y = doc.y + 3;

  const caveats = selectCaveats(input);
  // Caveats stop above the footer; the rest are counted in a "more caveats" line.
  const limit = PAGE.height - PAGE_MARGIN - FOOTER_HEIGHT;
  let shown = 0;

  doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#1f2937');

  for (const caveat of caveats) {
    const text = `• ${render(caveat, locale)}`;
    const height = doc.heightOfString(text, { width: CONTENT_WIDTH });
    // Leave room for that line unless this is the last caveat.
    const reserve = shown < caveats.length - 1 ? MORE_CAVEATS_LINE_HEIGHT : 0;

    if (y + height + reserve > limit) {
      break;
    }

    doc.text(text, left, y, { width: CONTENT_WIDTH });
    y = doc.y + 2;
    shown += 1;
  }

  if (shown < caveats.length) {
    doc
      .fillColor('#6b7280')
      .text(t('REPORT_MORE_CAVEATS', { count: caveats.length - shown }), left, y, { width: CONTENT_WIDTH });
  }

  doc.moveTo(left, FOOTER_TOP - 4).lineTo(left + CONTENT_WIDTH, FOOTER_TOP - 4).lineWidth(0.3).strokeColor('#d1d5db').stroke();
  doc.font(FONT_REGULAR).fontSize(6.5).fillColor('#6b7280');
  doc.text(t('REPORT_FOOTER_SOURCE'), left, FOOTER_TOP, { width: CONTENT_WIDTH, lineBreak: false });
  doc.text(
    `${t('REPORT_FOOTER_GENERATED', { date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' })} · ` +
      `${t('REPORT_FOOTER_RANGE', { from: input.from, to: input.to, days: input.days })} · ${input.qid}`,
    left,
    FOOTER_TOP + 9,
    { width: CONTENT_WIDTH, lineBreak: false },
  );
  const zero = zeroDaysDetail(input);
  const coverage = [missingDaysDetail(input), ...(zero ? [zero] : [])].map((line) => render(line, locale)).join(' · ');
  doc.text(coverage, left, FOOTER_TOP + 18, { width: CONTENT_WIDTH, lineBreak: false });

  doc.end();
  await finished(stream);

  return { pdf: pdfPath, svg: svgPath, headline: summary };
}
