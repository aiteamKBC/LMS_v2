import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentSubmissionWizard } from './AssignmentSubmissionWizard';
import { checkMonthlyAssignment, emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { loadLearningReflectionSubmission, saveLearningReflectionSubmission } from '@/api/reflectionSubmission';

vi.mock('./page', () => ({ InlineAttachmentPreview: ({ url }: { url: string }) => <div data-testid="question-preview" data-url={url}>Question preview</div> }));

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
  it('seeds a new submission with its Training Plan month', async () => {
    render(<AssignmentSubmissionWizard {...props} initialMonth="2026-03" />);
    await screen.findByText('Stage 1 of 4');
    expect(screen.getByLabelText('Submission month')).toHaveValue('2026-03');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveLearningReflectionSubmission).toHaveBeenCalledWith(expect.objectContaining({
      monthlyAssignment: expect.objectContaining({ month: '2026-03' }),
    })));
  });

  it('preserves the saved month when opened from a different Training Plan month', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ status: 'draft',
      monthlyAssignment: emptyMonthlyAssignment([], '2026-04'),
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} initialMonth="2026-03" />);
    await screen.findByText('Stage 2 of 4');
    expect(screen.getByLabelText('Submission month')).toHaveValue('2026-04');
  });

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
    await screen.findByRole('heading', { name: 'What you need to do' });
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
  it('starts with the task and lets an incomplete answer move forward as a draft', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByText('Stage 1 of 4');
    expect(screen.queryByLabelText(/Your answer \(/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Stage 2 of 4');
    expect(screen.getByLabelText(/Your answer \(/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByRole('heading', { name: 'Supporting evidence (optional)' });
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
    expect(screen.getByText('Part 6 of 6. You can save and return at any time.')).toBeInTheDocument();
    expect(props.onRestoreTime).toHaveBeenCalledWith(28800, 'timer');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveLearningReflectionSubmission).toHaveBeenCalled());
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls[0][0].monthlyAssignment).toEqual(monthly);
  });

  it('takes saved action-plan drafts to the meeting before the final checks without renumbering saved sections', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ status: 'draft',
      monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step: 5 },
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Stage 3 of 4');
    expect(checkMonthlyAssignment).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Submit assignment' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Stage 4 of 4');
    await waitFor(() => expect(checkMonthlyAssignment).toHaveBeenCalledOnce());
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.map(([value]) => value.monthlyAssignment?.step)).toEqual([5, 7]);
    expect(vi.mocked(checkMonthlyAssignment).mock.calls[0][0]).toEqual(expect.objectContaining({ monthlyAssignment: expect.objectContaining({ step: 6 }) }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Stage 3 of 4')).toBeInTheDocument();
  });

  it.each([6, 7])('restores persisted section %i to its original content', async step => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ status: 'draft',
      monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step },
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByText(`Stage ${step === 6 ? 4 : 3} of 4`);
    if (step === 6) {
      await waitFor(() => expect(checkMonthlyAssignment).toHaveBeenCalledOnce());
      expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeInTheDocument();
    } else {
      expect(screen.getByRole('button', { name: 'Generate full-month presentation' })).toBeInTheDocument();
      expect(checkMonthlyAssignment).not.toHaveBeenCalled();
    }
  });

  it('keeps the learner on the current part when Save and continue fails', async () => {
    vi.mocked(saveLearningReflectionSubmission).mockRejectedValueOnce(new Error('Could not save your draft. Please try again.'));
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Stage 1 of 4')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Your answer \(/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await screen.findByText('Stage 2 of 4');
  });

  it('takes a failed check directly to the relevant work and checks again on return', async () => {
    vi.mocked(checkMonthlyAssignment).mockResolvedValueOnce([
      { key: 'hours', label: 'Record your learning hours', passed: false },
      ...Array.from({ length: 12 }, (_, i) => ({ key: String(i), label: `Check ${i}`, passed: true })),
    ]);
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check & submit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add your learning hours' }));
    expect(screen.getByLabelText('Part of your work')).toHaveValue('2');
    expect(screen.getByText('Automatic timer')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Check & submit' }));
    await waitFor(() => expect(checkMonthlyAssignment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeEnabled());
  });

  it('uses the compact stage selector with the same work, meeting and final-check navigation', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    const selector = await screen.findByRole('combobox', { name: 'Assignment stage' });
    expect(selector).toHaveValue('0');
    fireEvent.change(selector, { target: { value: '1' } });
    expect(screen.getByLabelText(/Your answer \(/)).toBeVisible();
    expect(screen.getByText('Stage 2 of 4')).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: '2' } });
    expect(screen.getByRole('button', { name: 'Generate full-month presentation' })).toBeInTheDocument();
    expect(checkMonthlyAssignment).not.toHaveBeenCalled();
    fireEvent.change(selector, { target: { value: '3' } });
    await waitFor(() => expect(checkMonthlyAssignment).toHaveBeenCalledOnce());
    expect(screen.getByText('Stage 4 of 4')).toBeInTheDocument();
    expect(selector).toHaveValue('3');
  });

  it('keeps the original eight-section navigation for historical records', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ status: 'accepted', submissionOrigin: 'imported_legacy',
      monthlyAssignment: { ...emptyMonthlyAssignment([], '2025-09'), step: 5 },
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} historicalReadOnly />);
    await screen.findByText('Step 6 of 8 — Action plan & EPA');
    expect(screen.queryByRole('navigation', { name: 'Assignment stages' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Step 7 of 8 — Quality checks');
    expect(checkMonthlyAssignment).not.toHaveBeenCalled();
    expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
  });

  it('does not overwrite a saved assignment when loading fails', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockRejectedValue(new Error('Server unavailable'));
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByText('Server unavailable');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare your work' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare your work' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Check & submit' }));
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));
    await screen.findByRole('heading', { name: 'Assignment submitted' });
    expect(screen.getByText('Your assignment has been sent to your coach. You are now waiting for their review.')).toBeVisible();
    expect(screen.queryByText('Submission preview')).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose Submit assignment to send/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Submitted .*Europe\/London/)).not.toBeInTheDocument();
    expect(props.onSubmitProgress).toHaveBeenCalledOnce();
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.every(([payload]) => payload.submissionMode === 'draft')).toBe(true);
    expect(sessionStorage.getItem('monthly-assignment-draft:commercial:1:COMP-1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View submission' }));
    expect(await screen.findByText('Submission preview')).toBeVisible();
  });

  it('displays the recorded submission timestamp in London time', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ status: 'submitted_for_tutor_review', submittedAt: '2026-09-14T14:30:00+00:00',
      monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step: 6 },
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} />);
    expect(await screen.findByText('Submitted 14 September 2026 at 15:30 (Europe/London)')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Submit assignment' })).toBeNull();
    expect(checkMonthlyAssignment).not.toHaveBeenCalled();
  });

  it('does not invent a timezone for an ambiguous saved timestamp', async () => {
    vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ status: 'submitted_for_tutor_review', submittedAt: '2026-09-14T14:30:00',
      monthlyAssignment: emptyMonthlyAssignment([], '2026-09'),
    } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByRole('heading', { name: 'Assignment submitted' });
    expect(screen.queryByText(/Submitted .*Europe\/London/)).toBeNull();
  });

  it('does not submit when the final validation returns an incomplete check set', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check & submit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    vi.mocked(checkMonthlyAssignment).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));
    await screen.findByText(/Complete the outstanding checks/);
    expect(props.onSubmitProgress).not.toHaveBeenCalled();
    expect(screen.queryByText('Submission preview')).not.toBeInTheDocument();
  });

  it('discards previously passed checks when revalidation fails, and can retry', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check & submit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    vi.mocked(checkMonthlyAssignment).mockRejectedValueOnce(new Error('Validation service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Validation service unavailable');
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
  });
});


it('previews a question attachment inside the answer step without downloading it', async () => {
  render(<AssignmentSubmissionWizard {...props} questionText="" questionFileUrl="/curriculum_api/curriculum/uploads/brief.pdf" questionFileName="brief.pdf" />);
  expect(await screen.findByText('Preview the attached file for your assignment question.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'View file' }));
  expect(await screen.findByTestId('question-preview')).toHaveAttribute('data-url', '/curriculum_api/curriculum/uploads/brief.pdf');
  expect(screen.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true');
});
