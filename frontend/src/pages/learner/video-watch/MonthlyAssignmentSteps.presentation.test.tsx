import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyMonthlyAssignment, type MonthlyAssignment } from '@/api/monthlyAssignment';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { MonthlyAssignmentSteps } from './MonthlyAssignmentSteps';

vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn().mockResolvedValue({ activityFeed: [] }) }));
vi.mock('@/api/extraActivities', () => ({ useExtraActivities: () => ({ activities: [], loading: false, error: '' }) }));
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
function Harness({ initial = source, step = 6, historical = false, disabled = false }: { initial?: MonthlyAssignment; step?: number; historical?: boolean; disabled?: boolean }) {
  const [data, onChange] = useState(initial);
  const props: ComponentProps<typeof MonthlyAssignmentSteps> = {
    step, data, onChange, historical, disabled, kind: 'commercial', learnerId: '1', activityId: 'C1', title: 'Monthly assignment',
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
