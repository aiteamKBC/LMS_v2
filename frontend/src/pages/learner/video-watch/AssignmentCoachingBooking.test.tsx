import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadAssignmentTopicStates } from '@/api/assignmentTopics';
import { AssignmentCoachingBooking } from './AssignmentCoachingBooking';
import { bookLearnerCalendarSession, fetchLearnerCalendarEvents, fetchLearnerMeetingRecordings, fetchReviewSlots, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchReviewHistory, type ImportedReview } from '@/api/reviewHistory';
vi.mock('@/api/learnerCalendar', () => ({ bookLearnerCalendarSession: vi.fn(), fetchLearnerCalendarEvents: vi.fn(), fetchLearnerMeetingRecordings: vi.fn(), fetchReviewSlots: vi.fn(), learnerMeetingArtifactContentUrl: vi.fn() }));
vi.mock('@/api/assignmentTopics', () => ({ loadAssignmentTopicStates: vi.fn() }));
vi.mock('@/api/reviewHistory', () => ({ fetchReviewHistory: vi.fn() }));
const render = (ui: ReactElement) => renderUi(ui, { wrapper: MemoryRouter });
async function chooseSlot(label = 'MCM 2026-09 | Coach') {
  fireEvent.click(await screen.findByRole('button', { name: label }));
  await screen.findByRole('dialog');
}
async function openAptemTimeline() {
  fireEvent.click(await screen.findByRole('button', { name: 'View programme MCMs' }));
  return screen.findByRole('dialog', { name: 'Choose a programme MCM' });
}
function chooseDate(value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Date' }));
  let month = screen.getByRole('group', { name: 'Booking calendar' }).getAttribute('data-month')!;
  while (month !== value.slice(0, 7)) {
    const next = screen.getByRole('button', { name: month < value.slice(0, 7) ? 'Next month' : 'Previous month' });
    if (next.hasAttribute('disabled')) break;
    fireEvent.click(next);
    month = screen.getByRole('group', { name: 'Booking calendar' }).getAttribute('data-month')!;
  }
  const day = screen.queryByRole('button', { name: value });
  if (!day || day.hasAttribute('disabled')) {
    if (day) expect(day).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
  } else fireEvent.click(day);
}
const slot = { eventKey: 'mcr:1:2026-09-15', title: 'Monthly Coaching', targetDate: '2026-09-15', source: 'mcr', status: 'not-scheduled', coachName: 'Coach' } as LearnerCalendarEvent;
const props = { kind: 'commercial' as const, learnerId: '1', month: '2026-09', title: 'Assignment', meetingKey: '', disabled: false, onSave: vi.fn().mockResolvedValue(true), onSelect: vi.fn() };
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([]);
  vi.mocked(fetchLearnerMeetingRecordings).mockResolvedValue({ artifacts: [] });
  vi.mocked(fetchReviewSlots).mockResolvedValue(['09:00', '10:00']);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ times: ['09:00', '10:00'] }) }));
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [slot], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  vi.mocked(bookLearnerCalendarSession).mockResolvedValue({ event: { ...slot, status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '09:00' } });
  vi.mocked(fetchReviewHistory).mockResolvedValue({ learnerId: null, category: 'monthly-coaching', reviews: [] });
});
const aptemMcm = (id: string, plannedDate: string, status = 'not-scheduled') => ({
  id, aptemReviewId: `A-${id}`, name: 'Monthly Coaching Meeting', type: 'Monthly Coaching Meeting', reviewerName: 'Former coach',
  plannedDate, plannedTime: null, completedDate: status === 'completed' ? plannedDate : null, status,
  extractionStatus: 'complete', detailsAvailable: false, sections: [],
}) as ImportedReview;
const withAptemMcms = (...reviews: ImportedReview[]) => vi.mocked(fetchReviewHistory).mockResolvedValue({ learnerId: 1, category: 'monthly-coaching', reviews });
afterEach(() => { cleanup(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('reads saved imported meeting resources without exposing Coach refresh actions', async () => {
  const imported = { ...slot, reviewSource: 'aptem' as const, eventKey: 'imported-review:901', status: 'scheduled',
    scheduledDate: '2026-09-15', scheduledTime: '09:00', meetingLink: 'https://teams.example.test/saved' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [imported] });
  vi.mocked(fetchLearnerMeetingRecordings).mockResolvedValue({ artifacts: [], resourceMode: 'stored' });
  render(<AssignmentCoachingBooking {...props} meetingKey={imported.eventKey} />);
  expect(await screen.findByText(/No saved meeting recording is available/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
  expect(fetchLearnerMeetingRecordings).toHaveBeenCalledExactlyOnceWith('commercial', '1', imported.eventKey, expect.any(AbortSignal));
});

it('books the official MCM key and links the returned meeting after saving the draft', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(slot.eventKey));
  expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ sessionType: 'mcr', bookingContext: 'monthly-assignment', eventKey: slot.eventKey, durationMinutes: 60, scheduledDate: '2026-09-22' }));
  expect(props.onSave.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(bookLearnerCalendarSession).mock.invocationCallOrder[0]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Your Monthly Coaching Meeting is booked and linked to this assignment.')).toBeInTheDocument();
});

it('switches between programme MCM cards and books the last selected slot', async () => {
  const nextSlot = { ...slot, eventKey: 'mcr:1:2026-10-15', targetDate: '2026-10-15', coachName: 'Coach Two' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [slot, nextSlot], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  const first = await screen.findByRole('button', { name: 'MCM 2026-09 | Coach' });
  const second = screen.getByRole('button', { name: 'MCM 2026-10 | Coach Two' });
  fireEvent.click(first);
  fireEvent.click(second);
  fireEvent.click(first);
  fireEvent.click(second);
  expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Session to book').parentElement).toHaveTextContent('MCM 2026-10');
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ eventKey: nextSlot.eventKey })));
});

it('reopens booking details for different MCMs without losing the page or using a stale slot', async () => {
  const nextSlot = { ...slot, eventKey: 'mcr:1:2026-10-15', targetDate: '2026-10-15', coachName: 'Coach Two' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [slot, nextSlot], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  const first = await screen.findByRole('button', { name: 'MCM 2026-09 | Coach' });
  first.focus();
  fireEvent.click(first);
  expect(await screen.findByRole('dialog', { name: 'Book MCM 2026-09' })).toBeInTheDocument();
  chooseDate('2026-09-22');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(first).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'MCM 2026-10 | Coach Two' }));
  expect(await screen.findByRole('dialog', { name: 'Book MCM 2026-10' })).toHaveTextContent('MCM 2026-10');
  expect(screen.getByLabelText('Date')).toHaveTextContent('Select a date');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(first);
  expect(await screen.findByRole('dialog', { name: 'Book MCM 2026-09' })).toHaveTextContent('MCM 2026-09');
  expect(screen.getByLabelText('Date')).toHaveTextContent('Select a date');
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it('defaults to one hour and rechecks availability before booking a different duration', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  expect(screen.getByLabelText('Duration')).toHaveValue('60');
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } });
  await waitFor(() => expect(fetchReviewSlots).toHaveBeenLastCalledWith('commercial', '1', '2026-09-22', 90, expect.anything()));
  expect(screen.getByLabelText('Time')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Book 90-minute MCM' })).toBeDisabled();
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 90-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ durationMinutes: 90 })));
});
it('prevents weekend booking and booking without an official slot', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  const slotButton = await screen.findByRole('button', { name: 'MCM 2026-09 | Coach' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(slotButton);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  chooseDate('2026-09-26');
  expect(screen.getByLabelText('Date')).toHaveTextContent('Select a date');
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('shows a saved-booking invitation warning', async () => {
  vi.mocked(bookLearnerCalendarSession).mockResolvedValueOnce({ event: { ...slot, status: 'scheduled', scheduledDate: '2026-09-22' }, warning: 'Invitation could not be sent.' });
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByText('Booking saved. Invitation could not be sent.')).toBeInTheDocument();
});

it('does not book if the assignment draft could not be saved', async () => {
  render(<AssignmentCoachingBooking {...props} onSave={vi.fn().mockResolvedValue(false)} />);
  await chooseSlot();
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save your assignment draft');
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('shows server conflicts and does not link a failed booking', async () => {
  vi.mocked(bookLearnerCalendarSession).mockRejectedValueOnce(new Error('That time overlaps another meeting.'));
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('overlaps another meeting');
  expect(props.onSelect).not.toHaveBeenCalled();
});

it('books directly with the assigned coach when no generated slot exists', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  await screen.findByLabelText('Date');
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ bookingContext: 'monthly-assignment', assignmentMonth: '2026-09', eventKey: undefined, sessionType: 'mcr', durationMinutes: 60 })));
});

it.each(['commercial', 'apprenticeship'] as const)('books the second assignment window for %s without an imported review', async kind => {
  render(<AssignmentCoachingBooking {...props} kind={kind} />);
  await chooseSlot();
  chooseDate('2026-10-28');
  await screen.findByRole('option', { name: '10:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith(kind, '1', expect.objectContaining({
    bookingContext: 'monthly-assignment', sessionType: 'mcr', eventKey: slot.eventKey,
    assignmentMonth: '2026-09', scheduledDate: '2026-10-28', scheduledTime: '10:00',
    durationMinutes: 60, timezoneOffsetMinutes: 0,
  })));
  expect(vi.mocked(bookLearnerCalendarSession).mock.calls[0][2]).not.toHaveProperty('reviewId');
});

it('loads own meeting artifacts without a Teams join link', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [{ ...slot, id: 'meeting', status: 'scheduled', scheduledDate: '2026-09-22', meetingLink: 'https://teams.microsoft.com/meeting' }] });
  vi.mocked(fetchLearnerMeetingRecordings).mockResolvedValue({ artifacts: [] });
  render(<AssignmentCoachingBooking {...props} meetingKey={slot.eventKey} />);
  expect(await screen.findByText('Meeting Recording')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
  expect(screen.queryByText('Attendance tracking')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Join MCM' })).not.toBeInTheDocument();
  await waitFor(() => expect(fetchLearnerMeetingRecordings).toHaveBeenCalledWith('commercial', '1', slot.eventKey, expect.any(AbortSignal)));
});

it.each(['commercial', 'apprenticeship'] as const)('keeps saved recording playback without Coach controls or attendance for %s assignments', async kind => {
  const booked = { ...slot, status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '09:00', meetingLink: 'https://teams.example.test/meeting' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind, id: 1 }, events: [booked] });
  vi.mocked(fetchLearnerMeetingRecordings).mockResolvedValue({
    resourceMode: 'stored',
    artifacts: [{ id: 'saved-video', artifact_type: 'recording', graph_artifact_id: 'saved-video', content_available: true },
                { id: 'private-transcript', artifact_type: 'transcript', graph_artifact_id: 'private-transcript' }],
  });
  render(<AssignmentCoachingBooking {...props} kind={kind} meetingKey={booked.eventKey} />);
  expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
  expect(screen.queryByText('Attendance tracking')).not.toBeInTheDocument();
  expect(screen.queryByText('AI Meeting Summary')).not.toBeInTheDocument();
  expect(screen.queryByText('Transcript')).not.toBeInTheDocument();
  expect(screen.getByText(/Linked meeting/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Change meeting date or time' })).toBeInTheDocument();
  expect(fetchLearnerMeetingRecordings).toHaveBeenCalledExactlyOnceWith(kind, '1', booked.eventKey, expect.any(AbortSignal));
});

it('keeps Coach controls hidden while the saved recordings request is pending', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [
    { ...slot, status: 'scheduled', scheduledDate: '2026-09-22', meetingLink: 'https://teams.example.test/meeting' },
  ] });
  vi.mocked(fetchLearnerMeetingRecordings).mockReturnValue(new Promise(() => {}));
  render(<AssignmentCoachingBooking {...props} meetingKey={slot.eventKey} />);
  expect(await screen.findByText('Meeting Recording')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
  expect(screen.queryByText('Attendance tracking')).not.toBeInTheDocument();
});

it('books an available appointment after the 5th', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();

  chooseDate('2026-10-06');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeEnabled();
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ assignmentMonth: '2026-09', scheduledDate: '2026-10-06' })));
});

it('blocks booking when the coach has no available appointments', async () => {
  vi.mocked(fetchReviewSlots).mockResolvedValue([]);
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  chooseDate('2026-09-22');
  expect(await screen.findByText(/Your coach has no available/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
});
it('blocks booking when the coach calendar cannot be checked', async () => {
  vi.mocked(fetchReviewSlots).mockRejectedValue(new Error('Calendar unavailable'));
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  chooseDate('2026-09-22');
  expect(await screen.findByRole('alert')).toHaveTextContent('Calendar unavailable');
  expect(screen.getByLabelText('Time')).toBeDisabled();
});

it('labels the monthly slot with its month and coach instead of its old target date', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  expect(await screen.findByRole('button', { name: 'MCM 2026-09 | Coach' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('group', { name: 'Monthly Coaching Meeting slot' })).toHaveTextContent('Coach');
  expect(screen.queryByRole('button', { name: /target 2026-09-15/ })).not.toBeInTheDocument();
});


it('allows choosing and booking another available time when a meeting already exists in the window', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [{ ...slot, status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '09:00' }], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  await screen.findByLabelText('Date');
  chooseDate('2026-09-24');
  await screen.findByRole('option', { name: '10:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({ assignmentMonth: '2026-09', eventKey: undefined, scheduledDate: '2026-09-24', scheduledTime: '10:00' })));
});


it('allows available MCM weekdays throughout the month while excluding past dates and weekends', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  for (const date of ['2026-10-06', '2026-10-19', '2026-11-18', '2026-12-10', '2026-10-20', '2026-11-20', '2026-12-21']) {
    chooseDate(date);
    await screen.findByRole('option', { name: '09:00' });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
    expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeEnabled();
  }
  for (const date of ['2026-09-11', '2026-10-17']) {
    chooseDate(date);
    expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
    expect(screen.getByLabelText('Date')).toHaveTextContent('Select a date');
  }
});


it('enables every October weekday and keeps weekends disabled', async () => {
  render(<AssignmentCoachingBooking {...props} />);
  await chooseSlot();
  fireEvent.click(screen.getByLabelText('Date'));
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  const weekends = [3, 4, 10, 11, 17, 18, 24, 25, 31];
  for (let day = 1; day <= 31; day++) {
    const button = screen.getByRole('button', { name: `2026-10-${String(day).padStart(2, '0')}` });
    if (weekends.includes(day)) expect(button).toBeDisabled();
    else expect(button).toBeEnabled();
  }
});

it('opens the Aptem plan in a popup and returns focus to the page when it closes', async () => {
  withAptemMcms(aptemMcm('9840', '2026-10-27'));
  render(<AssignmentCoachingBooking {...props} />);
  const trigger = await screen.findByRole('button', { name: 'View programme MCMs' });
  expect(screen.queryByRole('region', { name: 'Monthly Coaching Meetings' })).not.toBeInTheDocument();
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Choose a programme MCM' })).toHaveTextContent('MCM 1');
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(screen.getByRole('button', { name: 'Close MCM list' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe('');
});

it('shows every Aptem MCM in plan order without recommending or selecting one for the assignment', async () => {
  withAptemMcms(aptemMcm('9839', '2026-09-30', 'completed'), aptemMcm('9842', '2026-12-27'), aptemMcm('9840', '2026-10-27'), aptemMcm('9831', '2026-06-15'));
  render(<AssignmentCoachingBooking {...props} />);
  expect(screen.queryByRole('region', { name: 'Monthly Coaching Meetings' })).not.toBeInTheDocument();
  const timeline = await openAptemTimeline();
  const slotPicker = within(timeline).getByRole('group', { name: 'Monthly Coaching Meeting slot' });
  // Completed meetings retain their number while open meetings remain selectable.
  expect(within(screen.getByRole('region', { name: 'Monthly Coaching Meetings' })).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
    'MCM 1, Not booked, review Planned, planned 15 Jun 2026',
    'MCM 2, Not bookable, review Completed, planned 30 Sept 2026',
    'MCM 3, Not booked, review Planned, planned 27 Oct 2026',
    'MCM 4, Not booked, review Planned, planned 27 Dec 2026',
  ]);
  expect(within(slotPicker).getByRole('button', { name: /MCM 2, Not bookable/ })).toBeEnabled();
  expect(slotPicker).toHaveTextContent('0 booked');
  expect(slotPicker).toHaveTextContent('3 not booked');
  expect(screen.getByLabelText('Use an existing coaching booking')).toHaveValue('');
  expect(screen.queryByText(/Next to book/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Choose time for/ })).not.toBeInTheDocument();
  for (const card of within(screen.getByRole('region', { name: 'Monthly Coaching Meetings' })).getAllByRole('button')) {
    expect(card).toHaveAttribute('aria-pressed', 'false');
  }
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /MCM 1, Not booked/ }));
  expect(screen.getByRole('dialog', { name: 'Book MCM 1' })).toBeInTheDocument();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to meetings' }));
  expect(screen.getByRole('dialog', { name: 'Choose a programme MCM' })).toBeInTheDocument();
  await chooseSlot('MCM 3, Not booked, review Planned, planned 27 Oct 2026');
  expect(screen.getByRole('dialog', { name: 'Book MCM 3' })).toHaveTextContent('Monthly Coaching Meeting');
  chooseDate('2026-10-27');
  await screen.findByRole('option', { name: '10:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(bookLearnerCalendarSession).toHaveBeenCalledWith('commercial', '1', expect.objectContaining({
    sessionType: 'mcr', bookingContext: 'monthly-assignment', reviewId: '9840', eventKey: undefined,
    assignmentMonth: '2026-09', scheduledDate: '2026-10-27', scheduledTime: '10:00', durationMinutes: 60,
  })));
});

it.each(['2026-09', '2026-10'])('keeps an existing Aptem booking a manual choice for assignment month %s', async month => {
  withAptemMcms(aptemMcm('9840', '2026-10-27'));
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [{ ...slot, eventKey: 'imported-review:A-9840', reviewSource: 'aptem', calendarEventKey: 'booked-1', bookingStatus: 'scheduled', status: 'scheduled', scheduledDate: '2026-10-27', scheduledTime: '10:00', reviewId: '9840' }], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} month={month} />);
  await openAptemTimeline();
  const card = screen.getByRole('button', { name: 'MCM 1, Booked, review Planned, planned 27 Oct 2026' });
  expect(card).toHaveTextContent('Booked for 27 Oct 2026 at 10:00');
  expect(screen.getByRole('group', { name: 'Monthly Coaching Meeting slot' })).toHaveTextContent('1 booked');
  expect(screen.getByRole('option', { name: /MCM 1 · 2026-10-27 10:00/ })).toHaveValue('imported-review:A-9840');
  fireEvent.click(card);
  expect(await screen.findByRole('dialog', { name: 'View MCM 1' })).toHaveTextContent('Booked appointment');
  expect(screen.getByLabelText('Use an existing coaching booking')).toHaveValue('');
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use this MCM' }));
  expect(props.onSelect).toHaveBeenCalledWith('imported-review:A-9840');
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
});

it('offers an Aptem MCM whose calendar event has no booking yet', async () => {
  // The learner calendar returns every imported MCM as an event, booked or not.
  withAptemMcms(aptemMcm('9840', '2026-10-27'));
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [{ ...slot, eventKey: 'imported-review:A-9840', reviewSource: 'aptem', calendarEventKey: null, status: 'not-scheduled', targetDate: '2026-10-27', reviewId: '9840' }], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  await openAptemTimeline();
  const slotPicker = screen.getByRole('group', { name: 'Monthly Coaching Meeting slot' });
  expect(within(slotPicker).getByRole('button', { name: /MCM 1, Not booked, review Planned/ })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByText(/No open Monthly Coaching Meeting from your programme plan/)).not.toBeInTheDocument();
});

it('keeps same-day Aptem MCMs in order and shows an unresolved reservation as pending', async () => {
  withAptemMcms(aptemMcm('12', '2026-11-28'), aptemMcm('11', '2026-11-28'));
  const pending = { ...slot, eventKey: 'imported-review:A-11', reviewSource: 'aptem' as const,
    reviewId: '11', calendarEventKey: 'pending-booking-11', bookingReserved: true,
    status: 'not-scheduled', scheduledDate: '2026-11-30', scheduledTime: '09:00', syncState: 'reconciliation' as const };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [pending], bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  render(<AssignmentCoachingBooking {...props} />);
  await openAptemTimeline();
  const plan = screen.getByRole('group', { name: 'Monthly Coaching Meeting slot' });
  expect(within(screen.getByRole('region', { name: 'Monthly Coaching Meetings' })).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
    'MCM 1, Booking pending, review Planned, planned 28 Nov 2026',
    'MCM 2, Not booked, review Planned, planned 28 Nov 2026',
  ]);
  expect(screen.queryByText(/Next to book/i)).not.toBeInTheDocument();
  expect(within(plan).getByRole('button', { name: /MCM 2, Not booked/ })).toBeEnabled();
  expect(within(plan).getByRole('button', { name: /MCM 1, Booking pending/ })).toBeEnabled();
  expect(plan).toHaveTextContent('0 booked');
  expect(plan).toHaveTextContent('1 not booked');
  expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
  fireEvent.click(within(plan).getByRole('button', { name: /MCM 2, Not booked/ }));
  expect(screen.getByRole('dialog', { name: 'Book MCM 2' })).toHaveTextContent('Monthly Coaching Meeting');
  expect(screen.getByLabelText('Date')).toBeInTheDocument();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it.each([
  ['in-progress', 'In progress'], ['confirmed', 'Confirmed'], ['pending', 'Pending'],
])('preserves main booking eligibility for an Aptem review marked %s without an appointment', async (status, label) => {
  // Source review status alone must not add booking restrictions beyond main.
  // Existing reservations are covered separately and still prevent duplicates.
  withAptemMcms(aptemMcm('9840', '2026-10-27', status));
  const event = { ...slot, eventKey: 'imported-review:9840', reviewSource: 'aptem' as const,
    reviewId: '9840', calendarEventKey: null, status: 'not-scheduled', sourceStatus: status, targetDate: '2026-10-27' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValueOnce({ learner: { kind: 'commercial', id: 1 }, events: [event],
    bookingCalendar: { division: 'england-and-wales', today: '2026-09-12', coveredYears: [2026], bankHolidays: [] } });
  vi.mocked(bookLearnerCalendarSession).mockResolvedValueOnce({ event: { ...event, calendarEventKey: 'booked-9840',
    status: 'scheduled', bookingStatus: 'scheduled', scheduledDate: '2026-10-27', scheduledTime: '10:00' } });
  render(<AssignmentCoachingBooking {...props} />);
  await openAptemTimeline();
  fireEvent.click(screen.getByRole('button', { name: `MCM 1, Not booked, review ${label}, planned 27 Oct 2026` }));
  expect(await screen.findByRole('dialog', { name: 'Book MCM 1' })).toHaveTextContent(label);
  expect(props.onSelect).not.toHaveBeenCalled();
  chooseDate('2026-10-27');
  await screen.findByRole('option', { name: '10:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(event.eventKey));
  expect(bookLearnerCalendarSession).toHaveBeenCalledExactlyOnceWith('commercial', '1', expect.objectContaining({
    sessionType: 'mcr', bookingContext: 'monthly-assignment', reviewId: '9840', eventKey: undefined,
    assignmentMonth: '2026-09', scheduledDate: '2026-10-27', scheduledTime: '10:00', durationMinutes: 60,
  }));
  expect(props.onSave.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(bookLearnerCalendarSession).mock.invocationCallOrder[0]);
});

it.each([
  ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['awaiting-signature', 'Awaiting signatures'],
])('preserves main booking restrictions for an Aptem review marked %s', async (status, label) => {
  withAptemMcms(aptemMcm('9842', '2026-09-30', status));
  render(<AssignmentCoachingBooking {...props} />);
  expect(await screen.findByText(/No open Monthly Coaching Meeting is left in your programme plan/)).toBeInTheDocument();
  await openAptemTimeline();
  fireEvent.click(screen.getByRole('button', { name: `MCM 1, Not bookable, review ${label}, planned 30 Sept 2026` }));
  expect(await screen.findByRole('dialog', { name: 'View MCM 1' })).toHaveTextContent(label);
  expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Book 60-minute MCM' })).not.toBeInTheDocument();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

const savedMeeting = { ...slot, id: 'shared-mcm', meetingLink: 'https://teams.microsoft.com/synthetic-meeting', status: 'scheduled', scheduledDate: '2026-09-22', scheduledTime: '09:00' } as LearnerCalendarEvent;
const savedTopic = { topicId: '1', status: 'submitted_for_tutor_review', elapsedSeconds: 90, month: '2026-09', meetingKey: slot.eventKey };
it.each(['commercial', 'apprenticeship'] as const)('shares a booked MCM with each remaining topic for %s', async kind => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind, id: 1 }, events: [savedMeeting] });
  const view = render(<AssignmentCoachingBooking {...props} kind={kind} assignmentId="COMP-TOPICS" topicId="2" />);
  expect(await screen.findByText('MCM already booked: 2026-09-22 at 09:00 with Coach.')).toBeInTheDocument();
  expect(loadAssignmentTopicStates).toHaveBeenCalledWith({ learnerKind: kind, learnerId: '1', activityId: 'COMP-TOPICS' });
  expect(props.onSelect).toHaveBeenCalledWith(slot.eventKey);
  expect(screen.queryByRole('button', { name: 'Book 60-minute MCM' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Use an existing coaching booking')).not.toBeInTheDocument();
  expect(await screen.findByText('Meeting Recording')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check Teams' })).not.toBeInTheDocument();
  expect(screen.queryByText('Attendance tracking')).not.toBeInTheDocument();
  view.rerender(<AssignmentCoachingBooking {...props} kind={kind} assignmentId="COMP-TOPICS" topicId="3" />);
  expect(await screen.findByText('MCM already booked: 2026-09-22 at 09:00 with Coach.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Book 60-minute MCM' })).not.toBeInTheDocument();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('uses the current rescheduled time and keeps the invitation warning visible', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [{ ...savedMeeting, scheduledDate: '2026-09-24', scheduledTime: '10:00', invited: false }] });
  render(<AssignmentCoachingBooking {...props} assignmentId="COMP-TOPICS" topicId="2" />);
  expect(await screen.findByText('MCM already booked: 2026-09-24 at 10:00 with Coach.')).toBeInTheDocument();
  expect(screen.getByText(/calendar invitation has not been sent/)).toBeInTheDocument();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('reuses a shared meeting booked outside the old monthly windows', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [{ ...savedMeeting, scheduledDate: '2026-10-15' }] });
  render(<AssignmentCoachingBooking {...props} assignmentId="COMP-TOPICS" topicId="2" />);
  expect(await screen.findByText('MCM already booked: 2026-10-15 at 09:00 with Coach.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Book 60-minute MCM' })).not.toBeInTheDocument();
});
it.each(['cancelled', 'missing', 'another-month'])('does not reuse a %s shared meeting', async reason => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([{ ...savedTopic, month: reason === 'another-month' ? '2026-08' : savedTopic.month }]);
  const event = { ...savedMeeting, ...(reason === 'cancelled' ? { status: 'cancelled' as const } : {}) };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: reason === 'missing' ? [] : [event] });
  render(<AssignmentCoachingBooking {...props} assignmentId="COMP-TOPICS" topicId="2" />);
  expect(await screen.findByRole('button', { name: 'Book 60-minute MCM' })).toBeInTheDocument();
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(screen.queryByText(/MCM already booked:/)).not.toBeInTheDocument();
});
it('blocks booking when shared topic bookings could not be loaded', async () => {
  vi.mocked(loadAssignmentTopicStates).mockRejectedValueOnce(new Error('Could not load assignment topics.'));
  render(<AssignmentCoachingBooking {...props} assignmentId="COMP-TOPICS" topicId="2" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load assignment topics.');
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeDisabled();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});
it('stops offering another booking as soon as the first topic books successfully', async () => {
  render(<AssignmentCoachingBooking {...props} assignmentId="COMP-TOPICS" topicId="1" />);
  await chooseSlot();
  chooseDate('2026-09-22');
  await screen.findByRole('option', { name: '09:00' });
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Book 60-minute MCM' }));
  expect(await screen.findByText('MCM already booked: 2026-09-22 at 09:00 with Coach.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Book 60-minute MCM' })).not.toBeInTheDocument();
  expect(bookLearnerCalendarSession).toHaveBeenCalledTimes(1);
});
it('preserves the original booking UI for an assignment without topics', async () => {
  render(<AssignmentCoachingBooking {...props} assignmentId="LEGACY" meetingKey={slot.eventKey} />);
  await chooseSlot();
  expect(screen.getByRole('button', { name: 'Book 60-minute MCM' })).toBeInTheDocument();
  expect(loadAssignmentTopicStates).not.toHaveBeenCalled();
});

const replacementMeeting = { ...savedMeeting, id: 'replacement', eventKey: 'mcr:1:replacement',
  scheduledDate: '2026-09-24', scheduledTime: '10:00' } as LearnerCalendarEvent;

function EditableTopicBooking({ kind = 'commercial', initialKey = '' }: { kind?: 'commercial' | 'apprenticeship'; initialKey?: string }) {
  const [key, setKey] = useState(initialKey);
  return <AssignmentCoachingBooking {...props} kind={kind} assignmentId="COMP-TOPICS" topicId="2" meetingKey={key}
    onSelect={value => { props.onSelect(value); setKey(value); }} />;
}

it('restores the top selector for booked Aptem MCMs and shows the chosen booking', async () => {
  withAptemMcms(aptemMcm('1', '2026-10-28'), aptemMcm('2', '2026-11-28'));
  const first = { ...savedMeeting, eventKey: 'imported-review:A-1', reviewSource: 'aptem' as const,
    reviewId: '1', calendarEventKey: 'booked-1', bookingStatus: 'scheduled', scheduledDate: '2026-10-29' };
  const second = { ...savedMeeting, eventKey: 'imported-review:A-2', reviewSource: 'aptem' as const,
    reviewId: '2', calendarEventKey: 'booked-2', bookingStatus: 'scheduled', scheduledDate: '2026-11-30' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [first, second] });
  render(<EditableTopicBooking />);
  const selector = await screen.findByLabelText('Use an existing coaching booking');
  expect(selector).toHaveValue('');
  expect(within(selector).getByRole('option', { name: /MCM 1 · 2026-10-29/ })).toHaveValue(first.eventKey);
  expect(within(selector).getByRole('option', { name: /MCM 2 · 2026-11-30/ })).toHaveValue(second.eventKey);
  fireEvent.change(selector, { target: { value: second.eventKey } });
  expect(props.onSelect).toHaveBeenLastCalledWith(second.eventKey);
  expect(await screen.findByText('MCM already booked: 2026-11-30 at 09:00 with Coach.')).toBeInTheDocument();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it('switches a topic between two booked Aptem MCM cards without creating an appointment', async () => {
  withAptemMcms(aptemMcm('1', '2026-10-28'), aptemMcm('2', '2026-11-28'));
  const first = { ...savedMeeting, eventKey: 'imported-review:A-1', reviewSource: 'aptem' as const,
    reviewId: '1', calendarEventKey: 'booked-1', bookingStatus: 'scheduled', scheduledDate: '2026-10-29' };
  const second = { ...savedMeeting, eventKey: 'imported-review:A-2', reviewSource: 'aptem' as const,
    reviewId: '2', calendarEventKey: 'booked-2', bookingStatus: 'scheduled', scheduledDate: '2026-11-30' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [first, second] });
  render(<EditableTopicBooking initialKey={first.eventKey} />);
  await openAptemTimeline();
  const firstCard = screen.getByRole('button', { name: /MCM 1, Booked, review Planned/ });
  const secondCard = screen.getByRole('button', { name: /MCM 2, Booked, review Planned/ });
  expect(firstCard).toHaveAttribute('aria-pressed', 'true');
  expect(secondCard).toBeEnabled();
  fireEvent.click(secondCard);
  expect(await screen.findByRole('dialog', { name: 'View MCM 2' })).toHaveTextContent('Booked appointment');
  expect(props.onSelect).not.toHaveBeenCalledWith(second.eventKey);
  fireEvent.click(screen.getByRole('button', { name: 'Use this MCM' }));
  expect(props.onSelect).toHaveBeenLastCalledWith(second.eventKey);
  await openAptemTimeline();
  expect(screen.getByRole('button', { name: /MCM 1, Booked, review Planned/ })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: /MCM 2, Booked, review Planned/ })).toHaveAttribute('aria-pressed', 'true');
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it.each(['commercial', 'apprenticeship'] as const)('lets a %s learner change an inherited meeting and keeps the replacement after refresh', async kind => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind, id: 1 }, events: [savedMeeting, replacementMeeting] });
  render(<EditableTopicBooking kind={kind} />);
  await screen.findByText('MCM already booked: 2026-09-22 at 09:00 with Coach.');
  fireEvent.click(screen.getByRole('button', { name: 'Change linked meeting' }));
  fireEvent.change(screen.getByLabelText('Use an existing coaching booking'), { target: { value: replacementMeeting.eventKey } });
  expect(await screen.findByText('MCM already booked: 2026-09-24 at 10:00 with Coach.')).toBeVisible();
  expect(props.onSelect).toHaveBeenLastCalledWith(replacementMeeting.eventKey);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh meetings' }));
  expect(await screen.findByText('MCM already booked: 2026-09-24 at 10:00 with Coach.')).toBeVisible();
  expect(props.onSelect).toHaveBeenLastCalledWith(replacementMeeting.eventKey);
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it('restores the draft selection instead of replacing it with an older topic booking', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [savedMeeting, replacementMeeting] });
  render(<EditableTopicBooking initialKey={replacementMeeting.eventKey} />);
  expect(await screen.findByText('MCM already booked: 2026-09-24 at 10:00 with Coach.')).toBeVisible();
  expect(props.onSelect).not.toHaveBeenCalled();
});

it('opens the existing imported appointment for rescheduling without creating a new meeting', async () => {
  const imported = { ...savedMeeting, eventKey: 'imported-review:901', calendarEventKey: 'review:1:existing',
    reviewSource: 'aptem' as const };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [imported] });
  render(<EditableTopicBooking initialKey={imported.eventKey} />);
  const link = await screen.findByRole('link', { name: 'Change meeting date or time' });
  const url = new URL(link.getAttribute('href')!, 'https://lms.example.test');
  expect(url.pathname).toBe('/learner/calendar');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ kind: 'commercial', learner: '1', event: imported.calendarEventKey,
    date: '2026-09-22', action: 'reschedule' });
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it.each(['commercial', 'apprenticeship'] as const)('recognises the saved calendar key of the same imported MCM for %s', async kind => {
  const imported = { ...savedMeeting, eventKey: 'imported-review:901', calendarEventKey: 'review:1:existing',
    reviewSource: 'aptem' as const, bookingStatus: 'scheduled', sourceStatus: 'not-scheduled' };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind, id: 1 }, events: [imported] });
  render(<EditableTopicBooking kind={kind} initialKey={imported.calendarEventKey} />);
  expect(await screen.findByText('MCM already booked: 2026-09-22 at 09:00 with Coach.')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it('reuses a prior topics booking when it saved the calendar key of the same imported MCM', async () => {
  const imported = { ...savedMeeting, eventKey: 'imported-review:901', calendarEventKey: 'review:1:existing', reviewSource: 'aptem' as const };
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([{ ...savedTopic, meetingKey: imported.calendarEventKey }]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [imported] });
  render(<EditableTopicBooking />);
  expect(await screen.findByText(/MCM already booked:/)).toBeVisible();
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(imported.eventKey));
  expect(bookLearnerCalendarSession).not.toHaveBeenCalled();
});

it('does not select an arbitrary MCM when both the saved link and a calendar alias are empty', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([{ ...savedTopic, meetingKey: '' }]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [{ ...savedMeeting, calendarEventKey: '' }] });
  render(<EditableTopicBooking />);
  expect(await screen.findByLabelText('Use an existing coaching booking')).toHaveValue('');
  expect(screen.queryByText(/MCM already booked:/)).not.toBeInTheDocument();
  expect(props.onSelect).not.toHaveBeenCalled();
});

it('keeps historical topic meeting selection read only', async () => {
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [savedMeeting] });
  render(<AssignmentCoachingBooking {...props} assignmentId="COMP-TOPICS" topicId="1" meetingKey={savedMeeting.eventKey} disabled />);
  await screen.findByText(/MCM already booked:/);
  expect(screen.queryByRole('button', { name: 'Change linked meeting' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Change meeting date or time' })).not.toBeInTheDocument();
  expect(props.onSelect).not.toHaveBeenCalled();
});

it('lets a learner recover an unavailable saved meeting without replacing it silently', async () => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [savedMeeting] });
  render(<EditableTopicBooking initialKey="cancelled-mcm" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing coaching booking or arrange a new MCM');
  const select = screen.getByLabelText('Use an existing coaching booking');
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: savedMeeting.eventKey } });
  expect(await screen.findByText(/MCM already booked:/)).toBeVisible();
  expect(props.onSelect).toHaveBeenLastCalledWith(savedMeeting.eventKey);
});

it.each(['not-scheduled', 'failed', 'cancelled'])('does not present a reserved %s appointment as a confirmed shared MCM', async status => {
  vi.mocked(loadAssignmentTopicStates).mockResolvedValue([savedTopic]);
  const reserved = { ...savedMeeting, status, bookingReserved: true, syncState: 'reconciliation' as const };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [reserved] });
  render(<EditableTopicBooking initialKey={reserved.eventKey} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing coaching booking');
  expect(screen.queryByText(/MCM already booked:/)).not.toBeInTheDocument();
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Use an existing coaching booking')).toBeEnabled();
});

it('does not treat an unbooked imported source as confirmed merely because its form was started', async () => {
  const imported = { ...savedMeeting, eventKey: 'imported-review:901', reviewSource: 'aptem' as const,
    status: 'in-progress', sourceStatus: 'not-scheduled', calendarEventKey: null, bookingReserved: true };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 1 }, events: [imported] });
  render(<EditableTopicBooking initialKey={imported.eventKey} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose an existing coaching booking');
  expect(screen.queryByText(/MCM already booked:/)).not.toBeInTheDocument();
});
