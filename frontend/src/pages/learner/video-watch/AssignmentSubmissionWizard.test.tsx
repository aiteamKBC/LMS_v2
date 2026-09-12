import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentSubmissionWizard } from './AssignmentSubmissionWizard';
import { checkMonthlyAssignment, emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { loadLearningReflectionSubmission, saveLearningReflectionSubmission } from '@/api/reflectionSubmission';

vi.mock('@/api/reflectionSubmission', () => ({
  loadLearningReflectionSubmission: vi.fn(), saveLearningReflectionSubmission: vi.fn(),
}));
vi.mock('@/components/feature/AssignmentEvidence', () => ({ AssignmentEvidence: () => <div>Evidence uploader</div> }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn().mockResolvedValue({ ksbs: [], activityFeed: [] }) }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn().mockResolvedValue({ events: [] }), bookLearnerCalendarSession: vi.fn() }));
vi.mock('@/api/monthlyAssignment', async importOriginal => ({ ...await importOriginal<typeof import('@/api/monthlyAssignment')>(), checkMonthlyAssignment: vi.fn() }));

const props = {
  kind: 'commercial' as const, learnerId: '1', learnerName: 'Learner', programmeName: 'Programme',
  componentId: 'COMP-1', title: 'Monthly assignment', moduleTitle: 'Module', weekTitle: 'Week 1',
  plannedOtjh: 2, questionText: 'Describe your work.', ksbMappings: [], evidenceFiles: [], evidenceDetails: {},
  timeSeconds: 28800, timeControl: <div>Automatic timer</div>, outsideWorkingHours: false,
  outsideWorkingHoursConfirmed: false, submittingProgress: false,
  onEvidenceChanged: vi.fn(), onRestoreTime: vi.fn(), onSubmitProgress: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue(null);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'submission-1', status: 'draft' });
  vi.mocked(checkMonthlyAssignment).mockResolvedValue(Array.from({ length: 13 }, (_, i) => ({ key: String(i), label: `Check ${i}`, passed: true })));
});
afterEach(async () => {
  cleanup();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  vi.clearAllMocks();
});

describe('monthly assignment drafts', () => {
  it('renders HTML stored in a legacy question field and removes unsafe markup', async () => {
    render(<AssignmentSubmissionWizard {...props} questionText={'<span style="font-size:14px" onclick="alert(1)">What have you learned this month?</span><script>alert(1)</script>'} />);
    const question = await screen.findByText('What have you learned this month?');
    expect(question.tagName).toBe('SPAN');
    expect(question).toHaveStyle({ fontSize: '14px' });
    expect(question).not.toHaveAttribute('onclick');
    expect(question.parentElement?.querySelector('script')).toBeNull();
  });

  it('preserves plain question text with line breaks and comparison symbols', async () => {
    const text = 'Compare results: 2 < 3 and 5 > 4.\nExplain your findings.';
    render(<AssignmentSubmissionWizard {...props} questionText={text} />);
    await screen.findByLabelText(/Your answer \(/);
    expect(screen.getByText(/Compare results/).textContent).toBe(text);
    expect(screen.getByText(/Compare results/)).toHaveClass('whitespace-pre-line');
  });

  it('opens historical originals through their resolver and never saves the imported record', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
      status: 'accepted', submissionOrigin: 'imported_legacy',
      monthlyAssignment: emptyMonthlyAssignment([], '2025-06'),
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    const file = { id: 'legacy:20128:file', filename: 'Original.pdf', status: 'approved', contentType: 'application/pdf',
      sizeBytes: 0, scanResult: null, sectionRef: 'COMP-1', uploadedAt: null, trainingPlanDetails: null };
    const resolveEvidenceUrl = vi.fn().mockResolvedValue('https://example.test/original');
    render(<AssignmentSubmissionWizard {...props} historicalReadOnly evidenceFiles={[file]} resolveEvidenceUrl={resolveEvidenceUrl}
      renderEvidencePreview={(record, url) => <a href={url}>{record.filename} preview</a>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(screen.getAllByText(/Not captured as a separate field/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' }).at(-1)!);
    expect(await screen.findByText('Original.pdf preview')).toHaveAttribute('href', 'https://example.test/original');
    expect(resolveEvidenceUrl).toHaveBeenCalledWith(file);
    cleanup();
    expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
  });
  it('renders eight steps and lets an incomplete answer move forward as a draft', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByText('Step 1 of 8 — Assignment answer');
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await screen.findByText('Step 2 of 8 — Evidence & cross-referencing');
    const saved = vi.mocked(saveLearningReflectionSubmission).mock.calls[0][0];
    expect(saved.submissionMode).toBe('draft');
    expect(saved.monthlyAssignment?.version).toBe(2);
    expect(saved.assignmentAnswer).toBe('');
    expect(saved.actualTimeHours).toBe('8');
    expect(props.onSubmitProgress).not.toHaveBeenCalled();
  });

  it('restores the saved step, all monthly fields and time source', async () => {
    const monthly = { ...emptyMonthlyAssignment(['K1'], '2026-09'), step: 5, actionPlan: 'Continue learning next month.' };
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
      monthlyAssignment: monthly, status: 'draft', assignmentAnswer: 'Saved answer', whatYouLearned: 'Saved learning',
      actualTimeHours: '8', assignmentTimeSource: 'timer',
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByDisplayValue('Continue learning next month.');
    expect(screen.getByText('Step 6 of 8 — Action plan & EPA')).toBeInTheDocument();
    expect(props.onRestoreTime).toHaveBeenCalledWith(28800, 'timer');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveLearningReflectionSubmission).toHaveBeenCalled());
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls[0][0].monthlyAssignment).toEqual(monthly);
  });

  it('does not overwrite a saved assignment when loading fails', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockRejectedValue(new Error('Server unavailable'));
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByText('Server unavailable');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByLabelText(/Your answer \(/)).toBeDisabled();
    cleanup();
    expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
  });

  it('makes preview available for submitted assignments without autosaving them', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
      status: 'submitted_for_tutor_review', assignmentAnswer: 'Previously submitted answer',
      monthlyAssignment: emptyMonthlyAssignment([], '2026-09'), actualTimeHours: '8',
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Submission preview')).toBeInTheDocument();
    expect(screen.getAllByText('Previously submitted answer').length).toBeGreaterThan(0);
    cleanup();
    expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
  });

  it('flushes the last edit on in-app navigation instead of discarding the debounce', async () => {
    const view = render(<AssignmentSubmissionWizard {...props} />);
    const input = await screen.findByLabelText(/Your answer \(/);
    fireEvent.change(input, { target: { value: 'Last unsaved change' } });
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.at(-1)?.[0].assignmentAnswer).toBe('Last unsaved change');
  });

  it('recovers a newer tab-local draft without discarding its extra fields', async () => {
    sessionStorage.setItem('monthly-assignment-draft:commercial:1:COMP-1', JSON.stringify({ at: Date.now(), payload: {
      activityId: 'COMP-1', assignmentAnswer: 'Recovered answer', actualTimeHours: '7',
      monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step: 5, actionPlan: 'Recovered action plan' },
    } }));
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByDisplayValue('Recovered action plan');
    expect(screen.getByText(/Recovered your most recent unsaved changes/)).toBeInTheDocument();
  });

  it('keeps submit locked until checking, then uses the atomic completion endpoint only', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Coaching & presentation/ }));
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck submission requirements' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));
    await screen.findByText('Submission preview');
    expect(props.onSubmitProgress).toHaveBeenCalledOnce();
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.every(([payload]) => payload.submissionMode === 'draft')).toBe(true);
    expect(sessionStorage.getItem('monthly-assignment-draft:commercial:1:COMP-1')).toBeNull();
  });
});
