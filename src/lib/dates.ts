/** Milliseconds in a UTC day; every date in this project is a UTC calendar day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds since the epoch at the start of a YYYY-MM-DD day in UTC. */
export function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** YYYY-MM-DD of the UTC day that contains the given instant. */
export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day `days` after `date` (negative goes back), as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  return formatDay(parseDay(date) + days * DAY_MS);
}
