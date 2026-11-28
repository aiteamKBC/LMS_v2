import { useState } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLearnerCalendarEvents, type BookSessionResponse, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerReviewSessions } from '@/api/reviewSessions';
import { fetchReviewHistory } from '@/api/reviewHistory';
import { useReviewSessions } from './useReviewSessions';
import { useMeetingBooking } from './useMeetingBooking';

vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn() }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
vi.mock('@/api/reviewSessions', () => ({ fetchLearnerReviewSessions: vi.fn() }));
vi.mock('@/api/reviewHistory', () => ({ fetchReviewHistory: vi.fn() }));
vi.mock('@/hooks/useMyLearner', () => ({ useLinkedLearner: () => ({ kind: 'commercial', id: '121' }) }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));
let bookingResponse: BookSessionResponse;
vi.mock('./MeetingBookingDialog', () => ({ default: ({ session, onBooked, onSwitchJourneySession }: {
  session: LearnerCalendarEvent; onBooked: (response: BookSessionResponse) => void;
  onSwitchJourneySession?: (id: string) => void;
}) => <><output data-testid="selected-booking-session">{session.id}</output>
  {onSwitchJourneySession && <button onClick={() => onSwitchJourneySession('mcr:121:3')}>Choose MCM 3</button>}
  <button onClick={() => onBooked(bookingResponse)}>Save appointment</button></> }));

function imported(type: string, status: string, id = '401'): LearnerCalendarEvent {
  const source = type === 'Monthly Coaching Meeting' ? 'mcr' : 'progress-review';
  return { id: `imported-review:A-${id}`, eventKey: `imported-review:A-${id}`, reviewId: id,
    aptemReviewId: `A-${id}`, importedReviewType: type, reviewSource: 'aptem',
    source, type: 'review', title: type, sequence: 1, status, sourceStatus: status,
    date: '2026-11-18', targetDate: '2026-11-18', scheduledDate: null, scheduledTime: null,
    durationMinutes: 60, coachName: 'Synthetic coach', coachEmail: '', meetingProvider: '', meetingLink: '', notes: '' };
}
beforeEach(() => { vi.mocked(fetchLearnerDetail).mockResolvedValue({ studentActivityAvailable: false } as Awaited<ReturnType<typeof fetchLearnerDetail>>); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe.each(['Monthly Coaching Meeting', 'Progress Review', 'Progress Review (+ Skills Radar)'])('%s source-owned sessions', type => {
  it.each(['completed', 'scheduled', 'not-scheduled', 'in-progress', 'awaiting-signature'])('shows the imported %s row with both identities intact', async status => {
    const event = imported(type, status);
    vi.mocked(event.source === 'mcr' ? fetchLearnerCalendarEvents : fetchLearnerReviewSessions)
      .mockResolvedValue({ learner: { kind: 'commercial', id: 121 }, events: [event] });
    const { result } = renderHook(() => useReviewSessions(event.source as 'mcr' | 'progress-review'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([event]);
    expect(result.current.usingImportedReviews).toBe(true);
    expect(fetchReviewHistory).not.toHaveBeenCalled();
  });
});

it('keeps same-date PR and Skills Radar rows distinct and exposes local completion separately', async () => {
  const events = [imported('Progress Review', 'scheduled'), { ...imported('Progress Review (+ Skills Radar)', 'completed', '402'),
    sequence: 2, sourceStatus: 'not-scheduled', calendarEventKey: 'existing-booking', migratedForm: true }];
  vi.mocked(fetchLearnerReviewSessions).mockResolvedValue({ learner: { kind: 'commercial', id: 121 }, events });
  const { result } = renderHook(() => useReviewSessions('progress-review'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sessions).toEqual(events);
});

it('preserves an empty imported plan without reading or fabricating another source', async () => {
  vi.mocked(fetchLearnerDetail).mockResolvedValue({ studentActivityAvailable: true } as Awaited<ReturnType<typeof fetchLearnerDetail>>);
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 121 }, events: [] });
  const { result } = renderHook(() => useReviewSessions('mcr'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sessions).toEqual([]);
  expect(fetchReviewHistory).not.toHaveBeenCalled();
});

it('retains server-owned Native numbering and instance linkage', async () => {
  const native = { ...imported('Monthly Coaching Meeting', 'scheduled'), id: 'review:21:T1:7', eventKey: 'review:21:T1:7',
    reviewSource: 'curriculum' as const, reviewTypeCode: 'mcm', reviewTemplateId: 'T1', reviewInstanceId: 'native-instance', occurrenceNumber: 7, sequence: 7 };
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 121 }, events: [native] });
  const { result } = renderHook(() => useReviewSessions('mcr'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sessions).toEqual([native]);
  expect(result.current.usingImportedReviews).toBe(false);
});

it.each(['Monthly Coaching Meeting', 'Progress Review', 'Progress Review (+ Skills Radar)'])('keeps the durable booking key and source evidence after booking %s', type => {
  const event: LearnerCalendarEvent = { ...imported(type, 'not-scheduled'), importedReview: {
    id: '401', aptemReviewId: 'A-401', type, name: type, reviewerName: 'Synthetic coach',
    plannedDate: '2026-11-18', plannedTime: null, completedDate: null, status: 'not-scheduled',
    extractionStatus: 'complete', detailsAvailable: false, sections: [],
  } };
  bookingResponse = { event: { ...event, status: 'scheduled', calendarEventKey: 'existing-appointment',
    calendarEventId: '55', scheduledDate: '2026-11-20', scheduledTime: '14:00' } };
  function Harness() {
    const [events, setEvents] = useState([event]);
    const booking = useMeetingBooking({ learner: { kind: 'commercial', id: '121' }, rules: null,
      attendance: [], titleOf: item => item.title, setEvents, refresh: vi.fn() });
    return <><button onClick={() => booking.openBooking(events[0])}>Book</button>{booking.dialog}
      <output data-testid="events">{JSON.stringify(events)}</output></>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText('Book'));
  fireEvent.click(screen.getByText('Save appointment'));
  const events = JSON.parse(screen.getByTestId('events').textContent || '[]');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ id: event.id, eventKey: event.eventKey, reviewId: '401', aptemReviewId: 'A-401',
    calendarEventKey: 'existing-appointment', calendarEventId: '55', status: 'scheduled', sourceStatus: 'not-scheduled' });
  expect(events[0].importedReview).toEqual(event.importedReview);
});

it('switches the in-page booking target only to an actionable MCM from the learner journey', () => {
  const current = imported('Monthly Coaching Meeting', 'completed', '1');
  const next = { ...imported('Monthly Coaching Meeting', 'not-scheduled', '2'), id: 'mcr:121:2' };
  const later = { ...imported('Monthly Coaching Meeting', 'not-scheduled', '3'), id: 'mcr:121:3' };
  function Harness() {
    const [events, setEvents] = useState([current, next, later]);
    const booking = useMeetingBooking({ learner: { kind: 'commercial', id: '121' }, rules: null,
      attendance: [], titleOf: item => item.title, setEvents, refresh: vi.fn() });
    return <><button onClick={() => booking.openBooking(next, { currentId: current.id, sessions: events,
      items: [
        { id: current.id, title: 'MCM 1', date: current.date, status: 'attended', selectable: false },
        { id: next.id, title: 'MCM 2', date: next.date, status: 'planned', selectable: true },
        { id: later.id, title: 'MCM 3', date: later.date, status: 'planned', selectable: true },
      ] })}>Book next</button>{booking.dialog}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Book next' }));
  expect(screen.getByTestId('selected-booking-session')).toHaveTextContent(next.id);
  fireEvent.click(screen.getByRole('button', { name: 'Choose MCM 3' }));
  expect(screen.getByTestId('selected-booking-session')).toHaveTextContent(later.id);
});
