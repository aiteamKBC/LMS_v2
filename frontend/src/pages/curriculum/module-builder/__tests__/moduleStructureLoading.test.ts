import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCurriculumGetCache } from '@/lib/curriculumApi';
import { createLocalModuleDraft, loadModuleStructure } from '../moduleAuthoringData';

describe('loading a full module structure over a slow connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCurriculumGetCache();
  });

  afterEach(() => {
    clearCurriculumGetCache();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function delayedFetch(delay: number) {
    const module = createLocalModuleDraft({
      programme: 'Test programme', title: 'Large module', description: '',
      weeks: 1, status: 'draft', catalogueId: 'MOD-SLOW',
    });
    module.structureRevision = 'revision-from-server';
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(module), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })), delay);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('finishes a cold read longer than 60 seconds with its revision intact', async () => {
    const fetchMock = delayedFetch(75_000);
    const result = loadModuleStructure('MOD-SLOW', { skipCache: true });
    const assertion = expect(result).resolves.toMatchObject({
      title: 'Large module', structureRevision: 'revision-from-server',
    });
    await vi.advanceTimersByTimeAsync(75_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still aborts an unresponsive request and exposes the timeout', async () => {
    const fetchMock = delayedFetch(120_000);
    const result = loadModuleStructure('MOD-SLOW', { skipCache: true });
    const assertion = expect(result).rejects.toThrow('Curriculum API timed out');
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
