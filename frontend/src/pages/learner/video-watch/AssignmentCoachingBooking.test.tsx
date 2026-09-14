import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssignmentCoachingBooking } from './AssignmentCoachingBooking';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, fetchLearnerMeetingArtifacts, type LearnerCalendarEvent } from '@/api/learnerCalendar';
vi.mock('@/api/learnerCalendar', () => ({ bookLearnerCalendarSession: vi.fn(), fetchLearnerCalendarEvents: vi.fn(), fetchLearnerMeetingArtifacts: vi.fn(), learnerMeetingArtifactContentUrl: vi.fn() }));
const slot = { eventKey: 'mcr:1:2026-09-15', title: 'Monthly Coaching', targetDate: '2026-09-15', source: 'mcr', status: 'not-scheduled', coachName: 'Coach' } as LearnerCalendarEvent;
const props = { kind: 'commercial' as const, learnerId: '1', month: '2026-09', title: 'Assignment', meetingKey: '', disabled: false, onSave: vi.fn().mockResolvedValue(true), onSelect: vi.fn() };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ times: ['09:00', '10:00'] }) }));
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [slot], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  vi.mocked(bookLearnerCalendarSession).mockResolvedValue({ event: { ...slot, status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '09:00' } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('books the official MCM key and links the returned meeting after saving the draft', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Monthly Coaching Meeting slot'), { target: { value: slot.eventKey } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-22' } });
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(slot.eventKey));
  expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ sessionType: 'mcr', eventKey: slot.eventKey, durationMinutes: 60, scheduledDate: '2026-09-22' }));
  expect(props.onSave.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(bookLearnerCalendarSession).mock.invocationCallOrder[0]);
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  expect(screen.getByLabelText('Date')).toHaveValue('');
  expect(screen.getByLabelText('Time')).toHaveValue('');
});
it('prevents weekend booking and booking without an official slot', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  const select = await screen.findByLabelText('Monthly Coaching Meeting slot');
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-22' } });
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  fireEvent.change(select, { target: { value: slot.eventKey } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-26' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Saturdays or Sundays');
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('shows a saved-booking invitation warning', async () => {
  vi.mocked(bookLearnerCalendarSession).mockResolvedValueOnce({ event: { ...slot, status: 'scheduled', scheduledDate: '2026-09-22' }, warning: 'Invitation could not be sent.' });
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Monthly Coaching Meeting slot'), { target: { value: slot.eventKey } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-22' } });
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByText('Booking saved. Invitation could not be sent.')).toBeInTheDocument();
});

it('does not book if the assignment draft could not be saved', async () => {
  render(<AssignmentCoachingBooking {...props} onSave={vi.fn().mockResolvedValue(false)} />);
  fireEvent.change(await screen.findByLabelText('Monthly Coaching Meeting slot'), { target: { value: slot.eventKey } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-22' } });
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save your assignment draft');
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('shows server conflicts and does not link a failed booking', async () => {
  vi.mocked(bookLearnerCalendarSession).mockRejectedValueOnce(new Error('That time overlaps another meeting.'));
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Monthly Coaching Meeting slot'), { target: { value: slot.eventKey } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-22' } });
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('overlaps another meeting');
  expect(props.onSelect).not.toHaveBeenCalled();
});

it('books directly with the assigned coach when no generated slot exists', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-09-22' } });
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ assignmentMonth: '2026-09', eventKey: undefined, sessionType: 'mcr', durationMinutes: 60 })));
});

it('loads own meeting artifacts without a Teams join link', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [{ ...slot, id: 'meeting', status: 'scheduled', scheduledDate: '2026-09-22', meetingLink: 'https://teams.microsoft.com/meeting' }] });
  vi.mocked(fetchLearnerMeetingArtifacts).mockResolvedValue({ artifacts: [] });
  render(<AssignmentCoachingBooking {...props} meetingKey={slot.eventKey} />);
  expect(await screen.findByText('Recording, Transcript & Attendance')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Join MCM' })).not.toBeInTheDocument();
  await waitFor(() => expect(fetchLearnerMeetingArtifacts).toHaveBeenCalledWith('commercial', '1', slot.eventKey, expect.any(AbortSignal)));
});

it('allows October 5 for September but rejects October 6', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Monthly Coaching Meeting slot'), { target: { value: slot.eventKey } });
  const input = screen.getByLabelText('Date');
  expect(input).toHaveAttribute('max', '2026-10-05');
  fireEvent.change(input, { target: { value: '2026-10-06' } });
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '2026-10-05' } });
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeEnabled();
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ assignmentMonth: '2026-09', scheduledDate: '2026-10-05' })));
});

it('blocks booking when the coach has no available appointments', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ times: [] }) } as Response);
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-09-22' } });
  expect(await screen.findByText(/Your coach has no available/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
});
it('blocks booking when the coach calendar cannot be checked', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Calendar unavailable' }) } as Response);
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-09-22' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Calendar unavailable');
  expect(screen.getByLabelText('Time')).toBeDisabled();
});

it('labels the monthly slot with its permitted booking window instead of its old target date', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  expect(await screen.findByRole('option', { name: 'MCM 2026-09 | Booking window: 2026-09-21 to 2026-10-05 | Coach' })).toHaveValue(slot.eventKey);
  expect(screen.queryByRole('option', { name: /target 2026-09-15/ })).not.toBeInTheDocument();
});


it('allows choosing and booking another available time when a meeting already exists in the window', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [{ ...slot, status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '09:00' }], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  fireEvent.change(await screen.findByLabelText('Date'), { target: { value: '2026-09-24' } });
  await screen.findByRole('option', { name: '10:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ assignmentMonth: '2026-09', eventKey: undefined, scheduledDate: '2026-09-24', scheduledTime: '10:00' })));
});
