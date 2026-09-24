export interface SitelinkEvent {
  at: string;
  date: string;
  kind: 'set' | 'remove';
  title: string | null;
  previous: string | null;
}

export interface TitleWindow {
  title: string;
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

export function parseSitelinkEvent(comment: string, timestamp: string, site: string): SitelinkEvent | null {
  const at = timestamp;
  const date = timestamp.slice(0, 10);
  const key = escape(site);
  const update = new RegExp(`^/\\* clientsitelink-update:\\d+\\|${key}\\|${key}:(.+?)\\|${key}:(.+?) \\*/`).exec(comment);

  if (update) {
    return { at, date, kind: 'set', title: update[2] as string, previous: update[1] as string };
  }

  const set = new RegExp(`^/\\* wbsetsitelink-(add|set)(?:-both)?:\\d+\\|${key} \\*/ (.+)$`).exec(comment);

  if (set) {
    const title = (set[2] as string).split(/, (?:Bot:|Moving sitelink|#)/)[0]?.trim() ?? '';

    if (!title) {
      return null;
    }

    return { at, date, kind: 'set', title, previous: set[1] === 'add' ? title : null };
  }

  const linked = new RegExp(`^/\\* wblinktitles-connect:\\d+\\| \\*/ (?:.*, )?${key}:(.+?)(?:, [a-z_]+wiki:|$)`).exec(comment);

  if (linked) {
    const title = (linked[1] as string).trim();

    return { at, date, kind: 'set', title, previous: title };
  }

  if (new RegExp(`^/\\* (?:wbsetsitelink-remove|clientsitelink-remove):\\d+\\|${key} \\*/`).test(comment)) {
    return { at, date, kind: 'remove', title: null, previous: null };
  }

  return null;
}

export function titleWindows(events: SitelinkEvent[], current: string, from: string, to: string): TitleWindow[] {
  const ordered = events.filter((event) => event.kind === 'set').sort((a, b) => a.at.localeCompare(b.at));
  const segments: Array<{ title: string | null; from: string }> = [];
  const first = ordered[0];

  segments.push({ title: first ? first.previous : current, from: '0000-01-01' });

  for (const event of ordered) {
    const last = segments[segments.length - 1];

    if (last && last.from === event.date) {
      last.title = event.title;
      continue;
    }

    segments.push({ title: event.title, from: event.date });
  }

  const tail = segments[segments.length - 1];

  if (tail) {
    tail.title = current;
  }

  const windows: TitleWindow[] = [];

  segments.forEach((segment, index) => {
    const next = segments[index + 1];
    const start = segment.from > from ? segment.from : from;
    const end = next ? (dayBefore(next.from) < to ? dayBefore(next.from) : to) : to;

    if (!segment.title || start > end) {
      return;
    }

    const previous = windows[windows.length - 1];

    if (previous && previous.title === segment.title && previous.to === dayBefore(start)) {
      previous.to = end;
      return;
    }

    windows.push({ title: segment.title, from: start, to: end });
  });

  return windows;
}
