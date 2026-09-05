// ============================================================================
// Access logs — login."Login_audit"
//
// A real append-only trail: every sign-in, sign-out, invitation, reset and
// password change, successful or not. Failed attempts against addresses that
// have no account are recorded too, which is the half worth reading.
//
// This page replaces both of the old mock screens (Audit Logs and Access Logs),
// which showed the same invented events under two names.
// ============================================================================
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminPage, DataPanel, Pager, SourceNote } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { fetchAuditLog, type AuditEntry } from '@/api/platformAdmin';
import { ResendInvitationButton, canResendInvitation } from '../_shared/ResendInvitation';

const PAGE_SIZE = 50;

const EVENT_LABELS: Record<string, string> = {
  login: 'Sign-in',
  logout: 'Sign-out',
  invite_sent: 'Invitation sent',
  invite_accepted: 'Invitation accepted',
  reset_requested: 'Password reset requested',
  reset_completed: 'Password reset completed',
  password_changed: 'Password changed',
  admin_suspend: 'Account suspended',
  admin_restore: 'Account restored',
  admin_unlock: 'Account unlocked',
};

/** Machine reasons the backend records, in words. */
const REASON_LABELS: Record<string, string> = {
  bad_password: 'Incorrect password',
  locked: 'Account locked',
  no_account: 'No such account',
  inactive: 'Account suspended',
  ip_throttled: 'Too many attempts from this address',
  no_password: 'Password never set',
};

function label(event: string): string {
  return EVENT_LABELS[event] || event.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Condense a user agent to something that fits a table cell. */
function shortAgent(ua: string | null): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export default function AdminAccessLogsPage() {
  const [params, setParams] = useSearchParams();
  const outcome = (params.get('outcome') || '') as 'success' | 'failure' | '';
  const event = params.get('event') || '';
  const [days, setDays] = useState(0);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, loading, error, reload } = useAdminData(
    useCallback(
      () => fetchAuditLog({ event, outcome, q: term, days, page, pageSize: PAGE_SIZE }),
      [event, outcome, term, days, page],
    ),
    [event, outcome, term, days, page],
  );

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  }

  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const failures = rows.filter(r => !r.succeeded).length;

  return (
    <AdminPage
      title="Access Logs"
      subtitle="Every authentication event recorded by the platform"
      icon="ri-door-lock-line"
      heroTitle="Access and authentication trail"
      heroBlurb={
        <>Append-only, from <strong>login.Login_audit</strong>. Failed attempts against unknown addresses are recorded too, so a probe leaves a trace.</>
      }
      stats={[
        { label: 'Events', value: loading && !data ? '—' : count },
        { label: 'Failures shown', value: loading && !data ? '—' : failures },
      ]}
    >
      {/* Filters */}
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1 min-w-0">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setTerm(search); setPage(1); } }}
            onBlur={() => { setTerm(search); setPage(1); }}
            placeholder="Search by email address, then press Enter"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <select
          value={event}
          onChange={e => setFilter('event', e.target.value)}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">All events</option>
          {(data?.eventTypes ?? []).map(e => <option key={e} value={e}>{label(e)}</option>)}
        </select>
        <select
          value={outcome}
          onChange={e => setFilter('outcome', e.target.value)}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">Any outcome</option>
          <option value="success">Succeeded</option>
          <option value="failure">Failed</option>
        </select>
        <select
          value={String(days)}
          onChange={e => { setDays(Number(e.target.value)); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="0">All time</option>
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <DataPanel
        loading={loading && !data}
        error={error}
        empty={rows.length === 0}
        emptyMessage={term || event || outcome || days ? 'No events match these filters.' : 'No access events recorded yet.'}
        onRetry={reload}
      >
        <div className="admin-cool-table bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Event</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Address</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Outcome</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Source</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">When</th>
                  <th className="text-right px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry: AuditEntry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          entry.severity === 'critical' ? 'bg-red-500' : entry.severity === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}></span>
                        <span className="font-medium text-foreground-800 whitespace-nowrap">{label(entry.event)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-600 truncate max-w-[220px]">
                      {entry.email || <span className="text-foreground-300">unknown</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.succeeded ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                          Succeeded
                        </span>
                      ) : (
                        <div>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200/50">
                            Failed
                          </span>
                          {entry.reason && (
                            <p className="text-[10px] text-red-600 mt-0.5">{REASON_LABELS[entry.reason] || entry.reason}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">
                      {entry.ipAddress || '—'}
                      {expanded === entry.id
                        ? <p className="text-[10px] text-foreground-300 whitespace-normal break-all max-w-[280px]">{entry.userAgent || 'No user agent recorded'}</p>
                        : <p className="text-[10px] text-foreground-300">{shortAgent(entry.userAgent)}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtDateTime(entry.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {/* The only row type an administrator can act on from the
                          log: an invitation whose delivery failed. */}
                      {canResendInvitation(entry) && (
                        <ResendInvitationButton entry={entry} onResent={reload} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} count={count} onPage={setPage} />
        </div>
      </DataPanel>

      <SourceNote>
        This log is written by the authentication layer itself and is never edited or deleted from the
        application. Select a row to see the full user agent.
      </SourceNote>
    </AdminPage>
  );
}
