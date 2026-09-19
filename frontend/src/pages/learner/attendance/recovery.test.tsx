import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Swal from 'sweetalert2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchAbsenceReports, submitAbsenceReport, type LearnerAbsenceReport } from '@/api/absenceReports';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, type LearnerCalendarEvent, type BookSessionResponse } from '@/api/learnerCalendar';
import AbsenceReportForm from './components/AbsenceReportForm';

vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '12' }) }));
vi.mock('@/api/absenceReports', () => ({ fetchAbsenceReports: vi.fn(), submitAbsenceReport: vi.fn() }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn(), bookLearnerCalendarSession: vi.fn() }));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));

const futureDate = (days: number) => {
  const date = new Date(); date.setDate(date.getDate() + days); date.setHours(12, 0, 0, 0);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const lectureDate = futureDate(1);
const bookingDate = futureDate(14);
const booking: LearnerCalendarEvent = {
  id: 'catch-up:12:1', eventKey: 'catch-up:12:1', title: 'Catch-up Session', source: 'catch-up', type: 'coaching',
  sequence: 1, status: 'not-scheduled', date: bookingDate, targetDate: bookingDate, scheduledDate: bookingDate,
  scheduledTime: '11:00', durationMinutes: 30, coachName: 'Coach', coachEmail: 'coach@example.test',
  meetingProvider: '', meetingLink: '', notes: '',
};
const calendar = (events: LearnerCalendarEvent[] = []) => ({ learner: { kind: 'apprenticeship' as const, id: 12 }, events });

beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('AppIcon', AppIcon);
  vi.mocked(fetchAbsenceReports).mockResolvedValue({ count: 0, results: [], missedSessions: ['first', 'second'].map(id => ({
    id, sessionId: `teams:${id}`, title: `${id} lecture`, dateIso: lectureDate, sessionType: 'live_session',
    startTime: '10:00', endTime: '11:00', coach: 'Coach', module: 'Business', status: 'upcoming',
  })) });
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue(calendar());
  vi.mocked(bookLearnerCalendarSession).mockResolvedValue({ event: booking, approvalRequired: true });
  vi.mocked(submitAbsenceReport).mockResolvedValue({ id: 1, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0001', status: 'pending' } as LearnerAbsenceReport);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function openForm() {
  render(<MemoryRouter><AbsenceReportForm compact showHistory={false} preselectMatch={{ id: 'first', dateIso: lectureDate, title: 'first lecture' }} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText('Lecture *')).toHaveValue('first'));
  fireEvent.change(screen.getByLabelText('Main reason'), { target: { value: 'illness' } });
}
const submit = () => screen.getByRole('button', { name: /Submit absence report/ });
async function chooseCatchup() {
  fireEvent.click(screen.getByRole('radio', { name: 'Book a Catch-up session' }));
  await waitFor(() => expect(screen.queryByText('Loading your bookings…')).not.toBeInTheDocument());
}
function fillBooking() {
  fireEvent.change(screen.getByLabelText('Catch-up date'), { target: { value: bookingDate } });
  fireEvent.change(screen.getByLabelText('Catch-up time'), { target: { value: '11:00' } });
}

describe('absence recovery choice', () => {
  it('keeps the alternative option visible and explains when no equivalent lecture exists', async () => {
    await openForm();
    const alternative = screen.getByRole('radio', { name: 'Attend another group session' });
    expect(alternative).toBeVisible();
    fireEvent.click(alternative);
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({
      target: document.body,
      icon: 'info',
      title: 'No alternative lecture available',
    }));
    expect(alternative).not.toBeChecked();
    expect(submit()).toBeDisabled();
  });

  it('offers a backend-approved cohort alternative and submits its exact occurrence', async () => {
    const alternativeDate = futureDate(2);
    vi.mocked(fetchAbsenceReports).mockResolvedValue({ count: 0, results: [], missedSessions: [{
      id: 'first', sessionId: 'teams:first', title: 'first lecture', dateIso: lectureDate,
      sessionType: 'live_session', startTime: '10:00', endTime: '11:00', coach: 'Coach',
      module: 'Business', status: 'upcoming', alternativeSessions: [{
        id: 'target-occurrence', sessionId: 'teams:target-occurrence', title: 'Equivalent lecture',
        dateIso: alternativeDate, startTime: '14:00', endTime: '16:00', groupId: 'G2',
        group: 'Thursday group', cohortId: 'C1', cohort: 'October cohort', module: 'Business',
      }],
    }] });
    await openForm();
    fireEvent.click(screen.getByRole('radio', { name: 'Attend another group session' }));
    fireEvent.change(screen.getByLabelText('Available equivalent session *'), { target: { value: 'target-occurrence' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledOnce());
    const data = vi.mocked(submitAbsenceReport).mock.calls[0][2];
    expect(data.get('recoveryMethod')).toBe('alternative');
    expect(data.get('targetOccurrenceId')).toBe('target-occurrence');
    expect(data.has('catchupEventKey')).toBe(false);
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('requires an explicit recovery choice and confirmation, and saves the recording choice', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Watch the recording' }));
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({
      target: document.body,
      icon: 'warning',
      title: 'Recording does not recover attendance',
    }));
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit());
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledOnce());
    const data = vi.mocked(submitAbsenceReport).mock.calls[0][2];
    expect(data.get('recoveryMethod')).toBe('recorded');
    expect(data.has('catchupEventKey')).toBe(false);
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('waits for a saved booking before allowing the absence submission', async () => {
    let finish!: (result: BookSessionResponse) => void;
    vi.mocked(bookLearnerCalendarSession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await openForm(); await chooseCatchup();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeDisabled();
    fillBooking(); fireEvent.click(screen.getByRole('button', { name: 'Book Catch-up Session' }));
    expect(submit()).toBeDisabled();
    expect(submitAbsenceReport).not.toHaveBeenCalled();
    finish({ event: booking, approvalRequired: true });
    await screen.findByText(/Catch-up request saved/);
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledOnce());
    const data = vi.mocked(submitAbsenceReport).mock.calls[0][2];
    expect(data.get('recoveryMethod')).toBe('catch-up');
    expect(data.get('catchupEventKey')).toBe(booking.eventKey);
    expect(bookLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '12', expect.objectContaining({ sessionType: 'catch-up', scheduledDate: bookingDate, notes: expect.stringContaining('first lecture') }));
  });

  it('keeps Submit disabled after a failed booking', async () => {
    vi.mocked(bookLearnerCalendarSession).mockRejectedValue(new Error('That time is already booked.'));
    await openForm(); await chooseCatchup(); fillBooking();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Book Catch-up Session' }));
    await screen.findByRole('alert');
    expect(submit()).toBeDisabled();
    expect(submitAbsenceReport).not.toHaveBeenCalled();
  });

  it('reuses an existing booking and invalidates it when cancelled on refresh', async () => {
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue(calendar([booking]));
    await openForm(); await chooseCatchup();
    fireEvent.change(screen.getByLabelText('Catch-up booking'), { target: { value: booking.eventKey } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeEnabled();
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue(calendar([{ ...booking, status: 'cancelled' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh bookings' }));
    await waitFor(() => expect(submit()).toBeDisabled());
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('clears the chosen recovery plan when a different lecture is selected', async () => {
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue(calendar([booking]));
    await openForm(); await chooseCatchup();
    fireEvent.change(screen.getByLabelText('Catch-up booking'), { target: { value: booking.eventKey } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Lecture *'), { target: { value: 'second' } });
    expect(submit()).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Book a Catch-up session' })).not.toBeChecked();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
