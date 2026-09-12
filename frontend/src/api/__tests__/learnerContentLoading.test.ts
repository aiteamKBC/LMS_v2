import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchLearnerDetail, invalidateLearnerDetailCache } from '../learnerDetail';
import { hasComponentContent } from '@/utils/learnerJourney';

beforeEach(() => {
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const componentId = url.searchParams.get('component_id');
    return new Response(JSON.stringify(componentId ? { componentId, contentHtml: `<p>${componentId} reading</p>` }
      : { components: ['C1', 'C2'].map(componentId => ({ componentId, hasReadingContent: true })) }));
  }));
});
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('learner content loading', () => {
  it('shares the compact plan while keeping each opened reading in a separate cache', async () => {
    await Promise.all([fetchLearnerDetail('commercial', '125'), fetchLearnerDetail('commercial', '125')]);
    await fetchLearnerDetail('commercial', '125', { componentId: 'C1' });
    await fetchLearnerDetail('commercial', '125', { componentId: 'C2' });
    await fetchLearnerDetail('commercial', '125', { componentId: 'C1' });
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
      '/learner_api/learner-detail/commercial/125/?content=summary',
      '/learner_api/learner-detail/commercial/125/?content=reading&component_id=C1',
      '/learner_api/learner-detail/commercial/125/?content=reading&component_id=C2',
    ]);
  });

  it('invalidates the opened lesson as well as the plan after a save', async () => {
    await fetchLearnerDetail('commercial', '125', { componentId: 'C1' });
    invalidateLearnerDetailCache('commercial', '125');
    await fetchLearnerDetail('commercial', '125', { componentId: 'C1' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('adds only the requested HTML without changing the cached list or its siblings', async () => {
    const plan = await fetchLearnerDetail('commercial', '125');
    const opened = await fetchLearnerDetail('commercial', '125', { componentId: 'C1' });
    expect(opened.components[0].contentHtml).toBe('<p>C1 reading</p>');
    expect(opened.components[1].contentHtml).toBeUndefined();
    expect(plan.components[0].contentHtml).toBeUndefined();
    expect(await fetchLearnerDetail('commercial', '125')).toBe(plan);
  });

  it('opens a video from the shared plan without another detail request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ components: [{ componentId: 'V1', type: 'video', videoUrl: 'https://example.com/video' }] })));
    await fetchLearnerDetail('commercial', '125');
    const opened = await fetchLearnerDetail('commercial', '125', { componentId: 'V1' });
    expect(opened.components[0].videoUrl).toBe('https://example.com/video');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('loads embedded reading markup even when there is no visible text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ components: [
      { componentId: 'C1', type: 'reading', hasReadingContent: false, resourceUrl: 'https://example.com/reading.pdf' },
    ] }))).mockResolvedValueOnce(new Response(JSON.stringify({ componentId: 'C1', contentHtml: '<iframe src="https://example.com/lesson"></iframe>' })));
    const opened = await fetchLearnerDetail('commercial', '125', { componentId: 'C1' });
    expect(opened.components[0].contentHtml).toContain('<iframe');
  });

  it('keeps deferred readings openable and genuinely empty readings unavailable', () => {
    const reading = { title: 'Reading', componentId: 'C1', type: 'reading', expectedOtjh: 1 };
    expect(hasComponentContent({ ...reading, hasReadingContent: true })).toBe(true);
    expect(hasComponentContent({ ...reading, hasReadingContent: false })).toBe(false);
    expect(hasComponentContent({ ...reading, contentHtml: '<p>Existing full response</p>' })).toBe(true);
  });
});
