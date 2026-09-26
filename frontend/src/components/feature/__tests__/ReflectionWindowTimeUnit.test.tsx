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
