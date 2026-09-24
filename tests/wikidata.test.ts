import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifySearchResult,
  getLabels,
  getSitelinks,
  probeLanguages,
  resolveTopic,
  scoreEntry,
  sitelinksToTitles,
  titleSimilarity,
} from '../src/lib/wikidata.js';
import { SkillError, TopicNotFound } from '../src/types.js';

const FAST = { minIntervalMs: 0, baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 1000 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sitelinks(map: Record<string, string>): Record<string, { site: string; title: string }> {
  return Object.fromEntries(Object.entries(map).map(([site, title]) => [site, { site, title }]));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sitelinksToTitles', () => {
  it('keeps language wikipedias and drops sister projects', () => {
    const titles = sitelinksToTitles(
      sitelinks({
        ukwiki: 'Інтервальне голодування',
        plwiki: 'Post przerywany',
        commonswiki: 'Category:Fasting',
        enwikiquote: 'Fasting',
        specieswiki: 'Homo',
        be_x_oldwiki: 'Пост',
      }),
    );
    expect(titles).toEqual({
      uk: 'Інтервальне голодування',
      pl: 'Post przerywany',
      'be-x-old': 'Пост',
    });
  });
});

describe('scoreEntry', () => {
  it('ranks an exact label match above a partial one', () => {
    const exact = scoreEntry('пост', { label: 'Пост', match: { type: 'label', text: 'Пост' } }, 0);
    const partial = scoreEntry('пост', { label: 'Постмодернізм', match: { type: 'label', text: 'Постмодернізм' } }, 1);
    expect(exact).toBeGreaterThan(partial);
  });
});

describe('resolveTopic', () => {
  it('returns the winner with its titles and no candidates when it is unambiguous', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          search: [
            { id: 'Q1', label: 'Інтервальне голодування', description: 'режим харчування', match: { type: 'label', text: 'Інтервальне голодування' } },
            { id: 'Q2', label: 'Голодування', description: 'утримання від їжі', match: { type: 'label', text: 'Голодування' } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          entities: {
            Q1: { sitelinks: sitelinks({ ukwiki: 'Інтервальне голодування', plwiki: 'Post przerywany', cswiki: 'Přerušovaný půst' }) },
            Q2: { sitelinks: sitelinks({ ukwiki: 'Голодування' }) },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveTopic('інтервальне голодування', 'uk', FAST);

    expect(result.qid).toBe('Q1');
    expect(result.titles['pl']).toBe('Post przerywany');
    expect(result.titles['cs']).toBe('Přerušovaný půst');
    expect(result.candidates).toEqual([]);

    const searchUrl = String((fetchMock.mock.calls[0] as [string])[0]);
    expect(searchUrl).toContain('action=wbsearchentities');
    expect(searchUrl).toContain('language=uk');
  });

  it('returns every close candidate instead of guessing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            search: [
              { id: 'Q1', label: 'Меркурій', description: 'планета', match: { type: 'label', text: 'Меркурій' } },
              { id: 'Q2', label: 'Меркурій', description: 'хімічний елемент', match: { type: 'label', text: 'Меркурій' } },
            ],
          }),
        )
        .mockResolvedValueOnce(
          json({
            entities: {
              Q1: { sitelinks: sitelinks({ ukwiki: 'Меркурій (планета)' }) },
              Q2: { sitelinks: sitelinks({ ukwiki: 'Ртуть' }) },
            },
          }),
        ),
    );

    const result = await resolveTopic('меркурій', 'uk', FAST);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.qid)).toEqual(['Q1', 'Q2']);
    expect(result.candidates[0]?.wikiCount).toBe(1);
  });

  it('does not treat an obscure namesake as a real alternative', async () => {
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`l${index}wiki`, `Astronomy ${index}`]));

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            search: [
              { id: 'Q12012641', label: 'Астрономія', description: 'fictional class at Hogwarts', match: { type: 'label', text: 'Астрономія' } },
              { id: 'Q333', label: 'астрономія', description: 'наука', match: { type: 'label', text: 'астрономія' } },
            ],
          }),
        )
        .mockResolvedValueOnce(
          json({
            entities: {
              Q12012641: { sitelinks: sitelinks({ enwiki: 'Astronomy (Harry Potter)', dewiki: 'Astronomie (HP)' }) },
              Q333: { sitelinks: sitelinks(many) },
            },
          }),
        ),
    );

    const result = await resolveTopic('астрономія', 'uk', FAST);

    expect(result.qid).toBe('Q333');
    expect(result.candidates).toEqual([]);
  });

  it('skips items without Wikipedia articles', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            search: [
              { id: 'Q1', label: 'Тема', description: 'лише Wikidata', match: { type: 'label', text: 'Тема' } },
              { id: 'Q2', label: 'Тема (стаття)', description: 'є стаття', match: { type: 'alias', text: 'Тема' } },
            ],
          }),
        )
        .mockResolvedValueOnce(
          json({ entities: { Q1: { sitelinks: {} }, Q2: { sitelinks: sitelinks({ ukwiki: 'Тема' }) } } }),
        ),
    );

    const result = await resolveTopic('тема', 'uk', FAST);
    expect(result.qid).toBe('Q2');
  });

  it('throws TopicNotFound when the search stays empty', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ search: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveTopic('щось неможливе', 'uk', FAST)).rejects.toBeInstanceOf(TopicNotFound);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once when Wikidata returns an empty search for a topic that exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(json({ search: [] })))
        .mockImplementationOnce(() =>
          Promise.resolve(json({ search: [{ id: 'Q1', label: 'Тема', match: { type: 'label', text: 'Тема' } }] })))
        .mockImplementationOnce(() =>
          Promise.resolve(json({ entities: { Q1: { sitelinks: sitelinks({ ukwiki: 'Тема' }) } } }))),
    );

    await expect(resolveTopic('тема', 'uk', FAST)).resolves.toMatchObject({ qid: 'Q1' });
  });

  it('throws NoSitelink when nothing has an article', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ search: [{ id: 'Q1', label: 'X', match: { type: 'label', text: 'X' } }] }))
        .mockResolvedValueOnce(json({ entities: { Q1: { sitelinks: {} } } })),
    );
    await expect(resolveTopic('x', 'uk', FAST)).rejects.toMatchObject({ code: 'NoSitelink' });
  });
});

describe('getSitelinks', () => {
  it('rejects a non Q-id without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSitelinks('pl', FAST)).rejects.toBeInstanceOf(SkillError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the title map for an item', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ entities: { Q42: { sitelinks: sitelinks({ plwiki: 'Post', cswiki: 'Půst' }) } } })),
    );
    await expect(getSitelinks('Q42', FAST)).resolves.toEqual({ pl: 'Post', cs: 'Půst' });
  });

  it('throws NoSitelink for an item without articles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ entities: { Q42: { sitelinks: {} } } })));
    await expect(getSitelinks('Q42', FAST)).rejects.toMatchObject({ code: 'NoSitelink' });
  });
});

describe('titleSimilarity', () => {
  it('scores exact and near-exact titles highest', () => {
    expect(titleSimilarity('post przerywany', 'Post przerywany')).toBe(1);
    expect(titleSimilarity('post przerywany', 'Post przerywany (dieta)')).toBe(0.9);
  });

  it('scores an unrelated title at zero', () => {
    expect(titleSimilarity('post przerywany', 'Zygmunt III Waza')).toBe(0);
  });
});

describe('classifySearchResult', () => {
  it('reports no_article when the search finds nothing', () => {
    const result = classifySearchResult('pl', 'post przerywany', {
      project: 'pl.wikipedia.org',
      query: 'post przerywany',
      totalHits: 0,
      hits: [],
    });

    expect(result).toMatchObject({
      lang: 'pl',
      project: 'pl.wikipedia.org',
      status: 'no_article',
      title: null,
      requiresConfirmation: false,
      searchHits: 0,
      alternatives: [],
    });
  });

  it('reports no_article when the term only appears inside other articles', () => {
    const result = classifySearchResult('pl', 'post przerywany', {
      project: 'pl.wikipedia.org',
      query: 'post przerywany',
      totalHits: 12,
      hits: [
        { title: 'Głodówka', pageid: 1, snippet: 'okresowa głodówka' },
        { title: 'Dieta', pageid: 2, snippet: 'rodzaje diet' },
      ],
    });

    expect(result.status).toBe('no_article');
    expect(result.alternatives).toEqual([]);
    expect(result.searchHits).toBe(12);
    expect(result.reason.code).toBe('NO_ARTICLE_WITH_MENTIONS');
    expect(result.reason.params).toEqual({ project: 'pl.wikipedia.org', query: 'post przerywany', hits: 12 });
  });

  it('reports possible_alternative and never marks it confirmed', () => {
    const result = classifySearchResult('pl', 'post przerywany', {
      project: 'pl.wikipedia.org',
      query: 'post przerywany',
      totalHits: 3,
      hits: [
        { title: 'Nic wspólnego', pageid: 9, snippet: '' },
        { title: 'Post przerywany (dieta)', pageid: 5, snippet: 'schemat żywienia' },
      ],
    });

    expect(result.status).toBe('possible_alternative');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.title).toBeNull();
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]).toMatchObject({
      title: 'Post przerywany (dieta)',
      confirmed: false,
      url: 'https://pl.wikipedia.org/wiki/Post_przerywany_(dieta)',
    });
    expect(result.reason.code).toBe('POSSIBLE_ALTERNATIVE');
  });
});

describe('getLabels', () => {
  it('falls back to the first alias when there is no label', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        entities: {
          Q1: { labels: { cs: { value: 'Přerušovaný půst' } }, aliases: { pl: [{ value: 'głodówka przerywana' }] } },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLabels('Q1', ['cs', 'pl', 'xh'], FAST)).resolves.toEqual({
      cs: 'Přerušovaný půst',
      pl: 'głodówka przerywana',
    });
    expect(String((fetchMock.mock.calls[0] as [string])[0])).toContain('languages=cs%7Cpl%7Cxh');
  });
});

describe('probeLanguages', () => {
  it('asks Wikidata for labels once and searches each language once', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('props=labels')
          ? json({ entities: { Q1: { labels: { pl: { value: 'post przerywany' } }, aliases: {} } } })
          : json({ query: { searchinfo: { totalhits: 0 }, search: [] } }),
      ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeLanguages('Q1', ['pl', 'cs'], 'Intermittent fasting', FAST);

    expect(result.map((entry) => entry.status)).toEqual(['no_article', 'no_article']);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('props=labels'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('list=search'))).toHaveLength(2);
  });

  it('uses the fallback query for a language Wikidata has no label for', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('props=labels')
          ? json({ entities: { Q1: { labels: {}, aliases: {} } } })
          : json({ query: { searchinfo: { totalhits: 0 }, search: [] } }),
      ));
    vi.stubGlobal('fetch', fetchMock);

    const [entry] = await probeLanguages('Q1', ['pl'], 'Intermittent fasting', FAST);

    expect(entry?.searchQuery).toBe('Intermittent fasting');
    const searchUrl = String(
      (fetchMock.mock.calls.find((call) => String(call[0]).includes('list=search')) as [string])[0],
    );
    expect(searchUrl).toContain('https://pl.wikipedia.org/w/api.php');
    expect(searchUrl).toContain('srsearch=Intermittent+fasting');
  });

  it('marks a failed search as fetch_failed, not as a missing article', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('props=labels')
          ? json({ entities: { Q1: { labels: { pl: { value: 'post' } }, aliases: {} } } })
          : json({ error: 'boom' }, 400),
      ));
    vi.stubGlobal('fetch', fetchMock);

    const [entry] = await probeLanguages('Q1', ['pl'], 'fallback', FAST);
    expect(entry?.status).toBe('fetch_failed');
  });
});
