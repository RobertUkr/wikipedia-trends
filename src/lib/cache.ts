import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How long cached API responses stay valid: 24 hours. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** On-disk cache record; createdAt is an ISO timestamp checked against the TTL. */
export interface CacheEntry<T> {
  key: string;
  createdAt: string;
  value: T;
}

/** Repository root, resolved two levels up from this module (src/lib or dist/lib). */
export function packageRoot(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

/** Directory for cached API responses: WIKIPEDIA_TRENDS_CACHE_DIR or .cache/ in the repository. */
export function cacheDir(): string {
  const override = process.env['WIKIPEDIA_TRENDS_CACHE_DIR']?.trim();
  return override && override.length > 0 ? override : join(packageRoot(), '.cache');
}

/** Directory for series, artifacts and reports: WIKIPEDIA_TRENDS_OUTPUT_DIR or output/ in the repository. */
export function outputDir(): string {
  const override = process.env['WIKIPEDIA_TRENDS_OUTPUT_DIR']?.trim();
  return override && override.length > 0 ? override : join(packageRoot(), 'output');
}

export function cacheKey(parts: Record<string, string | number>): string {
  const canonical = Object.keys(parts)
    .sort()
    .map((name) => `${name}=${String(parts[name])}`)
    .join('&');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function entryPath(key: string): string {
  return join(cacheDir(), `${key}.json`);
}

/** Cached value for the key, or null when it is missing, corrupt or older than the TTL. */
export async function readCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(entryPath(key), 'utf8');
  } catch {
    return null;
  }

  let entry: CacheEntry<T>;
  try {
    entry = JSON.parse(raw) as CacheEntry<T>;
  } catch {
    // A corrupt entry is removed so the next write replaces it cleanly.
    await rm(entryPath(key), { force: true });
    return null;
  }

  const createdAt = Date.parse(entry.createdAt ?? '');
  // An entry with a missing or unparsable timestamp counts as expired.
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= ttlMs) {
    await rm(entryPath(key), { force: true });
    return null;
  }

  return entry.value;
}

/** Stores a value under the key, stamped with the current time. */
export async function writeCache<T>(key: string, value: T): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const entry: CacheEntry<T> = { key, createdAt: new Date().toISOString(), value };
  await writeFile(entryPath(key), JSON.stringify(entry), 'utf8');
}

/** Deletes the whole cache directory. */
export async function clearCache(): Promise<void> {
  await rm(cacheDir(), { recursive: true, force: true });
}
