import { describe, expect, it } from 'vitest';
import { DAY_MS, addDays, formatDay, parseDay } from '../src/lib/dates.js';

describe('dates', () => {
  it('reads and writes UTC calendar days', () => {
    expect(parseDay('2024-03-01')).toBe(Date.UTC(2024, 2, 1));
    expect(formatDay(Date.UTC(2024, 2, 1) + DAY_MS - 1)).toBe('2024-03-01');
  });

  it('moves across month, leap-day and year boundaries in both directions', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-01-10', 0)).toBe('2024-01-10');
  });
});
