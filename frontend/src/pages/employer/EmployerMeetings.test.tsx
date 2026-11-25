import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmployerTeamsMeeting } from '@/api/employerMeetings';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { EmployerMeetings } from './EmployerMeetings';

const api = vi.hoisted(() => ({ teams: vi.fn() }));
vi.mock('@/api/employerMeetings', () => ({ fetchEmployerTeamsMeetings: api.teams }));
beforeEach(() => { vi.clearAllMocks(); api.teams.mockResolvedValue({ meetings: [], status: 'ready' }); });

afterEach(cleanup);
const learner = { id: '11', kind: 'apprenticeship', name: 'Alex Learner' } as EmployerLearnerCard;
const event = (id: string, extra: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: id, source: 'progress-review', type: 'review', sequence: 1, status: 'not-scheduled',
  date: '2026-12-01', targetDate: '2026-12-01', scheduledDate: null, scheduledTime: null,
  durationMinutes: 60, coachName: 'Coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '', ...extra,
});
const show = (events: LearnerCalendarEvent[]) => render(<MemoryRouter><EmployerMeetings employerId="8" learners={[learner]} today="2026-11-25" reviews={{ 'apprenticeship:11': { status: 'ready', data: events } }} /></MemoryRouter>);

it('shows only upcoming LMS / Teams bookings and excludes unbooked source plans', () => {
  show([
    event('LMS planned'),
    event('Aptem planned', { aptemReviewId: '77', importedReview: { id: '77', type: 'Progress Review', status: 'Scheduled', completedDate: null } as LearnerCalendarEvent['importedReview'], status: 'scheduled', scheduledDate: '2026-12-01', meetingLink: 'https://teams.microsoft.com/source-only' }),
    event('Confirmed booking', { status: 'scheduled', scheduledDate: '2026-12-02', scheduledTime: '10:00', invited: true, syncState: 'synced', meetingLink: 'https://teams.microsoft.com/confirmed' }),
    event('Past booking', { status: 'scheduled', scheduledDate: '2026-01-01' }),
    event('Past plan', { targetDate: '2026-01-01' }),
    event('Cancelled', { status: 'cancelled' }),
    event('Completed', { status: 'completed' }),
    event('Undated', { targetDate: null, date: '' }),
  ]);
  const panel = within(screen.getByRole('region', { name: 'Meetings to attend (1)' }));
  expect(panel.queryByRole('link', { name: 'LMS planned' })).not.toBeInTheDocument();
  expect(panel.queryByRole('link', { name: 'Aptem planned' })).not.toBeInTheDocument();
  expect(panel.getAllByRole('link', { name: /^Join / })).toHaveLength(1);
  expect(panel.getByRole('link', { name: 'Join Alex Learner: Confirmed booking' })).toHaveAttribute('href', 'https://teams.microsoft.com/confirmed');
  expect(panel.queryByText(/Past plan|Past booking|Cancelled|Completed|Undated/)).not.toBeInTheDocument();
});

it('uses a rescheduled Aptem booking date once, even when its original plan is past', () => {
  show([event('Rescheduled Aptem', { aptemReviewId: '78', calendarEventKey: 'local:78',
    importedReview: { id: '78', type: 'Progress Review', status: 'Scheduled', completedDate: null } as LearnerCalendarEvent['importedReview'],
    status: 'scheduled', bookingStatus: 'scheduled', scheduledDate: '2026-12-02', targetDate: '2026-01-01',
    invited: false, syncState: 'failed', meetingLink: 'https://teams.microsoft.com/unconfirmed' })]);
  expect(screen.getAllByRole('link', { name: 'Rescheduled Aptem' })).toHaveLength(1);
  expect(screen.getByText(/2 Dec 2026/)).toBeVisible();
  expect(screen.getByText('Invitation not confirmed. Contact your coach.')).toBeVisible();
  expect(screen.queryByRole('link', { name: /^Join / })).not.toBeInTheDocument();
});

const invitation: EmployerTeamsMeeting = { id: 'graph-1', title: 'Teams progress discussion',
  startsAt: '2026-12-07T10:00:00Z', endsAt: '2026-12-07T11:00:00Z',
  scheduledDate: '2026-12-07', scheduledTime: '10:00', endTime: '11:00',
  coachName: 'Coach', joinUrl: 'https://teams.microsoft.com/live-invitation',
  learners: [{ id: '11', kind: 'apprenticeship', name: 'Alex Learner' }] };

it('shows an actual Teams invitation when the learner has no future LMS booking', async () => {
  api.teams.mockResolvedValue({ meetings: [invitation], status: 'ready' });
  show([]);
  const panel = within(await screen.findByRole('region', { name: 'Meetings to attend (1)' }));
  expect(panel.getByText('Teams progress discussion')).toBeVisible();
  expect(panel.getByText(/7 Dec 2026 · 10:00/)).toBeVisible();
  expect(panel.getByRole('link', { name: 'Join Teams: Teams progress discussion' })).toHaveAttribute('href', invitation.joinUrl);
  expect(panel.queryByRole('link', { name: 'View review' })).not.toBeInTheDocument();
  expect(panel.queryByText('No upcoming LMS bookings or Teams invitations found.')).not.toBeInTheDocument();
});

it('deduplicates a Teams calendar copy of the same booked appointment', async () => {
  api.teams.mockResolvedValue({ meetings: [invitation], status: 'ready' });
  show([event('LMS review', { status: 'scheduled', scheduledDate: invitation.scheduledDate,
    scheduledTime: invitation.scheduledTime, invited: true, syncState: 'synced', meetingLink: invitation.joinUrl })]);
  await act(async () => {});
  expect(screen.getByRole('region', { name: 'Meetings to attend (1)' })).toBeVisible();
  expect(screen.getAllByRole('link', { name: /^Join / })).toHaveLength(1);
  expect(screen.queryByText('Teams invitation', { exact: true })).not.toBeInTheDocument();
});

it('shows a calendar failure without reporting a false empty result, and retries', async () => {
  api.teams.mockRejectedValueOnce(new Error('Graph unavailable'));
  show([]);
  await screen.findByRole('alert');
  expect(screen.queryByText('No upcoming LMS bookings or Teams invitations found.')).not.toBeInTheDocument();
  const oldSignal = api.teams.mock.calls[0][1] as AbortSignal;
  api.teams.mockResolvedValue({ meetings: [invitation], status: 'ready' });
  await userEvent.click(screen.getByRole('button', { name: 'Retry Teams invitations' }));
  await screen.findByRole('link', { name: 'Join Teams: Teams progress discussion' });
  expect(oldSignal.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('ignores a late response after the employer changes', async () => {
  let finish!: (value: { status: 'ready'; meetings: EmployerTeamsMeeting[] }) => void;
  api.teams.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = show([]);
  const signal = api.teams.mock.calls[0][1] as AbortSignal;
  view.rerender(<MemoryRouter><EmployerMeetings employerId="9" learners={[]} today="2026-11-25" reviews={{}} /></MemoryRouter>);
  await screen.findByText('No upcoming LMS bookings or Teams invitations found.');
  await act(async () => finish({ status: 'ready', meetings: [invitation] }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText(invitation.title)).not.toBeInTheDocument();
});
