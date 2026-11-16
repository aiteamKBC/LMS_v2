import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'csrftoken=; Max-Age=0'; });

describe('Free Course programme conversion dates', () => {
  it('sends both module dates unchanged to the canonical conversion endpoint', async () => {
    vi.resetModules();
    document.cookie = 'csrftoken=synthetic-csrf-token';
    const result = { mode: 'clone', programmeId: 'P1', programmeName: 'Programme', cohortId: 'C1', groupId: 'G1', moduleCatalogueId: 'MOD-NEW' };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const { injectFreeCourseIntoGroup } = await import('../curriculumApi');
    const input = { courseId: 'FREE-1', mode: 'clone' as const, groupId: 'G1', startDate: '2026-10-01', endDate: '2026-12-15' };
    expect(await injectFreeCourseIntoGroup('FREE-COURSES', input)).toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/curriculum/free-programmes/FREE-COURSES/convert/');
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toEqual(input);
    expect(new Headers(request.headers).get('X-CSRFToken')).toBe('synthetic-csrf-token');
  });
});
