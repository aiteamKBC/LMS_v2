import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { SavedReflection } from './SavedReflection';

vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn() }));
const identity = { learnerKind: 'apprenticeship' as const, learnerId: '1', activityType: 'reading', activityId: 'C1' };
const saved: StoredLearningReflectionSubmission = {
  ...identity, id: 'R1', status: 'submitted_for_tutor_review', activityTitle: 'Synthetic lesson',
  learnerName: 'Synthetic learner', programmeName: 'Synthetic programme', moduleTitle: 'Planning', weekTitle: 'Week 1',
  locked: false, qualityScore: 100,
  learningReflection: 'My saved reflection.\nAnother paragraph.',
  ksbCodes: ['K1'], ksbWeights: { K1: 50 }, ksbExplanations: { K1: 'Evidence of planning' },
  confidenceBefore: { K1: 2 }, confidenceAfter: { K1: 4 },
  applicationType: 'plan', applicationText: 'Apply this in the next project.',
  evidenceFiles: ['Synthetic example.pdf'], selectedBenefits: ['Improved quality'], benefitExplanation: 'Reduce project errors.',
  plannedOtjh: '1 hour', actualTimeHours: '0.5', dateCompleted: '2026-10-01',
  completedDuringPaidHours: 'yes', otjhConfirmed: true, signedDeclaration: true, evidenceConsentConfirmed: true,
  coachFeedback: 'Good example.', reviewedBy: 'Synthetic coach',
  submittedAt: '2026-10-01T09:00:00Z', reviewedAt: '2026-10-02T09:00:00Z',
};

beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(saved); });
afterEach(cleanup);

it('shows additional lecture reflection time separately from the recorded lecture duration', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ ...saved, actualTimeHours: '2',
    lectureReflectionTime: { seconds: 1800, progressEntryId: 10, addedAt: 'now', countedSeconds: 9000 } });
  render(<SavedReflection {...identity} />);
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  expect(await screen.findByText('Additional reflection time added')).toBeVisible();
  expect(screen.getByText('Recorded activity total')).toBeVisible();
  expect(screen.getByText('02:30:00')).toBeVisible();
  expect(screen.getByText('00:30:00')).toBeVisible();
});

it('shows immutable time actions and the previous reflection in the coach time-history view', async () => {
  const receipt = { seconds: 1200, inputSeconds: 1200, progressEntryId: 11, countedSeconds: 8400,
    lectureSeconds: 7200, choice: 'correct' as const, addedAt: '2026-11-10T12:00:00Z', reason: 'Corrected minutes.' };
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ ...saved, lectureReflectionTime: receipt,
    lectureReflectionTimeHistory: [receipt], lectureReflectionAttempts: [{ status: 'submitted_for_tutor_review',
      content: { learningReflection: 'Original writing preserved.' }, coachFeedback: 'Original review preserved.' }] });
  render(<SavedReflection {...identity} timeOnly />);
  fireEvent.click(screen.getByRole('button', { name: 'View reflection time history' }));
  expect(await screen.findByRole('heading', { name: 'Reflection time history' })).toBeVisible();
  expect(screen.getByText(/Lecture time: 02:00:00/)).toHaveTextContent('Reflection time: 00:20:00');
  expect(screen.getByText('Reason: Corrected minutes.')).toBeVisible();
  fireEvent.click(screen.getByText(/Previous reflection 1/));
  expect(screen.getByText('Original writing preserved.')).toBeVisible();
  expect(screen.getByText('Coach feedback: Original review preserved.')).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it.each([
  ['submitted_for_tutor_review', 'Pending coach review'], ['accepted', 'Accepted'],
  ['referred', 'Rejected'], ['rejected', 'Rejected'], ['escalated', 'Pending coach review'],
  ['partial', 'Accepted'],
])('shows the saved %s document and coach feedback without editable controls', async (status, label) => {
  render(<SavedReflection {...identity} />);
  expect(loadLearningReflectionSubmission).not.toHaveBeenCalled();
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ ...saved, status });
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  expect(await screen.findByText(label)).toBeVisible();
  expect(screen.getByText(/My saved reflection/)).toBeVisible();
  expect(screen.getByText('Evidence of planning')).toBeVisible();
  expect(screen.getByText('Confidence before: 2; after: 4')).toBeVisible();
  expect(screen.getByText('Apply this in the next project.')).toBeVisible();
  expect(screen.getByText('Synthetic example.pdf')).toBeVisible();
  expect(screen.getByText('Improved quality')).toBeVisible();
  expect(screen.getByText('Reduce project errors.')).toBeVisible();
  expect(screen.getByText('00:30:00')).toBeVisible();
  expect(screen.getByText('2026-10-01')).toBeVisible();
  expect(screen.getByText('Good example.')).toBeVisible();
  expect(screen.getByText('1 Oct 2026, 10:00')).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /submit|save draft/i })).not.toBeInTheDocument();
  expect(loadLearningReflectionSubmission).toHaveBeenCalledWith(identity, { revalidate: true });
});

it('shows an explicit empty state when an activity was completed without a reflection', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(null);
  render(<SavedReflection {...identity} />);
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  expect(await screen.findByText('No saved reflection was found for this activity.')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Learning reflection' })).not.toBeInTheDocument();
});

it('shows read errors and retries without fabricating an empty submission', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockRejectedValueOnce(new Error('Could not load the saved reflection.'));
  render(<SavedReflection {...identity} />);
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the saved reflection.');
  expect(screen.queryByText('No saved reflection was found for this activity.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved reflection' }));
  expect(await screen.findByText(/My saved reflection/)).toBeVisible();
  expect(loadLearningReflectionSubmission).toHaveBeenCalledTimes(2);
});

it('refreshes the coach decision when the saved document is reopened', async () => {
  render(<SavedReflection {...identity} />);
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  await screen.findByText('Pending coach review');
  fireEvent.click(screen.getByRole('button', { name: 'Hide saved reflection' }));
  expect(screen.queryByText(/My saved reflection/)).not.toBeInTheDocument();
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ ...saved, status: 'accepted', coachFeedback: 'Accepted after review.' });
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  expect(await screen.findByText('Accepted after review.')).toBeVisible();
  expect(screen.getByText('Accepted')).toBeVisible();
  expect(loadLearningReflectionSubmission).toHaveBeenCalledTimes(2);
});

it('clears the old learner and ignores an in-flight response when identity changes', async () => {
  let resolveOld!: (value: StoredLearningReflectionSubmission) => void;
  vi.mocked(loadLearningReflectionSubmission).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<SavedReflection {...identity} />);
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  await waitFor(() => expect(loadLearningReflectionSubmission).toHaveBeenCalledTimes(1));
  view.rerender(<SavedReflection {...identity} learnerId="2" activityId="C2" />);
  expect(screen.getByRole('button', { name: 'View saved reflection' })).toHaveAttribute('aria-expanded', 'false');
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ ...saved, learningReflection: 'Second learner document.' });
  fireEvent.click(screen.getByRole('button', { name: 'View saved reflection' }));
  expect(await screen.findByText('Second learner document.')).toBeVisible();
  await act(async () => { resolveOld(saved); });
  expect(screen.queryByText(/My saved reflection/)).not.toBeInTheDocument();
  expect(loadLearningReflectionSubmission).toHaveBeenLastCalledWith({ ...identity, learnerId: '2', activityId: 'C2' }, { revalidate: true });
});
