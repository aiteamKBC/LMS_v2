import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/api/reflectionSubmission', () => ({
  loadLearningReflectionSubmission: mocks.load,
  saveLearningReflectionSubmission: mocks.save,
}));
vi.mock('@/api/evidence', () => ({ uploadEvidence: vi.fn() }));
vi.mock('@/api/reflectionVoice', () => ({ proofreadLearningReflection: vi.fn(), transcribeVoiceReflection: vi.fn() }));

import { ReflectionWindow } from '../ReflectionWindow';

// AppIcon is a global auto-import in the app build; supply it for tests.
(globalThis as Record<string, unknown>).AppIcon = ({ className }: { className?: string }) => <i className={className} />;

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

const view = (props: Partial<Parameters<typeof ReflectionWindow>[0]> = {}) => render(
  <ReflectionWindow
    learnerKsbs={[]} elapsedSeconds={3} plannedTimeLabel="60 minutes" plannedHours={1}
    submitting={false} submitError={null} onSubmit={vi.fn()}
    learnerKind="apprenticeship" learnerId="learner-1" evidenceSectionRef="quiz-1" {...props}
  />,
);
const openOtjh = () => fireEvent.click(screen.getByRole('button', { name: 'OTJH' }));

it.each(['commercial', 'apprenticeship'] as const)('lets a %s learner review 49 hours and submit 4.9 without losing reflection text', async learnerKind => {
  mocks.load.mockResolvedValue({ status: 'draft', actualTimeHours: '49', learningReflection: 'Learning '.repeat(100),
    applicationType: 'apply_now', applicationText: 'Apply this learning at work.', selectedBenefits: ['Improved productivity'],
    benefitExplanation: 'Help the team with everyday work.', dateCompleted: '2026-10-14', completedDuringPaidHours: 'yes',
    otjhConfirmed: true, signedDeclaration: true });
  mocks.save.mockResolvedValue({ status: 'draft' });
  const onSubmit = vi.fn();
  view({ learnerKind, noun: 'video', onSubmit });
  openOtjh();
  await waitFor(() => expect(screen.getByLabelText('Actual time spent (hours)')).toHaveValue(49));
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('49 hours and 0 minutes');
  expect(mocks.save.mock.calls.some(([payload]) => payload.submissionMode === 'submit')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
  await waitFor(() => expect(screen.getByLabelText('Actual time spent (hours)')).toHaveValue(49));
  fireEvent.change(screen.getByLabelText('Actual time spent (hours)'), { target: { value: '4.9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('4 hours and 54 minutes');
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ timeTakenSeconds: 17640 })));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ submissionMode: 'submit', actualTimeHours: '4.9', learningReflection: 'Learning '.repeat(100).trim() }));
});

it('asks quizzes for minutes and presets the planned minutes', async () => {
  mocks.load.mockResolvedValue(null);
  view({ actualTimeUnit: 'minutes' });
  openOtjh();
  const field = await screen.findByLabelText('Actual time spent (minutes)');
  expect(field).toHaveValue(60);
  expect(screen.queryByLabelText('Actual time spent (hours)')).toBeNull();
});

it('restores a saved quiz reflection, stored in hours, as minutes', async () => {
  mocks.load.mockResolvedValue({ actualTimeHours: '0.25' });
  view({ actualTimeUnit: 'minutes' });
  openOtjh();
  await waitFor(() => expect(screen.getByLabelText('Actual time spent (minutes)')).toHaveValue(15));
});

it('keeps hours for other reflections', async () => {
  mocks.load.mockResolvedValue(null);
  view({ noun: 'video' });
  openOtjh();
  expect(await screen.findByLabelText('Actual time spent (hours)')).toHaveValue(1);
});


it.each([
  { seconds: 2400, clock: '00:40:00' },
  { seconds: 317, clock: '00:05:17' },
  { seconds: 5400, clock: '01:30:00' },
  { seconds: 0, clock: '00:00:00' },
])('saves the selected $clock in the reflection and completion, overriding planned and draft hours', async ({ seconds, clock }) => {
  mocks.load.mockResolvedValue({
    status: 'draft', actualTimeHours: '14', learningReflection: 'Learning '.repeat(100),
    applicationType: 'apply_now', applicationText: 'Use the learning at work.',
    selectedBenefits: ['Improved productivity'], benefitExplanation: 'Improve everyday work.',
    dateCompleted: '2026-10-01', completedDuringPaidHours: 'yes',
    otjhConfirmed: true, signedDeclaration: true,
  });
  mocks.save.mockResolvedValue({});
  const onSubmit = vi.fn();
  view({ noun: 'reading', plannedHours: 14, plannedTimeLabel: '14h', selectedTimeSeconds: seconds, onSubmit });
  openOtjh();
  expect(await screen.findByLabelText('Selected activity time')).toHaveValue(clock);
  expect(screen.getByLabelText('Selected activity time')).not.toHaveAttribute('readonly');
  expect(screen.queryByLabelText('Actual time spent (hours)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  const submit = screen.getByRole('button', { name: 'Submit for tutor review' });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    reportedTime: `${seconds / 60} minutes`,
  })));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    actualTimeHours: String(seconds / 3600), plannedOtjh: '14h',
  }));
});

it.each([['00:05:00', 300], ['02:30:00', 9000]])('saves corrected time %s from the start and end of the reflection', async (clock, seconds) => {
  mocks.load.mockResolvedValue({
    status: 'draft', learningReflection: 'Learning '.repeat(100),
    applicationType: 'apply_now', applicationText: 'Use the learning at work.',
    selectedBenefits: ['Improved productivity'], benefitExplanation: 'Improve everyday work.',
    dateCompleted: '2026-10-01', completedDuringPaidHours: 'yes', otjhConfirmed: true, signedDeclaration: true,
  });
  mocks.save.mockResolvedValue({ status: 'submitted_for_tutor_review' });
  const onSubmit = vi.fn();
  view({ noun: 'reading', selectedTimeSeconds: 3600, onSubmit });
  await waitFor(() => expect(screen.getByLabelText('Selected activity time')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Selected activity time'), { target: { value: '00:10:00' } });
  openOtjh();
  expect(screen.getByLabelText('Selected activity time')).toHaveValue('00:10:00');
  fireEvent.change(screen.getByLabelText('Selected activity time'), { target: { value: clock } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    reportedTime: `${seconds / 60} minutes`, timeTakenSeconds: seconds, timeEntrySource: 'input',
  })));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ actualTimeHours: String(seconds / 3600), reflectionTimeEdited: true }));
});

it('restores a corrected server draft instead of replacing it with a higher timer value', async () => {
  mocks.load.mockResolvedValue({ status: 'draft', actualTimeHours: '0.25', reflectionTimeEdited: true });
  view({ noun: 'reading', selectedTimeSeconds: 3600 });
  await waitFor(() => expect(screen.getByLabelText('Selected activity time')).toHaveValue('00:15:00'));
});

it.each(['00:90:00', '-1:00:00', '', 'not a time'])('does not allow submission with invalid time %s', async value => {
  mocks.load.mockResolvedValue(null);
  view({ selectedTimeSeconds: 3600 });
  await waitFor(() => expect(screen.getByLabelText('Selected activity time')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Selected activity time'), { target: { value } });
  expect(screen.getByLabelText('Selected activity time')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('button', { name: 'Submit for tutor review' })).toBeDisabled();
});


it('preserves the recorded hours of an accepted reflection when reopened', async () => {
  mocks.load.mockResolvedValue({ status: 'accepted', actualTimeHours: '2' });
  view({ noun: 'reading', selectedTimeSeconds: 2400, plannedHours: 14 });
  openOtjh();
  const field = await screen.findByLabelText('Actual time spent (hours)');
  expect(field).toHaveValue(2);
  expect(field).toBeDisabled();
  expect(screen.queryByLabelText('Selected activity time')).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});


it('saves incomplete answers as a server draft without completing the activity', async () => {
  mocks.load.mockResolvedValue(null);
  mocks.save.mockResolvedValue({ status: 'draft' });
  const onSubmit = vi.fn();
  view({ onSubmit });
  const draft = screen.getByRole('button', { name: 'Save draft' });
  await waitFor(() => expect(draft).toBeEnabled());
  fireEvent.change(screen.getByPlaceholderText('Type or use the microphone...'), { target: { value: 'My unfinished answer' } });
  fireEvent.click(draft);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    submissionMode: 'draft', learningReflection: 'My unfinished answer',
    learnerId: 'learner-1', activityId: 'quiz-1',
  })));
  expect(await screen.findByRole('button', { name: 'Draft saved' })).toBeEnabled();
  expect(onSubmit).not.toHaveBeenCalled();
});

it('restores unsaved answers and the active section after reopening', async () => {
  mocks.load.mockResolvedValue(null);
  const first = view();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
  fireEvent.change(screen.getByPlaceholderText('Type or use the microphone...'), { target: { value: 'Keep this answer' } });
  openOtjh();
  first.unmount();
  view();
  await waitFor(() => expect(screen.getByLabelText('Actual time spent (hours)')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /^Learning$/ }));
  expect(screen.getByPlaceholderText('Type or use the microphone...')).toHaveValue('Keep this answer');
});
