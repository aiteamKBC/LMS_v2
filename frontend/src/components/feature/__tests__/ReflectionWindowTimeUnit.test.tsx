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

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const view = (props: Partial<Parameters<typeof ReflectionWindow>[0]> = {}) => render(
  <ReflectionWindow
    learnerKsbs={[]} elapsedSeconds={3} plannedTimeLabel="60 minutes" plannedHours={1}
    submitting={false} submitError={null} onSubmit={vi.fn()}
    learnerKind="apprenticeship" learnerId="learner-1" evidenceSectionRef="quiz-1" {...props}
  />,
);
const openOtjh = () => fireEvent.click(screen.getByRole('button', { name: 'OTJH' }));

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
  expect(screen.getByLabelText('Selected activity time')).toHaveAttribute('readonly');
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
