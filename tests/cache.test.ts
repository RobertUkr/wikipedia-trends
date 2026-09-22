import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheDir, cacheKey, readCache, writeCache } from '../src/lib/cache.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wt-cache-'));
  process.env['WIKIPEDIA_TRENDS_CACHE_DIR'] = dir;
});

afterEach(async () => {
  delete process.env['WIKIPEDIA_TRENDS_CACHE_DIR'];
  await rm(dir, { recursive: true, force: true });
});

describe('cacheKey', () => {
  it('is stable regardless of property order', () => {
    const a = cacheKey({ project: 'pl.wikipedia.org', title: 'Post', start: '2024-01-01', end: '2024-02-01' });
    const b = cacheKey({ end: '2024-02-01', start: '2024-01-01', title: 'Post', project: 'pl.wikipedia.org' });
    expect(a).toBe(b);
  });

  it('changes when any part changes', () => {
    const base = { project: 'pl.wikipedia.org', title: 'Post', start: '2024-01-01', end: '2024-02-01', access: 'all-access', agent: 'user' };
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, agent: 'all-agents' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, title: 'Post_2' }));
  });
});

describe('file cache', () => {
  it('round-trips a value', async () => {
    const key = cacheKey({ a: '1' });
    await writeCache(key, { points: [{ date: '2024-01-01', views: 10 }] });
    await expect(readCache(key)).resolves.toEqual({ points: [{ date: '2024-01-01', views: 10 }] });
  });

  it('returns null for a missing key', async () => {
    await expect(readCache('deadbeef')).resolves.toBeNull();
  });

  it('honours the TTL', async () => {
    const key = cacheKey({ a: '2' });
    await writeCache(key, { value: 1 });
    await expect(readCache(key, 0)).resolves.toBeNull();
    await expect(readCache(key)).resolves.toBeNull();
  });

  it('drops corrupted entries', async () => {
    const key = cacheKey({ a: '3' });
    await writeFile(join(cacheDir(), `${key}.json`), 'not json', 'utf8');
    await expect(readCache(key)).resolves.toBeNull();
  });
});
