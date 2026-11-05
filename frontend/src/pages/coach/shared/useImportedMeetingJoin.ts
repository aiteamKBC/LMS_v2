import { useCallback, useEffect, useRef } from 'react';
import { startMigratedReview, type ReviewInstanceFormDefinition } from '@/api/reviewInstances';

type JoinEvent = {
  id?: string; eventKey?: string; calendarEventKey?: string | null; formEventKey?: string | null;
  reviewSource?: string; status?: string; meetingLink?: string | null; graphWebLink?: string | null;
  scheduledDate?: string | null; scheduledTime?: string | null;
};

export function isImportedJoin(event: JoinEvent) {
  return event.reviewSource === 'aptem' || Boolean(event.eventKey?.startsWith('imported-review:'));
}

/** All Coach Join surfaces share this operation. Links keep browser navigation;
 * buttons open synchronously so waiting for the status POST cannot block Teams.
 */
export function useImportedMeetingJoin({ contextKey, readOnly, onError, onStarted }: {
  contextKey: string;
  readOnly: boolean;
  onError: (message: string | null) => void;
  onStarted: (event: JoinEvent, review: ReviewInstanceFormDefinition) => void;
}) {
  const current = useRef({ contextKey, readOnly, onError, onStarted });
  current.current = { contextKey, readOnly, onError, onStarted };
  const active = useRef(true);
  const pending = useRef(new Set<string>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return useCallback((event: JoinEvent, navigate = true) => {
    const url = event.meetingLink || event.graphWebLink;
    if (!url) { current.current.onError('This meeting does not have a Teams link yet.'); return; }
    if (navigate) window.open(url, '_blank', 'noopener,noreferrer');
    if (!isImportedJoin(event) || !['scheduled', 'in-progress'].includes(event.status || '')) return;
    if (current.current.readOnly) {
      current.current.onError('Teams can be opened, but this Review cannot be started while viewing as another Coach.');
      return;
    }
    const key = event.calendarEventKey || event.eventKey || event.id;
    if (!key) { current.current.onError('Teams opened, but the Review booking could not be identified.'); return; }
    const scope = current.current.contextKey;
    const requestKey = `${scope}:${key}`;
    if (pending.current.has(requestKey)) return;
    pending.current.add(requestKey);
    current.current.onError(null);
    const reviewKey = event.formEventKey || (event.eventKey?.startsWith('imported-review:') ? event.eventKey : key);
    void startMigratedReview(reviewKey, { calendarEventKey: key, meetingLink: url,
      scheduledDate: event.scheduledDate, scheduledTime: event.scheduledTime }).then(review => {
      if (!active.current || current.current.contextKey !== scope || current.current.readOnly) return;
      if ((review.localStatus || review.instance.status) !== 'in-progress') throw new Error('The Review start was not confirmed.');
      current.current.onStarted(event, review);
    }).catch(error => {
      if (active.current && current.current.contextKey === scope && !current.current.readOnly) {
        current.current.onError(`Teams opened, but the Review could not be started. ${error instanceof Error ? error.message : 'Retry after checking the Review booking.'}`);
      }
    }).finally(() => { pending.current.delete(requestKey); });
  }, []);
}
