import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackApi, type FeedbackAnalyticsData, type FeedbackQuestionReport } from '@/api/feedback';
import { LectureQuestionAnalytics } from './LectureQuestionAnalytics';
import { lectureAnalyticsLabel } from './lectureAnalyticsLabels';

const row = {
  questionId: 1, question: 'All lecture answers?', type: 'rating' as const, formId: 4, formTitle: 'Lecture feedback',
  version: 1, category: 'Teaching', importance: 'high' as const, weight: 3, includedInOverall: true,
  assignedCount: 40, answeredCount: 30, answerRate: 75, score: 82.5, scoredResponses: 30,
  status: 'good' as const, averageRating: 4.3, scaleMax: 5, distribution: [],
};
const data: FeedbackAnalyticsData = {
  totalAssigned: 40, notStarted: 10, inProgress: 0, completed: 30, completionRate: 75, ratingAverages: [],
  questionMetrics: [row], overallScore: { score: 82.5, scoredQuestions: 1, includedQuestions: 1 },
  lectures: [
    { deliveryId: 30, moduleId: 'M1', moduleName: 'Marketing', sessionTitle: 'Session 1', occurrenceKey: 'lecture-30', startsAt: '2026-10-20T09:00:00Z', cohortName: 'Cohort A', groupName: 'Group A', formTitle: 'Lecture feedback', version: 1 },
    { deliveryId: 31, moduleId: 'M1', moduleName: 'Marketing', sessionTitle: 'Session 1', occurrenceKey: 'lecture-31', startsAt: '2026-10-21T09:00:00Z', cohortName: 'Cohort A', groupName: 'Group A', formTitle: 'Lecture feedback', version: 1 },
    { deliveryId: 40, moduleId: 'M2', moduleName: 'Leadership', sessionTitle: 'Session 1', occurrenceKey: 'lecture-40', startsAt: '2026-10-20T09:00:00Z', cohortName: 'Cohort B', groupName: 'Group B', formTitle: 'Other feedback', version: 2 },
  ],
};
const report = (question: string, score = 0): FeedbackQuestionReport => ({
  questionMetrics: [{ ...row, question, assignedCount: 2, answeredCount: 1, answerRate: 50, score }],
  overallScore: { score, scoredQuestions: 1, includedQuestions: 1 },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());

async function openQuestions() {
  const button = await screen.findByRole('button', { name: /Lecture feedback.*Version 1/ });
  if (button.getAttribute('aria-expanded') === 'false') await userEvent.click(button);
}

describe('lecture-only question reporting filters', () => {
  it.each([true, false])('has no submission date controls and preserves the initial report (lecture filters: %s)', async showLectures => {
    const request = vi.spyOn(feedbackApi, 'questionAnalytics');
    render(<LectureQuestionAnalytics data={data} scope={{}} showLectures={showLectures} />);
    await openQuestions();
    expect(screen.queryByText('Submission period')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Submission date from')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Submission date to')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply dates' })).not.toBeInTheDocument();
    expect(screen.getByText('All lecture answers?')).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps the initial report and distinguishes repeated lecture titles by UK date, group and identity', async () => {
    const request = vi.spyOn(feedbackApi, 'questionAnalytics');
    render(<LectureQuestionAnalytics data={data} scope={{ formId: 4 }} />);
    await openQuestions();
    expect(screen.getByText('All lecture answers?')).toBeVisible();
    expect(screen.getByRole('option', { name: /20 Oct 2026, 10:00.*Group A.*#30/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /21 Oct 2026, 10:00.*Group A.*#31/ })).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    const winter = { ...data.lectures![0], startsAt: '2026-10-26T09:00:00Z' };
    expect(lectureAnalyticsLabel(winter)).toContain('26 Oct 2026, 09:00');
  });

  it('filters modules then lectures and keeps the parent form/type scope', async () => {
    const user = userEvent.setup();
    const request = vi.spyOn(feedbackApi, 'questionAnalytics').mockResolvedValue({ analytics: report('Saved lecture question?') });
    render(<LectureQuestionAnalytics data={data} scope={{ formId: 4, formType: 'post_lecture' }} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report module' }), 'M1');
    await waitFor(() => expect(request).toHaveBeenLastCalledWith({ formId: 4, formType: 'post_lecture', moduleId: 'M1' }));
    expect(screen.queryByRole('option', { name: /Group B/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report lecture' }), '30');
    await waitFor(() => expect(request).toHaveBeenLastCalledWith({ formId: 4, formType: 'post_lecture', moduleId: 'M1', deliveryId: 30 }));
    await openQuestions();
    expect(await screen.findByText('Saved lecture question?')).toBeVisible();
    expect(screen.queryByText('All lecture answers?')).not.toBeInTheDocument();
    expect(screen.getByText(/Question report: Marketing.*#30/)).toBeVisible();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report module' }), 'M2');
    expect(screen.getByRole('combobox', { name: 'Question report lecture' })).toHaveValue('');
    await waitFor(() => expect(request).toHaveBeenLastCalledWith({ formId: 4, formType: 'post_lecture', moduleId: 'M2' }));
  });

  it('searches many lectures without changing data or making requests', async () => {
    const user = userEvent.setup();
    const request = vi.spyOn(feedbackApi, 'questionAnalytics');
    render(<LectureQuestionAnalytics data={data} scope={{}} />);
    await openQuestions();
    await user.type(screen.getByRole('searchbox', { name: 'Search lectures' }), 'Group B');
    expect(screen.getByRole('option', { name: /Group B/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Group A.*#30/ })).not.toBeInTheDocument();
    expect(screen.getByText('All lecture answers?')).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it('hides old results while loading and ignores a late response for a previous lecture', async () => {
    const user = userEvent.setup();
    const first = deferred<{ analytics: FeedbackQuestionReport }>();
    const second = deferred<{ analytics: FeedbackQuestionReport }>();
    vi.spyOn(feedbackApi, 'questionAnalytics').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<LectureQuestionAnalytics data={data} scope={{}} />);
    await openQuestions();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report lecture' }), '30');
    expect(screen.getByRole('status')).toHaveTextContent('Loading lecture question results');
    expect(screen.queryByText('All lecture answers?')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report lecture' }), '31');
    second.resolve({ analytics: report('Lecture 31 only') });
    await openQuestions();
    expect(await screen.findByText('Lecture 31 only')).toBeVisible();
    first.resolve({ analytics: report('Stale lecture 30') });
    await waitFor(() => expect(screen.queryByText('Stale lecture 30')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Clear lecture filters' }));
    await openQuestions();
    expect(screen.getByText('All lecture answers?')).toBeVisible();
    expect(screen.queryByText('Lecture 31 only')).not.toBeInTheDocument();
  });

  it('shows a failed request explicitly and retries without falling back to all answers', async () => {
    const user = userEvent.setup();
    vi.spyOn(feedbackApi, 'questionAnalytics').mockRejectedValueOnce(new Error('Lecture unavailable')).mockResolvedValueOnce({ analytics: report('Retry result') });
    render(<LectureQuestionAnalytics data={data} scope={{}} />);
    await openQuestions();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report lecture' }), '30');
    expect(await screen.findByRole('alert')).toHaveTextContent('Lecture unavailable');
    expect(screen.queryByText('All lecture answers?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry lecture results' }));
    await openQuestions();
    expect(await screen.findByText('Retry result')).toBeVisible();
  });

  it('does not draw or display the full bank when a legacy selection is pending', async () => {
    const user = userEvent.setup();
    vi.spyOn(feedbackApi, 'questionAnalytics').mockResolvedValue({ analytics: {
      questionMetrics: [], overallScore: { score: null, scoredQuestions: 0, includedQuestions: 0 }, selectionPending: true,
    } });
    render(<LectureQuestionAnalytics data={data} scope={{}} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Question report lecture' }), '30');
    expect(await screen.findByText(/legacy lecture has no saved question selection/)).toBeVisible();
    expect(screen.queryByText('All lecture answers?')).not.toBeInTheDocument();
  });
});
