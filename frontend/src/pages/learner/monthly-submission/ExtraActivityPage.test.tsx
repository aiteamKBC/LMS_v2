import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import ExtraActivityPage, { ExtraActivityForm } from './ExtraActivityPage';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { fetchEvidence } from '@/api/evidence';
import type { EvidenceRecord, UploadEvidenceResult } from '@/api/evidence';
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: vi.fn() }));
const mockUpload = vi.hoisted(() => ({ status: 'approved' }));
import { useAuth } from '@/hooks/useAuth';
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
import { loadLearningReflectionSubmission, saveLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { checkMonthlyAssignment, emptyMonthlyAssignment } from '@/api/monthlyAssignment';
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./ExtraActivities', () => ({ ExtraActivities: () => <div>Saved extra activities</div> }));
vi.mock('@/api/extraActivities', () => ({ useExtraActivities: () => ({ activities: [], loading: false, error: '', refresh: vi.fn() }) }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn(), saveLearningReflectionSubmission: vi.fn() }));
vi.mock('@/api/monthlyAssignment', async original => ({ ...await original<typeof import('@/api/monthlyAssignment')>(), checkMonthlyAssignment: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/feature/AssignmentEvidence', () => ({ AssignmentEvidence: ({ readOnly, componentId, onUploadCompleted, onUploaded }: {
  readOnly: boolean; componentId: string; onUploadCompleted?: (file: UploadEvidenceResult) => void; onUploaded?: (files: EvidenceRecord[]) => void;
}) => <><button disabled={readOnly} onClick={() => onUploadCompleted?.({ id: 'new-evidence', status: mockUpload.status, scanResult: '', filename: 'Synthetic evidence.pdf', sectionRef: componentId })}>Evidence upload</button>
  <button disabled={readOnly} onClick={() => onUploaded?.([])}>Complete evidence scan</button></> }));
vi.mock('@/hooks/useLearnerDetailParam', () => ({ useLearnerDetailParam: () => ({ real: { name: 'Example learner', programme: 'Example programme' } }) }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn().mockResolvedValue({ ksbs: [], activityFeed: [] }) }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn().mockResolvedValue({ events: [], bookingCalendar: { coveredYears: [2026], bankHolidays: [] } }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.mocked(useResolvedLearner).mockReturnValue({ kind: 'commercial', id: '101' } as ReturnType<typeof useResolvedLearner>);
  vi.mocked(fetchEvidence).mockReset().mockResolvedValue([]);
  vi.mocked(loadLearningReflectionSubmission).mockReset();
  mockUpload.status = 'approved';
  vi.mocked(useAuth).mockReturnValue({ auth: { account: null }, isInitialized: true } as ReturnType<typeof useAuth>);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'submitted_for_tutor_review' });
  vi.mocked(checkMonthlyAssignment).mockResolvedValue(['title', 'answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours'].map(key => ({ key, label: key, passed: true })));
});

function CurrentRoute() { const location = useLocation(); return <output data-testid="route">{location.pathname}{location.search}</output>; }

it.each(['commercial', 'apprenticeship'] as const)('reopens the same saved %s activity after refreshing its URL', async kind => {
  vi.mocked(useResolvedLearner).mockReturnValue({ kind, id: '101' } as ReturnType<typeof useResolvedLearner>);
  const records = new Map<string, StoredLearningReflectionSubmission>();
  vi.mocked(saveLearningReflectionSubmission).mockImplementation(async payload => {
    records.set(payload.activityId, { ...payload, status: 'draft' } as unknown as StoredLearningReflectionSubmission);
    return { id: 'record', status: 'draft' };
  });
  vi.mocked(loadLearningReflectionSubmission).mockImplementation(async input => records.get(input.activityId) || null);
  const view = render(<MemoryRouter initialEntries={['/learner/extra-activities?keep=yes']}><ExtraActivityPage /><CurrentRoute /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'View saved activities and continue a draft' })).toHaveAttribute('href', '#saved-extra-activities');
  expect(screen.getByRole('region', { name: 'Saved activities' })).toHaveAttribute('id', 'saved-extra-activities');
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Keep this workshop' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('activity='));
  const route = screen.getByTestId('route').textContent!;
  expect(route).toContain('keep=yes');
  expect(new URL(route, 'https://synthetic.invalid').searchParams.get('activity')).toBe([...records.keys()][0]);
  expect(loadLearningReflectionSubmission).not.toHaveBeenCalled();
  view.unmount();
  render(<MemoryRouter initialEntries={[route]}><ExtraActivityPage /></MemoryRouter>);
  expect(await screen.findByDisplayValue('Keep this workshop')).toBeVisible();
  expect(records.size).toBe(1);
});

it('keeps newer edits while the first saved activity is added to its URL, and starts another only on request', async () => {
  let finish!: (value: { id: string; status: string }) => void;
  vi.mocked(saveLearningReflectionSubmission).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ id: 'record', status: 'draft' });
  render(<MemoryRouter><ExtraActivityPage /><CurrentRoute /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Earlier edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Newer edit' } });
  await act(async () => { finish({ id: 'record', status: 'draft' }); });
  expect(screen.getByLabelText('Activity title')).toHaveValue('Newer edit');
  expect(loadLearningReflectionSubmission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  const firstId = vi.mocked(saveLearningReflectionSubmission).mock.calls[0][0].activityId;
  expect(vi.mocked(saveLearningReflectionSubmission).mock.calls[1][0]).toMatchObject({ activityId: firstId, activityTitle: 'Newer edit' });
  fireEvent.click(screen.getByRole('button', { name: 'New activity' }));
  expect(screen.getByLabelText('Activity title')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Another activity' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.at(-1)![0].activityId).not.toBe(firstId);
});

it('attaches only a new upload after approval and respects an explicit removal', async () => {
  const activityId = 'extra:00000000-0000-4000-8000-000000000001';
  const monthly = { ...emptyMonthlyAssignment([], '2026-10'), timeEntries: [{ topic: 'Research', hours: '2', date: '2026-10-14' }] };
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Saved activity', status: 'draft', monthlyAssignment: monthly } as StoredLearningReflectionSubmission);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'draft' });
  const old = { id: 'old-evidence', sectionRef: activityId, status: 'approved', filename: 'Previously removed.pdf' } as EvidenceRecord;
  vi.mocked(fetchEvidence).mockResolvedValue([old]);
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId={activityId} /></MemoryRouter>);
  await screen.findByDisplayValue('Saved activity');
  fireEvent.click(screen.getByRole('button', { name: '2. Evidence & cross-referencing' }));
  expect(await screen.findByRole('button', { name: 'Attach Previously removed.pdf' })).toBeVisible();
  mockUpload.status = 'pending';
  const uploaded = { ...old, id: 'new-evidence', filename: 'Synthetic evidence.pdf', status: 'pending' };
  vi.mocked(fetchEvidence).mockResolvedValue([old, uploaded]);
  fireEvent.click(screen.getByRole('button', { name: 'Evidence upload' }));
  await screen.findByText(/It will be attached after the upload checks finish/);
  expect(screen.queryByText('Uploaded evidence attached to this activity.')).not.toBeInTheDocument();
  vi.mocked(fetchEvidence).mockResolvedValue([old, { ...uploaded, status: 'approved' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Complete evidence scan' }));
  await screen.findByText('Uploaded evidence attached to this activity.');
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({
    actualTimeHours: '2', evidenceFiles: ['Synthetic evidence.pdf'],
    monthlyAssignment: expect.objectContaining({ evidence: [{ id: 'new-evidence', name: 'Synthetic evidence.pdf', points: '' }], timeEntries: monthly.timeEntries }),
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove from submission' }));
  fireEvent.click(screen.getByRole('button', { name: 'Complete evidence scan' }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({ evidenceFiles: [] }));
});

it('keeps a deleted extra-activity topic removed when switching steps, and retains the activity answers', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Written activity', status: 'draft',
    whatYouLearned: 'Keep my learning', monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-10'),
      timeEntries: [{ topic: 'Accidental topic', hours: '2', date: '2026-10-14' }] },
  } as StoredLearningReflectionSubmission);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'draft' });
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId="extra:00000000-0000-4000-8000-000000000001" /></MemoryRouter>);
  await screen.findByDisplayValue('Written activity');
  fireEvent.click(screen.getByRole('button', { name: '3. KSBs & hours claimed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove topic 1' }));
  fireEvent.click(screen.getByRole('button', { name: '1. Activity answer' }));
  expect(screen.getByDisplayValue('Keep my learning')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '3. KSBs & hours claimed' }));
  expect(screen.queryByLabelText('Topic 1')).not.toBeInTheDocument();
  expect(screen.getByText('Total learning time: 0 hours')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({
    activityTitle: 'Written activity', whatYouLearned: 'Keep my learning', actualTimeHours: '0',
    monthlyAssignment: expect.objectContaining({ timeEntries: [] }),
  }));
});

it('asks before replacing statements and keeps written answers, claims and hours when generation returns blanks', async () => {
  const monthly = { ...emptyMonthlyAssignment([], '2026-10'),
    understood: 'Written understanding', gainedSkills: 'Written skills',
    timeEntries: [{ topic: 'Research', hours: '2', date: '2026-10-14' }],
    claims: [{ code: 'K1', description: 'Synthetic knowledge', explanation: 'Written explanation', evidenceIds: [] }],
  };
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Written activity', status: 'draft',
    assignmentAnswer: 'learning '.repeat(120), whatYouLearned: 'Written knowledge', monthlyAssignment: monthly,
  } as unknown as StoredLearningReflectionSubmission);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'draft' });
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ whatYouLearned: '', understood: ' ', gainedSkills: '' }) });
  vi.stubGlobal('fetch', request);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId="extra:00000000-0000-4000-8000-000000000001" /></MemoryRouter>);
  await screen.findByDisplayValue('Written activity');
  fireEvent.click(screen.getByRole('button', { name: 'Generate learning statements' }));
  expect(confirm).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Generate learning statements' }));
  await screen.findByText(/Your existing answers have been kept/);
  expect(screen.getByDisplayValue('Written knowledge')).toBeVisible();
  expect(screen.getByDisplayValue('Written understanding')).toBeVisible();
  expect(screen.getByDisplayValue('Written skills')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({
    activityTitle: 'Written activity', assignmentAnswer: 'learning '.repeat(120), whatYouLearned: 'Written knowledge', actualTimeHours: '2',
    monthlyAssignment: expect.objectContaining(monthly),
  }));
});

it('shows coach provenance and prevents learner edits even if the review status changes', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Coach activity', status: 'referred', submissionOrigin: 'coach',
    coachCreation: { name: 'Actual Coach', addedAt: '', approvedAt: '', role: 'coach' }, monthlyAssignment: emptyMonthlyAssignment([], '2026-10'),
  } as StoredLearningReflectionSubmission);
  render(<MemoryRouter><ExtraActivityForm kind="apprenticeship" learnerId="7" savedId="extra:00000000-0000-4000-8000-000000000001" /></MemoryRouter>);
  expect(await screen.findByRole('note')).toHaveTextContent('Added and originally approved by Actual Coach');
  expect(screen.getByLabelText('Activity title')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
});

it('returns to extra-activity hours without submitting or clearing the draft', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Synthetic workshop', status: 'draft',
    monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-10'), timeEntries: [{ topic: 'Research', hours: '4.9', date: '2026-10-14' }] },
  } as StoredLearningReflectionSubmission);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'draft' });
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId="extra:00000000-0000-4000-8000-000000000001" /></MemoryRouter>);
  await screen.findByDisplayValue('Synthetic workshop');
  fireEvent.click(screen.getByRole('button', { name: '4. Quality checks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Submit extra activity' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('4 hours and 54 minutes');
  expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
  expect(await screen.findByLabelText('Hours 1')).toHaveValue(4.9);
  expect(screen.getByLabelText('Topic 1')).toHaveValue('Research');
  fireEvent.click(screen.getByRole('button', { name: '1. Activity answer' }));
  expect(screen.getByLabelText('Activity title')).toHaveValue('Synthetic workshop');
  expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
});
it('autosaves edits after a pause and saves newer edits made during an in-flight save', async () => {
  vi.useFakeTimers();
  let finishSave!: (value: { id: string; status: string }) => void;
  vi.mocked(saveLearningReflectionSubmission).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }))
    .mockResolvedValue({ id: 'record', status: 'draft' });
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId={null} /></MemoryRouter>);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'First title' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(saveLearningReflectionSubmission).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Saving draft...')).toBeInTheDocument();
  expect(screen.getByLabelText('Activity title')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Updated title' } });
  await act(async () => { finishSave({ id: 'record', status: 'draft' }); });
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({ activityTitle: 'Updated title', submissionMode: 'draft' }));
  expect(screen.getByText('Draft saved')).toBeInTheDocument();
});
it('shows a failed autosave and lets the learner retry without losing their edits', async () => {
  vi.useFakeTimers();
  vi.mocked(saveLearningReflectionSubmission).mockRejectedValueOnce(new Error('Could not save draft'))
    .mockResolvedValue({ id: 'record', status: 'draft' });
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId={null} /></MemoryRouter>);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Keep this title' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save draft');
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(saveLearningReflectionSubmission).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); });
  expect(screen.getByText('Draft saved')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Keep this title')).toBeInTheDocument();
});
it.each([['answer', 'Activity title'], ['evidence', 'Evidence upload'], ['hours', 'KSBs & hours claimed']])('opens the relevant step from the %s quality check', async (key, destination) => {
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId={null} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '4. Quality checks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  fireEvent.click(await screen.findByRole('button', { name: `Passed: ${key}` }));
  expect(screen.getAllByText(destination).length).toBeGreaterThan(0);
});
it.each(['commercial', 'apprenticeship'] as const)('submits four-step extra activity for %s without an MCM requirement', async kind => {
  render(<MemoryRouter><ExtraActivityForm kind={kind} learnerId="101" savedId={null} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Industry workshop' } });
  expect(screen.queryByRole('button', { name: /Coaching|Impact|Action plan/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '4. Quality checks' }));
  expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Submit extra activity' }));
  expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.some(([value]) => value.submissionMode === 'submit')).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm time' }));
  await screen.findByText(/Extra activity submitted/);
  expect(saveLearningReflectionSubmission).toHaveBeenCalledWith(expect.objectContaining({ learnerKind: kind, learnerId: '101', activityType: 'extra_activity', activityTitle: 'Industry workshop', submissionMode: 'submit', activityId: expect.stringMatching(/^extra:/) }));
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(screen.getByLabelText('Activity month')).toBeDisabled();
});
it('restores a rejected activity and requires a fresh quality check', async () => {
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Old workshop', status: 'rejected', assignmentAnswer: 'Old answer', monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), step: 3 } } as StoredLearningReflectionSubmission);
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId="extra:00000000-0000-4000-8000-000000000001" /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Run quality checks' });
  expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '1. Activity answer' }));
  expect(screen.getByDisplayValue('Old answer')).toBeInTheDocument();
  expect(screen.getByLabelText('Activity month')).toHaveValue('2026-09');
});

it.each(['commercial', 'apprenticeship'] as const)('defaults new %s activities to the UK month across a UTC month boundary', async kind => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
  render(<MemoryRouter><ExtraActivityForm kind={kind} learnerId="101" savedId={null} /></MemoryRouter>);
  await act(async () => {});
  expect(screen.getByLabelText('Activity month')).toHaveValue('2026-10');
});

it.each(['2026-09', '2026-11'])('saves and submits an activity in the selected month %s', async month => {
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValueOnce({ id: 'record', status: 'draft' })
    .mockResolvedValue({ id: 'record', status: 'submitted_for_tutor_review' });
  render(<MemoryRouter><ExtraActivityForm kind="apprenticeship" learnerId="101" savedId={null} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Activity title'), { target: { value: 'Learning workshop' } });
  fireEvent.change(screen.getByLabelText('Activity month'), { target: { value: month } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({
    submissionMode: 'draft', monthlyAssignment: expect.objectContaining({ month }),
  }));
  fireEvent.click(screen.getByRole('button', { name: '4. Quality checks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Submit extra activity' }));
  expect(vi.mocked(saveLearningReflectionSubmission).mock.calls.some(([value]) => value.submissionMode === 'submit')).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm time' }));
  await screen.findByText(new RegExp(`Extra activity submitted for ${month}`));
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({
    submissionMode: 'submit', monthlyAssignment: expect.objectContaining({ month }),
  }));
});

it('preserves a saved draft month and time entries when selecting another month', async () => {
  const entries = [{ topic: 'Workshop', hours: '1.25', date: '2026-09-29' }];
  vi.mocked(loadLearningReflectionSubmission).mockResolvedValue({ activityTitle: 'Saved workshop', status: 'draft',
    monthlyAssignment: { ...emptyMonthlyAssignment([], '2026-09'), timeEntries: entries } } as StoredLearningReflectionSubmission);
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'draft' });
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId="extra:00000000-0000-4000-8000-000000000001" /></MemoryRouter>);
  await screen.findByDisplayValue('Saved workshop');
  expect(screen.getByLabelText('Activity month')).toHaveValue('2026-09');
  fireEvent.change(screen.getByLabelText('Activity month'), { target: { value: '2026-10' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Some activity dates are outside the selected month');
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved');
  expect(saveLearningReflectionSubmission).toHaveBeenLastCalledWith(expect.objectContaining({
    actualTimeHours: '1.25', monthlyAssignment: expect.objectContaining({ month: '2026-10', timeEntries: entries }),
  }));
  fireEvent.click(screen.getByRole('button', { name: '3. KSBs & hours claimed' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Date 1' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Date 1' }));
  expect(screen.getByRole('button', { name: '2026-10-01' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '2026-09-29' })).toBeNull();
});

it('invalidates previous checks after changing the month and prevents saving an empty month', async () => {
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="101" savedId={null} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '4. Quality checks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run quality checks' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Activity month'), { target: { value: '2026-08' } });
  expect(screen.getByRole('button', { name: 'Submit extra activity' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Activity month'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid activity month');
});

it.each(['apprenticeship', 'commercial'] as const)('prevents a coach adding or uploading an extra activity from a %s learner workspace', async kind => {
  vi.mocked(useAuth).mockReturnValue({ auth: { account: { role: 'staff', subjectType: 'staff', subjectId: 3, access: 'coach', learnerRecordId: null } }, isInitialized: true } as ReturnType<typeof useAuth>);
  render(<MemoryRouter><ExtraActivityForm kind={kind} learnerId="7" savedId={null} /></MemoryRouter>);
  expect(screen.getByRole('note')).toHaveTextContent('Learners add their own extra activities and evidence');
  expect(screen.getByLabelText('Activity title')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '2. Evidence & cross-referencing' }));
  expect(screen.getByRole('button', { name: 'Evidence upload' })).toBeDisabled();
  expect(saveLearningReflectionSubmission).not.toHaveBeenCalled();
});

it('keeps staff learning on their own linked learner record editable', () => {
  vi.mocked(useAuth).mockReturnValue({ auth: { account: { role: 'staff', learnerRecordId: 7 } }, isInitialized: true } as ReturnType<typeof useAuth>);
  render(<MemoryRouter><ExtraActivityForm kind="commercial" learnerId="7" savedId={null} /></MemoryRouter>);
  expect(screen.getByLabelText('Activity title')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});
