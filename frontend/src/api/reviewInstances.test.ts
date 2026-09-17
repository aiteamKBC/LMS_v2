import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// coachFetch caches its CSRF token in a module-level variable (see
// src/lib/coachFetch.ts) -- reset modules between tests (matching
// coachFetch.test.ts's own convention) and re-import so each POST test gets
// its own fresh CSRF fetch rather than reusing another test's cached token.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLearnerAdditionReviewTemplates', () => {
  it('requests enabled Review templates for one learner only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      learnerId: 669, programmeId: 'PROG-MM-L6',
      templates: [{ id: 'REV-1', name: 'Monthly Learner Catch-up', reviewTypeId: 'RT-1', reviewTypeCode: 'mcm', reviewTypeName: 'Monthly Coaching Meeting' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLearnerAdditionReviewTemplates } = await import('./reviewInstances');

    const body = await fetchLearnerAdditionReviewTemplates(669);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/coach_api/coach/reviews/learner-additions/templates?learnerId=669');
    expect(body.templates).toHaveLength(1);
    expect(body.programmeId).toBe('PROG-MM-L6');
  });

  it('surfaces the backend error message when the learner is not in caseload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Learner not found in your caseload.' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchLearnerAdditionReviewTemplates } = await import('./reviewInstances');

    await expect(fetchLearnerAdditionReviewTemplates(999)).rejects.toThrow('Learner not found in your caseload.');
  });
});

describe('createLearnerReviewAddition', () => {
  it('posts learnerId, reviewTemplateId, targetDate and reason through the CSRF-protected path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({
        additionId: 'LRA-1', eventKey: 'review:669:REV-1:manual:LRA-1', reviewInstanceId: 'REVI-1',
        reviewTemplateId: 'REV-1', reviewName: 'Monthly Learner Catch-up', reviewTypeCode: 'mcm',
        occurrenceRef: 'manual:LRA-1', targetDate: '2026-10-30', status: 'not-scheduled',
      }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { createLearnerReviewAddition } = await import('./reviewInstances');

    const result = await createLearnerReviewAddition({
      learnerId: 669, reviewTemplateId: 'REV-1', targetDate: '2026-10-30',
      reasonCode: 'additional-coaching', reason: 'Flagged by employer.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/coach_api/coach/reviews/learner-additions');
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      learnerId: 669, reviewTemplateId: 'REV-1', targetDate: '2026-10-30',
      reasonCode: 'additional-coaching', reason: 'Flagged by employer.',
    });
    expect(result.eventKey).toBe('review:669:REV-1:manual:LRA-1');
    expect(result.eventKey).not.toContain('2026-10-30'); // date-independent, per spec
    expect(result.status).toBe('not-scheduled');
  });

  it('defaults reasonCode/reason to empty strings when omitted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({
        additionId: 'LRA-2', eventKey: 'review:669:REV-1:manual:LRA-2', reviewInstanceId: 'REVI-2',
        reviewTemplateId: 'REV-1', reviewName: 'Monthly Learner Catch-up', reviewTypeCode: 'mcm',
        occurrenceRef: 'manual:LRA-2', targetDate: '2026-11-30', status: 'not-scheduled',
      }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { createLearnerReviewAddition } = await import('./reviewInstances');

    await createLearnerReviewAddition({ learnerId: 669, reviewTemplateId: 'REV-1', targetDate: '2026-11-30' });

    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      learnerId: 669, reviewTemplateId: 'REV-1', targetDate: '2026-11-30', reasonCode: '', reason: '',
    });
  });

  it('surfaces a clear error for a wrong-programme or disabled template', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({ detail: 'That Review template is not enabled for this learner’s programme.' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const { createLearnerReviewAddition } = await import('./reviewInstances');

    await expect(createLearnerReviewAddition({
      learnerId: 669, reviewTemplateId: 'REV-WRONG', targetDate: '2026-10-30',
    })).rejects.toThrow(/not enabled for this learner/);
  });
});
