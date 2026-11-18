export const QUALITY_TICKET_CHANGED = 'feedback-quality-ticket-changed';

export function notifyQualityTicketClosed(responseId: number) {
  window.dispatchEvent(new CustomEvent(QUALITY_TICKET_CHANGED, { detail: { responseId, status: 'Closed' } }));
}
