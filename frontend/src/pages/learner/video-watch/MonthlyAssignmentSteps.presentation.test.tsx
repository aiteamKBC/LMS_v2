import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyMonthlyAssignment, type MonthlyAssignment } from '@/api/monthlyAssignment';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import type { LearnerDetail } from '@/api/learnerDetail';
import { fetchExtraActivities } from '@/api/extraActivities';
import { MonthlyAssignmentSteps } from './MonthlyAssignmentSteps';

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn().mockResolvedValue({ activityFeed: [] }) }));
vi.mock('@/api/extraActivities', () => ({ fetchExtraActivities: vi.fn().mockResolvedValue([]), useExtraActivities: () => ({ activities: [], loading: false, error: '' }) }));
vi.mock('./AssignmentCoachingBooking', () => ({ AssignmentCoachingBooking: () => <div>Booking preserved</div> }));
vi.mock('@/hooks/useAssignedKsbExplanations', () => ({ useAssignedKsbExplanations: () => '' }));
vi.mock('@/hooks/useMonthlyReflections', () => ({ useMonthlyReflections: () => '' }));
vi.mock('@/hooks/useImpactStatements', () => ({ useImpactStatements: () => ({ status: '', phase: 'idle' }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const source = emptyMonthlyAssignment([], '2026-10');
const submission = {
  learnerKind: 'commercial' as const, learnerId: '1', learnerName: 'Synthetic learner', programmeName: 'Programme',
  activityType: 'assignment', activityId: 'C1', activityTitle: 'Monthly assignment', moduleTitle: '', weekTitle: '',
  plannedOtjh: '2', learningReflection: '', ksbCodes: [], ksbWeights: {}, ksbExplanations: {}, confidenceBefore: {}, confidenceAfter: {},
  applicationType: '', applicationText: '', evidenceFiles: [], evidenceConsentConfirmed: false, selectedBenefits: [], benefitExplanation: '',
  actualTimeHours: '2', completedDuringPaidHours: 'yes', dateCompleted: '2026-10-12', otjhConfirmed: false, signedDeclaration: false, qualityScore: 0,
};
function Harness({ initial = source, step = 6, historical = false, disabled = false, learnerId = '1' }: { initial?: MonthlyAssignment; step?: number; historical?: boolean; disabled?: boolean; learnerId?: string }) {
  const [data, onChange] = useState(initial);
  const props: ComponentProps<typeof MonthlyAssignmentSteps> = {
    step, data, onChange, historical, disabled, kind: 'commercial', learnerId, activityId: 'C1', title: 'Monthly assignment',
    question: '<p>Original question</p>', answers: { assignmentAnswer: 'My own answer', whatYouLearned: 'My original learning', businessImpact: 'My original impact' },
    onAnswer: vi.fn(), plannedOtjh: null, mappings: [], evidenceFiles: [], evidenceUploader: null, timeControl: null,
    payload: () => ({ ...submission, monthlyAssignment: data }), checks: [], checking: false, onCheck: vi.fn(), onSave: vi.fn(),
  };
  return <><MonthlyAssignmentSteps {...props} /><output data-testid="saved">{JSON.stringify(data)}</output></>;
}
const saved = () => JSON.parse(screen.getByTestId('saved').textContent || '{}') as MonthlyAssignment;

it('generates a branded draft with editable source notes, preserving hours, template and selected upload', async () => {
  const initial = { ...source, timeEntries: [{ topic: 'Research', hours: '2', date: '2026-10-12' }],
    uploadedPresentation: { id: 'own', name: 'own.pptx' }, presentationDesign: { name: 'My reference', evidenceId: 'ref', font: 'Calibri', accent: '51258B', ratio: 16 / 9 } };
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate full-month presentation' }));
  await screen.findByText(/8 slides in this presentation/);
  expect(saved()).toMatchObject({ timeEntries: initial.timeEntries, presentationDesign: initial.presentationDesign, uploadedPresentation: initial.uploadedPresentation, presentationFormat: 'kbc-mcm-v2' });
  expect(saved().slides).toHaveLength(8);
  expect(saved().slides[2].notes).toContain('My own answer');
  expect(fetchLearnerDetail).toHaveBeenCalledWith('commercial', '1', { force: true });
  fireEvent.click(screen.getByRole('button', { name: 'Use generated slides for submission' }));
  expect(saved().uploadedPresentation).toBeUndefined();
  expect(screen.getByText(/uploaded file remains in your evidence library/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Speaker notes for slide 3'), { target: { value: 'My edited full account' } });
  expect(saved().slides[2].notes).toBe('My edited full account');
  expect(saved().presentationReviewed).toBe(false);
  expect(saved().presentationToken).toBe('');
  fireEvent.change(screen.getAllByLabelText('Content')[2], { target: { value: '' } });
  expect(saved().slides[2].body).toBe('');
  expect(saved().slides[2].notes).toBe('My edited full account');
});

it('cancelled regeneration retains manual content, notes and reviewed token', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const initial: MonthlyAssignment = { ...source, presentationFormat: 'kbc-mcm-v1', slides: [{ title: 'My edit', body: 'My content', notes: 'My notes' }], presentationReviewed: true, presentationToken: 'saved-token' };
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate full-month presentation' }));
  expect(saved()).toEqual(initial);
  expect(fetchLearnerDetail).not.toHaveBeenCalled();
});

it.each([{ step: 6, historical: true }, { step: 6, disabled: true }, { step: 7 }])('does not repair saved content outside an editable presentation step: %o', props => {
  const initial: MonthlyAssignment = { ...source, slides: [{ title: 'Full-month reflection', body: '' }], lmsReflection: 'Original reflection', presentationReviewed: true, presentationToken: 'original' };
  render(<Harness initial={initial} {...props} />);
  expect(saved()).toEqual(initial);
});

it('repairs a legacy empty generated section on presentation step 6 without replacing another manual slide', async () => {
  const initial: MonthlyAssignment = { ...source, slides: [{ title: 'Full-month reflection', body: '' }, { title: 'My edit', body: 'Keep my content' }], lmsReflection: 'Original reflection' };
  render(<Harness initial={initial} />);
  await waitFor(() => expect(saved().slides[0].body).toContain('Original reflection'));
  expect(saved().slides[1].body).toBe('Keep my content');
  expect(saved().presentationFormat).toBeUndefined();
});

it('uses the completed records shown in Full-month reflection when generating the presentation', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce({ activityFeed: [], componentProgress: [{
    componentId: 'reading', componentTitle: 'Completed monthly reading', submittedAt: '2026-10-12T10:00:00Z',
    feedback: 'Full completed reading reflection.', ksbs: ['K1'], reportedTime: '20 minutes',
  }] } as unknown as LearnerDetail);
  const view = render(<Harness step={3} />);
  expect(await screen.findByText('Completed monthly reading')).toBeVisible();
  expect(screen.getByText('K1')).toBeVisible();
  expect(screen.getByText('20 minutes')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Read more about Completed monthly reading' }));
  expect(screen.getAllByText('Full completed reading reflection.').length).toBeGreaterThan(0);
  view.unmount();
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce({ activityFeed: [], componentProgress: [{
    componentId: 'reading', componentTitle: 'Completed monthly reading', submittedAt: '2026-10-12T10:00:00Z',
    feedback: 'Full completed reading reflection.', ksbs: ['K1'], reportedTime: '20 minutes',
  }] } as unknown as LearnerDetail);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate full-month presentation' }));
  await waitFor(() => expect(saved().slides.length).toBeGreaterThan(0));
  expect(saved().slides.map(s => s.body).join(' ').replace(/\s+/g, ' ')).toContain('Full completed reading reflection.');
  expect(fetchExtraActivities).toHaveBeenCalledWith('commercial', '1', '2026-10');
});

it('preserves the existing deck if the current month extra activities cannot be loaded', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(fetchExtraActivities).mockRejectedValueOnce(new Error('Monthly activities unavailable'));
  const initial: MonthlyAssignment = { ...source, presentationFormat: 'kbc-mcm-v2', slides: [{ title: 'Saved', body: 'Keep my content' }], presentationReviewed: true, presentationToken: 'saved' };
  render(<Harness initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate full-month presentation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Monthly activities unavailable');
  expect(saved()).toEqual(initial);
});

it('does not show the previous learner activities while another learner is loading', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValueOnce({ activityFeed: [], componentProgress: [{
    componentId: 'reading', componentTitle: 'First learner reading', submittedAt: '2026-10-12T10:00:00Z',
  }] } as unknown as LearnerDetail);
  const view = render(<Harness step={3} />);
  expect(await screen.findByText('First learner reading')).toBeVisible();
  vi.mocked(fetchLearnerDetail).mockImplementationOnce(() => new Promise(() => {}));
  view.rerender(<Harness step={3} learnerId="2" />);
  expect(screen.queryByText('First learner reading')).not.toBeInTheDocument();
  expect(fetchLearnerDetail).toHaveBeenLastCalledWith('commercial', '2', { revalidate: true });
});
