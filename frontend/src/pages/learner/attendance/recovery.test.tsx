import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchAbsenceReports, submitAbsenceReport, type LearnerAbsenceReport } from '@/api/absenceReports';
import { bookLearnerCalendarSession, fetchCatchupSlots, fetchLearnerCalendarEvents, type LearnerCalendarEvent, type BookSessionResponse } from '@/api/learnerCalendar';
import AbsenceReportForm from './components/AbsenceReportForm';

vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => ({ kind: 'apprenticeship', id: '12' }) }));
vi.mock('@/api/absenceReports', () => ({ fetchAbsenceReports: vi.fn(), submitAbsenceReport: vi.fn() }));
vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn(), bookLearnerCalendarSession: vi.fn(),
  fetchCatchupSlots: vi.fn(), ukOffsetForDate: vi.fn(() => -60) }));

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
  vi.mocked(fetchCatchupSlots).mockResolvedValue(['11:00', '11:15']);
  vi.mocked(submitAbsenceReport).mockResolvedValue({ id: 1, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0001', status: 'pending' } as LearnerAbsenceReport);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function openForm() {
  render(<MemoryRouter><AbsenceReportForm compact showHistory={false} preselectMatch={{ id: 'first', dateIso: lectureDate, title: 'first lecture' }} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText('Lecture *')).toHaveValue('first'));
  fireEvent.change(screen.getByLabelText('Main reason'), { target: { value: 'illness' } });
}
const submit = () => screen.getByRole('button', { name: /Submit absence report|Book catch-up & submit/ });
async function chooseCatchup() {
  fireEvent.click(screen.getByRole('radio', { name: /Coach catch-up/ }));
  await waitFor(() => expect(screen.queryByText('Loading your bookings…')).not.toBeInTheDocument());
}
async function fillBooking() {
  fireEvent.change(screen.getByLabelText('Catch-up date'), { target: { value: bookingDate } });
  await within(screen.getByLabelText('Catch-up time')).findByRole('option', { name: '11:00' });
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
    expect(screen.getByText(/Does not make up the absence/)).toBeVisible();
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

  it('saves the report, then books the coach time linked to it in one request', async () => {
    let finish!: (result: BookSessionResponse) => void;
    vi.mocked(bookLearnerCalendarSession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(submitAbsenceReport).mockResolvedValue({
      id: 34, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0034',
      status: 'approved', recoveryMethod: 'catch-up',
    } as LearnerAbsenceReport);
    await openForm(); await chooseCatchup();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Book Catch-up Session' })).not.toBeInTheDocument();
    await fillBooking();
    expect(screen.getByRole('button', { name: /Book catch-up & submit/ })).toBeEnabled();
    fireEvent.click(submit());
    // The report goes first, without a booking ...
    await waitFor(() => expect(submitAbsenceReport).toHaveBeenCalledOnce());
    const data = vi.mocked(submitAbsenceReport).mock.calls[0][2];
    expect(data.get('recoveryMethod')).toBe('catch-up');
    expect(data.get('catchupPending')).toBe('1');
    expect(data.has('catchupEventKey')).toBe(false);
    // ... then one booking request that the server links to report 34.
    await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('apprenticeship', '12', expect.objectContaining({
      sessionType: 'catch-up', scheduledDate: bookingDate, scheduledTime: '11:00', timezoneOffsetMinutes: -60,
      absenceReportId: 34, notes: expect.stringContaining('first lecture') })));
    expect(fetchCatchupSlots).toHaveBeenCalledWith('apprenticeship', '12', bookingDate, 30, expect.anything());
    finish({ event: booking, linkedReportId: 34 });
    expect(await screen.findByText('Added to your calendar')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View in calendar' })).toHaveAttribute(
      'href', '/learner/calendar?kind=apprenticeship&learner=12&event=catch-up%3A12%3A1');
  });

  it('a booking that fails keeps the report saved and leaves no stray catch-up', async () => {
    vi.mocked(submitAbsenceReport).mockResolvedValue({
      id: 34, sessionTitle: 'first lecture', sessionDate: lectureDate, reference: 'AR-0034',
      status: 'approved', recoveryMethod: 'catch-up',
    } as LearnerAbsenceReport);
    vi.mocked(bookLearnerCalendarSession).mockRejectedValue(new Error('That time is already booked.'));
    await openForm(); await chooseCatchup(); await fillBooking();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit());
    expect(await screen.findByText(/catch-up could not be booked/)).toBeVisible();
    expect(screen.getByText('Coach catch-up / not booked yet')).toBeVisible();
    expect(submitAbsenceReport).toHaveBeenCalledOnce();
  });

  it('books nothing when the report itself cannot be saved', async () => {
    vi.mocked(submitAbsenceReport).mockRejectedValueOnce(new Error('Could not save the absence report.'));
    await openForm(); await chooseCatchup(); await fillBooking();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit());
    expect(await screen.findByText('Could not save the absence report.')).toBeVisible();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Book catch-up & submit/ })).toBeEnabled();
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
    await openForm(); await chooseCatchup();
    fireEvent.change(screen.getByLabelText('Catch-up date'), { target: { value: bookingDate } });
    expect(screen.getByRole('alert')).toHaveTextContent('Catch-up sessions cannot be booked on Test bank holiday.');
    expect(submit()).toBeDisabled();
    expect(fetchCatchupSlots).not.toHaveBeenCalled();
    expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  });

  it('offers only the coach’s free times and says when a day has none', async () => {
    vi.mocked(fetchCatchupSlots).mockResolvedValueOnce([]);
    await openForm(); await chooseCatchup();
    fireEvent.change(screen.getByLabelText('Catch-up date'), { target: { value: bookingDate } });
    expect(await screen.findByText('Your coach has no free time on this day. Choose another date.')).toBeVisible();
    expect(screen.getByLabelText('Catch-up time')).toBeDisabled();
    expect(submit()).toBeDisabled();
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

  it('does not offer a catch-up that already makes up another lecture', async () => {
    const spare = { ...booking, id: 'catch-up:12:2', eventKey: 'catch-up:12:2', scheduledTime: '12:00' };
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue(calendar([{ ...booking, linkedReportId: 40 }, spare]));
    await openForm(); await chooseCatchup();
    const options = [...(screen.getByLabelText('Catch-up booking') as HTMLSelectElement).options].map(option => option.value);
    expect(options).toEqual(['', spare.eventKey]);
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
