import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  OUTLIER_COLOR,
  dateTicks,
  dayNumber,
  escapeXml,
  lineChart,
  niceTicks,
  scaleValues,
  xDomain,
  yDomain,
} from '../src/lib/chart.js';
import type { ChartSeries } from '../src/lib/chart.js';

function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  const badEntity = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(xml)) !== null) {
    const between = xml.slice(last, match.index);

    if (between.includes('<') || between.includes('>') || badEntity.test(between)) {
      return `bad text before offset ${match.index}: ${between.slice(0, 40)}`;
    }

    if (badEntity.test(match[3] ?? '')) {
      return `bad entity in attributes of <${match[2]}>`;
    }

    const [, closing, name, , selfClosing] = match;

    if (closing) {
      const open = stack.pop();

      if (open !== name) {
        return `</${name}> closes <${open}>`;
      }
    } else if (!selfClosing) {
      stack.push(name as string);
    }

    last = tag.lastIndex;
  }

  if (xml.slice(last).trim().length > 0) {
    return 'content after the root element';
  }

  return stack.length === 0 ? null : `unclosed: ${stack.join(', ')}`;
}

function dates(count: number, start = '2024-01-01'): string[] {
  const begin = dayNumber(start);

  return Array.from({ length: count }, (_, index) => new Date((begin + index) * 86400000).toISOString().slice(0, 10));
}

function series(id: string, values: number[], extra: Partial<ChartSeries> = {}): ChartSeries {
  return { id, label: id, dates: dates(values.length), raw: values, smoothed: values, ...extra };
}

function assertClean(svg: string): void {
  expect(wellFormed(svg)).toBeNull();
  expect(svg).not.toMatch(/NaN|Infinity|undefined/);
}

describe('well-formedness checker', () => {
  it('rejects the mistakes it is meant to catch', () => {
    expect(wellFormed('<svg><g></svg>')).not.toBeNull();
    expect(wellFormed('<svg>R & D</svg>')).not.toBeNull();
    expect(wellFormed('<svg><text>a < b</text></svg>')).not.toBeNull();
    expect(wellFormed('<svg x="a & b"></svg>')).not.toBeNull();
    expect(wellFormed('<svg></svg><svg></svg>x')).not.toBeNull();
    expect(wellFormed('<svg><g><rect/></g></svg>')).toBeNull();
  });
});

describe('SVG validity', () => {
  it('produces well-formed SVG sized for A4', () => {
    const svg = lineChart([series('en', [1, 2, 3, 4, 5])]);

    assertClean(svg);
    const root = /^<svg [^>]*>/.exec(svg)?.[0] ?? '';

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(root).toContain(`width="${CHART_WIDTH}pt" height="${CHART_HEIGHT}pt"`);
    expect(root).toContain(`viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"`);
    expect(CHART_WIDTH).toBe(520);
    expect(CHART_HEIGHT).toBe(260);
  });

  it('escapes labels so hostile text cannot break the document', () => {
    const svg = lineChart([series('a&b', [1, 2, 3], { label: 'R&D <"quoted">' })], { title: 'Tom & Jerry' });

    assertClean(svg);
    expect(svg).toContain('R&amp;D &lt;&quot;quoted&quot;&gt;');
    expect(svg).toContain('Tom &amp; Jerry');
    expect(escapeXml(`'`)).toBe('&apos;');
  });

  it('keeps Cyrillic and Czech labels intact', () => {
    const svg = lineChart([series('uk', [1, 2, 3], { label: 'Штучний інтелект' }), series('cs', [3, 2, 1], { label: 'Přerušovaný půst' })]);

    assertClean(svg);
    expect(svg).toContain('Штучний інтелект');
    expect(svg).toContain('Přerušovaný půst');
  });
});

describe('series', () => {
  it('draws every series with raw, smoothed, band and legend', () => {
    const trend = { dates: dates(3), value: [1, 2, 3], lower: [0.5, 1.5, 2.5], upper: [1.5, 2.5, 3.5] };
    const svg = lineChart([
      series('en', [1, 2, 3], { trend }),
      series('de', [2, 3, 4], { trend }),
      series('uk', [3, 4, 5], { trend }),
    ]);

    assertClean(svg);

    for (const id of ['en', 'de', 'uk']) {
      expect(svg).toContain(`data-series="${id}"`);
    }

    expect(svg.match(/class="raw"/g)).toHaveLength(3);
    expect(svg.match(/class="smoothed"/g)).toHaveLength(3);
    expect(svg.match(/class="ci-band"/g)).toHaveLength(3);
    expect(svg.match(/class="trend"/g)).toHaveLength(3);
    expect(svg.match(/class="legend"/g)).toHaveLength(3);
  });

  it('draws spike days in their own colour', () => {
    const values = [10, 10, 90, 10, 95, 10];
    const svg = lineChart([series('en', values, { outliers: [dates(6)[2] as string, dates(6)[4] as string] })]);

    assertClean(svg);
    expect(svg.match(/class="outlier"/g)).toHaveLength(2);
    expect(svg).toContain(`fill="${OUTLIER_COLOR}"`);
  });

  it('draws the recent-trend boundary when asked', () => {
    const svg = lineChart([series('en', [1, 2, 3, 4, 5, 6])], { marker: { date: dates(6)[4] as string, label: 'recent' } });

    assertClean(svg);
    expect(svg).toContain('class="marker"');
    expect(svg).toContain('>recent<');
  });

  it('breaks the line at missing values instead of drawing through them', () => {
    const svg = lineChart([{ id: 'en', label: 'en', dates: dates(5), raw: [1, 2, null, 4, 5] }]);
    const raw = /class="raw" d="([^"]*)"/.exec(svg)?.[1] ?? '';

    assertClean(svg);
    expect(raw.match(/M/g)).toHaveLength(2);
  });
});

describe('axis bounds', () => {
  it('handles a single series', () => {
    assertClean(lineChart([series('en', [5, 7, 6, 8])]));
  });

  it('handles a series of zeros', () => {
    const domain = yDomain([0, 0, 0]);
    const ticks = niceTicks(domain);

    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThan(0);
    expect(ticks.ticks).toContain(0);
    assertClean(lineChart([series('en', [0, 0, 0])]));
  });

  it('handles negative values and keeps zero on the axis', () => {
    const domain = yDomain([-5, -2, 3]);
    const ticks = niceTicks(domain);
    const svg = lineChart([series('en', [-5, -2, 3])]);

    expect(domain.min).toBeLessThan(-5);
    expect(ticks.min).toBeLessThanOrEqual(-5);
    expect(ticks.max).toBeGreaterThanOrEqual(3);
    expect(ticks.ticks).toContain(0);
    assertClean(svg);
    expect(svg).toContain('stroke="#9ca3af" stroke-width="0.5"/>');
  });

  it('does not pad non-negative data below zero', () => {
    expect(yDomain([1, 2, 3]).min).toBeGreaterThanOrEqual(0);
  });

  it('handles a series with a single point', () => {
    const domain = xDomain([series('en', [42])]);

    expect(domain.max).toBeGreaterThan(domain.min);
    assertClean(lineChart([series('en', [42])]));
  });

  it('handles a flat non-zero series without collapsing the axis', () => {
    const domain = yDomain([50, 50, 50]);

    expect(domain.max).toBeGreaterThan(domain.min);
    expect(domain.min).toBeLessThan(50);
  });

  it('renders an empty chart with a label instead of failing', () => {
    const svg = lineChart([], { emptyLabel: 'немає даних' });

    assertClean(svg);
    expect(svg).toContain('немає даних');
  });

  it('ignores non-finite values when choosing the range', () => {
    expect(yDomain([1, Number.NaN, 3, Number.POSITIVE_INFINITY, null])).toEqual(yDomain([1, 3]));
  });

  it('lets the tick range cover the whole domain', () => {
    const ticks = niceTicks({ min: 3.7, max: 97.2 });

    expect(ticks.min).toBeLessThanOrEqual(3.7);
    expect(ticks.max).toBeGreaterThanOrEqual(97.2);
    expect(ticks.ticks.length).toBeGreaterThanOrEqual(3);
  });

  it('gives a flat series a readable axis even when rounding leaves it a hair off flat', () => {
    const domain = yDomain([0.024999999999999998, 0.025]);
    const ticks = niceTicks(domain);

    expect(domain.max - domain.min).toBeGreaterThan(0.001);
    expect(ticks.ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.ticks.length).toBeLessThanOrEqual(12);
    expect(niceTicks({ min: 0.024999999999999998, max: 0.025 }).ticks.length).toBeLessThanOrEqual(12);
  });

  it('keeps date ticks inside the date range', () => {
    const domain = { min: dayNumber('2023-09-01'), max: dayNumber('2026-09-01') };
    const ticks = dateTicks(domain);

    expect(ticks.length).toBeGreaterThanOrEqual(4);

    for (const tick of ticks) {
      expect(dayNumber(tick)).toBeGreaterThanOrEqual(domain.min);
      expect(dayNumber(tick)).toBeLessThanOrEqual(domain.max);
    }
  });
});

describe('spikes and scale', () => {
  it('keeps spike days out of the axis range so they do not flatten the series', () => {
    const values = [4, 5, 4, 245, 5, 4];
    const spike = dates(6)[3] as string;
    const withSpike = series('cs', values, { smoothed: [4, 5, 4, 5, 5, 4], outliers: [spike] });
    const ticks = niceTicks(yDomain(scaleValues([withSpike])));

    expect(ticks.max).toBeLessThan(20);
  });

  it('marks an off-scale spike at the top edge instead of hiding it', () => {
    const values = [4, 5, 4, 245, 5, 4];
    const svg = lineChart([
      series('cs', values, { smoothed: [4, 5, 4, 5, 5, 4], outliers: [dates(6)[3] as string] }),
    ]);

    assertClean(svg);
    expect(svg).toContain('class="outlier off-scale"');
    expect(svg).not.toContain('<circle class="outlier"');
  });

  it('clips the lines to the plot area', () => {
    const svg = lineChart([series('en', [1, 2, 3])]);

    expect(svg).toContain('<clipPath id="plot-area">');
    expect(svg).toContain('clip-path="url(#plot-area)"');
  });
});
