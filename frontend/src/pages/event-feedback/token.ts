export const EVENT_FEEDBACK_PUBLIC_PATH = '/event-feedback';

export function eventFeedbackToken(search: string, hash: string, historyState?: unknown) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const stored = historyState && typeof historyState === 'object'
    && 'eventFeedbackToken' in historyState
    && typeof historyState.eventFeedbackToken === 'string'
    ? historyState.eventFeedbackToken
    : '';
  return fragment.get('token') || query.get('token') || stored;
}
