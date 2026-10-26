import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ExtraActivityForm } from './ExtraActivityPage';
import { loadLearningReflectionSubmission, saveLearningReflectionSubmission, type StoredLearningReflectionSubmission } from '@/api/reflectionSubmission';
import { checkMonthlyAssignment, emptyMonthlyAssignment } from '@/api/monthlyAssignment';
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./ExtraActivities', () => ({ ExtraActivities: () => <div>Saved extra activities</div> }));
vi.mock('@/api/extraActivities', () => ({ useExtraActivities: () => ({ activities: [], loading: false, error: '', refresh: vi.fn() }) }));
vi.mock('@/api/reflectionSubmission', () => ({ loadLearningReflectionSubmission: vi.fn(), saveLearningReflectionSubmission: vi.fn() }));
vi.mock('@/api/monthlyAssignment', async original => ({ ...await original<typeof import('@/api/monthlyAssignment')>(), checkMonthlyAssignment: vi.fn() }));
vi.mock('@/api/evidence', () => ({ fetchEvidence: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/feature/AssignmentEvidence', () => ({ AssignmentEvidence: () => <div>Evidence upload</div> }));
vi.mock('@/hooks/useLearnerDetailParam', () => ({ useLearnerDetailParam: () => ({ real: { name: 'Example learner', programme: 'Example programme' } }) }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn().mockResolvedValue({ ksbs: [], activityFeed: [] }) }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn().mockResolvedValue({ events: [], bookingCalendar: { coveredYears: [2026], bankHolidays: [] } }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
beforeEach(() => {
  vi.mocked(saveLearningReflectionSubmission).mockResolvedValue({ id: 'record', status: 'submitted_for_tutor_review' });
  vi.mocked(checkMonthlyAssignment).mockResolvedValue(['title', 'answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours'].map(key => ({ key, label: key, passed: true })));
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
