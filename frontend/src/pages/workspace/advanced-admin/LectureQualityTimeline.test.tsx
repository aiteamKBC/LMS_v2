import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { advancedAdminLectureWorkspace, type AdvancedAdminLectureWorkspace, type AdvancedAdminQuality } from '@/api/advancedAdmin';
import LectureQualityTimeline from './LectureQualityTimeline';

vi.mock('@/api/advancedAdmin', () => ({ advancedAdminLectureWorkspace: vi.fn() }));

const workspace: AdvancedAdminLectureWorkspace = {
  lectures: [
    { id: 'one', sessionId: 'session-one', date: '2026-10-08', title: 'Planning', moduleId: 'm1', module: 'Module One',
      source: 'kbc-attendance', startTime: '12:00', endTime: '14:00', durationMinutes: 120, tutor: 'Tutor', coach: 'Coach',
      contentSummary: 'Plan the work', ksbs: ['K1'], activities: [{ id: 'activity-one', title: 'Planning exercise', type: 'assignment', completed: false }],
      status: 'completed', catchupStatus: null },
    { id: 'two', sessionId: 'session-two', date: '2026-10-08', title: 'Delivery', moduleId: 'm2', module: 'Module Two',
      source: 'kbc-attendance', startTime: '15:00', endTime: '17:00', durationMinutes: 120, tutor: 'Tutor', coach: 'Coach',
      contentSummary: 'Deliver the work', ksbs: ['K2'], activities: [], status: 'absent', catchupStatus: null },
  ],
  modules: [{ id: 'm1', title: 'Module One' }, { id: 'm2', title: 'Module Two' }],
  mode: { available: true, mode: 'live', requestedMode: null, status: 'active' },
  recentActivity: [], timeZone: 'Europe/London',
};

const quality = (sessionId: string, subject: string): AdvancedAdminQuality => ({
  source: 'lecture', sessionId, date: '2026-10-08', subject, trainer: 'Tutor', rating: 4,
  comments: 'A saved report', judgement: 'Good', module: 'Module One', duration: '2 hours',
  learnersEnrolled: 1, learnersAttended: 1, observationState: 'Observed',
  checklist: [{ order: 1, item: 'Session duration', status: 'Met', evidence: 'Two hours observed' }],
  strengths: ['Clear examples'], areasForDevelopment: { area_1: { title: 'Tighter pacing', evidence: 'A timed example' } },
  ksbCoverage: { ksb_1: { title: 'K1', type: 'Knowledge', evidence: 'Applied example' } },
});

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.mocked(advancedAdminLectureWorkspace).mockResolvedValue(workspace);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.clearAllMocks();
});

it('shows the read-only lecture page and opens only the quality linked to that lecture', async () => {
  render(<MemoryRouter><LectureQualityTimeline learnerId={42} active attendance={[]} loading={false}
    quality={{ tutor: [], lecture: [quality('session-one', 'Planning'), quality('unknown', 'Other subject')] }} /></MemoryRouter>);

  await waitFor(() => expect(advancedAdminLectureWorkspace).toHaveBeenCalledWith(42, expect.any(AbortSignal)));
  expect(screen.queryByText('Quality reports without a unique lecture match')).not.toBeInTheDocument();
  expect(screen.queryByText('Attendance Mode')).not.toBeInTheDocument();
  expect(screen.queryByText('Support sessions')).not.toBeInTheDocument();
  expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();
  const planning = screen.getByRole('row', { name: /Planning/ });
  expect(screen.queryByRole('columnheader', { name: 'Activities' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View Activities' })).not.toBeInTheDocument();
  fireEvent.click(within(planning).getByRole('button', { name: 'Quality (1)' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('QA Observation Report')).toBeVisible();
  expect(within(dialog).getByText('Observation Categories')).toBeVisible();
  expect(within(dialog).getByText('Evidence by Checklist Item')).toBeVisible();
  expect(within(dialog).getByText('Two hours observed')).toBeVisible();
  expect(within(dialog).getByText('Tighter pacing')).toBeVisible();
  expect(within(dialog).getByText('K1')).toBeVisible();
  expect(within(dialog).getByText('Clear examples')).toBeVisible();
  expect(within(dialog).queryByText('Other subject')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Report Absence|Attend|Join session|Book a Support Session/ })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close Quality' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: 'Quality' })[0]);
  expect(within(screen.getByRole('dialog')).getByText(/Other subject/)).toBeVisible();
});

it('keeps recorded attendance visible when the richer schedule cannot load', async () => {
  vi.mocked(advancedAdminLectureWorkspace).mockRejectedValue(new Error('LMS link is unavailable.'));
  render(<MemoryRouter><LectureQualityTimeline learnerId={42} active loading={false}
    attendance={[{ sessionId: 'kbc-one', date: '2026-09-01', title: 'Recorded lecture', module: 'Module One', status: 'present' }]}
    quality={{ tutor: [], lecture: [] }} /></MemoryRouter>);

  expect(await screen.findByText(/Showing the recorded attendance register/)).toBeVisible();
  expect(screen.getByRole('row', { name: /Recorded lecture/ })).toBeVisible();
});

it('counts sessions through today in the business time zone without removing future lectures', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T23:30:00Z')); // 8 October in Europe/London.
  vi.mocked(advancedAdminLectureWorkspace).mockResolvedValue({
    ...workspace,
    lectures: [
      ...workspace.lectures,
      { ...workspace.lectures[0], id: 'past', sessionId: 'session-past', date: '2026-10-07', title: 'Past session' },
      { ...workspace.lectures[0], id: 'future', sessionId: 'session-future', date: '2026-10-09', title: 'Future session', status: 'upcoming' },
    ],
  });
  render(<MemoryRouter><LectureQualityTimeline learnerId={42} active attendance={[]} loading={false}
    quality={{ tutor: [], lecture: [] }} /></MemoryRouter>);

  expect(await screen.findByRole('row', { name: /Future session/ })).toBeVisible();
  const totalCard = screen.getByText('Total Lectures').parentElement!;
  expect(within(totalCard).getByText('3')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'm1' } });
  expect(within(totalCard).getByText('2')).toBeVisible();
  expect(screen.getByRole('row', { name: /Future session/ })).toBeVisible();
});
