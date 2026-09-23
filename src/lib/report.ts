import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { finished } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { packageRoot } from './cache.js';
import { CHART_HEIGHT, CHART_WIDTH, FONT_FAMILY, lineChart } from './chart.js';
import type { ChartSeries, TrendBand } from './chart.js';
import type { ConfidenceLevel } from './confidence.js';
import { message, render } from './messages.js';
import type { Locale } from './messages.js';
import type { Direction } from './stats.js';
import type { Message, MessageCode } from '../types.js';

export const FONT_REGULAR = 'DejaVuSans';
export const FONT_BOLD = 'DejaVuSans-Bold';
export const PAGE_MARGIN = 36;

const PAGE = { width: 595.28, height: 841.89 };
const CONTENT_WIDTH = PAGE.width - PAGE_MARGIN * 2;
const FOOTER_HEIGHT = 40;

export const LANGUAGE_CAVEAT_PRIORITY: MessageCode[] = [
  'TREND_REVERSAL',
  'EDITION_TRAFFIC_DECLINING',
  'ABSOLUTE_VS_RELATIVE',
  'SLOPE_SIGN_UNSTABLE',
  'LOW_VOLUME',
  'LONG_GAP_POSSIBLE_RENAME',
  'INTERVAL_SPANS_ZERO',
  'RAW_COUNTS_NOT_COMPARABLE',
];

export interface ReportTrend {
  percentPerYear: number | null;
  ci95: [number, number] | null;
  direction: Direction;
  slopePerWeek: number;
  intercept: number;
  ci95Slope: [number, number];
}

export interface ReportPoint {
  date: string;
  perMillion: number | null;
  smoothed: number;
}

export interface ReportLanguage {
  lang: string;
  title: string;
  unit: 'views_per_million' | 'raw_views';
  trend: ReportTrend;
  relativeTrend: ReportTrend | null;
  recentTrend: (ReportTrend & { weeks: number; from: string | null }) | null;
  weeks: number;
  medianPerMillion: number;
  confidence: { overall: ConfidenceLevel; score: number; caveats: Message[] };
  outlierDates: string[];
  missingDays: number;
  points: ReportPoint[];
}

export interface ReportInput {
  qid: string;
  from: string;
  to: string;
  days: number;
  topic: string;
  languages: ReportLanguage[];
  caveats: Message[];
  source: string;
}

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

export function directionMessage(direction: Direction): Message {
  return message(DIRECTION_CODES[direction]);
}

export function confidenceMessage(level: ConfidenceLevel): Message {
  return message(CONFIDENCE_CODES[level]);
}

export function signed(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return value > 0 ? `+${value}` : String(value);
}

export function pickTopic(languages: Array<{ lang: string; title: string }>, locale: Locale, fallback: string): string {
  const preferred = languages.find((item) => item.lang === locale) ?? languages.find((item) => item.lang === 'en');

  return preferred?.title ?? languages[0]?.title ?? fallback;
}

export function headline(input: ReportInput): Message {
  const languages = input.languages;
  const topic = input.topic;

  if (languages.length === 1) {
    const only = languages[0] as ReportLanguage;

    return message('HEADLINE_SINGLE', {
      topic,
      lang: only.lang,
      direction: directionMessage(only.trend.direction),
      recent: directionMessage(only.recentTrend?.direction ?? 'inconclusive'),
      confidence: confidenceMessage(only.confidence.overall),
    });
  }

  const growing = languages
    .filter((item) => item.trend.direction === 'up')
    .sort((a, b) => (b.trend.percentPerYear ?? 0) - (a.trend.percentPerYear ?? 0));

  const leader = growing[0];

  if (leader) {
    return message('HEADLINE_GROWING', {
      topic,
      langs: growing.map((item) => item.lang).join(', '),
      leader: leader.lang,
      percent: signed(leader.trend.percentPerYear),
      recent: directionMessage(leader.recentTrend?.direction ?? 'inconclusive'),
      confidence: confidenceMessage(leader.confidence.overall),
    });
  }

  if (languages.length > 0 && languages.every((item) => item.trend.direction === 'down')) {
    const slowest = [...languages].sort((a, b) => (b.trend.percentPerYear ?? 0) - (a.trend.percentPerYear ?? 0))[0];

    return message('HEADLINE_ALL_DOWN', {
      topic,
      langs: languages.map((item) => item.lang).join(', '),
      leader: slowest?.lang ?? '',
      percent: signed(slowest?.trend.percentPerYear ?? null),
      recent: directionMessage(slowest?.recentTrend?.direction ?? 'inconclusive'),
    });
  }

  const declining = languages.filter((item) => item.trend.direction === 'down');

  if (declining.length > 0) {
    return message('HEADLINE_MIXED_DOWN', {
      topic,
      down: declining.map((item) => item.lang).join(', '),
      others: languages
        .filter((item) => item.trend.direction !== 'down')
        .map((item) => item.lang)
        .join(', '),
    });
  }

  return message('HEADLINE_NO_CLEAR_DIRECTION', {
    topic,
    langs: languages.map((item) => item.lang).join(', '),
  });
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function trendBand(trend: ReportTrend, weeks: number, from: string): TrendBand {
  const pivot = (weeks - 1) / 2;
  const pivotValue = trend.intercept + trend.slopePerWeek * pivot;
  const band: TrendBand = { dates: [], value: [], lower: [], upper: [] };

  for (let week = 0; week < weeks; week += 1) {
    const low = pivotValue + trend.ci95Slope[0] * (week - pivot);
    const high = pivotValue + trend.ci95Slope[1] * (week - pivot);

    band.dates.push(addDays(from, week * 7 + 3));
    band.value.push((trend.intercept + trend.slopePerWeek * week) / 7);
    band.lower.push(Math.min(low, high) / 7);
    band.upper.push(Math.max(low, high) / 7);
  }

  return band;
}

export function chartSeries(input: ReportInput): { series: ChartSeries[]; excluded: string[] } {
  const series: ChartSeries[] = [];
  const excluded: string[] = [];

  for (const item of input.languages) {
    if (item.unit !== 'views_per_million') {
      excluded.push(item.lang);
      continue;
    }

    const trend = item.relativeTrend ?? item.trend;

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

  const weekly = input.languages
    .flatMap((item) => item.confidence.caveats)
    .find((caveat) => caveat.code === 'WEEKLY_AGGREGATION');

  if (weekly) {
    selected.push(weekly);
  }

  return selected;
}

export function missingDaysDetail(input: ReportInput): Message {
  const gaps = input.languages.filter((item) => item.missingDays > 0);

  if (gaps.length === 0) {
    return message('REPORT_FOOTER_NO_MISSING');
  }

  return message('REPORT_FOOTER_MISSING', {
    detail: gaps.map((item) => `${item.lang} ${item.missingDays}`).join(', '),
  });
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

export async function renderReport(input: ReportInput, locale: Locale, pdfPath: string): Promise<RenderedReport> {
  const t = (code: MessageCode, params: Record<string, string | number | Message> = {}) =>
    render(message(code, params), locale);

  const { series, excluded } = chartSeries(input);
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
    .text(t('REPORT_SUBTITLE', { langs: input.languages.map((item) => item.lang).join(', '), from: input.from, to: input.to }), left, y, {
      width: CONTENT_WIDTH,
    });
  y = doc.y + 8;

  doc.font(FONT_BOLD).fontSize(11).fillColor('#111827').text(render(summary, locale), left, y, { width: CONTENT_WIDTH });
  y = doc.y + 10;

  SVGtoPDF(doc, svg, left + (CONTENT_WIDTH - CHART_WIDTH) / 2, y, {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    fontCallback: (_family: string, bold: boolean) => (bold ? FONT_BOLD : FONT_REGULAR),
  });
  y += CHART_HEIGHT + 6;

  if (excluded.length > 0) {
    doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#6b7280').text(t('REPORT_CHART_EXCLUDED', { langs: excluded.join(', ') }), left, y, {
      width: CONTENT_WIDTH,
    });
    y = doc.y + 4;
  }

  const columns = [
    { label: t('REPORT_TABLE_LANG'), width: 112 },
    { label: t('REPORT_TABLE_RELATIVE'), width: 104 },
    { label: t('REPORT_TABLE_CI'), width: 70 },
    { label: t('REPORT_TABLE_RECENT'), width: 104 },
    { label: t('REPORT_TABLE_MEDIAN'), width: 54 },
    { label: t('REPORT_TABLE_CONFIDENCE'), width: CONTENT_WIDTH - 112 - 104 - 70 - 104 - 54 },
  ];

  const drawRow = (cells: string[], bold: boolean, shaded: boolean, subtitle: string | null = null) => {
    doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(8);
    const firstWidth = (columns[0]?.width ?? 60) - 6;
    const subtitleHeight = subtitle ? doc.font(FONT_REGULAR).fontSize(7).heightOfString(subtitle, { width: firstWidth }) : 0;
    doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(8);
    const height =
      Math.max(
        ...cells.map((cell, index) => doc.heightOfString(cell, { width: (columns[index]?.width ?? 60) - 6 })),
        doc.heightOfString(cells[0] ?? '', { width: firstWidth }) + subtitleHeight,
      ) + 6;

    if (shaded) {
      doc.rect(left, y, CONTENT_WIDTH, height).fill('#f3f4f6');
    }

    let x = left;
    cells.forEach((cell, index) => {
      const width = columns[index]?.width ?? 60;
      const font = bold || index === 0 ? FONT_BOLD : FONT_REGULAR;
      doc.fillColor('#111827').font(font).fontSize(8).text(cell, x + 3, y + 3, { width: width - 6 });

      if (index === 0 && subtitle) {
        doc.fillColor('#4b5563').font(FONT_REGULAR).fontSize(7).text(subtitle, x + 3, doc.y, { width: width - 6 });
      }

      x += width;
    });

    y += height;
  };

  drawRow(columns.map((column) => column.label), true, true);

  for (const item of input.languages) {
    const primary = item.relativeTrend ?? item.trend;
    drawRow(
      [
        item.lang,
        trendCell(primary, locale),
        ciCell(primary),
        trendCell(item.recentTrend, locale),
        String(Math.round(item.medianPerMillion * 100) / 100),
        `${t(CONFIDENCE_CODES[item.confidence.overall])} (${item.confidence.score})`,
      ],
      false,
      false,
      item.title,
    );
    doc.moveTo(left, y).lineTo(left + CONTENT_WIDTH, y).lineWidth(0.3).strokeColor('#e5e7eb').stroke();
  }

  y += 10;
  doc.font(FONT_BOLD).fontSize(10).fillColor('#111827').text(t('REPORT_CAVEATS_TITLE'), left, y, { width: CONTENT_WIDTH });
  y = doc.y + 3;

  const caveats = selectCaveats(input);
  const limit = PAGE.height - PAGE_MARGIN - FOOTER_HEIGHT;
  let shown = 0;

  doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#1f2937');

  for (const caveat of caveats) {
    const text = `• ${render(caveat, locale)}`;
    const height = doc.heightOfString(text, { width: CONTENT_WIDTH });
    const reserve = shown < caveats.length - 1 ? 12 : 0;

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

  const footerY = PAGE.height - PAGE_MARGIN - FOOTER_HEIGHT + 8;
  doc.moveTo(left, footerY - 4).lineTo(left + CONTENT_WIDTH, footerY - 4).lineWidth(0.3).strokeColor('#d1d5db').stroke();
  doc.font(FONT_REGULAR).fontSize(6.5).fillColor('#6b7280');
  doc.text(t('REPORT_FOOTER_SOURCE'), left, footerY, { width: CONTENT_WIDTH, lineBreak: false });
  doc.text(
    `${t('REPORT_FOOTER_GENERATED', { date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' })} · ` +
      `${t('REPORT_FOOTER_RANGE', { from: input.from, to: input.to, days: input.days })} · ${input.qid}`,
    left,
    footerY + 9,
    { width: CONTENT_WIDTH, lineBreak: false },
  );
  doc.text(render(missingDaysDetail(input), locale), left, footerY + 18, { width: CONTENT_WIDTH, lineBreak: false });

  doc.end();
  await finished(stream);

  return { pdf: pdfPath, svg: svgPath, headline: summary };
}
