import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployerLearnerSummary, fetchEmployerReviewInstance, signReviewAsEmployer } from '../employerPortal';

afterEach(() => vi.unstubAllGlobals());

describe('Employer Portal read transport', () => {
  it('reads summary through LMS with the session cookie and preserves nulls', async () => {
    const payload = { attendance: { ratePercent: null }, otj: { actualHours: null } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchEmployerLearnerSummary('7', 'commercial', '125')).toEqual(payload);
    expect(fetch).toHaveBeenCalledWith('/learner_api/employer-portal/7/learner/commercial/125/summary/', expect.objectContaining({ credentials: 'include' }));
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
  it('propagates a backend ownership denial without a fallback or retry write', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Learner not owned' }), { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchEmployerLearnerSummary('7', 'apprenticeship', '999')).rejects.toThrow('Learner not owned');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads a review with an encoded event key without any signature mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ instance: { id: '45' } })));
    vi.stubGlobal('fetch', fetch);
    await fetchEmployerReviewInstance('7', 'commercial', '125', 'review:45');
    expect(fetch).toHaveBeenCalledWith('/learner_api/employer-portal/7/learner/commercial/125/events/review%3A45/review/', expect.objectContaining({ credentials: 'include' }));
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });
  it('posts an employer signature only to the employer-scoped review endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    await signReviewAsEmployer('7', 'commercial', '125', 'review:45', {
      name: 'Test Employer', signature: 'data:image/png;base64,c2ln',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/learner_api/employer-portal/7/learner/commercial/125/events/review%3A45/review/',
      expect.objectContaining({ credentials: 'include', method: 'POST', body: JSON.stringify({ name: 'Test Employer', signature: 'data:image/png;base64,c2ln' }) }),
    );
  });
});
