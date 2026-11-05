import { type AuditEntry } from '@/api/platformAdmin';


/** Whether this audit row is a failed invitation that can be re-sent. */
export function canResendInvitation(entry: AuditEntry): boolean {
  return entry.event === 'invite_sent' && !entry.succeeded && entry.accountId != null;
}
