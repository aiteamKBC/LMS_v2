import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import FeedbackPage from './page';

vi.mock('@/hooks/useOperatorIdentity', () => ({
  useOperatorIdentity: () => ({ name: 'Staff User', role: 'Engagement Manager' }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/api/feedback', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/feedback')>();
  return {
    ...actual,
    feedbackApi: {
      ...actual.feedbackApi,
      listForms: vi.fn(), responses: vi.fn(), response: vi.fn(), analytics: vi.fn(), questionAnalytics: vi.fn(), insightsDashboard: vi.fn(), versions: vi.fn(), recipients: vi.fn(),
    },
  };
});

const form: FeedbackForm = {
  id: 20, title: 'Lecture feedback', formType: 'post_lecture', deliveryScope: 'all_modules',
  templateKey: 'template-1', version: 2, isCurrent: true, previousVersionId: 19,
  curriculumScope: { programmeId: '', programmeName: '', cohortId: '', cohortName: '', groupId: '', groupName: '', moduleCatalogueId: '', moduleName: '' },
  description: '', instructions: '', status: 'published', startDate: null, dueDate: null,
  anonymousResponses: false, allowSaveContinue: true, allowEditAfterSubmission: false,
  createdBy: 'Staff', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z', publishedAt: '2026-09-24T10:00:00Z',
  assignedCount: 22, responseCount: 3, startedCount: 3, structureLocked: false, willCreateVersion: true,
};

describe('feedback form version history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('AppIcon', () => null);
    vi.mocked(feedbackApi.listForms).mockResolvedValue({ forms: [form], summary: { totalForms: 1, publishedForms: 1, draftForms: 0, totalResponses: 3 } });
    vi.mocked(feedbackApi.responses).mockResolvedValue({ responses: [] });
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: { totalAssigned: 22, notStarted: 19, inProgress: 0, completed: 3, completionRate: 14, ratingAverages: [] } });
    vi.mocked(feedbackApi.versions).mockResolvedValue({ versions: [
      { id: 20, title: 'Lecture feedback', version: 2, isCurrent: true, previousVersionId: 19, status: 'published', createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z', publishedAt: '2026-09-25T10:00:00Z', deliveryCount: 0, assignedCount: 0, startedCount: 0, responseCount: 0 },
      { id: 19, title: 'Lecture feedback', version: 1, isCurrent: false, previousVersionId: null, status: 'published', createdAt: '2026-09-24T10:00:00Z', updatedAt: '2026-09-24T10:00:00Z', publishedAt: '2026-09-24T10:00:00Z', deliveryCount: 1, assignedCount: 22, startedCount: 3, responseCount: 3 },
    ] });
    vi.mocked(feedbackApi.recipients).mockResolvedValue({
      recipients: [], total: 0, page: 1, pageSize: 50,
      sources: [
        { key: 'lecture:32', type: 'lecture', label: 'Lecture attendance', title: 'Martech - Thur - Session 2', subtitle: 'Martech - Thur', startsAt: '2026-09-24T09:30:00Z', assignedCount: 10, responseCount: 3 },
        { key: 'lecture:31', type: 'lecture', label: 'Lecture attendance', title: 'Martech - Thur - Session 1', subtitle: 'Martech - Thur', startsAt: '2026-09-17T09:30:00Z', assignedCount: 12, responseCount: 1 },
      ],
      lectures: [
        { deliveryId: 32, occurrenceKey: 'session-2', sessionTitle: 'Martech - Thur - Session 2', moduleName: 'Martech - Thur', startsAt: '2026-09-24T09:30:00Z', assignedCount: 10, responseCount: 3 },
        { deliveryId: 31, occurrenceKey: 'session-1', sessionTitle: 'Martech - Thur - Session 1', moduleName: 'Martech - Thur', startsAt: '2026-09-17T09:30:00Z', assignedCount: 12, responseCount: 1 },
      ],
    });
  });

  it('shows the current version and opens historical versions read-only', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Forms' }));

    expect(await screen.findByText('v2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Versions' }));

    await waitFor(() => expect(feedbackApi.versions).toHaveBeenCalledWith(20));
    expect(screen.getByText('Version history — Lecture feedback')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Historical')).toBeInTheDocument();
  });

  it('opens assigned learners on the latest lecture and can select another lecture', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Forms' }));
    await user.click(screen.getByRole('button', { name: '22' }));

    const lectureFilter = await screen.findByRole('combobox', { name: 'Filter by lecture' });
    await waitFor(() => expect(feedbackApi.recipients).toHaveBeenCalledWith(20, '', 1, 50, 'lecture:32'));
    expect(lectureFilter).toHaveValue('lecture:32');
    expect(screen.getByRole('option', { name: /Session 1.*12 assigned, 1 responses/ })).toBeInTheDocument();

    await user.selectOptions(lectureFilter, 'lecture:31');
    await waitFor(() => expect(feedbackApi.recipients).toHaveBeenCalledWith(20, '', 1, 50, 'lecture:31'));
  });

  it('shows event attendees from the event assignment source', async () => {
    const user = userEvent.setup();
    const eventForm = { ...form, id: 31, title: 'Event feedback', formType: 'post_event' as const, assignedCount: 1 };
    vi.mocked(feedbackApi.listForms).mockResolvedValue({ forms: [eventForm], summary: { totalForms: 1, publishedForms: 1, draftForms: 0, totalResponses: 0 } });
    vi.mocked(feedbackApi.recipients).mockResolvedValue({
      recipients: [{
        key: 'event-8-44', learnerId: '', learnerName: 'Guest Attendee', email: 'guest@example.test', programme: '',
        source: 'event_attendance', sourceKey: 'event:8', sourceType: 'event', sourceLabel: 'Event attendance',
        sourceTitle: 'Leadership Day', sourceSubtitle: 'Main Hall', sourceStartsAt: '2026-09-29',
        deliveryId: null, occurrenceKey: '', sessionTitle: 'Leadership Day', sessionStartsAt: null, moduleName: '',
        assignedAt: '2026-09-29T10:00:00Z', dueDate: null, responseStatus: 'not_started', formVersion: 1, recipientType: 'guest',
      }],
      sources: [{ key: 'event:8', type: 'event', label: 'Event attendance', title: 'Leadership Day', subtitle: 'Main Hall', startsAt: '2026-09-29', assignedCount: 1, responseCount: 0 }],
      lectures: [], total: 1, page: 1, pageSize: 50,
    });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Forms' }));
    await user.click(screen.getByRole('button', { name: '1' }));

    expect(await screen.findByText('Assigned attendees — Event feedback')).toBeInTheDocument();
    // The dialog automatically selects its source and then loads that scoped roster.
    await waitFor(() => expect(feedbackApi.recipients).toHaveBeenLastCalledWith(31, '', 1, 50, 'event:8'));
    expect(await screen.findByText('Guest Attendee')).toBeInTheDocument();
    expect(screen.getByText('Event attendance')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeInTheDocument();
  });

  it('shows completion analytics and reloads metrics for a feedback type', async () => {
    const user = userEvent.setup();
    vi.mocked(feedbackApi.responses).mockResolvedValue({ responses: [{
      id: 91, formId: 20, formTitle: 'Lecture feedback', learnerId: '61', learnerName: 'Test Learner',
      programme: 'Business', status: 'completed', startedAt: '2026-10-20T09:00:00Z',
      updatedAt: '2026-10-20T09:10:00Z', submittedAt: '2026-10-20T09:10:00Z',
    }] });
    vi.mocked(feedbackApi.analytics).mockReset()
      .mockResolvedValueOnce({ analytics: { totalAssigned: 22, notStarted: 19, inProgress: 0, completed: 3, completionRate: 14, ratingAverages: [] } })
      .mockResolvedValueOnce({ analytics: { totalAssigned: 22, notStarted: 17, inProgress: 1, completed: 4, completionRate: 18.2, ratingAverages: [
        { questionId: 4, question: 'How useful was this session?', average: 4.5, responses: 4, min: 1, max: 5 },
      ] } });

    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));

    expect(await screen.findByRole('heading', { name: 'Feedback Analytics' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Feedback completion metrics' })).toBeVisible();
    expect(screen.getByText('Completion split')).toBeVisible();
    for (const heading of ['Response rate by form', 'Average rating questions', 'Rating insights']) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }
    expect(screen.getByText('Test Learner')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'All feedback types' }));
    await user.click(screen.getByRole('option', { name: 'Live Sessions Feedback' }));

    await waitFor(() => expect(feedbackApi.analytics).toHaveBeenCalledWith({ formType: 'post_lecture' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Feedback completion metrics' })).getByText('18.2%')).toBeVisible());
    expect(screen.queryByText('How useful was this session?')).not.toBeInTheDocument();
    for (const heading of ['Response rate by form', 'Average rating questions', 'Rating insights']) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }
    expect(screen.getByText('Test Learner')).toBeVisible();
  });

  it('shows the new question score and answer-rate report in the existing Analytics tab', async () => {
    const user = userEvent.setup();
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: {
      totalAssigned: 40, notStarted: 10, inProgress: 0, completed: 30, completionRate: 75, ratingAverages: [],
      overallScore: { score: 80, scoredQuestions: 1, includedQuestions: 1 },
      questionMetrics: [{ questionId: 7, question: 'Supported?', type: 'yes_no', formId: 20, formTitle: 'Lecture feedback', version: 2, category: 'Teaching', importance: 'high', weight: 3, includedInOverall: true, assignedCount: 40, answeredCount: 30, answerRate: 75, score: 80, scoredResponses: 30, status: 'good', averageRating: null, scaleMax: null, distribution: [{ label: 'Yes', count: 24 }, { label: 'No', count: 6 }] }],
    } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));
    expect(await screen.findByRole('region', { name: 'Question analytics' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Lecture feedback.*Version 2/ }));
    expect(screen.getByRole('row', { name: /Supported/ })).toHaveTextContent('75%');
    expect(screen.getByRole('row', { name: /Supported/ })).toHaveTextContent('80%');
    expect(screen.getByRole('row', { name: /Supported/ })).toHaveTextContent('30 answered / 40 assigned');
    expect(screen.getByText('Weighted Overall Score')).toBeVisible();
  });

  it('shows lecture filters only for the lecture type and keeps other question reports visible', async () => {
    const user = userEvent.setup();
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: {
      totalAssigned: 22, notStarted: 19, inProgress: 0, completed: 3, completionRate: 14,
      ratingAverages: [], questionMetrics: [], overallScore: { score: null, scoredQuestions: 0, includedQuestions: 0 },
    } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));
    expect(screen.queryByText('Find a lecture')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Question analytics' })).toBeVisible();

    let currentType = 'All feedback types';
    for (const label of ['Live Sessions Feedback', 'Mid-module Feedback', 'End-module Feedback', 'MCM Feedback', 'Progress Review Feedback', 'Event Feedback', 'Event RSVP', 'General Feedback', 'All feedback types']) {
      await user.click(screen.getByRole('button', { name: currentType }));
      await user.click(screen.getByRole('option', { name: label }));
      if (label === 'Live Sessions Feedback') {
        expect(screen.getByText('Find a lecture')).toBeVisible();
        expect(screen.getByRole('combobox', { name: 'Question report lecture' })).toBeVisible();
      } else {
        expect(screen.queryByText('Find a lecture')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Question report lecture' })).not.toBeInTheDocument();
      }
      expect(screen.getByRole('region', { name: 'Question analytics' })).toBeVisible();
      currentType = label;
    }
    expect(feedbackApi.questionAnalytics).not.toHaveBeenCalled();
  });

  it('recognizes a selected lecture form under all types and hides the filters for an event form', async () => {
    const user = userEvent.setup();
    const eventForm = { ...form, id: 31, title: 'Event feedback', formType: 'post_event' as const };
    vi.mocked(feedbackApi.listForms).mockResolvedValue({ forms: [form, eventForm], summary: { totalForms: 2, publishedForms: 2, draftForms: 0, totalResponses: 6 } });
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: {
      totalAssigned: 22, notStarted: 19, inProgress: 0, completed: 3, completionRate: 14,
      ratingAverages: [], questionMetrics: [], overallScore: { score: null, scoredQuestions: 0, includedQuestions: 0 },
    } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));
    await user.click(screen.getByRole('button', { name: 'All forms' }));
    await user.click(screen.getByRole('option', { name: 'Lecture feedback' }));
    expect(screen.getByText('Find a lecture')).toBeVisible();
    await waitFor(() => expect(feedbackApi.analytics).toHaveBeenLastCalledWith({ formId: 20 }));
    await user.click(screen.getByRole('button', { name: 'Lecture feedback' }));
    await user.click(screen.getByRole('option', { name: 'Event feedback' }));
    expect(screen.queryByText('Find a lecture')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Question analytics' })).toBeVisible();
    await waitFor(() => expect(feedbackApi.analytics).toHaveBeenLastCalledWith({ formId: 31 }));
    expect(feedbackApi.questionAnalytics).not.toHaveBeenCalled();
  });

  it('filters lecture questions without replacing the global KPI counters or refetching whole analytics', async () => {
    const user = userEvent.setup();
    const metric = { questionId: 7, question: 'All lecture support?', type: 'yes_no' as const, formId: 20, formTitle: 'Lecture feedback', version: 2, category: 'Teaching', importance: 'high' as const, weight: 3, includedInOverall: true, assignedCount: 40, answeredCount: 30, answerRate: 75, score: 80, scoredResponses: 30, status: 'good' as const, averageRating: null, scaleMax: null, distribution: [] };
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: {
      totalAssigned: 40, notStarted: 10, inProgress: 0, completed: 30, completionRate: 75, ratingAverages: [],
      questionMetrics: [metric], overallScore: { score: 80, scoredQuestions: 1, includedQuestions: 1 },
      lectures: [{ deliveryId: 30, moduleId: 'M1', moduleName: 'Marketing', sessionTitle: 'Session 1', occurrenceKey: 'lecture-30', startsAt: '2026-10-20T09:00:00Z', groupName: 'Group A', cohortName: 'Cohort A', formTitle: 'Lecture feedback', version: 2 }],
    } });
    vi.mocked(feedbackApi.questionAnalytics).mockResolvedValue({ analytics: {
      questionMetrics: [{ ...metric, question: 'Only lecture 30?', assignedCount: 2, answeredCount: 1, answerRate: 50, score: 0 }],
      overallScore: { score: 0, scoredQuestions: 1, includedQuestions: 1 },
    } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));
    await user.click(screen.getByRole('button', { name: 'All feedback types' }));
    await user.click(screen.getByRole('option', { name: 'Live Sessions Feedback' }));
    await waitFor(() => expect(feedbackApi.analytics).toHaveBeenCalledWith({ formType: 'post_lecture' }));
    const counters = screen.getByRole('region', { name: 'Feedback completion metrics' }).textContent;
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report lecture' }), '30');
    await user.click(await screen.findByRole('button', { name: /Lecture feedback.*Version 2/ }));
    expect(await screen.findByText('Only lecture 30?')).toBeVisible();
    expect(screen.queryByText('All lecture support?')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Feedback completion metrics' }).textContent).toBe(counters);
    expect(feedbackApi.analytics).toHaveBeenCalledTimes(2);
    expect(feedbackApi.questionAnalytics).toHaveBeenCalledWith({ formType: 'post_lecture', deliveryId: 30 });
  });

  it('keeps insights and completion counters visible without submission date filters', async () => {
    const user = userEvent.setup();
    const insights = { stars: { average: 5, answers: 30, distribution: [{ stars: 5, count: 30 }] }, categories: [], trend: [], undatedScoredAnswers: 0 };
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: {
      totalAssigned: 40, notStarted: 10, inProgress: 0, completed: 30, completionRate: 75,
      ratingAverages: [{ questionId: 4, question: 'Historical average?', average: 4.5, responses: 30 }],
      questionMetrics: [], overallScore: { score: null, scoredQuestions: 0, includedQuestions: 0 }, insights,
    } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));
    expect(screen.getByText('5.00 / 5')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Feedback completion metrics' })).toHaveTextContent('40');
    expect(within(screen.getByText('Star answers').parentElement!).getByText('30')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Question analytics' })).toBeVisible();
    expect(screen.queryByText('Submission period')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Submission date from')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Submission date to')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply dates' })).not.toBeInTheDocument();
    expect(screen.queryByText('Historical average?')).not.toBeInTheDocument();
    for (const heading of ['Response rate by form', 'Average rating questions', 'Rating insights']) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Find a lecture')).not.toBeInTheDocument();
    expect(feedbackApi.analytics).toHaveBeenCalledTimes(1);
    expect(feedbackApi.questionAnalytics).not.toHaveBeenCalled();
  });

  it('shows rule-based classifications and opens a response through the existing staff read endpoint', async () => {
    const user = userEvent.setup();
    vi.mocked(feedbackApi.analytics).mockResolvedValue({ analytics: {
      totalAssigned: 40, notStarted: 39, inProgress: 0, completed: 1, completionRate: 2.5, ratingAverages: [], questionMetrics: [], overallScore: { score: null, scoredQuestions: 0, includedQuestions: 0 },
      insights: { stars: { average: null, answers: 0, distribution: [] }, categories: [], trend: [], undatedScoredAnswers: 0, classification: {
        total: 1, positive: 0, neutral: 0, negative: 1, unscored: 0, byType: [], trend: [],
        responses: [{ responseId: 99, formId: 20, formTitle: 'Lecture feedback', formType: 'post_lecture', version: 2, respondent: 'Anonymous learner', score: 0, classification: 'negative', scoredQuestions: 2, submittedAt: '2026-10-20T10:00:00Z' }],
      } },
    } });
    vi.mocked(feedbackApi.response).mockResolvedValue({ response: { id: 99, formId: 20, formTitle: 'Lecture feedback', learnerId: null, learnerName: 'Anonymous learner', programme: '', status: 'completed', startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z', submittedAt: '2026-10-20T10:00:00Z', sections: [] } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Analytics' }));
    expect(screen.getByRole('region', { name: 'Score-based response classification' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'View answers' }));
    await waitFor(() => expect(feedbackApi.response).toHaveBeenCalledWith(99));
    expect(await screen.findByRole('heading', { name: 'Feedback response' })).toBeVisible();
    expect(screen.getAllByText('Anonymous learner').length).toBeGreaterThan(1);
  });

  it('adds Feedback Insights beside Analytics and reviews original answers without replacing the existing report', async () => {
    const user = userEvent.setup();
    vi.mocked(feedbackApi.insightsDashboard).mockResolvedValue({ analytics: {
      groups: [], coverage: { assigned: 22, submitted: 3, rate: 13.6 }, questionMetrics: [], overallScore: { score: null, scoredQuestions: 0, includedQuestions: 0 },
      insights: { stars: { average: null, answers: 0, distribution: [] }, categories: [], trend: [], undatedScoredAnswers: 0, classification: {
        total: 1, positive: 0, neutral: 0, negative: 1, unscored: 0, byType: [], trend: [],
        responses: [{ responseId: 101, formId: 20, formTitle: 'Lecture feedback', formType: 'post_lecture', version: 2, respondent: 'Anonymous learner', score: 0, classification: 'negative', scoredQuestions: 2, submittedAt: null, contextTitle: 'Synthetic lecture session' }],
      } },
    } });
    vi.mocked(feedbackApi.response).mockResolvedValue({ response: { id: 101, formId: 20, formTitle: 'Lecture feedback', learnerId: null, learnerName: 'Anonymous learner', programme: '', status: 'completed', startedAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T10:00:00Z', submittedAt: null, sections: [] } });
    render(<MemoryRouter><FeedbackPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Feedback Insights' }));
    expect(await screen.findByText('Synthetic lecture session')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Feedback Forms' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review response 101' }));
    await waitFor(() => expect(feedbackApi.response).toHaveBeenCalledWith(101));
    expect(await screen.findByRole('heading', { name: 'Feedback response' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Analytics' }));
    expect(screen.getByRole('heading', { name: 'Feedback Analytics' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Feedback completion metrics' })).toBeVisible();
    expect(feedbackApi.analytics).toHaveBeenCalledTimes(1);
    expect(feedbackApi.questionAnalytics).not.toHaveBeenCalled();
  });
});
