import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readLearnerJson } from '@/api/learnerRead';
import { AssignmentSubmissions } from './AssignmentSubmissions';

vi.mock('./AssignmentDownload', () => ({ AssignmentDownload: ({ attempt }: { attempt?: number }) => <div aria-label={`Report for submission ${attempt}`}>Report controls</div> }));
vi.mock('@/api/learnerRead', () => ({ readLearnerJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const props = { kind: 'commercial' as const, learnerId: '1', activityId: 'A1', status: 'submitted_for_tutor_review', submissionCount: 2 };
const first = { number: 1, status: 'rejected', submittedAt: '2026-09-01T10:00:00Z', reviewedAt: '2026-09-02T10:00:00Z',
  reviewedBy: 'Coach One', coachFeedback: 'Please add supporting evidence.', answer: 'Original answer' };
const second = { ...first, number: 2, status: 'submitted_for_tutor_review', coachFeedback: '', reviewedAt: null, reviewedBy: '', answer: 'Revised answer' };

it.each(['commercial', 'apprenticeship'] as const)('shows old rejection and new feedback separately for %s without expanding feedback', async kind => {
  vi.mocked(readLearnerJson).mockResolvedValueOnce({ submission: { submissionAttempts: [first, second] } });
  render(<AssignmentSubmissions {...props} kind={kind} />);
  const rejected = await screen.findByRole('article', { name: 'Submission 1' });
  expect(within(rejected).getByText('Rejected')).toBeVisible();
  expect(within(rejected).getByLabelText('Report for submission 1')).toBeVisible();
  expect(within(rejected).getByText(/Submitted:/)).toHaveTextContent('1 Sept 2026, 11:00');
  expect(within(rejected).getByText(first.coachFeedback)).toBeVisible();
  const pending = screen.getByRole('article', { name: 'Submission 2' });
  expect(within(pending).getByText(/Awaiting coach review/)).toBeVisible();
  expect(within(pending).getByLabelText('Report for submission 2')).toBeVisible();
  expect(within(pending).queryByText(first.coachFeedback)).toBeNull();
  expect(readLearnerJson).toHaveBeenCalledWith(expect.stringContaining(`learnerKind=${kind}&learnerId=1&activityType=assignment&activityId=A1`), expect.objectContaining({ revalidate: true }));
  vi.mocked(readLearnerJson).mockResolvedValueOnce({ submission: { submissionAttempts: [first, { ...second, status: 'accepted', coachFeedback: 'The revised evidence is sufficient.', reviewedBy: 'Coach Two' }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh submissions' }));
  expect(await screen.findByText('The revised evidence is sufficient.')).toBeVisible();
  expect(within(screen.getByRole('article', { name: 'Submission 1' })).getByText(first.coachFeedback)).toBeVisible();
  expect(within(screen.getByRole('article', { name: 'Submission 2' })).getByText('Accepted')).toBeVisible();
});

it('does not display the previous assignment response after switching assignments', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(readLearnerJson).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<AssignmentSubmissions {...props} key="A1" />);
  vi.mocked(readLearnerJson).mockResolvedValueOnce({ submission: { submissionAttempts: [{ ...first, answer: 'Other answer', coachFeedback: 'Other feedback' }] } });
  view.rerender(<AssignmentSubmissions {...props} activityId="A2" key="A2" />);
  expect(await screen.findByText('Other feedback')).toBeVisible();
  await act(async () => resolve({ submission: { submissionAttempts: [first, second] } }));
  expect(screen.queryByText(first.coachFeedback)).toBeNull();
  expect(screen.getByText('Other feedback')).toBeVisible();
});

it('reports failed history loading and supports retry without inventing attempts', async () => {
  vi.mocked(readLearnerJson).mockRejectedValueOnce(new Error('Unavailable'));
  render(<AssignmentSubmissions {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load previous submissions');
  expect(screen.queryByRole('article')).toBeNull();
  vi.mocked(readLearnerJson).mockResolvedValueOnce({ submission: { submissionAttempts: [first] } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry submissions' }));
  expect(await screen.findByText(first.coachFeedback)).toBeVisible();
});

it('does not create a submission for an unsent draft', () => {
  render(<AssignmentSubmissions {...props} status="draft" submissionCount={0} />);
  expect(readLearnerJson).not.toHaveBeenCalled();
  expect(screen.queryByRole('article')).toBeNull();
});
