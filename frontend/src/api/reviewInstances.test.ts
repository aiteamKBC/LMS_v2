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

describe('migrated summary transcript upload', () => {
  it('uses the migrated multipart route and CSRF without a Native endpoint or JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({ artifacts: [], answerVersion: 'v2', reviewAnswers: { recap: 'Generated' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { uploadMigratedSummaryTranscript } = await import('./reviewInstances');
    const transcript = new File(['Coach: Transcript'], 'external.txt', { type: 'text/plain' });
    await uploadMigratedSummaryTranscript('imported-review:42', transcript);
    expect(fetchMock.mock.calls[1][0]).toBe('/coach_api/migrated-reviews/imported-review%3A42/summary/from-upload');
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(request.method).toBe('POST');
    expect((request.body as FormData).get('transcript')).toBe(transcript);
    expect(new Headers(request.headers).get('X-CSRFToken')).toBe('server-token');
    expect(new Headers(request.headers).has('Content-Type')).toBe(false);
  });
});

describe('migrated progress calculation', () => {
  it('sends only the overlay version to the migrated route with CSRF', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({ progressSnapshot: { schemaVersion: 4 } }));
    vi.stubGlobal('fetch', fetchMock);
    const { calculateMigratedReviewProgress } = await import('./reviewInstances');
    const result = await calculateMigratedReviewProgress('imported-review:42', 'v1');
    expect(fetchMock.mock.calls[1][0]).toBe('/coach_api/migrated-reviews/imported-review%3A42/progress');
    const request = fetchMock.mock.calls[1][1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({ progressVersion: 'v1' });
    expect(new Headers(request.headers).get('X-CSRFToken')).toBe('server-token');
    expect(result.progressSnapshot?.schemaVersion).toBe(4);
  });

  it('surfaces a stale-version refusal without retrying the write', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({ detail: 'Review changed. Reopen it.', code: 'progress_conflict' }, 409));
    vi.stubGlobal('fetch', fetchMock);
    const { calculateMigratedReviewProgress } = await import('./reviewInstances');
    await expect(calculateMigratedReviewProgress('imported-review:42', 'old')).rejects.toThrow('Review changed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
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

describe('generateReviewMeetingSummary', () => {
  it('surfaces the backend diagnostic code and reference when generation fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'server-token' }))
      .mockResolvedValueOnce(jsonResponse({
        detail: 'The transcript was accepted, but the AI Meeting Summary could not be generated.',
        code: 'meeting_summary_ai_failed',
        request_id: 'request-123',
      }, 502));
    vi.stubGlobal('fetch', fetchMock);
    const { generateReviewMeetingSummary } = await import('./reviewInstances');

    await expect(generateReviewMeetingSummary('REVI-1')).rejects.toThrow(
      /meeting_summary_ai_failed.*request-123/,
    );
  });
});
