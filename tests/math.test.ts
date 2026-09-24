import { describe, expect, it } from 'vitest';
import { clamp01, round } from '../src/lib/math.js';

describe('round', () => {
  it('rounds to two places by default and to any given precision', () => {
    expect(round(1.23456)).toBe(1.23);
    expect(round(-37.04, 1)).toBe(-37);
    expect(round(0.1234567, 6)).toBe(0.123457);
    expect(round(12.5, 0)).toBe(13);
  });
});

describe('clamp01', () => {
  it('keeps scores inside [0, 1]', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(1.7)).toBe(1);
  });
});
