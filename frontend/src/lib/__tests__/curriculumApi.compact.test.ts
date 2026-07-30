import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveCurriculumModule,
  clearCurriculumGetCache,
  createCurriculumModule,
  fetchCurriculumModules,
  updateCurriculumModule,
} from '@/lib/curriculumApi';

/**
 * Covers the `?compact=true` opt-in on the modules list and the invariants that
 * make the shared-request layer safe to use alongside it:
 *   - compact is opt-in, so existing full-payload consumers are untouched;
 *   - compact and full responses are distinct cache/dedupe identities, so a
 *     list-only caller can never hand a weekStructure-less payload to a consumer
 *     that needs the full structure;
 *   - mutations are never coalesced, whatever the path.
 */

const collection = (results: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ results }),
});

const urlsFrom = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(call => String(call[0]));

describe('fetchCurriculumModules compact option', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('omits the flag by default so existing consumers keep the full payload', async () => {
    fetchMock.mockResolvedValue(collection([]));
    await fetchCurriculumModules();
    expect(urlsFrom(fetchMock)[0]).not.toContain('compact');
  });

  it('requests the slim payload when compact is set', async () => {
    fetchMock.mockResolvedValue(collection([]));
    await fetchCurriculumModules(undefined, { compact: true });
    expect(urlsFrom(fetchMock)[0]).toContain('compact=true');
  });

  it('does not share one in-flight request between compact and full callers', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    fetchMock.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));

    const full = fetchCurriculumModules();
    const compact = fetchCurriculumModules(undefined, { compact: true });

    // Two distinct paths must mean two requests: a compact response has no
    // weekStructure, and handing it to the full-payload caller would silently
    // change module dedup scoring and week hydration.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolvers[0](collection([{ id: 'm1', weekStructure: [{ id: 'w1' }] }]));
    resolvers[1](collection([{ id: 'm1' }]));

    const [fullResult, compactResult] = await Promise.all([full, compact]);
    expect(fullResult).not.toBe(compactResult);
    expect(fullResult[0]).toHaveProperty('weekStructure');
    expect(compactResult[0]).not.toHaveProperty('weekStructure');
  });

  it('still shares one request between concurrent compact callers', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; }));

    const a = fetchCurriculumModules(undefined, { compact: true });
    const b = fetchCurriculumModules(undefined, { compact: true });
    resolveFetch(collection([{ id: 'm1' }]));

    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rb).toBe(ra);
  });
});

describe('mutations are never deduplicated', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('issues every concurrent POST/PATCH/DELETE separately', async () => {
    await Promise.all([
      createCurriculumModule({ name: 'A' }),
      createCurriculumModule({ name: 'A' }),
      updateCurriculumModule('MOD-1', { name: 'B' }),
      updateCurriculumModule('MOD-1', { name: 'B' }),
      archiveCurriculumModule('MOD-1'),
      archiveCurriculumModule('MOD-1'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const methods = fetchMock.mock.calls.map(call => (call[1] as { method?: string }).method);
    expect(methods.filter(m => m === 'POST')).toHaveLength(2);
    expect(methods.filter(m => m === 'PATCH')).toHaveLength(2);
    expect(methods.filter(m => m === 'DELETE')).toHaveLength(2);
  });

  it('does not let a GET share an in-flight mutation on the same path', async () => {
    await Promise.all([createCurriculumModule({ name: 'A' }), fetchCurriculumModules()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
