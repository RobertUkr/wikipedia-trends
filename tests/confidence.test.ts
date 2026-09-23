import { describe, expect, it } from 'vitest';
import { WEIGHTS, assessConfidence, subsampleSlopes } from '../src/lib/confidence.js';
import type { ConfidenceInput } from '../src/lib/confidence.js';
import type { Message } from '../src/types.js';

function codes(messages: Message[]): string[] {
  return messages.map((item) => item.code);
}

function ramp(length: number, start: number, perDay: number): number[] {
  return Array.from({ length }, (_, index) => start + perDay * index);
}

function zigzag(length: number): number[] {
  return Array.from({ length }, (_, index) => (index < length / 2 ? 100 + index * 0.5 : 100 + (length - index) * 0.5));
}

function input(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    values: ramp(730, 100, 0.05),
    rawMedianViews: 800,
    rangeDays: 730,
    missingDays: 0,
    longestGapDays: 0,
    outlierDays: 0,
    ci95: [0.04, 0.06],
    normalized: true,
    weeks: 104,
    trends: null,
    reversal: null,
    ...overrides,
  };
}

describe('weights', () => {
  it('sum to one so the score stays on a 0..1 scale', () => {
    expect(Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
  });
});

describe('volume', () => {
  it('rates a 15 views/day series as low confidence and says why', () => {
    const report = assessConfidence(input({ rawMedianViews: 15, values: ramp(730, 15, 0.01), ci95: [0.005, 0.02] }));

    expect(report.overall).toBe('low');
    expect(report.components.volume.score).toBe(0);
    expect(codes(report.caveats)).toContain('LOW_VOLUME');
    expect(report.caveats.find((caveat) => caveat.code === 'LOW_VOLUME')?.params).toMatchObject({ median: 15 });
  });

  it('caps the overall verdict at low however good the rest of the series is', () => {
    const report = assessConfidence(input({ rawMedianViews: 22 }));

    expect(report.components.length.score).toBe(1);
    expect(report.components.continuity.score).toBe(1);
    expect(report.overall).toBe('low');
  });

  it('never calls a verdict high while it is also warning that the traffic is noise', () => {
    const report = assessConfidence(input({ rawMedianViews: 55 }));

    expect(codes(report.caveats)).toContain('LOW_VOLUME');
    expect(report.score).toBeGreaterThan(0.7);
    expect(report.overall).toBe('medium');
  });

  it('rates a large, long, clean series as high', () => {
    const report = assessConfidence(input());

    expect(report.overall).toBe('high');
    expect(report.score).toBeGreaterThan(0.85);
  });
});

describe('length', () => {
  it('flags a series that is too short for a year-over-year claim', () => {
    const report = assessConfidence(input({ values: ramp(120, 100, 0.05), rangeDays: 120 }));

    expect(report.components.length.score).toBeCloseTo(120 / 730, 2);
    expect(codes(report.caveats)).toContain('SERIES_TOO_SHORT');
    expect(report.overall).not.toBe('high');
  });
});

describe('stability', () => {
  it('splits the series into halves and thirds', () => {
    expect(subsampleSlopes(ramp(300, 100, 0.1))).toHaveLength(5);
  });

  it('drops the score when the slope changes sign inside the period', () => {
    const report = assessConfidence(input({ values: zigzag(730), ci95: [0.01, 0.05] }));

    expect(report.components.stability.score).toBeLessThan(1);
    expect(codes(report.caveats)).toContain('SLOPE_SIGN_UNSTABLE');
    expect(report.overall).not.toBe('high');
  });

  it('does not punish a flat series whose interval already spans zero', () => {
    const report = assessConfidence(input({ values: zigzag(730), ci95: [-0.02, 0.03] }));

    expect(report.components.stability.score).toBe(1);
    expect(codes(report.caveats)).toContain('INTERVAL_SPANS_ZERO');
  });
});

describe('outlierShare', () => {
  it('reaches zero once a tenth of the days are spikes', () => {
    const report = assessConfidence(input({ outlierDays: 73 }));

    expect(report.components.outlierShare.score).toBe(0);
    expect(report.caveats.find((caveat) => caveat.code === 'SPIKES_EXCLUDED')?.params).toEqual({ days: 73 });
  });

  it('is untouched when nothing was excluded', () => {
    expect(assessConfidence(input()).components.outlierShare.score).toBe(1);
  });
});

describe('continuity', () => {
  it('treats a long gap as a possible article rename', () => {
    const report = assessConfidence(input({ missingDays: 20, longestGapDays: 20 }));

    expect(report.components.continuity.score).toBeLessThanOrEqual(0.4);
    expect(codes(report.caveats)).toContain('LONG_GAP_POSSIBLE_RENAME');
  });

  it('mentions short gaps without the rename warning', () => {
    const report = assessConfidence(input({ missingDays: 3, longestGapDays: 2 }));

    expect(report.components.continuity.score).toBeGreaterThan(0.9);
    expect(codes(report.caveats)).toContain('GAPS_INTERPOLATED');
    expect(codes(report.caveats)).not.toContain('LONG_GAP_POSSIBLE_RENAME');
  });
});

describe('caveats', () => {
  it('always explains that the fit runs on weekly sums because of autocorrelation', () => {
    const report = assessConfidence(input());

    expect(report.caveats.at(-1)?.code).toBe('WEEKLY_AGGREGATION');
    expect(report.caveats.at(-1)?.params).toEqual({ weeks: 104, days: 730 });
  });

  it('warns that raw counts are not comparable across editions', () => {
    const report = assessConfidence(input({ normalized: false }));

    expect(codes(report.caveats)).toContain('RAW_COUNTS_NOT_COMPARABLE');
  });
});

describe('two trends', () => {
  it('explains the difference between raw views and share of edition traffic', () => {
    const report = assessConfidence(
      input({
        trends: { absolutePercent: -12.6, absoluteCi: [-16.4, -8.5], relativePercent: -7.7, relativeCi: [-11.7, -3.5] },
      }),
    );

    const caveat = report.caveats.find((item) => item.code === 'ABSOLUTE_VS_RELATIVE');

    expect(caveat?.params).toEqual({ absolute: -12.6, relative: -7.7 });
    expect(codes(report.caveats)).not.toContain('EDITION_TRAFFIC_DECLINING');
  });

  it('says the edition is shrinking when raw views fall but the share holds', () => {
    const report = assessConfidence(
      input({
        trends: { absolutePercent: -20.1, absoluteCi: [-24, -16], relativePercent: 0.4, relativeCi: [-2.1, 3.0] },
      }),
    );

    expect(codes(report.caveats)).toContain('EDITION_TRAFFIC_DECLINING');
    expect(codes(report.caveats)).not.toContain('ABSOLUTE_VS_RELATIVE');
  });

  it('says nothing about two trends when only raw counts exist', () => {
    const report = assessConfidence(
      input({
        normalized: false,
        trends: { absolutePercent: -20.1, absoluteCi: [-24, -16], relativePercent: null, relativeCi: null },
      }),
    );

    expect(codes(report.caveats)).not.toContain('ABSOLUTE_VS_RELATIVE');
    expect(codes(report.caveats)).not.toContain('EDITION_TRAFFIC_DECLINING');
    expect(codes(report.caveats)).toContain('RAW_COUNTS_NOT_COMPARABLE');
  });
});

describe('trend reversal', () => {
  it('reports both numbers and refuses to call the verdict high', () => {
    const report = assessConfidence(input({ reversal: { overallPercent: -7.7, recentPercent: 12.4, weeks: 52 } }));

    expect(report.score).toBeGreaterThan(0.7);
    expect(report.overall).toBe('medium');
    expect(report.caveats.find((item) => item.code === 'TREND_REVERSAL')?.params).toEqual({
      overall: -7.7,
      recent: 12.4,
      weeks: 52,
    });
  });

  it('leaves a clean series at high when there is no reversal', () => {
    expect(assessConfidence(input()).overall).toBe('high');
  });
});
