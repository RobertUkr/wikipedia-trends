import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheEntry<T> {
  key: string;
  createdAt: string;
  value: T;
}

export function packageRoot(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

export function cacheDir(): string {
  const override = process.env['WIKIPEDIA_TRENDS_CACHE_DIR']?.trim();
  return override && override.length > 0 ? override : join(packageRoot(), '.cache');
}

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
    await rm(entryPath(key), { force: true });
    return null;
  }

  const createdAt = Date.parse(entry.createdAt ?? '');
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= ttlMs) {
    await rm(entryPath(key), { force: true });
    return null;
  }

  return entry.value;
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const entry: CacheEntry<T> = { key, createdAt: new Date().toISOString(), value };
  await writeFile(entryPath(key), JSON.stringify(entry), 'utf8');
}

export async function clearCache(): Promise<void> {
  await rm(cacheDir(), { recursive: true, force: true });
}
