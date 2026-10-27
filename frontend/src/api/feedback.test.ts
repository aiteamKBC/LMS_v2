import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackFormInput } from './feedback';

afterEach(() => vi.unstubAllGlobals());

describe('feedback API write protection', () => {
  it('gets a CSRF token and sends it with form saves', async () => {
    const input: FeedbackFormInput = {
      title: 'Learner feedback', formType: 'post_lecture', deliveryScope: 'module', programmeId: 'PROG-1',
      cohortId: 'COHORT-1', groupId: 'GROUP-1', moduleCatalogueId: 'MOD-1',
      description: '', instructions: '', startDate: null, dueDate: null,
      anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
      sections: [{ title: 'Learning', description: '', questions: [] }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'verified-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ form: { id: 1 } }) });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.createForm(input);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/engagement_api/feedback/csrf/', { credentials: 'include' });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      'X-CSRFToken': 'verified-token',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });

  it('loads the named recipients for a form with source, search, and pagination filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipients: [], total: 0, page: 2, pageSize: 25 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.recipients(19, 'Martech learner', 2, 25, 'lecture:31');

    expect(fetchMock).toHaveBeenCalledWith(
      '/engagement_api/feedback/forms/19/recipients/?search=Martech+learner&page=2&pageSize=25&source=lecture%3A31',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('loads the complete version history for a form', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ versions: [{ id: 20, version: 2 }, { id: 19, version: 1 }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.versions(20);

    expect(fetchMock).toHaveBeenCalledWith(
      '/engagement_api/feedback/forms/20/versions/',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('filters analytics by feedback type or a specific form', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ analytics: {} }) });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.analytics({ formType: 'post_lecture' });
    await feedbackApi.analytics({ formId: 20 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/engagement_api/feedback/analytics/?formType=post_lecture', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/analytics/?formId=20', expect.objectContaining({ credentials: 'include' }));
  });

  it('scopes staff learner-feedback preview reads to the selected learner', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ forms: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await feedbackApi.myForms('125');
    await feedbackApi.myDelivery(21, '125');
    await feedbackApi.myReviewDelivery(71, '125');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/engagement_api/feedback/my-forms/?learnerId=125', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/engagement_api/feedback/my-deliveries/21/?learnerId=125', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/engagement_api/feedback/my-review-deliveries/71/?learnerId=125', expect.objectContaining({ credentials: 'include' }));
  });

  it('loads lecture question results through a separate read-only reporting endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ analytics: { questionMetrics: [] } }) });
    vi.stubGlobal('fetch', fetchMock);
    await feedbackApi.questionAnalytics({ formId: 20, formType: 'post_lecture', moduleId: 'MOD A', deliveryId: 31 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/engagement_api/feedback/analytics/questions/?formId=20&formType=post_lecture&moduleId=MOD+A&deliveryId=31', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });

  it('combines submission dates with form and lecture scope on the read-only reporting request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ analytics: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    await feedbackApi.questionAnalytics({ formId: 20, deliveryId: 31, submittedFrom: '2026-10-01', submittedTo: '2026-10-25' });
    expect(fetchMock).toHaveBeenCalledWith('/engagement_api/feedback/analytics/questions/?formId=20&deliveryId=31&submittedFrom=2026-10-01&submittedTo=2026-10-25', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the independent insights request read-only and encodes all selected scope filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ analytics: {} }) });
    vi.stubGlobal('fetch', fetchMock);
    await feedbackApi.insightsDashboard({ formType: 'post_lecture', groupId: 'Group & One', moduleId: 'Module / One', classification: 'negative', submittedFrom: '2026-09-01', submittedTo: '2026-10-26' });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/engagement_api/feedback/analytics/insights/?formType=post_lecture&groupId=Group+%26+One&moduleId=Module+%2F+One&classification=negative&submittedFrom=2026-09-01&submittedTo=2026-10-26', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
});
