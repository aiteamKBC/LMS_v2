// ============================================================================
// Email delivery — login."Invitations" and login."Password_resets"
//
// The platform sends exactly two kinds of transactional email, and both tables
// record when it was sent and what went wrong. That is the entire delivery
// story, so this page shows it.
//
// The screen this replaces reported SMS and WhatsApp delivery counts alongside
// email. No SMS or WhatsApp transport exists in this codebase — those figures
// were fixtures, and a delivery dashboard that invents channels is worse than
// no dashboard.
// ============================================================================
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { AdminPage, DataPanel, Pager, SourceNote, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { useToast } from '@/hooks/useToast';
import { acknowledgeEmail, fetchEmailLog, type EmailLogRow } from '@/api/platformAdmin';

const PAGE_SIZE = 25;

const STATUS_TONE: Record<EmailLogRow['status'], 'ok' | 'bad' | 'warn' | 'neutral'> = {
  accepted: 'ok',
  delivered: 'ok',
  failed: 'bad',
  // Neutral, not bad: it still failed, but somebody has dealt with it, and a red
  // badge would keep asking for attention that has already been given.
  acknowledged: 'neutral',
  queued: 'warn',
};

const STATUS_LABEL: Record<EmailLogRow['status'], string> = {
  accepted: 'accepted',
  delivered: 'sent',
  failed: 'failed',
  acknowledged: 'acknowledged',
  queued: 'not sent',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminEmailDeliveryPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const status = params.get('status') || '';
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  // The row currently being written, so its button can say so and cannot be
  // pressed twice.
  const [acking, setAcking] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData(
    useCallback(() => fetchEmailLog({ status, kind, page, pageSize: PAGE_SIZE }), [status, kind, page]),
    [status, kind, page],
  );

  const rows = data?.results ?? [];
  const stats = data?.stats;
  const transport = data?.transport;

  /**
   * Acknowledge a failure, or put it back.
   *
   * Reloads rather than patching the row in place: acknowledging also moves the
   * counts above and, when the Failed filter is on, the row itself out of the
   * list — so a local edit would leave three things on screen disagreeing.
   */
  const setAcknowledged = async (row: EmailLogRow, acknowledged: boolean) => {
    setAcking(row.id);
    try {
      // The row id is a display key ("invitation-15"); the endpoint wants the
      // kind and the number separately.
      const numericId = Number(row.id.slice(row.kind.length + 1));
      await acknowledgeEmail(row.kind, numericId, acknowledged);
      toast.success(
        acknowledged ? 'Acknowledged' : 'Moved back to failed',
        acknowledged
          ? `${row.email} no longer counts as needing attention.`
          : `${row.email} is listed as a failure again.`,
      );
      reload();
    } catch (err) {
      toast.error(
        'Could not update this email',
        err instanceof Error ? err.message : 'Unexpected error',
      );
    } finally {
      setAcking(null);
    }
  };

  return (
    <AdminPage
      title="Email Delivery"
      subtitle="Invitations and password resets, and whether they were delivered"
      icon="ri-mail-send-line"
      heroTitle="Transactional email"
      heroBlurb={
        <>The platform sends invitations and password resets. Both are recorded with their send result, so an email that never left is visible here.</>
      }
      stats={[
        { label: 'Sent', value: loading && !data ? '—' : (stats?.sent ?? 0) },
        { label: 'Failed', value: loading && !data ? '—' : (stats?.failed ?? 0) },
        { label: 'Delivery', value: loading && !data ? '—' : (stats?.deliveryRate == null ? '—' : `${stats.deliveryRate}%`) },
      ]}
    >
      {/* Transport readiness — the cause of most "nothing was sent" reports */}
      {transport && !transport.configured && (
        <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-4 flex items-start gap-3">
          <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <AppIcon className="ri-alert-line text-amber-600 text-sm"></AppIcon>
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Email transport is not configured</p>
            <p className="text-[12px] text-amber-700 mt-1">
              Invitations and resets cannot be delivered until these settings are present:{' '}
              <span className="font-mono">{transport.missing.join(', ')}</span>.
              Accounts can still be created — the person just will not receive their link.
            </p>
          </div>
        </div>
      )}

      {/* Real figures */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <Tile label="Invitations sent" value={stats.invitations} icon="ri-mail-send-line" tone="neutral" />
          <Tile label="Resets sent" value={stats.resets} icon="ri-lock-password-line" tone="neutral" />
          {/* Outstanding, not the historical total: this tile answers "is there
              anything to do", and an acknowledged failure is done. The total is
              still what the delivery rate in the header is calculated from. */}
          <Tile
            label="Failed to send"
            value={stats.outstanding}
            icon="ri-mail-close-line"
            tone={stats.outstanding > 0 ? 'bad' : 'ok'}
            sub={stats.acknowledged > 0 ? `${stats.acknowledged} acknowledged` : undefined}
          />
          <Tile label="Last 30 days" value={stats.last30d} icon="ri-calendar-line" tone="neutral" />
        </div>
      )}

      {/* Filters */}
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <select
          value={kind}
          onChange={e => { setKind(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">Both kinds</option>
          <option value="invitation">Invitations</option>
          <option value="reset">Password resets</option>
        </select>
        <select
          value={status}
          onChange={e => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('status', e.target.value); else next.delete('status');
            setParams(next, { replace: true });
            setPage(1);
          }}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">Any status</option>
          <option value="delivered">Sent</option>
          <option value="failed">Failed</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="pending">Not yet used</option>
        </select>
      </div>

      <DataPanel
        loading={loading && !data}
        error={error}
        empty={rows.length === 0}
        emptyMessage={status || kind ? 'No emails match these filters.' : 'No invitations or resets have been issued yet.'}
        onRetry={reload}
      >
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Recipient</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Kind</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Sent</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Used</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Expires</th>
                  <th className="text-right px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground-800 truncate max-w-[240px]">{row.email}</p>
                      {row.error && <p className="text-[10px] text-red-600 mt-0.5 truncate max-w-[240px]">{row.error}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-600">
                      {row.kind === 'reset' ? 'Password reset' : 'Invitation'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtDateTime(row.sentAt)}</td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtDateTime(row.usedAt)}</td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtDateTime(row.expiresAt)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {row.status === 'failed' && (
                        <button
                          type="button"
                          disabled={acking === row.id}
                          onClick={() => setAcknowledged(row, true)}
                          title="Stop this counting as something needing attention. The record stays."
                          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                        >
                          <AppIcon className={acking === row.id ? 'ri-loader-4-line animate-spin' : 'ri-check-double-line'}></AppIcon>
                          {acking === row.id ? 'Saving...' : 'Acknowledge'}
                        </button>
                      )}
                      {row.status === 'acknowledged' && (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-[10px] text-foreground-400">
                            {row.acknowledgedBy ? `by ${row.acknowledgedBy}` : 'acknowledged'}
                          </span>
                          <button
                            type="button"
                            disabled={acking === row.id}
                            onClick={() => setAcknowledged(row, false)}
                            title="Put this back among the failures needing attention"
                            className="text-[11px] font-semibold text-foreground-400 hover:text-foreground-700 disabled:opacity-60 cursor-pointer"
                          >
                            Undo
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
        </div>
      </DataPanel>

      <SourceNote>
        Only the hash of each emailed link is stored, so a link cannot be recovered from here — re-issue
        the invitation from the account instead. &ldquo;Accepted&rdquo; means the recipient used the link.
        Acknowledging a failure clears it from the dashboard alert and from the count above; the row and
        its error stay here, and the delivery rate still counts it.
      </SourceNote>
    </AdminPage>
  );
}

function Tile({ label, value, icon, tone, sub }: { label: string; value: number; icon: string; tone: 'ok' | 'bad' | 'neutral'; sub?: string }) {
  const map = { ok: 'bg-emerald-100 text-emerald-600', bad: 'bg-red-100 text-red-600', neutral: 'bg-primary-100 text-primary-600' };
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 card-premium">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${map[tone]} mb-3`}>
        <AppIcon className={`${icon} text-sm`}></AppIcon>
      </span>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-foreground-300 mt-0.5">{sub}</p>}
    </div>
  );
}
