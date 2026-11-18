import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityFormCard, QualitySummary, QualityTemplate, QualityTemplateState } from '@/api/coachingQualityReviews';
import type { FeedbackForm, FeedbackResponse } from '@/api/feedback';
import { loadLiveQmsData } from './qualityData';

const mocks = vi.hoisted(() => ({
  forms: vi.fn(), reviews: vi.fn(), definition: vi.fn(),
  feedbackForms: vi.fn(), feedbackResponses: vi.fn(), insights: vi.fn(),
}));
vi.mock('@/api/coachingQualityReviews', () => ({
  qualityForms: mocks.forms, qualityReviews: mocks.reviews, qualityDefinition: mocks.definition,
}));
vi.mock('@/api/feedback', () => ({
  feedbackApi: { listForms: mocks.feedbackForms, responses: mocks.feedbackResponses, insightsDashboard: mocks.insights },
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
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.records.map(record => record.id)).toEqual([summary.id, 'feedback-response-1']);
    expect(data.forms.find(item => item.id === 'feedback-42')).toMatchObject({ submissions: 1, ragSupported: false });
  });

  it('keeps draft ratings separate from completed review evidence', async () => {
    mocks.reviews.mockResolvedValue({ reviews: [summary, { ...summary, id: 'draft-1', status: 'draft' }], nextOffset: null });
    const data = await loadLiveQmsData(new AbortController().signal);
    expect(data.records.find(record => record.id === 'draft-1')?.ratingCounts).toBeNull();
    expect(data.records.find(record => record.id === summary.id)?.ratingCounts).toEqual(summary.ratingCounts);
  });
});
