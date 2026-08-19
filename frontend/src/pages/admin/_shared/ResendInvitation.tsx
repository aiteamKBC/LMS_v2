// ============================================================================
// Re-send an invitation whose delivery failed.
//
// Offered from the access log because that is where a failed send is actually
// noticed — a transient DNS or mail outage leaves an "Invitation sent — failed"
// row and an account nobody can reach. Re-running the creation form would be the
// wrong fix (the person already exists); this re-issues the credential and mails
// it again, superseding the dead link.
//
// Shown only on rows that are genuinely fixable this way: a failed `invite_sent`
// that still names an account. Everything else gets nothing, because a button
// that does not apply is worse than no button.
// ============================================================================
import { useState } from 'react';
import { accountAction, type AuditEntry } from '@/api/platformAdmin';

/** Whether this audit row is a failed invitation that can be re-sent. */
export function canResendInvitation(entry: AuditEntry): boolean {
  return entry.event === 'invite_sent' && !entry.succeeded && entry.accountId != null;
}

export function ResendInvitationButton({
  entry,
  onResent,
}: {
  entry: AuditEntry;
  /** Lets the caller refresh the feed — the resend writes a new audit row. */
  onResent?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (entry.accountId == null) return;
    setState('sending');
    setError(null);
    try {
      await accountAction(entry.accountId, 'resend-invitation');
      setState('sent');
      onResent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not re-send the invitation.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50 whitespace-nowrap">
        <AppIcon className="ri-check-line mr-1"></AppIcon>Re-sent
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={e => { e.stopPropagation(); void resend(); }}
        disabled={state === 'sending'}
        className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-primary-200/60 text-primary-700 hover:bg-primary-50 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        title={`Re-send the invitation to ${entry.email || 'this account'}`}
      >
        <AppIcon className={`${state === 'sending' ? 'ri-loader-4-line animate-spin' : 'ri-mail-send-line'} mr-1`}></AppIcon>
        {state === 'sending' ? 'Sending…' : 'Re-send'}
      </button>
      {error && (
        <span className="text-[10px] text-red-600 max-w-[220px] text-right leading-snug">{error}</span>
      )}
    </span>
  );
}
