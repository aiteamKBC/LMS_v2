import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLearnerDetail, invalidateLearnerDetailCache } from '../learnerDetail';
import { saveFreeCourseAssignments, saveLearningPlan, saveModuleLearners } from '../learningPlan';
import { fetchLearnerCalendarEvents } from '../learnerCalendar';
import { updateEnrolmentUser } from '../enrolmentUsers';
import { fetchLearnerFreeCourses, invalidateLearnerFreeCourses } from '../freeCourses';

const response = (value: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => value, text: async () => JSON.stringify(value) }) as Response;
const oldDetail = { id: '101', modules: ['Existing'] };
const newDetail = { id: '101', modules: ['Existing', 'New'] };

describe('module assignment propagation', () => {
  beforeEach(() => { invalidateLearnerDetailCache(); invalidateLearnerFreeCourses(); });
  afterEach(() => { vi.unstubAllGlobals(); invalidateLearnerDetailCache(); invalidateLearnerFreeCourses(); });

  it.each(['plan', 'roster'])('refreshes both learner kinds after a successful %s save', async (surface) => {
    const fetch = vi.fn().mockResolvedValueOnce(response(oldDetail)).mockResolvedValueOnce(response(oldDetail))
      .mockResolvedValueOnce(response({})).mockResolvedValue(response(newDetail));
    vi.stubGlobal('fetch', fetch);
    await fetchLearnerDetail('commercial', '101');
    await fetchLearnerDetail('apprenticeship', '102');
    if (surface === 'plan') await saveLearningPlan('101', ['MOD-NEW']);
    else await saveModuleLearners('MOD-NEW', ['101']);
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(newDetail);
    expect(await fetchLearnerDetail('apprenticeship', '102')).toEqual(newDetail);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('keeps cached data when the assignment save fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(oldDetail)).mockResolvedValueOnce(response({ error: 'Save failed' }, false));
    vi.stubGlobal('fetch', fetch);
    await fetchLearnerDetail('commercial', '101');
    await expect(saveLearningPlan('101', ['MOD-NEW'])).rejects.toThrow('Save failed');
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(oldDetail);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse or recache a stale request that was pending during assignment', async () => {
    let finishOld!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(response(newDetail));
    vi.stubGlobal('fetch', fetch);
    const pending = fetchLearnerDetail('commercial', '101');
    await saveModuleLearners('MOD-NEW', ['101']);
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(newDetail);
    finishOld(response(oldDetail));
    await pending;
    expect(await fetchLearnerDetail('commercial', '101')).toEqual(newDetail);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['plan', 'roster', 'placement'])('expires calendar snapshots after a successful %s change', async surface => {
    const before = { events: [{ programme: 'Old programme', status: 'not-scheduled' }] };
    const after = { events: [{ programme: 'Assigned programme', status: 'scheduled' }] };
    const fetch = vi.fn().mockResolvedValueOnce(response(before)).mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response(after));
    vi.stubGlobal('fetch', fetch);
    await fetchLearnerCalendarEvents('commercial', '101');
    if (surface === 'plan') await saveLearningPlan('101', ['MOD-NEW']);
    else if (surface === 'roster') await saveModuleLearners('MOD-NEW', ['101']);
    else await updateEnrolmentUser('101', { programme: 'Assigned programme' });
    expect(await fetchLearnerCalendarEvents('commercial', '101')).toEqual(after);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('writes ordered Free Course ids with CSRF and the expected concurrency version', async () => {
    document.cookie = 'csrftoken=verified-token; path=/';
    const payload = {
      freeCourses: [
        { freeCourseId: 'B', courseName: 'Beta', addedAt: '' },
        { freeCourseId: 'A', courseName: 'Alpha', addedAt: '' },
      ],
      freeCourseAssignmentVersion: 'v2',
    };
    const fetch = vi.fn().mockResolvedValue(response(payload));
    vi.stubGlobal('fetch', fetch);

    await expect(saveFreeCourseAssignments('101', ['B', 'A'], 'v1')).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledWith('/learner_api/learning-plan/101/free-courses/', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      headers: expect.objectContaining({
        'X-CSRFToken': 'verified-token',
        'X-Requested-With': 'XMLHttpRequest',
      }),
      body: JSON.stringify({ courseIds: ['B', 'A'], expectedVersion: 'v1' }),
    }));
  });

  it('invalidates My Learning cards after a canonical assignment change', async () => {
    document.cookie = 'csrftoken=verified-token; path=/';
    const before = [{ freeCourseId: 'A', courseName: 'Alpha' }];
    const after = [{ freeCourseId: 'B', courseName: 'Beta' }];
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ freeCourses: before }))
      .mockResolvedValueOnce(response({ freeCourses: after, freeCourseAssignmentVersion: 'v2' }))
      .mockResolvedValueOnce(response({ freeCourses: after }));
    vi.stubGlobal('fetch', fetch);

    expect(await fetchLearnerFreeCourses('commercial', '101')).toEqual(before);
    await saveFreeCourseAssignments('101', ['B'], 'v1');
    expect(await fetchLearnerFreeCourses('commercial', '101')).toEqual(after);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
