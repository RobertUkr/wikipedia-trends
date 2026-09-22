import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enumerateDates, runFetch, summarizeSeries } from '../src/commands/fetch.js';

describe('enumerateDates', () => {
  it('is inclusive on both ends', () => {
    expect(enumerateDates('2024-02-27', '2024-03-01')).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('spans a year boundary', () => {
    expect(enumerateDates('2023-12-31', '2024-01-01')).toEqual(['2023-12-31', '2024-01-01']);
  });
});

describe('summarizeSeries', () => {
  it('reports a complete series without gaps', () => {
    const points = [
      { date: '2024-01-01', views: 10 },
      { date: '2024-01-02', views: 20 },
      { date: '2024-01-03', views: 30 },
    ];
    expect(summarizeSeries(points, '2024-01-01', '2024-01-03')).toEqual({
      points: 3,
      expectedDays: 3,
      missingDays: 0,
      longestGapDays: 0,
      firstGap: null,
      total: 60,
      first: '2024-01-01',
      last: '2024-01-03',
    });
  });

  it('counts missing days and the longest gap', () => {
    const points = [
      { date: '2024-01-01', views: 10 },
      { date: '2024-01-04', views: 40 },
      { date: '2024-01-06', views: 60 },
    ];
    expect(summarizeSeries(points, '2024-01-01', '2024-01-06')).toMatchObject({
      points: 3,
      expectedDays: 6,
      missingDays: 3,
      longestGapDays: 2,
      firstGap: '2024-01-02',
      total: 110,
    });
  });

  it('treats a series that starts late as a leading gap', () => {
    const points = [{ date: '2024-01-05', views: 5 }];
    expect(summarizeSeries(points, '2024-01-01', '2024-01-05')).toMatchObject({
      missingDays: 4,
      longestGapDays: 4,
      firstGap: '2024-01-01',
      first: '2024-01-05',
    });
  });

  it('handles an empty series', () => {
    expect(summarizeSeries([], '2024-01-01', '2024-01-03')).toMatchObject({
      points: 0,
      missingDays: 3,
      total: 0,
      first: null,
      last: null,
    });
  });
});

describe('runFetch', () => {
  const SITELINKS = {
    entities: { Q1: { sitelinks: { cswiki: { site: 'cswiki', title: 'Půst' }, enwiki: { site: 'enwiki', title: 'Fasting' } } } },
  };
  const LABELS = { entities: { Q1: { labels: { pl: { value: 'post przerywany' } }, aliases: {} } } };
  const VIEWS = { items: [{ timestamp: '2024010100', views: 3 }, { timestamp: '2024010200', views: 4 }] };

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  function router(overrides: { search?: unknown; views?: () => Response } = {}) {
    return vi.fn().mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes('props=sitelinks')) {
        return Promise.resolve(json(SITELINKS));
      }
      if (target.includes('props=labels')) {
        return Promise.resolve(json(LABELS));
      }
      if (target.includes('list=search')) {
        return Promise.resolve(json(overrides.search ?? { query: { searchinfo: { totalhits: 0 }, search: [] } }));
      }
      if (target.includes('per-article')) {
        return Promise.resolve(overrides.views ? overrides.views() : json(VIEWS));
      }
      throw new Error(`unexpected request: ${target}`);
    });
  }

  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-fetch-'));
    process.env['WIKIPEDIA_TRENDS_CACHE_DIR'] = join(dir, 'cache');
    process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'] = join(dir, 'output');
  });

  afterEach(async () => {
    delete process.env['WIKIPEDIA_TRENDS_CACHE_DIR'];
    delete process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR'];
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const base = { qid: 'Q1', from: '2024-01-01', to: '2024-01-02', noCache: true, out: null };

  it('fetches what exists and classifies a language with no article at all', async () => {
    vi.stubGlobal('fetch', router());

    const result = await runFetch({ ...base, langs: ['cs', 'pl'] });

    expect(result.series).toHaveLength(1);
    expect(result.series[0]).toMatchObject({ lang: 'cs', title: 'Půst', points: 2, total: 7 });
    expect(result.coverage).toEqual({ requested: 2, available: 1, unavailable: 1 });
    expect(result.unavailable[0]).toMatchObject({
      lang: 'pl',
      project: 'pl.wikipedia.org',
      status: 'no_article',
      requiresConfirmation: false,
      searchQuery: 'post przerywany',
      alternatives: [],
    });
  });

  it('classifies a similar title as an unconfirmed alternative', async () => {
    vi.stubGlobal(
      'fetch',
      router({
        search: {
          query: {
            searchinfo: { totalhits: 4 },
            search: [{ title: 'Post przerywany (dieta)', pageid: 7, snippet: 'schemat <span>żywienia</span>' }],
          },
        },
      }),
    );

    const result = await runFetch({ ...base, langs: ['cs', 'pl'] });

    const pl = result.unavailable[0];
    expect(pl).toMatchObject({ lang: 'pl', status: 'possible_alternative', requiresConfirmation: true, title: null });
    expect(pl?.alternatives[0]).toMatchObject({
      title: 'Post przerywany (dieta)',
      confirmed: false,
      url: 'https://pl.wikipedia.org/wiki/Post_przerywany_(dieta)',
      snippet: 'schemat żywienia',
    });
    expect(pl?.reason).toContain('Unconfirmed');
  });

  it('does not fail when every requested language lacks an article', async () => {
    vi.stubGlobal('fetch', router());

    const result = await runFetch({ ...base, langs: ['pl'] });

    expect(result.ok).toBe(true);
    expect(result.series).toEqual([]);
    expect(result.unavailable.map((entry) => entry.status)).toEqual(['no_article']);
    const written = JSON.parse(await readFile(result.file, 'utf8')) as { unavailable: unknown[]; coverage: unknown };
    expect(written.unavailable).toHaveLength(1);
    expect(written.coverage).toEqual({ requested: 1, available: 0, unavailable: 1 });
  });

  it('marks an article without pageviews as no_data rather than a missing article', async () => {
    vi.stubGlobal('fetch', router({ views: () => json({ type: 'not_found' }, 404) }));

    const result = await runFetch({ ...base, langs: ['cs'] });

    expect(result.series).toEqual([]);
    expect(result.unavailable[0]).toMatchObject({ lang: 'cs', status: 'no_data', title: 'Půst' });
  });

  it('still fails when every language breaks technically', async () => {
    vi.stubGlobal('fetch', router({ views: () => json({ error: 'boom' }, 400) }));

    await expect(runFetch({ ...base, langs: ['cs'] })).rejects.toMatchObject({ code: 'NetworkError' });
  });

  it('serves a repeated range from the cache', async () => {
    const fetchMock = router();
    vi.stubGlobal('fetch', fetchMock);

    const args = { ...base, langs: ['cs'], noCache: false };
    const first = await runFetch(args);
    const second = await runFetch(args);

    expect(first.series[0]?.cached).toBe(false);
    expect(second.series[0]?.cached).toBe(true);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('per-article'))).toHaveLength(1);
  });
});
