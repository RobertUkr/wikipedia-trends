/** Rounds to a fixed number of decimal places, the way every number in the output is rounded. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

/** Clamps a score into [0, 1]. */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
