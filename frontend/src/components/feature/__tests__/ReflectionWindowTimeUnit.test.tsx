import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/api/reflectionSubmission', () => ({
  loadLearningReflectionSubmission: mocks.load,
  saveLearningReflectionSubmission: mocks.save,
}));
vi.mock('@/api/evidence', () => ({ uploadEvidence: vi.fn() }));
vi.mock('@/api/reflectionVoice', () => ({ proofreadLearningReflection: vi.fn(), transcribeVoiceReflection: vi.fn() }));

import { ReflectionWindow } from '../ReflectionWindow';
import { CompletionValidationError } from '@/lib/completionValidation';

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

const completeLecture = {
  status: 'draft', actualTimeHours: '2', learningReflection: 'Learning '.repeat(100),
  applicationType: 'apply_now', applicationText: 'Apply this learning at work.', selectedBenefits: ['Improved productivity'],
  benefitExplanation: 'Help the team with everyday work.', dateCompleted: '2026-11-10', completedDuringPaidHours: 'yes',
  otjhConfirmed: true, signedDeclaration: true,
};

it.each([['correct', 1200, 8400], ['add', 3000, 10200], ['retry', 1800, 9000]] as const)(
  'offers an explicit %s action on an already submitted reflection and retains lecture hours', async (choice, reflected, total) => {
    mocks.load.mockResolvedValue({ ...completeLecture, status: 'submitted_for_tutor_review',
      lectureReflectionTime: { seconds: 1800, progressEntryId: 10, countedSeconds: 9000, addedAt: 'now' } });
    mocks.save.mockImplementation(async input => ({ status: 'submitted_for_tutor_review', lectureReflectionTime: {
      seconds: reflected, inputSeconds: 1200, progressEntryId: 11, countedSeconds: total,
      operationId: input.reflectionTimeOperation?.id, choice, addedAt: 'now' } }));
    const onSubmit = vi.fn();
    view({ noun: 'session', selectedTimeSeconds: 9000, readOnlyTime: true, allowAdditionalTime: true, initialTab: 'otjh', onSubmit });
    await waitFor(() => expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveValue(30));
    fireEvent.click(screen.getByRole('button', { name: 'Manage reflection time' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Previously recorded reflection time: 00:30:00');
    fireEvent.click(within(dialog).getByRole('radio', { name: choice === 'correct' ? /^Correct recorded time/ : choice === 'add' ? /^Add more learning time/ : /^Record another attempt/ }));
    if (choice === 'correct') fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Correcting the writing duration.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const minutes = screen.getByLabelText(choice === 'add' ? 'Additional reflection time (minutes)' : 'Reflection time for this action (minutes)');
    expect(minutes).not.toHaveAttribute('readonly');
    fireEvent.change(minutes, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm time' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reflectionTimeChoice: choice, additionalReflectionSeconds: 1200 })));
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ reflectionTimeOperation: expect.objectContaining({
      id: expect.any(String), choice, expectedReflectionSeconds: 1800, expectedProgressEntryId: 10 }) }));
    fireEvent.click(screen.getByRole('button', { name: 'OTJH' }));
    expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveValue(reflected / 60);
    expect(screen.getByLabelText('Recorded session time (reference)')).toHaveValue(total === 8400 ? '02:20:00' : total === 9000 ? '02:30:00' : '02:50:00');
  });

it('restores an unsent time action after reopening and discards it when the server revision has changed', async () => {
  const key = 'reflection-draft:apprenticeship:learner-1:session:quiz-1:time-action';
  const operation = { id: '00000000-0000-4000-8000-000000000001', choice: 'add', reason: '', expectedReflectionSeconds: 1800, expectedProgressEntryId: 10 };
  localStorage.setItem(key, JSON.stringify({ operation, minutes: '15' }));
  mocks.load.mockResolvedValue({ ...completeLecture, status: 'submitted_for_tutor_review',
    lectureReflectionTime: { seconds: 1800, progressEntryId: 10, countedSeconds: 9000, addedAt: 'now' } });
  const props = { noun: 'session', selectedTimeSeconds: 9000, readOnlyTime: true, allowAdditionalTime: true, initialTab: 'otjh' as const };
  const rendered = view(props);
  await waitFor(() => expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveValue(15));
  expect(screen.getByLabelText('Additional reflection time (minutes)')).not.toHaveAttribute('readonly');
  expect(JSON.parse(localStorage.getItem(key)!).operation.id).toBe(operation.id);
  rendered.unmount();
  mocks.load.mockResolvedValue({ ...completeLecture, status: 'submitted_for_tutor_review',
    lectureReflectionTime: { seconds: 2700, progressEntryId: 11, countedSeconds: 9900, addedAt: 'now' } });
  view(props);
  await waitFor(() => expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveValue(45));
  expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveAttribute('readonly');
  expect(localStorage.getItem(key)).toBeNull();
});

it('adds only explicitly entered reflection minutes and confirms them without editing lecture time', async () => {
  mocks.load.mockResolvedValue(completeLecture);
  const receipt = { seconds: 1800, progressEntryId: 10, addedAt: '2026-11-10T12:00:00Z', countedSeconds: 9000 };
  mocks.save.mockImplementation(async payload => ({ status: payload.submissionMode === 'submit' ? 'submitted_for_tutor_review' : 'draft', lectureReflectionTime: payload.submissionMode === 'submit' ? receipt : undefined }));
  const onSubmit = vi.fn();
  view({ noun: 'session', selectedTimeSeconds: 7200, readOnlyTime: true, allowAdditionalTime: true, onSubmit });
  openOtjh();
  const reference = await screen.findByLabelText('Recorded session time (reference)');
  await waitFor(() => expect(reference).toHaveValue('02:00:00'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add more learning time for this reflection' }));
  fireEvent.change(screen.getByLabelText('Additional reflection time (minutes)'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('0 hours and 30 minutes');
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ additionalReflectionSeconds: 1800 })));
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ submissionMode: 'submit', additionalReflectionSeconds: 1800, actualTimeHours: '2' }));
  fireEvent.click(screen.getByRole('button', { name: 'OTJH' }));
  expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveAttribute('readonly');
  expect(screen.getByText(/Saving this reflection again will not add them twice/)).toBeVisible();
});

it('restores credited reflection time as read only and does not confuse it with lecture time', async () => {
  mocks.load.mockResolvedValue({ ...completeLecture, status: 'submitted_for_tutor_review',
    additionalReflectionSeconds: 1800, lectureReflectionTime: { seconds: 1800, progressEntryId: 10, countedSeconds: 9000, addedAt: 'now' } });
  view({ noun: 'session', selectedTimeSeconds: 9000, readOnlyTime: true, allowAdditionalTime: true });
  openOtjh();
  await waitFor(() => expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveValue(30));
  expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Recorded session time (reference)')).toHaveValue('02:30:00');
  expect(screen.getByRole('checkbox', { name: 'Add more learning time for this reflection' })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('shows the confirmed total when a linked live card carries zero session hours', async () => {
  mocks.load.mockResolvedValue({ ...completeLecture, status: 'submitted_for_tutor_review', actualTimeHours: '0',
    additionalReflectionSeconds: 1800, lectureReflectionTime: { seconds: 1800, progressEntryId: 10, countedSeconds: 10800, addedAt: 'now' } });
  view({ noun: 'session', selectedTimeSeconds: 0, readOnlyTime: true, allowAdditionalTime: true });
  openOtjh();
  await waitFor(() => expect(screen.getByLabelText('Recorded session time (reference)')).toHaveValue('03:00:00'));
  expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveValue(30);
  expect(screen.getByLabelText('Additional reflection time (minutes)')).toHaveAttribute('readonly');
});

it('keeps an unavailable lecture duration distinct from zero and blocks invalid additional time', async () => {
  mocks.load.mockResolvedValue(completeLecture);
  view({ noun: 'session', readOnlyTime: true, allowAdditionalTime: true });
  openOtjh();
  await waitFor(() => expect(screen.getByLabelText('Recorded session time (reference)')).toHaveValue('Not recorded'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add more learning time for this reflection' }));
  fireEvent.change(screen.getByLabelText('Additional reflection time (minutes)'), { target: { value: '481' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('button', { name: 'Submit for tutor review' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('480 minutes');
});

it('keeps the reflection and added minutes when the server requests the existing working-time dialog', async () => {
  mocks.load.mockResolvedValue(completeLecture);
  mocks.save.mockImplementation(async payload => {
    if (payload.submissionMode === 'submit') throw new CompletionValidationError('Confirm the working time.', 'outside_working_hours');
    return { status: 'draft' };
  });
  const onSubmit = vi.fn();
  view({ noun: 'session', selectedTimeSeconds: 7200, readOnlyTime: true, allowAdditionalTime: true, onSubmit });
  openOtjh();
  await waitFor(() => expect(screen.getByLabelText('Recorded session time (reference)')).toHaveValue('02:00:00'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Add more learning time for this reflection' }));
  fireEvent.change(screen.getByLabelText('Additional reflection time (minutes)'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm time' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ additionalReflectionSeconds: 1800 }));
});

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
  expect(field).toHaveAccessibleDescription('Enter minutes. For 30 minutes, enter 30.');
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
  const field = await screen.findByLabelText('Actual time spent (hours)');
  expect(field).toHaveValue(1);
  expect(field).toHaveAccessibleDescription('Enter hours. For 30 minutes, enter 0.5; for 1 hour 30 minutes, enter 1.5.');
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
  expect(screen.getByLabelText('Selected activity time')).toHaveAccessibleDescription('Format: hours : minutes : seconds. For 30 minutes, enter 00:30:00.');
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


it('keeps a separate lecture reflection time read-only and preserves its saved duration without a new time confirmation', async () => {
  mocks.load.mockResolvedValue({
    status: 'draft', actualTimeHours: '2', reflectionTimeEdited: true, learningReflection: 'Learning '.repeat(100),
    applicationType: 'apply_now', applicationText: 'Use the learning at work.',
    selectedBenefits: ['Improved productivity'], benefitExplanation: 'Improve everyday work.',
    dateCompleted: '2026-10-01', completedDuringPaidHours: 'yes', otjhConfirmed: true, signedDeclaration: true,
  });
  mocks.save.mockResolvedValue({ status: 'submitted_for_tutor_review' });
  const onSubmit = vi.fn();
  view({ noun: 'session', readOnlyTime: true, selectedTimeSeconds: 1200, selectedTimeSource: 'input', onSubmit });
  const time = await screen.findByLabelText('Recorded session time (reference)');
  await waitFor(() => expect(time).toHaveValue('02:00:00'));
  expect(time).toHaveAttribute('readonly');
  expect(time).toHaveAccessibleDescription('Your session time and attendance stay unchanged. This reflection does not add study hours.');
  fireEvent.change(time, { target: { value: '03:00:00' } });
  expect(time).toHaveValue('02:00:00');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
    activityType: 'session', activityId: 'quiz-1', actualTimeHours: '2', reflectionTimeEdited: true, submissionMode: 'submit',
  }));
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
