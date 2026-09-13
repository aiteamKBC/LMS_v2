import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerCalendarEvents, type BookingCalendarRules, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { fetchReviewHistory, type ImportedReview } from '@/api/reviewHistory';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

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
    let importedMode = false;
    setCalendarError('');
    setDetailError('');

    // Aptem's imported review history is authoritative for learners that have
    // a migrated activity identity. Do not mix generated calendar rows beside
    // imported records. Learners without Aptem activity continue to use the
    // generated programme cycle and coach calendar.
    if (source === 'mcr' || source === 'progress-review') {
      // Resolve the fallback calendar in parallel with the learner identity.
      // Its rows are discarded when the learner is Aptem-backed, so imported
      // MCM data still comes exclusively from reviews/review_sections.
      const calendarPromise = fetchLearnerCalendarEvents(myLearner.kind, myLearner.id, { revalidate: true });
      void calendarPromise.catch(() => undefined);
      void calendarPromise.then(calendar => {
        if (!cancelled) setBookingCalendar(calendar.bookingCalendar || null);
      }).catch(() => undefined);
      void fetchLearnerDetail(myLearner.kind, myLearner.id, { revalidate: true })
        .then(async detail => {
          if (cancelled) return;
          setLearner(detail);
          if (detail.studentActivityAvailable) {
            importedMode = true;
            setUsingImportedReviews(true);
            const history = await fetchReviewHistory(
              myLearner.kind,
              myLearner.id,
              source === 'mcr' ? 'monthly-coaching' : 'reviews',
            );
            if (history.reviews.length > 0) {
              const importedEvents = importedReviewsToEvents(history.reviews, source);
              // Imported review rows are the durable source of truth. Matching
              // a live calendar event by date can attach another review (or a
              // stale event) and make the UI claim a booking that is not in
              // Learner.reviews. Booking POST updates that row explicitly.
              if (!cancelled) setEvents(importedEvents);
              return;
            }
            // An Aptem identity can exist before its review rows have been
            // imported. Keep the learner's generated programme sessions
            // visible in that case instead of rendering an empty table.
            const calendar = await calendarPromise;
            if (!cancelled) {
              setUsingImportedReviews(false);
              setBookingCalendar(calendar.bookingCalendar || null);
              setEvents(calendar.events);
            }
            return;
          }
          const calendar = await calendarPromise;
          if (!cancelled) {
            setBookingCalendar(calendar.bookingCalendar || null);
            setEvents(calendar.events);
          }
        })
        .catch(async (reason: unknown) => {
          if (cancelled) return;
          if (importedMode) {
            setCalendarError(reason instanceof Error ? reason.message : 'Could not load imported coaching history. Please try again.');
          } else {
            setDetailError('Could not load the learner summary. Please try again.');
            // A summary outage must not hide the programme sessions. This is
            // also the safe fallback when the learner's Aptem flag cannot be
            // read at all.
            try {
              const calendar = await calendarPromise;
              if (!cancelled) setEvents(calendar.events);
            } catch {
              if (!cancelled) setCalendarError('Could not load programme sessions. Please try again.');
            }
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      void fetchLearnerCalendarEvents(myLearner.kind, myLearner.id, { revalidate: true })
        .then(calendar => {
          if (!cancelled) {
            setBookingCalendar(calendar.bookingCalendar || null);
            setEvents(calendar.events);
          }
        })
        .catch(() => { if (!cancelled) setCalendarError('Could not load programme sessions. Please try again.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
      void fetchLearnerDetail(myLearner.kind, myLearner.id, { revalidate: true })
        .then(detail => { if (!cancelled) setLearner(detail); })
        .catch(() => { if (!cancelled) setDetailError('Could not load the learner summary. Please try again.'); });
    }
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id, revision, source]);

  const sessions = useMemo(() => events.filter(event => event.source === source)
    .sort((a, b) => a.sequence - b.sequence), [events, source]);
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
