import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePersonalLearning, clearPersonalLearning, learningFetch, ownPersonalLearning, parsePersonalLearning,
  personalLearningId, personalLearningUrl, readPersonalLearning, rememberPersonalLearning, syncPersonalLearningAccount } from '../personalLearning';
import { getRememberedLearner, rememberSignedInLearner, useResolvedLearner } from '@/hooks/useMyLearner';
import { renderHook } from '@testing-library/react';

const id = 'pl.7.study.MOD-A';
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); syncPersonalLearningAccount(null); rememberSignedInLearner(undefined, undefined); });
afterEach(() => { vi.unstubAllGlobals(); clearPersonalLearning(); syncPersonalLearningAccount(null); rememberSignedInLearner(undefined, undefined); window.history.replaceState({}, '', '/'); });

describe('personal course identity and transport', () => {
  it('separates account, course and mode from official learner IDs', () => {
    expect(personalLearningId(7, 'MOD-A', 'study')).toBe(id);
    expect(parsePersonalLearning(id)).toEqual({ id, accountId: 7, moduleId: 'MOD-A', mode: 'study' });
    for (const invalid of ['7', 'pl.0.study.MOD-A', 'pl.7.admin.MOD-A', 'pl.7.study.../MOD-A']) expect(parsePersonalLearning(invalid)).toBeNull();
  });
  it('retains the exact builder return route and does not accept external return destinations', () => {
    rememberPersonalLearning(id, '/curriculum/module-builder?module=MOD-A');
    rememberPersonalLearning(id, 'https://example.invalid/');
    expect(readPersonalLearning()?.returnTo).toBe('/curriculum/module-builder?module=MOD-A');
    expect(activePersonalLearning('/learner/my-learning/commercial/13')).toBeNull();
    expect(activePersonalLearning('/curriculum/module-builder')).toBeNull();
  });
  it('restores only the owning administrator and clears the context on account changes', () => {
    rememberPersonalLearning(id);
    syncPersonalLearningAccount({ id: 7, role: 'admin' });
    expect(ownPersonalLearning('/learner/my-learning')?.id).toBe(id);
    syncPersonalLearningAccount({ id: 8, role: 'admin' });
    expect(readPersonalLearning()).toBeNull();
    rememberPersonalLearning(id);
    syncPersonalLearningAccount({ id: 7, role: 'learner' });
    expect(ownPersonalLearning(`/learner/my-learning/commercial/${id}`)).toBeNull();
  });
  it('lets an admin with a separate official learner profile study personally without replacing that profile', () => {
    rememberSignedInLearner('learner', 42, 'apprenticeship');
    syncPersonalLearningAccount({ id: 7, role: 'admin' });
    rememberPersonalLearning(id);
    window.history.replaceState({}, '', `/learner/my-learning/commercial/${id}`);
    expect(getRememberedLearner()).toEqual({ kind: 'commercial', id });
    expect(renderHook(() => useResolvedLearner('commercial', id)).result.current.id).toBe(id);
    window.history.replaceState({}, '', '/learner/my-learning/apprenticeship/42');
    expect(getRememberedLearner()?.id).toBe('42');
  });
  it.each([
    [`/learner_api/learner-detail/commercial/${id}/`, undefined],
    [`/learner_api/time-tracking/start/?kind=commercial&learnerId=${id}`, { method: 'POST', body: '{}' }],
    ['/learner_api/reflection/submissions/', { method: 'POST', body: JSON.stringify({ learnerId: id }) }],
    [`/learner_api/evidence/commercial/${id}/upload/`, { method: 'POST', body: new FormData() }],
  ])('redirects only explicitly scoped personal requests: %s', async (url, init) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await learningFetch(url as string, init as globalThis.RequestInit | undefined);
    const [target, options] = fetch.mock.calls[0];
    expect(target).toContain(`/personal-learning/${id}/request/?path=`);
    expect(options.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(options.body).toBe(init?.body);
  });
  it('leaves ordinary learners, curriculum calls and external URLs unchanged', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    for (const url of ['/learner_api/learner-detail/apprenticeship/42/', '/curriculum_api/curriculum/modules/', `https://example.invalid/learner_api/${id}/`]) {
      const options = { credentials: 'same-origin' as const };
      expect(personalLearningUrl(url)).toBe(url);
      await learningFetch(url, options);
      expect(fetch).toHaveBeenLastCalledWith(url, options);
    }
  });
});
