import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerCalendarEvents, type BookingCalendarRules, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchReviewHistory, type ImportedReview } from '@/api/reviewHistory';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

export function isReviewSession(event: LearnerCalendarEvent, source: 'mcr' | 'progress-review') {
  const code = source === 'mcr' ? 'mcm' : 'progress_review';
  return event.reviewTypeCode ? event.reviewTypeCode === code : !event.reviewTemplateId && event.source === source;
}

/** Imported completed records remain history; Curriculum owns upcoming work. */
export function mergeCompletedReviewHistory(events: LearnerCalendarEvent[], history: LearnerCalendarEvent[]) {
  const linkedIds = new Set(events.map(event => event.reviewId).filter(Boolean));
  const keys = new Set(events.map(event => event.eventKey));
  return [...events, ...history.filter(event => event.status === 'completed'
    && !keys.has(event.eventKey) && !linkedIds.has(event.importedReview?.id))];
}

/** Programme sessions remain usable if the learning summary is unavailable. */
export function useReviewSessions(source: 'mcr' | 'progress-review') {
  const myLearner = useLinkedLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [bookingCalendar, setBookingCalendar] = useState<BookingCalendarRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarError, setCalendarError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [usingImportedReviews, setUsingImportedReviews] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useLiveRefresh(refresh);

  useEffect(() => {
    setLearner(null);
    setEvents([]);
    setBookingCalendar(null);
    setUsingImportedReviews(false);
    setLoading(true);
  }, [myLearner.kind, myLearner.id, source]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCalendarError('');
    setDetailError('');
    void fetchLearnerDetail(myLearner.kind, myLearner.id, { revalidate: true })
      .then(detail => { if (!cancelled) setLearner(detail); })
      .catch(() => { if (!cancelled) setDetailError('Could not load the learner summary. Please try again.'); });
    const historyPromise = fetchReviewHistory(myLearner.kind, myLearner.id,
      source === 'mcr' ? 'monthly-coaching' : 'reviews')
      .then(history => importedReviewsToEvents(history.reviews, source))
      .catch(() => {
        if (!cancelled) setDetailError('Could not load archived reviews. Please try again.');
        return [];
      });
    void fetchLearnerCalendarEvents(myLearner.kind, myLearner.id, { revalidate: true })
      .then(async calendar => {
        if (cancelled) return;
        setBookingCalendar(calendar.bookingCalendar || null);
        setEvents(calendar.events);
        setLoading(false);
        const history = await historyPromise;
        if (!cancelled) {
          setEvents(current => mergeCompletedReviewHistory(current, history));
          setUsingImportedReviews(history.some(event => event.status === 'completed'));
        }
      })
      .catch(() => { if (!cancelled) setCalendarError('Could not load programme sessions. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id, revision, source]);

  const sessions = useMemo(() => events.filter(event => isReviewSession(event, source))
    .sort((a, b) => (a.date || a.targetDate || '').localeCompare(b.date || b.targetDate || '') || a.sequence - b.sequence || a.eventKey.localeCompare(b.eventKey)), [events, source]);
  return { myLearner, learner, sessions, setEvents, bookingCalendar, loading, error: calendarError || detailError, refresh, usingImportedReviews };
}

/** Convert read-only imported review rows to the event shape used by the list.
 * The imported id is retained as the event id so a row can be opened without
 * inventing a calendar booking or exposing another learner's event key.
 */
export function importedReviewsToEvents(
  reviews: ImportedReview[],
  source: 'mcr' | 'progress-review' = 'mcr',
): LearnerCalendarEvent[] {
  const chronological = [...reviews].sort((a, b) => {
    const left = a.plannedDate || a.completedDate || '';
    const right = b.plannedDate || b.completedDate || '';
    return left.localeCompare(right) || a.id.localeCompare(b.id);
  });
  return chronological.map((review, index) => {
    const date = review.plannedDate || review.completedDate || null;
    const status = review.status || 'unknown';
    return {
      id: `imported-review:${review.id}`,
      eventKey: `imported-review:${review.id}`,
      title: review.name || (source === 'mcr' ? 'Monthly Coaching Meeting' : 'Review'),
      source,
      reviewTypeId: source === 'mcr' ? 'REVT-MCM' : 'REVT-PROGRESS_REVIEW',
      reviewTypeCode: source === 'mcr' ? 'mcm' : 'progress_review',
      reviewTypeName: source === 'mcr' ? 'Monthly Coaching Meeting' : 'Progress Review',
      reviewTypeIsSystem: true,
      type: source === 'mcr' ? 'coaching' : 'review',
      sequence: index + 1,
      status,
      date,
      targetDate: date,
      scheduledDate: ['scheduled', 'in-progress', 'completed', 'awaiting-signature'].includes(status) ? date : null,
      scheduledTime: review.plannedTime,
      durationMinutes: 60,
      coachName: review.reviewerName || '',
      coachEmail: '',
      meetingProvider: '',
      meetingLink: '',
      notes: '',
      importedReview: review,
    };
  });
}
