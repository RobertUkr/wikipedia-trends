import { addDays } from './dates.js';

/** A change of an article's sitelink for one wiki, parsed from a Wikidata revision comment. */
export interface SitelinkEvent {
  at: string;
  date: string;
  kind: 'set' | 'remove';
  title: string | null;
  previous: string | null;
}

/** Date range during which the article had the given title. */
export interface TitleWindow {
  title: string;
  from: string;
  to: string;
}

// Site keys are embedded into regexes below.
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parses a Wikidata edit summary into a sitelink set/remove event for `site`; null if it is unrelated. */
export function parseSitelinkEvent(comment: string, timestamp: string, site: string): SitelinkEvent | null {
  const at = timestamp;
  const date = timestamp.slice(0, 10);
  const key = escape(site);
  // Page move on the client wiki: `/* clientsitelink-update:0|ukwiki|ukwiki:Old|ukwiki:New */`.
  const update = new RegExp(`^/\\* clientsitelink-update:\\d+\\|${key}\\|${key}:(.+?)\\|${key}:(.+?) \\*/`).exec(comment);

  if (update) {
    return { at, date, kind: 'set', title: update[2] as string, previous: update[1] as string };
  }

  // Direct sitelink edit on Wikidata: `/* wbsetsitelink-set:1|ukwiki */ Title`, optionally with badges (`-both`).
  const set = new RegExp(`^/\\* wbsetsitelink-(add|set)(?:-both)?:\\d+\\|${key} \\*/ (.+)$`).exec(comment);

  if (set) {
    // Strip a free-text suffix the editor appended after the title.
    const title = (set[2] as string).split(/, (?:Bot:|Moving sitelink|#)/)[0]?.trim() ?? '';

    if (!title) {
      return null;
    }

    // An add starts the article under this title; a set does not name the former one, so the caller resolves it.
    return { at, date, kind: 'set', title, previous: set[1] === 'add' ? title : null };
  }

  // Titles linked across wikis: `/* wblinktitles-connect:2| */ enwiki:A, ukwiki:B`.
  const linked = new RegExp(`^/\\* wblinktitles-connect:\\d+\\| \\*/ (?:.*, )?${key}:(.+?)(?:, [a-z_]+wiki:|$)`).exec(comment);

  if (linked) {
    const title = (linked[1] as string).trim();

    return { at, date, kind: 'set', title, previous: title };
  }

  // Sitelink removed on Wikidata or by deleting the client page.
  if (new RegExp(`^/\\* (?:wbsetsitelink-remove|clientsitelink-remove):\\d+\\|${key} \\*/`).test(comment)) {
    return { at, date, kind: 'remove', title: null, previous: null };
  }

  return null;
}

/** Splits the range into windows by the title the article had, so each title is fetched only for its own days. */
export function titleWindows(events: SitelinkEvent[], current: string, from: string, to: string): TitleWindow[] {
  const ordered = events.filter((event) => event.kind === 'set').sort((a, b) => a.at.localeCompare(b.at));
  const segments: Array<{ title: string | null; from: string }> = [];
  const first = ordered[0];

  // Before the first recorded change the article carried that change's former title.
  segments.push({ title: first ? first.previous : current, from: '0000-01-01' });

  for (const event of ordered) {
    const last = segments[segments.length - 1];

    // Several changes on one day: only the day's final title counts.
    if (last && last.from === event.date) {
      last.title = event.title;
      continue;
    }

    segments.push({ title: event.title, from: event.date });
  }

  const tail = segments[segments.length - 1];

  // The latest segment is the article's current title, whatever the last event said.
  if (tail) {
    tail.title = current;
  }

  const windows: TitleWindow[] = [];

  segments.forEach((segment, index) => {
    const next = segments[index + 1];
    const start = segment.from > from ? segment.from : from;
    const lastDay = next ? addDays(next.from, -1) : to;
    const end = lastDay < to ? lastDay : to;

    if (!segment.title || start > end) {
      return;
    }

    const previous = windows[windows.length - 1];

    // Adjacent segments with the same title (e.g. an edit that did not change it) merge into one window.
    if (previous && previous.title === segment.title && previous.to === addDays(start, -1)) {
      previous.to = end;
      return;
    }

    windows.push({ title: segment.title, from: start, to: end });
  });

  return windows;
}
