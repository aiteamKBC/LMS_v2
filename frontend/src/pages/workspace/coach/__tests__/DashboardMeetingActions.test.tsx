import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardMeetingActions } from '../DashboardMeetingActions';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), schedule: vi.fn(), openForm: vi.fn(), savePptx: vi.fn(), viewingAs: false }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.fetch }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ isViewingAsCoach: mocks.viewingAs }) }));
vi.mock('@/pages/coach/shared/calendarEvents', async original => ({ ...await original<typeof import('@/pages/coach/shared/calendarEvents')>(), scheduleCoachCalendarEvent: mocks.schedule }));
vi.mock('@/api/reviewInstances', () => ({ openReviewInstanceForEvent: mocks.openForm }));
vi.mock('@/pages/coach/progress-reviews/lib/progressReviewPptx', () => ({ saveProgressReviewPptx: mocks.savePptx }));
vi.mock('@/pages/coach/progress-reviews/components/ProgressReviewPptxModal', () => ({ default: () => <div>Progress review presentation</div> }));

const event: CoachCalendarEvent = { id: 'meeting', eventKey: 'mcr:42:1', learnerId: '42', learner: 'Example Learner',
  source: 'mcr', title: 'Monthly Coaching', type: 'coaching', status: 'scheduled', scheduledDate: '2026-09-21', scheduledTime: '10:30',
  durationMinutes: 60, meetingLink: 'https://example.invalid/meeting', reviewInstanceId: 'instance-42' };
const onUpdated = vi.fn();
const onScheduleNotice = vi.fn();
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}|{JSON.stringify(location.state)}</div>;
}
function mount(overrides: Partial<CoachCalendarEvent> = {}) {
  return render(<MemoryRouter initialEntries={['/workspace/coach']}><LocationProbe /><table><tbody><tr><DashboardMeetingActions event={{ ...event, ...overrides }} onUpdated={onUpdated} onScheduleNotice={onScheduleNotice} /></tr></tbody></table></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.viewingAs = false;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it('sends one explicit reminder and blocks double clicks without passing a recipient or coach identity', async () => {
  let finish!: (value: Response) => void;
  mocks.fetch.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Send Reminder' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sending...' }));
  expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('/coach_api/coach/timetable/events/mcr%3A42%3A1/reminder', { method: 'POST' });
  finish(new Response(JSON.stringify({ sent: true, detail: 'Accepted for delivery.' })));
  expect(await screen.findByRole('status')).toHaveTextContent('Accepted for delivery.');
  expect(screen.getByRole('button', { name: 'Reminder sent' })).toBeDisabled();
});

it('reports delivery failure and never fabricates a sent state', async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Email is unavailable.' }), { status: 503 }));
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Send Reminder' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email is unavailable.');
  expect(screen.queryByRole('button', { name: 'Reminder sent' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send Reminder' })).toBeEnabled();
});

it('allows a reminder for a confirmed meeting shown in the weekly schedule', () => {
  mount({ status: 'confirmed' });
  expect(screen.getByRole('button', { name: 'Send Reminder' })).toBeEnabled();
});

it('reschedules the same event and preserves a partial Teams failure message', async () => {
  const updated = { ...event, scheduledTime: '11:30' };
  mocks.schedule.mockResolvedValue({ event: updated, warning: 'Saved locally; Teams update needs retry.' });
  const { container } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
  fireEvent.change(container.querySelector('input[type="time"]')!, { target: { value: '11:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new time' }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
  expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(event, { date: '2026-09-21', time: '11:30', durationMinutes: 60 });
  expect(onScheduleNotice).toHaveBeenCalledWith('Saved locally; Teams update needs retry.');
});

it('leaves a failed reschedule open and retains entered values', async () => {
  mocks.schedule.mockRejectedValue(new Error('This time is already booked.'));
  const { container } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
  fireEvent.change(container.querySelector('input[type="time"]')!, { target: { value: '12:15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new time' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This time is already booked.');
  expect(container.querySelector('input[type="time"]')).toHaveValue('12:15');
  expect(onUpdated).not.toHaveBeenCalled();
});

it('opens the linked form without generating another review instance', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'View Form' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/coach/review-instances/instance-42'));
  expect(screen.getByTestId('location')).toHaveTextContent('"returnTo":"/workspace/coach"');
  expect(mocks.openForm).not.toHaveBeenCalled();
});

it('uses the curriculum instance endpoint when the scheduled meeting has a template but no instance', async () => {
  mocks.openForm.mockResolvedValue({ instanceId: 'new-instance' });
  mount({ reviewInstanceId: null, reviewTemplateId: 'template' });
  fireEvent.click(screen.getByRole('button', { name: 'View Form' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/coach/review-instances/new-instance'));
  expect(mocks.openForm).toHaveBeenCalledExactlyOnceWith('mcr:42:1');
});

it('generates a local monthly agenda and retains the existing PR presentation workflow', async () => {
  const result = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Presentation' }));
  await waitFor(() => expect(mocks.savePptx).toHaveBeenCalledWith(expect.objectContaining({ learnerName: 'Example Learner', slides: expect.any(Array) }), 'Monthly Coaching Agenda'));
  expect(mocks.fetch).not.toHaveBeenCalled();
  result.unmount(); mount({ source: 'progress-review', type: 'review' });
  fireEvent.click(screen.getByRole('button', { name: 'Generate Presentation' }));
  expect(screen.getByText('Progress review presentation')).toBeVisible();
});

it('preserves read-only view-as restrictions for reminders and scheduling', () => {
  mocks.viewingAs = true; mount();
  expect(screen.getByRole('button', { name: 'Send Reminder' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reschedule' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'View Form' })).toBeEnabled();
});
