import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchLearningPlan, saveLearningPlan } from '../learningPlan';
import { fetchFirstLoginDetails, submitFirstLoginDetails, type FirstLoginDetailsValues } from '../firstLoginDetails';
import { apiLogin, apiMe } from '../auth';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => clearAllCachedResources());
afterEach(() => { clearAllCachedResources(); vi.unstubAllGlobals(); });

describe('F01/F02 concurrent reads', () => {
  it.each([
    ['plan', fetchLearningPlan], ['first login', fetchFirstLoginDetails],
  ] as const)('shares simultaneous %s reads, but reads again after settlement', async (_name, read) => {
    const fetch = vi.fn().mockImplementation(async () => response({ plan: [] }));
    vi.stubGlobal('fetch', fetch);
    await Promise.all([read('91'), read('91')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await read('91');
    expect(fetch).toHaveBeenCalledTimes(2);
    await Promise.all([read('91'), read('92')]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not reuse a pending plan read after a save', async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
      .mockResolvedValueOnce(response({ plan: [] })).mockResolvedValueOnce(response({ plan: ['new'] }));
    vi.stubGlobal('fetch', fetch);
    const old = fetchLearningPlan('91');
    await saveLearningPlan('91', []);
    expect(await fetchLearningPlan('91')).toEqual({ plan: ['new'] });
    resolve(response({ plan: ['old'] }));
    await old;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ modules: [] });
  });

  it('retains explicit empty free courses in the write payload', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ plan: [] }));
    vi.stubGlobal('fetch', fetch);
    await saveLearningPlan('91', ['B', 'A'], []);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ modules: [{ moduleId: 'B' }, { moduleId: 'A' }], freeCourses: [] });
  });

  it('rejects an explicit backend failure even when its HTTP status is successful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'Unable to save plan' })));
    await expect(saveLearningPlan('91', [])).rejects.toThrow('Unable to save plan');
  });

  it('keeps First Login credentials, CSRF and field errors', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ error: 'Invalid details', fields: { phone: 'Invalid phone' }, code: 'validation' }, 400));
    vi.stubGlobal('fetch', fetch);
    await expect(submitFirstLoginDetails('91', {} as FirstLoginDetailsValues, 'synthetic-signature', 'synthetic-csrf'))
      .rejects.toMatchObject({ message: 'Invalid details', fields: { phone: 'Invalid phone' }, code: 'validation' });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': 'synthetic-csrf' } });
  });

  it('does not reuse a pre-login session read after a successful login', async () => {
    let resolve!: (value: Response) => void;
    const user = { id: 1, role: 'learner', subjectId: 91 };
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
      .mockResolvedValueOnce(response({ user })).mockResolvedValueOnce(response({ user }));
    vi.stubGlobal('fetch', fetch);
    const old = apiMe();
    await apiLogin('synthetic@example.test', 'synthetic-password');
    expect(await apiMe()).toEqual(user);
    resolve(response({ error: 'Expired' }, 401));
    expect(await old).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
