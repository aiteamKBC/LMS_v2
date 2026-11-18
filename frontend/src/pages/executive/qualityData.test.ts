import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityFormCard, QualitySummary, QualityTemplate, QualityTemplateState } from '@/api/coachingQualityReviews';
import type { FeedbackForm, FeedbackResponse } from '@/api/feedback';
import { loadLiveQmsData } from './qualityData';

const mocks = vi.hoisted(() => ({
  forms: vi.fn(), reviews: vi.fn(), definition: vi.fn(),
  feedbackForms: vi.fn(), feedbackResponses: vi.fn(), getForm: vi.fn(), insights: vi.fn(),
}));
vi.mock('@/api/coachingQualityReviews', () => ({
  qualityForms: mocks.forms, qualityReviews: mocks.reviews, qualityDefinition: mocks.definition,
}));
vi.mock('@/api/feedback', () => ({
  feedbackApi: { listForms: mocks.feedbackForms, responses: mocks.feedbackResponses, getForm: mocks.getForm, insightsDashboard: mocks.insights },
}));

const card: QualityFormCard = { reviewType: 'MCM', title: 'Synthetic MCM', group: 'Coaching', published: true, revision: 1, legacy: false };
const definition: QualityTemplate = {
  id: 'synthetic', title: card.title, version: 1,
  ratings: { gold: 'Gold', green: 'Green', amber: 'Amber', red: 'Red', na: 'Not applicable' },
  sections: [{ id: 'section', title: 'Observation', screenshots: false, criteria: [{ id: 'criterion', text: 'Observed evidence', type: 'rating' }] }],
};
const state: QualityTemplateState = { id: 'synthetic', reviewType: 'MCM', revision: 1, draft: definition, published: definition, publishedAt: null, updatedAt: null };
const summary: QualitySummary = {
  id: 'review-1', coachEmail: 'coach@example.invalid', coachName: 'Synthetic Coach',
  learnerId: 'synthetic-learner', learnerName: 'Synthetic Learner', reviewerName: 'Synthetic Reviewer',
  startsAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
  title: 'Synthetic MCM', status: 'completed', version: 1, actionCount: 2, reviewType: 'MCM', formTitle: card.title,
  ratingCounts: { gold: 1, green: 1, amber: 0, red: 0, na: 1 },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.forms.mockResolvedValue({ forms: [card] });
  mocks.reviews.mockResolvedValue({ reviews: [summary], coaches: [], nextOffset: null });
  mocks.definition.mockResolvedValue({ template: state });
  mocks.feedbackForms.mockResolvedValue({ forms: [] });
  mocks.feedbackResponses.mockResolvedValue({ responses: [] });
  mocks.insights.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe('executive overview live data', () => {
  it('uses stored criteria counts without inventing an approved review-level RAG or action detail', async () => {
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.records).toHaveLength(1);
    expect(data.records[0]).toMatchObject({ id: summary.id, formId: 'MCM', ratingCounts: summary.ratingCounts, rag: 'unrated', policyVersion: null });
    expect(data.forms[0]).toMatchObject({ id: 'MCM', submissions: 1, questionCount: 1, ragSupported: false });
    expect(data.actions).toEqual([]);
    expect(data.availability).toEqual({ actions: false, criticalIssues: false, concerns: false, feedback: true, feedbackScores: false });
    expect(data.notice).toContain('No blended review-level RAG is inferred');
  });

  it('uses bundled form definitions without making one request per form', async () => {
    mocks.forms.mockResolvedValue({ forms: [card], templates: { MCM: state } });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(mocks.definition).not.toHaveBeenCalled();
    expect(data.forms[0]).toMatchObject({ questionCount: 1, answerTypes: ['Criteria rating'] });
  });

  it('keeps MCM and progress review forms but omits forms marked (T)', async () => {
    const visible = [
      { ...card, reviewType: 'FORM_PROGRESS_REVIEW', title: '1-1 Progress Review Feedback Form' },
      { ...card, reviewType: 'FORM_MONTHLY_COACHING', title: 'Monthly Coaching Meeting Feedback Form' },
    ];
    const hidden = { ...card, reviewType: 'FORM_WELLBEING', title: 'Well being (T)' };
    mocks.forms.mockResolvedValue({ forms: [...visible, hidden, card] });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.forms.map(form => form.name)).toEqual(expect.arrayContaining(visible.map(form => form.title)));
    expect(data.forms.map(form => form.name)).not.toContain(hidden.title);
    expect(data.records.map(record => record.formName)).not.toContain(hidden.title);
  });

  it('loads subsequent review pages before reporting the registry totals', async () => {
    mocks.reviews.mockResolvedValueOnce({ reviews: [summary], nextOffset: 30 })
      .mockResolvedValueOnce({ reviews: [{ ...summary, id: 'review-2' }], nextOffset: null });
    const signal = new AbortController().signal;
    const data = await loadLiveQmsData(signal);
    expect(mocks.reviews.mock.calls.map(([, offset]) => offset)).toEqual([0, 30]);
    expect(mocks.reviews.mock.calls.every(([, , callerSignal]) => callerSignal === signal)).toBe(true);
    expect(data.records.map(record => record.id)).toEqual(['review-1', 'review-2']);
    expect(data.forms[0].submissions).toBe(2);
  });

  it('propagates an unavailable quality source instead of returning a successful empty dashboard', async () => {
    mocks.forms.mockRejectedValue(new Error('Quality access denied'));
    await expect(loadLiveQmsData(new AbortController().signal)).rejects.toThrow('Quality access denied');
    expect(mocks.definition).not.toHaveBeenCalled();
  });

  it('keeps available audit data and explicitly identifies an unavailable feedback source', async () => {
    mocks.feedbackForms.mockRejectedValue(new Error('Feedback unavailable'));
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.records).toHaveLength(1);
    expect(data.records[0].id).toBe(summary.id);
    expect(data.feedbackTypes).toEqual([]);
    expect(data.availability.feedback).toBe(false);
    expect(data.availability.feedbackScores).toBe(false);
    expect(data.notice).toContain('Feedback API unavailable');
  });

  it('marks unavailable definitions rather than fabricating form questions', async () => {
    mocks.definition.mockRejectedValue(new Error('Definition unavailable'));
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.forms[0]).toMatchObject({ questionCount: 0, scoringMethod: 'Definition unavailable' });
    expect(data.records[0].ratingCounts).toEqual(summary.ratingCounts);
  });

  it('includes only feedback responses inside the requested period', async () => {
    const form = { id: 42, title: 'Synthetic event feedback', formType: 'post_event', version: 1, assignedCount: 2,
      sections: [{ questions: [{ id: 1, type: 'rating' }] }] } as FeedbackForm;
    const response: FeedbackResponse = { id: 1, formId: 42, formTitle: form.title, templateKey: 'synthetic', learnerId: null,
      formType: 'post_event', deliveryId: null, sessionTitle: 'Synthetic event', sessionStartsAt: null, tutorName: '',
      learnerName: 'Synthetic respondent', programme: 'Synthetic programme', status: 'completed',
      startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z', submittedAt: '2026-10-20T10:00:00Z' };
    mocks.feedbackForms.mockResolvedValue({ forms: [form] });
    mocks.feedbackResponses.mockResolvedValue({ responses: [response, { ...response, id: 2, submittedAt: '2024-10-20T10:00:00Z' }] });
    mocks.insights.mockResolvedValue({ analytics: { insights: { classification: { responses: [
      { responseId: 1, classification: 'negative' },
    ] } } } });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(mocks.feedbackResponses).toHaveBeenCalledWith({ status: 'completed', submittedFrom: '2025-11-15', submittedTo: '2026-11-15' });
    expect(mocks.insights).toHaveBeenCalledWith({ submittedFrom: '2025-11-15', submittedTo: '2026-11-15' });
    expect(data.records.map(record => record.id)).toEqual([summary.id, 'feedback-response-1']);
    expect(data.records[1].feedbackClassification).toBe('negative');
    expect(data.availability.feedbackScores).toBe(true);
    expect(data.forms.find(item => item.id === 'feedback-42')).toMatchObject({ submissions: 1, ragSupported: false });
  });

  it('keeps MCM and PR feedback responses and removes only forms marked (T)', async () => {
    const baseForm = { id: 60, title: 'Monthly Coaching Meeting Feedback Form', formType: 'post_mcm_review', version: 1,
      assignedCount: 1, sections: [{ questions: [{ id: 1, type: 'rating' }] }] } as FeedbackForm;
    const forms = [baseForm,
      { ...baseForm, id: 61, title: 'Progress Review Feedback Form', formType: 'post_progress_review' },
      { ...baseForm, id: 62, title: 'Progress Review Feedback Form (T)', formType: 'post_progress_review' }] as FeedbackForm[];
    const baseResponse = { id: 1, formId: 60, formTitle: baseForm.title, formType: baseForm.formType, templateKey: 'mcm',
      learnerId: null, deliveryId: null, sessionTitle: '', sessionStartsAt: null, tutorName: '', learnerName: 'Synthetic respondent',
      programme: '', status: 'completed', startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
      submittedAt: '2026-10-20T10:00:00Z' } as FeedbackResponse;
    mocks.feedbackForms.mockResolvedValue({ forms });
    mocks.feedbackResponses.mockResolvedValue({ responses: forms.map((form, index) =>
      ({ ...baseResponse, id: index + 1, formId: form.id, formTitle: form.title, formType: form.formType })) });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.forms.map(form => form.id)).toEqual(expect.arrayContaining(['feedback-60', 'feedback-61']));
    expect(data.forms.map(form => form.id)).not.toContain('feedback-62');
    expect(data.records.map(record => record.id)).toEqual(expect.arrayContaining(['feedback-response-1', 'feedback-response-2']));
    expect(data.records.map(record => record.id)).not.toContain('feedback-response-3');
  });

  it('adds a new feedback form and type to the executive registry from live data', async () => {
    const form = { id: 71, title: 'Learner Pulse', formType: 'custom_pulse', version: 1, assignedCount: 1,
      sections: [{ questions: [{ id: 1, type: 'rating' }] }] } as unknown as FeedbackForm;
    const response = { id: 7, formId: 71, formTitle: form.title, formType: form.formType, templateKey: 'pulse',
      learnerId: null, deliveryId: null, sessionTitle: '', sessionStartsAt: null, tutorName: '', learnerName: 'Synthetic respondent',
      programme: '', status: 'completed', startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
      submittedAt: '2026-10-20T10:00:00Z' } as FeedbackResponse;
    mocks.feedbackForms.mockResolvedValue({ forms: [form] });
    mocks.feedbackResponses.mockResolvedValue({ responses: [response] });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.forms.map(item => item.id)).toContain('feedback-71');
    expect(data.feedbackTypes).toContainEqual({ id: 'custom_pulse', name: 'custom_pulse' });
    expect(data.records.map(item => item.id)).toContain('feedback-response-7');
  });

  it('includes completed historical form responses and excludes unfinished responses', async () => {
    const current = { id: 49, title: 'Synthetic lecture feedback', templateKey: 'lecture-family', formType: 'post_lecture', version: 2,
      assignedCount: 5, sections: [{ questions: [{ id: 2, type: 'rating' }] }] } as FeedbackForm;
    const historical = { ...current, id: 47, version: 1, isCurrent: false,
      sections: [{ questions: [{ id: 1, type: 'rating' }, { id: 3, type: 'text' }] }] } as FeedbackForm;
    const response = { id: 10, formId: 47, formTitle: historical.title, templateKey: 'lecture-family', learnerId: null,
      formType: 'post_lecture', deliveryId: null, sessionTitle: '', sessionStartsAt: null, tutorName: '',
      learnerName: 'Synthetic respondent', programme: '', status: 'completed',
      startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z', submittedAt: '2026-10-20T10:00:00Z' } as FeedbackResponse;
    mocks.feedbackForms.mockResolvedValue({ forms: [current] });
    mocks.feedbackResponses.mockResolvedValue({ responses: [
      response, { ...response, id: 11 },
      { ...response, id: 12, formId: 49 },
      { ...response, id: 13, status: 'in_progress', submittedAt: null },
    ] });
    mocks.getForm.mockResolvedValue({ form: historical });

    const data = await loadLiveQmsData(new AbortController().signal);
    expect(mocks.getForm).toHaveBeenCalledOnce();
    expect(mocks.getForm).toHaveBeenCalledWith(47);
    expect(data.records.map(record => record.id)).toEqual([summary.id, 'feedback-response-12', 'feedback-response-10', 'feedback-response-11']);
    expect(data.records.find(record => record.id === 'feedback-response-10')).toMatchObject({ formId: 'feedback-47', totalQuestions: 2, reviewStatus: 'completed' });
    expect(data.forms.find(form => form.id === 'feedback-47')).toMatchObject({ version: '1', submissions: 2 });
    expect(data.forms.find(form => form.id === 'feedback-49')).toMatchObject({ version: '2', submissions: 1 });
  });

  it('keeps draft ratings separate from completed review evidence', async () => {
    mocks.reviews.mockResolvedValue({ reviews: [summary, { ...summary, id: 'draft-1', status: 'draft' }], nextOffset: null });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.records.find(record => record.id === 'draft-1')?.ratingCounts).toBeNull();
    expect(data.records.find(record => record.id === summary.id)?.ratingCounts).toEqual(summary.ratingCounts);
  });
});
