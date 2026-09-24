import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchAbsenceReports, submitAbsenceReport, type LearnerAbsenceReport } from '@/api/absenceReports';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, type LearnerCalendarEvent, type BookSessionResponse } from '@/api/learnerCalendar';
import AbsenceReportForm from './components/AbsenceReportForm';

vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '12' }) }));
vi.mock('@/api/absenceReports', () => ({ fetchAbsenceReports: vi.fn(), submitAbsenceReport: vi.fn() }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn(), bookLearnerCalendarSession: vi.fn() }));

const futureDate = (days: number) => {
  const date = new Date(); date.setDate(date.getDate() + days); date.setHours(12, 0, 0, 0);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const lectureDate = futureDate(1);
const bookingDate = futureDate(14);
const booking: LearnerCalendarEvent = {
  id: 'catch-up:12:1', eventKey: 'catch-up:12:1', title: 'Catch-up Session', source: 'catch-up', type: 'coaching',
  sequence: 1, status: 'scheduled', date: bookingDate, targetDate: bookingDate, scheduledDate: bookingDate,
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
  vi.mocked(bookLearnerCalendarSession).mockResolvedValue({ event: booking });
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
  fireEvent.click(screen.getByRole('radio', { name: /Coach catch-up/ }));
  await waitFor(() => expect(screen.queryByText('Loading your bookings…')).not.toBeInTheDocument());
}
function fillBooking() {
  fireEvent.change(screen.getByLabelText('Catch-up date'), { target: { value: bookingDate } });
  fireEvent.change(screen.getByLabelText('Catch-up time'), { target: { value: '11:00' } });
}

describe('absence recovery choice', () => {
  it('keeps the alternative option visible and explains when no equivalent lecture exists', async () => {
    await openForm();
    const alternative = screen.getByRole('radio', { name: /Another group session/ });
    expect(alternative).toBeVisible();
    fireEvent.click(alternative);
    expect(alternative).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('No equivalent session is available.');
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
    vi.mocked(submitAbsenceReport).mockResolvedValue({
      id: 1, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0001',
      status: 'approved', recoveryMethod: 'alternative', alternativeSession: {
        id: 'target-occurrence', title: 'Equivalent lecture', dateIso: alternativeDate,
        startTime: '14:00', endTime: '16:00', groupId: 'G2', group: 'Thursday group',
        cohortId: 'C1', cohort: 'October cohort', joinUrl: 'https://teams.microsoft.com/l/meetup-join/alternative',
      },
    } as LearnerAbsenceReport);
    await openForm();
    fireEvent.click(screen.getByRole('radio', { name: /Another group session/ }));
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
    expect(await screen.findByText('Added to your calendar')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View in calendar' })).toHaveAttribute(
      'href', '/learner/calendar?kind=apprenticeship&learner=12&event=absence-alternative%3A1');
    expect(screen.getByRole('link', { name: 'Join alternative session' })).toHaveAttribute(
      'href', 'https://teams.microsoft.com/l/meetup-join/alternative');
  });

  it('requires an explicit recovery choice and confirmation, and saves the recording choice', async () => {
    vi.mocked(submitAbsenceReport).mockResolvedValue({
      id: 1, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0001',
      status: 'approved', recoveryMethod: 'recorded',
    } as LearnerAbsenceReport);
    await openForm();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Watch the recording/ }));
    expect(screen.getByText(/attendance remains absent/i)).toBeVisible();
    expect(submit()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Recording viewing date'), { target: { value: bookingDate } });
    fireEvent.change(screen.getByLabelText('Recording viewing time'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit());
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledOnce());
    const data = vi.mocked(submitAbsenceReport).mock.calls[0][2];
    expect(data.get('recoveryMethod')).toBe('recorded');
    expect(data.get('recordingDate')).toBe(bookingDate);
    expect(data.get('recordingTime')).toBe('18:00');
    expect(data.get('recordingDurationMinutes')).toBe('60');
    expect(data.has('catchupEventKey')).toBe(false);
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
    expect(await screen.findByText('Added to your calendar')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View in calendar' })).toHaveAttribute(
      'href', '/learner/calendar?kind=apprenticeship&learner=12&event=absence-recording%3A1');
  });

  it('links a newly saved catch-up booking to the absence report automatically', async () => {
    let finish!: (result: BookSessionResponse) => void;
    vi.mocked(bookLearnerCalendarSession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(submitAbsenceReport).mockResolvedValue({
      id: 1, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0001',
      status: 'approved', recoveryMethod: 'catch-up',
    } as LearnerAbsenceReport);
    await openForm(); await chooseCatchup();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeDisabled();
    fillBooking(); fireEvent.click(screen.getByRole('button', { name: 'Book Catch-up Session' }));
    expect(submit()).toBeDisabled();
    expect(submitAbsenceReport).not.toHaveBeenCalled();
    finish({ event: booking });
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledOnce());
    const data = vi.mocked(submitAbsenceReport).mock.calls[0][2];
    expect(data.get('recoveryMethod')).toBe('catch-up');
    expect(data.get('catchupEventKey')).toBe(booking.eventKey);
    expect(bookLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '12', expect.objectContaining({ sessionType: 'catch-up', scheduledDate: bookingDate, notes: expect.stringContaining('first lecture') }));
    expect(await screen.findByText('Added to your calendar')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View in calendar' })).toHaveAttribute(
      'href', '/learner/calendar?kind=apprenticeship&learner=12&event=catch-up%3A12%3A1');
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

  it('keeps a successful booking selected when automatic report linking fails', async () => {
    vi.mocked(submitAbsenceReport).mockRejectedValueOnce(new Error('Could not link the absence report.'));
    await openForm(); await chooseCatchup(); fillBooking();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Book Catch-up Session' }));

    expect(await screen.findByText('Could not link the absence report.')).toBeVisible();
    expect(screen.getByText(/Catch-up session booked\. Submit your absence report/)).toBeVisible();
    expect(submit()).toBeEnabled();
    expect(bookLearnerCalendarSession).toHaveBeenCalledOnce();

    vi.mocked(submitAbsenceReport).mockResolvedValue({
      id: 1, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0001',
      status: 'approved', recoveryMethod: 'catch-up',
    } as LearnerAbsenceReport);
    fireEvent.click(submit());
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledTimes(2));
    expect(bookLearnerCalendarSession).toHaveBeenCalledOnce();
    expect(await screen.findByText('Added to your calendar')).toBeVisible();
  });

  it('blocks a catch-up date that is a bank holiday before sending a booking request', async () => {
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({
      ...calendar(),
      bookingCalendar: {
        division: 'england-and-wales', today: lectureDate,
        coveredYears: [new Date(`${bookingDate}T12:00:00`).getFullYear()],
        bankHolidays: [{ date: bookingDate, title: 'Test bank holiday' }],
      },
    });
    await openForm(); await chooseCatchup(); fillBooking();
    expect(screen.getByRole('alert')).toHaveTextContent('Catch-up sessions cannot be booked on Test bank holiday.');
    expect(screen.getByRole('button', { name: 'Book Catch-up Session' })).toBeDisabled();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
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
    expect(screen.getByRole('radio', { name: /Coach catch-up/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
