import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const destination = { programmeId: 'P1', cohortId: 'C1', groupId: 'G1', tutor: 'T1' };
const result = { ...destination, converted: true, moduleCatalogueId: 'FREE/1',
  programmeName: 'Programme', cohortName: 'Cohort', groupName: 'Group' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('free course conversion transport', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the session CSRF token, credentials and selected destination', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ csrfToken: 'session-token' }))
      .mockResolvedValueOnce(json(result));
    vi.stubGlobal('fetch', fetchMock);
    const { convertFreeCourseToModule } = await import('../curriculumApi');

    await expect(convertFreeCourseToModule('FREE/1', destination)).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/curriculum/modules/FREE%2F1/convert-free-course/');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('session-token');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual(destination);
    expect(init).not.toHaveProperty('csrf');
  });

  it('does not submit a conversion when request verification fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}, 403));
    vi.stubGlobal('fetch', fetchMock);
    const { convertFreeCourseToModule } = await import('../curriculumApi');
    await expect(convertFreeCourseToModule('FREE/1', destination))
      .rejects.toThrow('Unable to initialise request verification.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/csrf');
  });

  it.each([401, 403, 409, 500])('preserves a %s refusal without automatically retrying the conversion', async status => {
    const data = { error: 'The course could not be moved.' };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ csrfToken: 'session-token' }))
      .mockResolvedValueOnce(json(data, status));
    vi.stubGlobal('fetch', fetchMock);
    const { convertFreeCourseToModule } = await import('../curriculumApi');
    await expect(convertFreeCourseToModule('FREE/1', destination)).rejects.toMatchObject({ status, data });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates the catalogue after conversion so the course is reclassified', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ results: [{ id: 'FREE/1', isFreeCourse: true }] }))
      .mockResolvedValueOnce(json({ csrfToken: 'session-token' }))
      .mockResolvedValueOnce(json(result))
      .mockResolvedValueOnce(json({ results: [{ id: 'FREE/1', isFreeCourse: false }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchCurriculumModules, convertFreeCourseToModule } = await import('../curriculumApi');
    expect(await fetchCurriculumModules()).toEqual([{ id: 'FREE/1', isFreeCourse: true }]);
    await convertFreeCourseToModule('FREE/1', destination);
    expect(await fetchCurriculumModules()).toEqual([{ id: 'FREE/1', isFreeCourse: false }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps ordinary module edits on their existing transport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ updated: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { updateCurriculumModule } = await import('../curriculumApi');
    await updateCurriculumModule('MOD-1', { name: 'Updated title' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/curriculum/modules/MOD-1/');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });
});
