import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  articleViewsUrl,
  getArticleViews,
  getProjectTotals,
  normalizeProject,
  projectTotalsUrl,
  DEFAULT_CONTACT,
  contactWarning,
  searchArticles,
  stripMarkup,
  userAgent,
} from '../src/lib/wikimedia.js';
import { ArticleNotFound, HttpError, SkillError } from '../src/types.js';

const FAST = { minIntervalMs: 0, baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 1000 };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeProject', () => {
  it('expands bare language codes', () => {
    expect(normalizeProject('pl')).toBe('pl.wikipedia.org');
    expect(normalizeProject('pl.wikipedia')).toBe('pl.wikipedia.org');
    expect(normalizeProject('https://cs.wikipedia.org/')).toBe('cs.wikipedia.org');
  });
});

describe('url building', () => {
  it('always pins access=all-access and agent=user and encodes the title', () => {
    const url = articleViewsUrl('pl', 'Post przerywany', '2024-01-01', '2024-01-31');
    expect(url).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pl.wikipedia.org/all-access/user/Post_przerywany/daily/20240101/20240131',
    );
  });

  it('percent-encodes slashes in titles', () => {
    expect(articleViewsUrl('en', 'AC/DC', '2024-01-01', '2024-01-02')).toContain('/AC%2FDC/daily/');
  });

  it('builds the aggregate url', () => {
    expect(projectTotalsUrl('cs', '2024-01-01', '2024-01-02')).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/cs.wikipedia.org/all-access/user/daily/20240101/20240102',
    );
  });

  it('rejects malformed dates', () => {
    expect(() => articleViewsUrl('pl', 'X', '2024-1-1', '2024-01-02')).toThrow(SkillError);
    expect(() => articleViewsUrl('pl', 'X', '2024-02-31', '2024-03-02')).toThrow(/valid calendar date/);
  });
});

describe('userAgent', () => {
  it('carries a contact from the environment and says nothing', () => {
    process.env['WIKIMEDIA_CONTACT'] = 'team@example.com';

    expect(userAgent()).toContain('(team@example.com)');
    expect(contactWarning()).toBeNull();

    delete process.env['WIKIMEDIA_CONTACT'];
  });

  it('always carries a real contact, and warns when it is only the default', () => {
    delete process.env['WIKIMEDIA_CONTACT'];

    expect(userAgent()).toContain(`(${DEFAULT_CONTACT})`);
    expect(DEFAULT_CONTACT).toMatch(/^https:\/\/github\.com\/\w+/);
    expect(contactWarning()).toContain('WIKIMEDIA_CONTACT is not set');
  });

  it('ignores a blank value', () => {
    process.env['WIKIMEDIA_CONTACT'] = '   ';

    expect(userAgent()).toContain(DEFAULT_CONTACT);

    delete process.env['WIKIMEDIA_CONTACT'];
  });
});

describe('getArticleViews', () => {
  it('maps timestamps to ISO dates and sorts them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        items: [
          { timestamp: '2024010200', views: 20 },
          { timestamp: '2024010100', views: 10 },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getArticleViews('pl', 'Post przerywany', '2024-01-01', '2024-01-02', FAST);

    expect(result.points).toEqual([
      { date: '2024-01-01', views: 10 },
      { date: '2024-01-02', views: 20 },
    ]);
    expect(result).toMatchObject({ project: 'pl.wikipedia.org', access: 'all-access', agent: 'user' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/^wikipedia-trends\//);
  });

  it('turns 404 into ArticleNotFound', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ type: 'not_found' }, 404)));
    await expect(getArticleViews('pl', 'Nic', '2024-01-01', '2024-01-02', FAST)).rejects.toBeInstanceOf(ArticleNotFound);
  });

  it('turns an empty series into ArticleNotFound instead of an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ items: [] })));
    await expect(getArticleViews('pl', 'Nic', '2024-01-01', '2024-01-02', FAST)).rejects.toMatchObject({
      code: 'ArticleNotFound',
    });
  });

  it('retries 429 and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'rate' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json({ items: [{ timestamp: '2024010100', views: 5 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getArticleViews('pl', 'X', '2024-01-01', '2024-01-01', FAST);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.points).toHaveLength(1);
  });

  it('retries 5xx and gives up with an HttpError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: 'boom' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getArticleViews('pl', 'X', '2024-01-01', '2024-01-01', { ...FAST, retries: 2 })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: 'bad' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getArticleViews('pl', 'X', '2024-01-01', '2024-01-01', FAST)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network failures', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(json({ items: [{ timestamp: '2024010100', views: 7 }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getArticleViews('pl', 'X', '2024-01-01', '2024-01-01', FAST)).resolves.toMatchObject({
      points: [{ date: '2024-01-01', views: 7 }],
    });
  });
});

describe('getProjectTotals', () => {
  it('returns the aggregate series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ items: [{ timestamp: '2024010100', views: 1000 }] })));
    await expect(getProjectTotals('cs', '2024-01-01', '2024-01-01', FAST)).resolves.toEqual({
      project: 'cs.wikipedia.org',
      access: 'all-access',
      agent: 'user',
      granularity: 'daily',
      points: [{ date: '2024-01-01', views: 1000 }],
    });
  });
});

describe('searchArticles', () => {
  it('queries the language wiki action api in namespace 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ query: { searchinfo: { totalhits: 0 }, search: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchArticles('pl', 'post przerywany', 5, FAST);

    const url = String((fetchMock.mock.calls[0] as [string])[0]);
    expect(url).toContain('https://pl.wikipedia.org/w/api.php');
    expect(url).toContain('list=search');
    expect(url).toContain('srnamespace=0');
    expect(url).toContain('srlimit=5');
    expect(result).toEqual({ project: 'pl.wikipedia.org', query: 'post przerywany', totalHits: 0, hits: [] });
  });

  it('strips search markup from snippets and keeps the total hit count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          query: {
            searchinfo: { totalhits: 12 },
            search: [{ title: 'Głodówka', pageid: 3, snippet: 'okresowa <span class="searchmatch">głodówka</span>  &amp; post' }],
          },
        }),
      ),
    );

    const result = await searchArticles('pl', 'głodówka', 5, FAST);

    expect(result.totalHits).toBe(12);
    expect(result.hits[0]).toEqual({ title: 'Głodówka', pageid: 3, snippet: 'okresowa głodówka & post' });
  });
});

describe('stripMarkup', () => {
  it('collapses whitespace and removes tags', () => {
    expect(stripMarkup('<b>a</b>   b\n c')).toBe('a b c');
  });
});
