const DAY_MS = 24 * 60 * 60 * 1000;

export const CHART_WIDTH = 520;
export const CHART_HEIGHT = 260;
export const PALETTE = ['#2563eb', '#0d9488', '#7c3aed', '#b45309', '#475569'];
export const OUTLIER_COLOR = '#e11d48';
export const MARKER_COLOR = '#6b7280';
export const FONT_FAMILY = 'DejaVuSans';

const PAD = { left: 46, right: 12, top: 24, bottom: 52 };

export interface TrendBand {
  dates: string[];
  value: number[];
  lower: number[];
  upper: number[];
}

export interface ChartSeries {
  id: string;
  label: string;
  color?: string;
  dates: string[];
  raw?: Array<number | null>;
  smoothed?: Array<number | null>;
  trend?: TrendBand;
  outliers?: string[];
}

export interface ChartLegendLabels {
  raw: string;
  smoothed: string;
  trend: string;
  outliers: string;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  title?: string;
  yLabel?: string;
  marker?: { date: string; label: string } | null;
  legend?: Partial<ChartLegendLabels>;
  fontFamily?: string;
  emptyLabel?: string;
}

export interface Domain {
  min: number;
  max: number;
}

export interface Ticks extends Domain {
  ticks: number[];
  step: number;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

export function xDomain(series: ChartSeries[]): Domain {
  const days = series.flatMap((item) => [
    ...item.dates.map(dayNumber),
    ...(item.trend?.dates.map(dayNumber) ?? []),
  ]).filter(Number.isFinite);

  if (days.length === 0) {
    return { min: 0, max: 1 };
  }

  const min = Math.min(...days);
  const max = Math.max(...days);

  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }

  return { min, max };
}

export function yDomain(values: Array<number | null | undefined>): Domain {
  const usable = finite(values);

  if (usable.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = Math.min(...usable);
  let max = Math.max(...usable);

  if (min === max) {
    const spread = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= spread;
    max += spread;
  }

  const padding = (max - min) * 0.05;
  const paddedMin = Math.min(...usable) >= 0 ? Math.max(0, min - padding) : min - padding;

  return { min: paddedMin, max: max + padding };
}

function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;

  return nice * 10 ** exponent;
}

export function niceTicks(domain: Domain, count = 5): Ticks {
  const span = domain.max - domain.min;

  if (!Number.isFinite(span) || span <= 0) {
    return { min: 0, max: 1, ticks: [0, 1], step: 1 };
  }

  const step = niceStep(span / count);
  const min = Math.floor(domain.min / step) * step;
  const max = Math.ceil(domain.max / step) * step;
  const ticks: number[] = [];

  for (let value = min; value <= max + step / 2; value += step) {
    ticks.push(Math.round(value / step) * step);
  }

  return { min, max, ticks, step };
}

export function dateTicks(domain: Domain): string[] {
  const spanDays = domain.max - domain.min;
  const months = spanDays > 730 ? 6 : spanDays > 365 ? 3 : spanDays > 90 ? 1 : 0;

  if (months === 0) {
    const step = Math.max(1, Math.round(spanDays / 5));
    const ticks: string[] = [];

    for (let day = Math.ceil(domain.min); day <= domain.max; day += step) {
      ticks.push(fromDayNumber(day));
    }

    return ticks;
  }

  const start = new Date(domain.min * DAY_MS);
  let year = start.getUTCFullYear();
  let month = Math.ceil((start.getUTCMonth() + (start.getUTCDate() > 1 ? 1 : 0)) / months) * months;
  const ticks: string[] = [];

  for (;;) {
    year += Math.floor(month / 12);
    month %= 12;
    const date = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    if (dayNumber(date) > domain.max) {
      break;
    }

    if (dayNumber(date) >= domain.min) {
      ticks.push(date);
    }

    month += months;
  }

  return ticks;
}

function formatNumber(value: number): string {
  if (value === 0) {
    return '0';
  }

  const magnitude = Math.abs(value);

  if (magnitude >= 1_000_000) {
    return `${Math.round(value / 100_000) / 10}M`;
  }

  if (magnitude >= 10_000) {
    return `${Math.round(value / 100) / 10}k`;
  }

  if (magnitude >= 100) {
    return String(Math.round(value));
  }

  return String(Math.round(value * 100) / 100);
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function path(points: Array<[number, number] | null>): string {
  const commands: string[] = [];
  let drawing = false;

  for (const point of points) {
    if (point === null) {
      drawing = false;
      continue;
    }

    commands.push(`${drawing ? 'L' : 'M'}${round(point[0])} ${round(point[1])}`);
    drawing = true;
  }

  return commands.join('');
}

export function scaleValues(series: ChartSeries[]): Array<number | null> {
  return series.flatMap((item) => {
    const spikes = new Set(item.outliers ?? []);
    const raw = (item.raw ?? []).map((value, index) => (spikes.has(item.dates[index] ?? '') ? null : value));

    return [
      ...raw,
      ...(item.smoothed ?? []),
      ...(item.trend?.lower ?? []),
      ...(item.trend?.upper ?? []),
      ...(item.trend?.value ?? []),
    ];
  });
}

export function lineChart(series: ChartSeries[], options: ChartOptions = {}): string {
  const width = options.width ?? CHART_WIDTH;
  const height = options.height ?? CHART_HEIGHT;
  const font = options.fontFamily ?? FONT_FAMILY;
  const plot = {
    left: PAD.left,
    top: PAD.top,
    width: width - PAD.left - PAD.right,
    height: height - PAD.top - PAD.bottom,
  };

  const allValues = series.flatMap((item) => [
    ...(item.raw ?? []),
    ...(item.smoothed ?? []),
    ...(item.trend?.lower ?? []),
    ...(item.trend?.upper ?? []),
    ...(item.trend?.value ?? []),
  ]);

  const x = xDomain(series);
  const y = niceTicks(yDomain(scaleValues(series)));
  const scaleX = (day: number) => plot.left + ((day - x.min) / (x.max - x.min)) * plot.width;
  const scaleY = (value: number) => plot.top + plot.height - ((value - y.min) / (y.max - y.min)) * plot.height;
  const text = (value: string) => escapeXml(value);
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}pt" height="${height}pt" viewBox="0 0 ${width} ${height}" ` +
      `font-family="${text(font)}" font-size="7">`,
  );
  parts.push(
    `<defs><clipPath id="plot-area"><rect x="${plot.left}" y="${plot.top}" width="${plot.width}" ` +
      `height="${plot.height}"/></clipPath></defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);

  if (options.title) {
    parts.push(`<text x="${plot.left}" y="14" font-size="9" fill="#111827">${text(options.title)}</text>`);
  }

  parts.push('<g class="grid">');

  for (const tick of y.ticks) {
    const position = round(scaleY(tick));
    parts.push(
      `<line x1="${plot.left}" y1="${position}" x2="${plot.left + plot.width}" y2="${position}" ` +
        `stroke="${tick === 0 ? '#9ca3af' : '#e5e7eb'}" stroke-width="0.5"/>`,
    );
    parts.push(
      `<text x="${plot.left - 4}" y="${round(scaleY(tick) + 2.5)}" text-anchor="end" fill="#4b5563">` +
        `${text(formatNumber(tick))}</text>`,
    );
  }

  for (const date of dateTicks(x)) {
    const position = round(scaleX(dayNumber(date)));
    parts.push(
      `<line x1="${position}" y1="${plot.top}" x2="${position}" y2="${plot.top + plot.height}" ` +
        'stroke="#f3f4f6" stroke-width="0.5"/>',
    );
    parts.push(
      `<text x="${position}" y="${plot.top + plot.height + 10}" text-anchor="middle" fill="#4b5563">` +
        `${text(date.slice(0, 7))}</text>`,
    );
  }

  parts.push('</g>');
  parts.push(
    `<rect x="${plot.left}" y="${plot.top}" width="${plot.width}" height="${plot.height}" fill="none" ` +
      'stroke="#9ca3af" stroke-width="0.5"/>',
  );

  if (options.yLabel) {
    parts.push(
      `<text x="10" y="${round(plot.top + plot.height / 2)}" text-anchor="middle" fill="#4b5563" ` +
        `transform="rotate(-90 10 ${round(plot.top + plot.height / 2)})">${text(options.yLabel)}</text>`,
    );
  }

  if (series.length === 0 || allValues.every((value) => value === null || value === undefined)) {
    parts.push(
      `<text x="${round(plot.left + plot.width / 2)}" y="${round(plot.top + plot.height / 2)}" ` +
        `text-anchor="middle" fill="#6b7280">${text(options.emptyLabel ?? 'no data')}</text>`,
    );
  }

  const offScale: string[] = [];

  series.forEach((item, index) => {
    const color = item.color ?? PALETTE[index % PALETTE.length] ?? '#111827';
    const days = item.dates.map(dayNumber);
    parts.push(`<g class="series" data-series="${text(item.id)}" clip-path="url(#plot-area)">`);

    if (item.trend && item.trend.dates.length > 0) {
      const trendDays = item.trend.dates.map(dayNumber);
      const upper = trendDays.map((day, point) => `${round(scaleX(day))},${round(scaleY(item.trend?.upper[point] ?? 0))}`);
      const lower = trendDays
        .map((day, point) => `${round(scaleX(day))},${round(scaleY(item.trend?.lower[point] ?? 0))}`)
        .reverse();

      parts.push(
        `<polygon class="ci-band" points="${[...upper, ...lower].join(' ')}" fill="${color}" fill-opacity="0.12" ` +
          'stroke="none"/>',
      );
      parts.push(
        `<path class="trend" d="${path(trendDays.map((day, point) => [scaleX(day), scaleY(item.trend?.value[point] ?? 0)]))}" ` +
          `fill="none" stroke="${color}" stroke-width="0.9" stroke-dasharray="3 2"/>`,
      );
    }

    if (item.raw) {
      const points = days.map((day, point): [number, number] | null => {
        const value = item.raw?.[point];

        return typeof value === 'number' && Number.isFinite(value) ? [scaleX(day), scaleY(value)] : null;
      });

      parts.push(
        `<path class="raw" d="${path(points)}" fill="none" stroke="${color}" stroke-width="0.4" stroke-opacity="0.35"/>`,
      );
    }

    if (item.smoothed) {
      const points = days.map((day, point): [number, number] | null => {
        const value = item.smoothed?.[point];

        return typeof value === 'number' && Number.isFinite(value) ? [scaleX(day), scaleY(value)] : null;
      });

      parts.push(`<path class="smoothed" d="${path(points)}" fill="none" stroke="${color}" stroke-width="1.4"/>`);
    }

    if (item.outliers && item.outliers.length > 0) {
      const lookup = new Map(item.dates.map((date, point) => [date, item.raw?.[point] ?? item.smoothed?.[point] ?? null]));

      for (const date of item.outliers) {
        const value = lookup.get(date);

        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue;
        }

        const cx = scaleX(dayNumber(date));

        if (value > y.max) {
          offScale.push(
            `<polygon class="outlier off-scale" points="${round(cx - 2)},${plot.top + 4} ${round(cx + 2)},${plot.top + 4} ` +
              `${round(cx)},${plot.top + 0.5}" fill="${OUTLIER_COLOR}"/>`,
          );
          continue;
        }

        parts.push(`<circle class="outlier" cx="${round(cx)}" cy="${round(scaleY(value))}" r="1.6" fill="${OUTLIER_COLOR}"/>`);
      }
    }

    parts.push('</g>');
  });

  parts.push(...offScale);

  if (options.marker) {
    const position = round(scaleX(dayNumber(options.marker.date)));
    parts.push(
      `<line class="marker" x1="${position}" y1="${plot.top}" x2="${position}" y2="${plot.top + plot.height}" ` +
        `stroke="${MARKER_COLOR}" stroke-width="0.8" stroke-dasharray="2 2"/>`,
    );
    parts.push(
      `<text x="${round(Number(position) + 3)}" y="${plot.top + 8}" fill="${MARKER_COLOR}">${text(options.marker.label)}</text>`,
    );
  }

  const legendY = height - 24;
  let cursor = plot.left;

  series.forEach((item, index) => {
    const color = item.color ?? PALETTE[index % PALETTE.length] ?? '#111827';
    parts.push(
      `<rect class="legend-swatch" x="${cursor}" y="${legendY - 5}" width="10" height="3" fill="${color}"/>`,
    );
    parts.push(`<text class="legend" x="${cursor + 13}" y="${legendY - 2}" fill="#111827">${text(item.label)}</text>`);
    cursor += 24 + item.label.length * 4.6;
  });

  const labels = options.legend ?? {};
  const keyY = height - 10;
  let key = plot.left;
  const keyItems: Array<{ label: string; shape: (at: number) => string }> = [
    {
      label: labels.raw ?? 'daily',
      shape: (at) =>
        `<line x1="${round(at)}" y1="${keyY - 2}" x2="${round(at + 12)}" y2="${keyY - 2}" stroke="#374151" ` +
        'stroke-width="0.4" stroke-opacity="0.5"/>',
    },
    {
      label: labels.smoothed ?? '7-day average',
      shape: (at) =>
        `<line x1="${round(at)}" y1="${keyY - 2}" x2="${round(at + 12)}" y2="${keyY - 2}" stroke="#374151" ` +
        'stroke-width="1.4"/>',
    },
    {
      label: labels.trend ?? 'trend ±95%',
      shape: (at) =>
        `<rect x="${round(at)}" y="${keyY - 5}" width="12" height="6" fill="#374151" fill-opacity="0.12"/>` +
        `<line x1="${round(at)}" y1="${keyY - 2}" x2="${round(at + 12)}" y2="${keyY - 2}" stroke="#374151" ` +
        'stroke-width="0.9" stroke-dasharray="3 2"/>',
    },
    {
      label: labels.outliers ?? 'spike days',
      shape: (at) => `<circle cx="${round(at + 6)}" cy="${keyY - 2}" r="1.6" fill="${OUTLIER_COLOR}"/>`,
    },
  ];

  for (const item of keyItems) {
    parts.push(`<g class="key">${item.shape(key)}</g>`);
    parts.push(`<text class="key-label" x="${round(key + 15)}" y="${keyY}" fill="#374151">${text(item.label)}</text>`);
    key += 30 + item.label.length * 4.4;
  }

  parts.push('</svg>');

  return parts.join('');
}
