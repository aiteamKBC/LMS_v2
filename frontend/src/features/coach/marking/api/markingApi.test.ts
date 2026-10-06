import { beforeEach, describe, expect, it, vi } from 'vitest';

const coachFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));
import { fetchMarkingDetail, fetchMarkingQueue, fetchMarkingSidebarQueue, markingEndpoint } from './markingApi';

describe('Marking API contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps official and personal queue ownership separate', () => {
    expect(markingEndpoint('official')).toBe('/coach_api/coach/marking-queue');
    expect(markingEndpoint('personal')).toBe('/coach_api/coach/personal-marking');
  });

  it('passes status, kind and bounded page request fields exactly once', async () => {
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ items: [], summary: {}, pagination: {} }), { status: 200 }));
    await fetchMarkingQueue({ scope: 'official', status: 'pending', kind: 'assignment', page: 2 });
    expect(coachFetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/marking-queue?status=pending&kind=assignment&page=2&page_size=25');
  });

  it('loads detail before the distinct sidebar queue without duplicating detail', async () => {
    coachFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ item: { id: 'submission-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], summary: {} }), { status: 200 }));
    await fetchMarkingDetail('official', 'submission-1');
    await fetchMarkingSidebarQueue('official');
    expect(coachFetch.mock.calls.map(call => call[0])).toEqual([
      '/coach_api/coach/marking-queue/submission-1',
      '/coach_api/coach/marking-queue?status=all&page=1&page_size=25',
    ]);
  });
});

