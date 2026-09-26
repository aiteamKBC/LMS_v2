vi.mock('@/api/extraActivities', () => ({ useExtraActivities: () => ({ activities: [], loading: false, error: '', refresh: vi.fn() }) }));
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentSubmissionWizard } from './AssignmentSubmissionWizard';
import { checkMonthlyAssignment, emptyMonthlyAssignment } from '@/api/monthlyAssignment';
import { loadLearningReflectionSubmission, saveLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { fetchLearnerCalendarEvents } from '@/api/learnerCalendar';

vi.mock('./page', () => ({ InlineAttachmentPreview: ({ url }: { url: string }) => <div data-testid="question-preview" data-url={url}>Question preview</div> }));

vi.mock('@/api/reflectionSubmission', () => ({
  loadLearningReflectionSubmission: vi.fn(), saveLearningReflectionSubmission: vi.fn(),
}));
vi.mock('@/components/feature/AssignmentEvidence', () => ({ AssignmentEvidence: () => <div>Evidence uploader</div> }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn().mockResolvedValue({ ksbs: [], activityFeed: [] }) }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn().mockResolvedValue({ events: [], bookingCalendar: { coveredYears: [2026], bankHolidays: [] } }), bookLearnerCalendarSession: vi.fn() }));
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
  vi.mocked(checkMonthlyAssignment).mockResolvedValue(['answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours', 'reflection', 'benefit', 'impact', 'action', 'meeting', 'presentation'].map(key => ({ key, label: `Check ${key}`, passed: true })));
});
afterEach(async () => {
  cleanup();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function enterTopicTime() {
  fireEvent.click(await screen.findByRole('button', { name: /KSBs & hours claimed/ }));
  fireEvent.change(screen.getByLabelText('Topic 1'), { target: { value: 'Research' } });
  fireEvent.change(screen.getByLabelText('Hours 1'), { target: { value: '3.5' } });
  const month = (screen.getByLabelText('Submission month') as HTMLInputElement).value;
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date 1' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Date 1' }));
  fireEvent.click(screen.getByRole('button', { name: `${month}-15` }));
}

const learningDeclarations = [
  /I have reviewed the planned hours/,
  /This activity developed new knowledge/,
  /This activity developed new skills or behaviours/,
  /If I include evidence, my employer accepts sharing/,
];

function confirmLearning() {
  for (const name of learningDeclarations) fireEvent.click(screen.getByRole('checkbox', { name }));
}
describe('monthly assignment drafts', () => {
  it('shows the personal booking exemption while keeping presentation and validation', async () => {
    render(<AssignmentSubmissionWizard {...props} learnerId="pl.7.study.MOD-A" />);
    fireEvent.click(await screen.findByRole('button', { name: /Presentation/ }));
    expect(screen.getByText('Step 8 of 8 — Presentation')).toBeVisible();
    expect(screen.getByText(/Coaching booking is not required for personal learning/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recheck submission requirements' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export PowerPoint (.pptx)' })).toBeVisible();
    expect(fetchLearnerCalendarEvents).not.toHaveBeenCalled();
  });

  it('keeps the normal coaching step when previewing the learner experience', async () => {
    render(<AssignmentSubmissionWizard {...props} learnerId="pl.7.preview.MOD-A" />);
    fireEvent.click(await screen.findByRole('button', { name: /Coaching & presentation/ }));
    expect(screen.getByText(/Preview does not create coaching bookings/)).toBeVisible();
    expect(screen.queryByText(/Coaching booking is not required/)).not.toBeInTheDocument();
    expect(fetchLearnerCalendarEvents).not.toHaveBeenCalled();
  });

  describe.each([
    ['commercial', false], ['commercial', true],
    ['apprenticeship', false], ['apprenticeship', true],
  ] as const)('quality navigation for %s learners (passed: %s)', (kind, passed) => {
    const destinations = [
      ['answer', 1, /Your answer/], ['learning', 1, /Your learning statements/],
      ['evidence', 2, /Evidence & cross-referencing/], ['ksbs', 3, /Your KSB claims/],
      ['planned', 3, /reviewed the planned hours/], ['declarations', 3, /developed new knowledge/],
      ['hours', 3, /Your learning time/], ['reflection', 4, /Reflect on your LMS activities/],
      ['benefit', 5, /employer has benefited/], ['impact', 5, /Impact on your career/],
      ['action', 6, /Your action plan for next month/], ['meeting', 7, /Coaching & presentation/],
      ['presentation', 7, /Prepare your presentation/],
    ] as const;
    it.each(destinations)('opens %s in step %s and preserves answers', async (key, stepNumber, text) => {
      // Keep automatic draft generation local while exercising the real step UI.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      vi.mocked(checkMonthlyAssignment).mockResolvedValue(destinations.map(([key]) => ({ key, label: `Review ${key}`, passed })));
      render(<AssignmentSubmissionWizard {...props} kind={kind} />);
      fireEvent.change(await screen.findByLabelText(/Your answer \(/), { target: { value: 'My unfinished answer stays here.' } });
      const user = userEvent.setup();
      fireEvent.click(screen.getByRole('button', { name: /Quality checks/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
      const button = await screen.findByRole('button', { name: new RegExp(`Review ${key}.*Go to Step ${stepNumber}`) });
      expect(button).toHaveClass(passed ? 'bg-emerald-50' : 'bg-amber-50');
      button.focus();
      await user.keyboard(key === 'learning' ? ' ' : '{Enter}');
      expect(screen.getByText(new RegExp(`Step ${stepNumber} of 8`))).toBeInTheDocument();
      expect(document.activeElement).toHaveTextContent(text);
      expect(document.activeElement).toHaveAttribute('data-quality-target', key);
      fireEvent.click(screen.getByRole('button', { name: /Assignment answer/ }));
      expect(screen.getByLabelText(/Your answer \(/)).toHaveValue('My unfinished answer stays here.');
      expect(props.onSubmitProgress).not.toHaveBeenCalled();
    });
  });

  it('seeds a new submission with its Training Plan month', async () => {
    render(<AssignmentSubmissionWizard {...props} initialMonth="2026-03" />);
    await screen.findByText('Step 1 of 8 — Assignment answer');
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
    await screen.findByText('Step 1 of 8 — Assignment answer');
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
  it('blocks Next for an incomplete answer while allowing draft saving', async () => {
    vi.mocked(checkMonthlyAssignment).mockResolvedValue([{ key: 'answer', label: 'Assignment answer: at least 120 words', passed: false }, { key: 'learning', label: 'Learning statements: 20 words each', passed: false }]);
    render(<AssignmentSubmissionWizard {...props} />);
    await screen.findByText('Step 1 of 8 — Assignment answer');
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await screen.findByText('Complete the following before selecting Next:');
    expect(screen.getByRole('button', { name: /^Next/ })).toBeDisabled();
    expect(screen.getByText('Step 1 of 8 — Assignment answer')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveLearningReflectionSubmission).toHaveBeenCalled());
    const saved = vi.mocked(saveLearningReflectionSubmission).mock.calls[0][0];
    expect(saved.submissionMode).toBe('draft');
    expect(saved.monthlyAssignment?.version).toBe(2);
    expect(saved.assignmentAnswer).toBe('');
    expect(saved.actualTimeHours).toBe('');
    expect(saved.monthlyAssignment?.timeEntries).toEqual([]);
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
    await enterTopicTime();
    confirmLearning();
    fireEvent.click(await screen.findByRole('button', { name: /Quality checks/ }));
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));
    await screen.findByText('Submission preview');
    expect(props.onSubmitProgress).toHaveBeenCalledOnce();
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.at(-1)?.[0].actualTimeHours).toBe('3.5');
    expect(props.onRestoreTime).toHaveBeenCalledWith(12600, 'input');
    expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.every(([payload]) => payload.submissionMode === 'draft')).toBe(true);
    expect(sessionStorage.getItem('monthly-assignment-draft:commercial:1:COMP-1')).toBeNull();
  });

  it('does not submit when the final validation returns an incomplete check set', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    await enterTopicTime();
    confirmLearning();
    fireEvent.click(await screen.findByRole('button', { name: /Quality checks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    vi.mocked(checkMonthlyAssignment).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit assignment' }));
    await screen.findByText(/Complete the outstanding checks/);
    expect(props.onSubmitProgress).not.toHaveBeenCalled();
    expect(screen.queryByText('Submission preview')).not.toBeInTheDocument();
  });

  it('discards previously passed checks when revalidation fails, and can retry', async () => {
    render(<AssignmentSubmissionWizard {...props} />);
    await enterTopicTime();
    confirmLearning();
    fireEvent.click(await screen.findByRole('button', { name: /Quality checks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).not.toBeDisabled());
    vi.mocked(checkMonthlyAssignment).mockRejectedValueOnce(new Error('Validation service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
    await screen.findByText('Validation service unavailable');
    expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
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

it.each(['commercial', 'apprenticeship'] as const)('requires every learning declaration for %s submission even when server checks pass', async kind => {
  render(<AssignmentSubmissionWizard {...props} kind={kind} initialMonth="2026-09" />);
  await enterTopicTime();
  confirmLearning();
  fireEvent.click(screen.getByRole('button', { name: /Quality checks/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeEnabled());

  for (const name of learningDeclarations) {
    fireEvent.click(screen.getByRole('button', { name: /KSBs & hours claimed/ }));
    fireEvent.click(screen.getByRole('checkbox', { name }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Quality checks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
    await screen.findByText('13/13 checks passed at last check');
    const submit = screen.getByRole('button', { name: 'Submit assignment' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription('Confirm all four learning declarations in Step 3 before submitting your assignment.');
    fireEvent.click(submit);
    expect(props.onSubmitProgress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /KSBs & hours claimed/ }));
    expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name }));
    fireEvent.click(screen.getByRole('button', { name: /Quality checks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeEnabled());
  }
});
it.each(['commercial', 'apprenticeship'] as const)('places coaching before final quality checks for %s learners', async kind => {
  render(<AssignmentSubmissionWizard {...props} kind={kind} initialMonth="2026-09" />);
  fireEvent.click(await screen.findByRole('button', { name: /Coaching & presentation/ }));
  expect(screen.getByText('Step 7 of 8 — Coaching & presentation')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit assignment' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: /^Next/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
  expect(await screen.findByText('Step 8 of 8 — Quality checks')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Run quality checks' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('Step 7 of 8 — Coaching & presentation')).toBeVisible();
  expect(props.onSubmitProgress).not.toHaveBeenCalled();
});

it('restores and saves an uploaded presentation without requiring generated slides', async () => {
  const monthly = { ...emptyMonthlyAssignment([], '2026-09'), step: 6, uploadedPresentation: { id: 'file-mcm', name: 'My MCM.pptx' } };
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ monthlyAssignment: monthly, status: 'draft' } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
  render(<AssignmentSubmissionWizard {...props} initialMonth="2026-09" />);
  expect(await screen.findByText('My MCM.pptx')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed the slides and they accurately represent my own work.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(saveLearningReflectionSubmission).toHaveBeenCalledWith(expect.objectContaining({
    evidenceFiles: ['My MCM.pptx'],
    monthlyAssignment: expect.objectContaining({ uploadedPresentation: monthly.uploadedPresentation, presentationReviewed: true, slides: [] }),
  })));
});


it.each(['commercial', 'apprenticeship'] as const)('requires fresh checks when revising a rejected %s submission and after editing', async kind => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
    id: 'rejected-original', status: 'rejected', assignmentAnswer: 'Original submitted answer',
    monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step: 7, meetingKey: 'existing-mcm' },
  } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
  render(<AssignmentSubmissionWizard {...props} kind={kind} />);
  await screen.findByText(/Run quality checks again for this revised submission/);
  expect(screen.getByText('Quality checks not run yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await screen.findByText('13/13 checks passed at last check');
  fireEvent.click(screen.getByRole('button', { name: /Check answer/ }));
  const answer = screen.getByDisplayValue('Original submitted answer');
  fireEvent.change(answer, { target: { value: 'Corrected submitted answer' } });
  fireEvent.click(screen.getByRole('button', { name: /Quality checks/ }));
  expect(screen.getByText('Quality checks not run yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await screen.findByText('13/13 checks passed at last check');
  expect(vi.mocked(checkMonthlyAssignment).mock.calls.at(-1)?.[0]).toMatchObject({
    assignmentAnswer: 'Corrected submitted answer', monthlyAssignment: { meetingKey: 'existing-mcm' },
  });
});


it('discards in-flight quality results if submission data changes before the response', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({
    id: 'revision', status: 'rejected', monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step: 7 },
  } as Awaited<ReturnType<typeof loadLearningReflectionSubmission>>);
  const view = render(<AssignmentSubmissionWizard {...props} />);
  await screen.findByText(/Run quality checks again for this revised submission/);
  let resolveChecks!: (checks: Awaited<ReturnType<typeof checkMonthlyAssignment>>) => void;
  vi.mocked(checkMonthlyAssignment).mockImplementationOnce(() => new Promise(resolve => { resolveChecks = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  view.rerender(<AssignmentSubmissionWizard {...props} outsideWorkingHoursConfirmed />);
  await act(async () => resolveChecks(Array.from({ length: 13 }, (_, i) => ({ key: String(i), label: `Old check ${i}`, passed: true }))));
  expect(screen.getByText('Quality checks not run yet')).toBeInTheDocument();
  expect(screen.queryByText('Old check 0')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Submit assignment' })).toBeDisabled();
});
