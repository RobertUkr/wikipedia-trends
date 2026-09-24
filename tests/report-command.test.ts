import { afterEach, describe, expect, it, vi } from 'vitest';
import { runReport } from '../src/commands/report.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runReport', () => {
  it('rejects a malformed qid before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runReport({ qid: 'Q1x', langs: ['en'], from: '2024-01-01', to: '2024-12-31', locale: 'en', artifact: null, noCache: true }),
    ).rejects.toMatchObject({ code: 'InvalidInput', message: '--qid "Q1x" is not a Wikidata item id', details: { qid: 'Q1x' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
