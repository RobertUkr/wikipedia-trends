import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeLanguage } from '../src/commands/analyze.js';
import type { Message } from '../src/types.js';

const DAYS = 728;
const START = '2024-01-01';

function codes(messages: Message[]): string[] {
  return messages.map((item) => item.code);
}

function dates(length: number): string[] {
  const begin = Date.parse(`${START}T00:00:00Z`);

  return Array.from({ length }, (_, index) => new Date(begin + index * 86400000).toISOString().slice(0, 10));
}

function items(shape: (index: number) => number): { items: Array<{ timestamp: string; views: number }> } {
  return {
    items: dates(DAYS).map((date, index) => ({
      timestamp: `${date.replace(/-/g, '')}00`,
      views: Math.max(1, Math.round(shape(index))),
    })),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function router(article: (index: number) => number, totals: (index: number) => number) {
  return vi.fn().mockImplementation((url: string) => {
    const target = String(url);

    if (target.includes('props=sitelinks')) {
      return Promise.resolve(json({ entities: { Q1: { sitelinks: { enwiki: { site: 'enwiki', title: 'Topic' } } } } }));
    }

    if (target.includes('per-article')) {
      return Promise.resolve(json(items(article)));
    }

    if (target.includes('aggregate')) {
      return Promise.resolve(json(items(totals)));
    }

    throw new Error(`unexpected request: ${target}`);
  });
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wt-analyze-'));
  process.env['WIKIPEDIA_TRENDS_CACHE_DIR'] = join(dir, 'cache');
  process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'] = join(dir, 'output');
});

afterEach(async () => {
  delete process.env['WIKIPEDIA_TRENDS_CACHE_DIR'];
  delete process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'];
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const LAST_DAY = dates(DAYS)[DAYS - 1] as string;

describe('absolute and relative trends', () => {
  it('separates a shrinking edition from a shrinking topic', async () => {
    const decay = (index: number) => 1 - (0.25 * index) / 365;
    vi.stubGlobal(
      'fetch',
      router(
        (index) => 2000 * decay(index),
        (index) => 2_000_000_000 * decay(index),
      ),
    );

    const result = await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true);

    expect(result.unit).toBe('views_per_million');
    expect(result.primary).toBe('relative');
    expect(result.absoluteTrend.percentPerYear).toBeLessThan(-15);
    expect(Math.abs(result.relativeTrend?.percentPerYear ?? 99)).toBeLessThan(2);
    expect(codes(result.confidence.caveats)).toContain('EDITION_TRAFFIC_DECLINING');
  });

  it('reports a topic that really is losing interest as falling on both measures', async () => {
    vi.stubGlobal(
      'fetch',
      router(
        (index) => 2000 * (1 - (0.3 * index) / 365),
        () => 2_000_000_000,
      ),
    );

    const result = await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true);

    expect(result.absoluteTrend.percentPerYear).toBeLessThan(-20);
    expect(result.relativeTrend?.percentPerYear).toBeLessThan(-20);
    expect(codes(result.confidence.caveats)).toContain('ABSOLUTE_VS_RELATIVE');
    expect(codes(result.confidence.caveats)).not.toContain('EDITION_TRAFFIC_DECLINING');
  });

  it('leaves relativeTrend empty when the edition totals are unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const target = String(url);

      if (target.includes('props=sitelinks')) {
        return Promise.resolve(json({ entities: { Q1: { sitelinks: { enwiki: { site: 'enwiki', title: 'Topic' } } } } }));
      }

      if (target.includes('per-article')) {
        return Promise.resolve(json(items((index) => 2000 - index)));
      }

      return Promise.resolve(json({ type: 'not_found' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true);

    expect(result.unit).toBe('raw_views');
    expect(result.primary).toBe('absolute');
    expect(result.relativeTrend).toBeNull();
    expect(codes(result.confidence.caveats)).toContain('RAW_COUNTS_NOT_COMPARABLE');
  });
});

describe('recent trend', () => {
  it('is always reported, even when it agrees with the whole period', async () => {
    vi.stubGlobal(
      'fetch',
      router(
        (index) => 2000 + (600 * index) / 365,
        () => 2_000_000_000,
      ),
    );

    const result = await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true);

    expect(result.recentTrend?.percentPerYear).toBeGreaterThan(0);
    expect(result.recentWeeks).toBe(Math.ceil(104 / 3));
    expect(codes(result.confidence.caveats)).not.toContain('TREND_REVERSAL');
  });

  it('flags a reversal and drops the verdict below high', async () => {
    const turn = Math.round(DAYS * 0.66);
    const shape = (index: number) =>
      index < turn ? 4000 - (1400 * index) / 365 : 4000 - (1400 * turn) / 365 + (2600 * (index - turn)) / 365;

    vi.stubGlobal(
      'fetch',
      router(shape, () => 2_000_000_000),
    );

    const result = await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true);

    expect(result.trend.percentPerYear).toBeLessThan(0);
    expect(result.recentTrend?.percentPerYear).toBeGreaterThan(0);
    expect(result.reversal).not.toBeNull();
    expect(codes(result.confidence.caveats)).toContain('TREND_REVERSAL');
    expect(result.confidence.overall).not.toBe('high');
  });

  it('stays silent about a reversal when the recent interval contains zero', async () => {
    const turn = Math.round(DAYS * 0.66);
    const shape = (index: number) => (index < turn ? 4000 - (1400 * index) / 365 : 4000 - (1400 * turn) / 365);

    vi.stubGlobal(
      'fetch',
      router(shape, () => 2_000_000_000),
    );

    const result = await analyzeLanguage('Q1', 'en', 'Topic', START, LAST_DAY, true);

    expect(result.recentTrend).not.toBeNull();
    expect(result.reversal).toBeNull();
    expect(codes(result.confidence.caveats)).not.toContain('TREND_REVERSAL');
  });
});
