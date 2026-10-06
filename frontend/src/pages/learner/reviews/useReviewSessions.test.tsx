import { useState } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLearnerCalendarEvents, type BookSessionResponse, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { fetchReviewHistory } from '@/api/reviewHistory';
import { useReviewSessions } from './useReviewSessions';
import { useMeetingBooking } from './useMeetingBooking';

vi.mock('@/api/learnerCalendar', () => ({ fetchLearnerCalendarEvents: vi.fn() }));
vi.mock('@/api/learnerDetail', () => ({ fetchLearnerDetail: vi.fn() }));
vi.mock('@/api/reviewHistory', () => ({ fetchReviewHistory: vi.fn() }));
vi.mock('@/hooks/useMyLearner', () => ({ useLinkedLearner: () => ({ kind: 'commercial', id: '121' }) }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn() }));
let bookingResponse: BookSessionResponse;
vi.mock('./MeetingBookingDialog', () => ({ default: ({ onBooked }: { onBooked: (response: BookSessionResponse) => void }) =>
  <button onClick={() => onBooked(bookingResponse)}>Save appointment</button> }));

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
    vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 121 }, events: [event] });
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
  vi.mocked(fetchLearnerCalendarEvents).mockResolvedValue({ learner: { kind: 'commercial', id: 121 }, events });
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
