export const EVENT_FEEDBACK_PUBLIC_PATH = '/event-feedback';

export function eventFeedbackToken(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  return fragment.get('token') || query.get('token') || '';
}
