import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerCalendarEvents, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useLinkedLearner } from '@/hooks/useMyLearner';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';

/** Programme sessions remain usable if the learning summary is unavailable. */
export function useReviewSessions(source: 'mcr' | 'progress-review') {
  const myLearner = useLinkedLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarError, setCalendarError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useLiveRefresh(refresh);

  useEffect(() => {
    setLearner(null);
    setEvents([]);
    setLoading(true);
  }, [myLearner.kind, myLearner.id]);

  useEffect(() => {
    let cancelled = false;
    setCalendarError('');
    setDetailError('');
    void fetchLearnerCalendarEvents(myLearner.kind, myLearner.id, { revalidate: true })
      .then(calendar => { if (!cancelled) setEvents(calendar.events); })
      .catch(() => { if (!cancelled) setCalendarError('Could not load programme sessions. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void fetchLearnerDetail(myLearner.kind, myLearner.id, { revalidate: true })
      .then(detail => { if (!cancelled) setLearner(detail); })
      .catch(() => { if (!cancelled) setDetailError('Could not load the learner summary. Please try again.'); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id, revision]);

  const sessions = useMemo(() => events.filter(event => event.source === source)
    .sort((a, b) => a.sequence - b.sequence), [events, source]);
  return { myLearner, learner, sessions, setEvents, loading, error: calendarError || detailError, refresh };
}
