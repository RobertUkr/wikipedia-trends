import { describe, expect, it } from 'vitest';
import { parseSitelinkEvent, titleWindows } from '../src/lib/history.js';

describe('parseSitelinkEvent', () => {
  it('reads a page move, a manual set and a removal for the requested site only', () => {
    expect(
      parseSitelinkEvent(
        '/* clientsitelink-update:0|enwiki|enwiki:Russian invasion of Ukraine|enwiki:Russo-Ukrainian war (2022–present) */',
        '2025-09-23T17:42:23Z',
        'enwiki',
      ),
    ).toMatchObject({ date: '2025-09-23', kind: 'set', title: 'Russo-Ukrainian war (2022–present)', previous: 'Russian invasion of Ukraine' });
    expect(
      parseSitelinkEvent('/* wblinktitles-connect:2| */ enwiki:Russian invasion of Ukraine, kswiki:X', '2023-11-07T17:22:33Z', 'enwiki'),
    ).toMatchObject({ kind: 'set', title: 'Russian invasion of Ukraine', previous: 'Russian invasion of Ukraine' });
    expect(
      parseSitelinkEvent(
        '/* wbsetsitelink-set:1|dewiki */ Russischer Überfall auf die Ukraine seit 2022, Bot: page move of [[:de:X|X]]',
        '2026-02-09T13:59:30Z',
        'dewiki',
      ),
    ).toMatchObject({ kind: 'set', title: 'Russischer Überfall auf die Ukraine seit 2022', previous: null });
    expect(parseSitelinkEvent('/* wbsetsitelink-add:1|ukwiki */ Астрономія', '2025-03-01T00:00:00Z', 'ukwiki')).toMatchObject({
      kind: 'set',
      title: 'Астрономія',
      previous: 'Астрономія',
    });
    expect(parseSitelinkEvent('/* wbsetsitelink-remove:1|enwiki */ Old', '2025-11-18T00:00:00Z', 'enwiki')).toMatchObject({
      kind: 'remove',
    });
    expect(parseSitelinkEvent('/* wbsetsitelink-add:1|enwikiquote */ Quote', '2025-01-01T00:00:00Z', 'enwiki')).toBeNull();
  });
});

describe('titleWindows', () => {
  it('gives one window with the current title when the article was never renamed', () => {
    expect(titleWindows([], 'Tinder (app)', '2024-01-01', '2024-12-31')).toEqual([
      { title: 'Tinder (app)', from: '2024-01-01', to: '2024-12-31' },
    ]);
  });

  it('splits the period at every rename and starts from the name before the first move', () => {
    const windows = titleWindows(
      [
        { at: '2025-09-23T10:00:00Z', date: '2025-09-23', kind: 'set', title: 'C', previous: 'B' },
        { at: '2023-03-07T10:00:00Z', date: '2023-03-07', kind: 'set', title: 'B', previous: 'A' },
      ],
      'C',
      '2022-02-24',
      '2026-09-22',
    );

    expect(windows).toEqual([
      { title: 'A', from: '2022-02-24', to: '2023-03-06' },
      { title: 'B', from: '2023-03-07', to: '2025-09-22' },
      { title: 'C', from: '2025-09-23', to: '2026-09-22' },
    ]);
  });

  it('leaves the time before the first rename empty when the old name is unknown, instead of guessing', () => {
    const windows = titleWindows(
      [{ at: '2023-03-07T10:00:00Z', date: '2023-03-07', kind: 'set', title: 'Now', previous: null }],
      'Now',
      '2022-02-24',
      '2023-12-31',
    );

    expect(windows).toEqual([{ title: 'Now', from: '2023-03-07', to: '2023-12-31' }]);
  });

  it('keeps the whole period when an existing article was only linked to Wikidata later', () => {
    const linked = parseSitelinkEvent('/* wbsetsitelink-add:1|ukwiki */ Астрономія', '2025-03-01T00:00:00Z', 'ukwiki');
    const windows = titleWindows(linked ? [linked] : [], 'Астрономія', '2024-09-23', '2026-09-22');

    expect(windows).toEqual([{ title: 'Астрономія', from: '2024-09-23', to: '2026-09-22' }]);
  });

  it('orders same-day edits by time and ignores sitelink removals', () => {
    const windows = titleWindows(
      [
        { at: '2022-03-18T12:00:00Z', date: '2022-03-18', kind: 'set', title: 'Right', previous: null },
        { at: '2022-03-18T09:00:00Z', date: '2022-03-18', kind: 'set', title: 'Wrong', previous: 'First' },
        { at: '2023-01-01T09:00:00Z', date: '2023-01-01', kind: 'remove', title: null, previous: null },
      ],
      'Right',
      '2022-03-01',
      '2023-06-30',
    );

    expect(windows).toEqual([
      { title: 'First', from: '2022-03-01', to: '2022-03-17' },
      { title: 'Right', from: '2022-03-18', to: '2023-06-30' },
    ]);
  });
});
