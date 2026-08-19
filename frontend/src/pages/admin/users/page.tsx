// ============================================================================
// Accounts — login."Login_accounts"
//
// This is the sign-in register, which is a narrower set than the user directory
// at /users: that lists *people* (every learner, employer and staff row), while
// a person only appears here once they have been invited to the platform. The
// page says so, because the two counts differing is otherwise alarming.
//
// The three actions are the ones the backend actually supports. Role is not
// editable: identity.ensure_account recomputes it from the person's enrolment
// row on every request, so an edit here would be reverted within a request.
// ============================================================================
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminPage, DataPanel, Pager, SourceNote, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { accountAction, fetchAccounts, type AccountStatus, type PlatformAccount } from '@/api/platformAdmin';
import { accessLabel } from '@/api/staffUsers';
import { useAuth } from '@/hooks/useAuth';
import { AccessPanel } from './AccessPanel';

const ROLE_FILTERS = [
  { id: '', label: 'All roles' },
  { id: 'admin', label: 'Admin' },
  { id: 'staff', label: 'Staff' },
  { id: 'employer', label: 'Employer' },
  { id: 'learner', label: 'Learner' },
];

const STATUS_FILTERS = [
  { id: '', label: 'All statuses' },
  { id: 'active', label: 'Active' },
  { id: 'invited', label: 'Awaiting first sign-in' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'locked', label: 'Locked' },
];

const STATUS_TONE: Record<AccountStatus, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  active: 'ok',
  suspended: 'bad',
  locked: 'warn',
  invited: 'neutral',
};

const PAGE_SIZE = 25;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminAccountsPage() {
  // Deep links from the dashboard land here pre-filtered (?status=locked etc).
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || '';
  const status = params.get('status') || '';
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<number | null>(null);
  // The account whose access panel is open, from clicking their name.
  const [editingAccess, setEditingAccess] = useState<PlatformAccount | null>(null);
  const { auth } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  // Mail actions need a positive result, not just the absence of an error:
  // the whole reason to press them is to know something was sent.
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const { data, loading, error, reload, setData } = useAdminData(
    useCallback(
      () => fetchAccounts({ role, status, q: term, page, pageSize: PAGE_SIZE }),
      [role, status, term, page],
    ),
    [role, status, term, page],
  );

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  }

  async function runAction(
    account: PlatformAccount,
    action: 'suspend' | 'restore' | 'unlock' | 'resend-invitation' | 'send-password-reset',
  ) {
    setBusy(account.id);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await accountAction(account.id, action);
      const updated = res.account;
      // Patch in place so the row updates without losing the current page.
      setData(prev => prev && ({
        ...prev,
        results: prev.results.map(r => (r.id === updated.id ? updated : r)),
      }));
      // Only the two mail actions report back; suspend/restore/unlock show their
      // result in the row itself.
      if (res.resent) {
        setActionNotice(`Invitation sent to ${res.sentTo || updated.email}.`);
      } else if (res.resetSent) {
        setActionNotice(`Password reset sent to ${res.sentTo || updated.email}.`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.results ?? [];
  const count = data?.count ?? 0;

  return (
    <AdminPage
      title="Accounts"
      subtitle="Sign-in accounts, their role and their access state"
      icon="ri-shield-user-line"
      heroTitle="Platform accounts"
      heroBlurb={
        <>Every identity that can sign in, sourced from <strong>login.Login_accounts</strong>. People who have not been invited yet appear in the <a href="/users" className="underline hover:text-white">user directory</a>, not here.</>
      }
      stats={[{ label: 'Accounts', value: loading && !data ? '—' : count }]}
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
            placeholder="Search email or name, then press Enter"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <select
          value={role}
          onChange={e => setFilter('role', e.target.value)}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {ROLE_FILTERS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select
          value={status}
          onChange={e => setFilter('status', e.target.value)}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {STATUS_FILTERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-3 flex items-center gap-2.5">
          <AppIcon className="ri-error-warning-line text-red-600 text-sm"></AppIcon>
          <p className="text-[12px] text-red-800 flex-1">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 cursor-pointer">
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-3 flex items-center gap-2.5">
          <AppIcon className="ri-mail-check-line text-emerald-600 text-sm"></AppIcon>
          <p className="text-[12px] text-emerald-800 flex-1">{actionNotice}</p>
          <button onClick={() => setActionNotice(null)} className="text-emerald-400 hover:text-emerald-600 cursor-pointer">
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>
      )}

      <DataPanel
        loading={loading && !data}
        error={error}
        empty={rows.length === 0}
        emptyMessage={term || role || status ? 'No accounts match these filters.' : 'No accounts have been created yet.'}
        onRetry={reload}
      >
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Account</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Access</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Last sign-in</th>
                  <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Created</th>
                  <th className="text-right px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(account => (
                  <tr key={account.id} className="border-b border-background-100/50 hover:bg-background-100/40 transition-smooth">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0 ring-1 ring-primary-200/50">
                          <span className="text-primary-700 text-[10px] font-semibold">
                            {(account.displayName || account.email).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          {/* Clicking the name opens the access editor. Staff only:
                              a learner or employer has no grant to edit. */}
                          {account.subjectType === 'staff' ? (
                            <button
                              onClick={() => setEditingAccess(account)}
                              className="font-medium text-primary-600 hover:text-primary-700 hover:underline truncate cursor-pointer text-left block max-w-full"
                              title="Set this account's access"
                            >
                              {account.displayName || account.email}
                            </button>
                          ) : (
                            <p className="font-medium text-foreground-800 truncate">{account.displayName || '—'}</p>
                          )}
                          <p className="text-[11px] text-foreground-400 truncate">{account.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] text-foreground-600 capitalize">{account.role}</span>
                      <p className="text-[10px] text-foreground-300 capitalize">via {account.subjectType}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      {account.subjectType !== 'staff' ? (
                        <span className="text-[11px] text-foreground-300">n/a</span>
                      ) : account.access ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200/50 whitespace-nowrap">
                          {accessLabel(account.access)}
                        </span>
                      ) : (
                        <button
                          onClick={() => setEditingAccess(account)}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/50 whitespace-nowrap cursor-pointer hover:bg-amber-100"
                        >
                          Set access
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={account.status === 'invited' ? 'awaiting sign-in' : account.status} tone={STATUS_TONE[account.status]} />
                      {account.failedAttempts > 0 && (
                        <p className="text-[10px] text-amber-600 mt-0.5">{account.failedAttempts} failed attempts</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">
                      {fmtDate(account.lastLoginAt)}
                      {account.lastLoginIp && <p className="text-[10px] text-foreground-300">{account.lastLoginIp}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{fmtDate(account.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        {account.locked && (
                          <ActionButton busy={busy === account.id} onClick={() => runAction(account, 'unlock')} tone="warn" icon="ri-lock-unlock-line" label="Unlock" />
                        )}
                        {/* One or the other, never both: an invitation sets the
                            first password, a reset replaces an existing one. The
                            server enforces the same split, so this is the
                            applicable action rather than just the tidier label. */}
                        {account.hasPassword ? (
                          <ActionButton busy={busy === account.id} onClick={() => runAction(account, 'send-password-reset')} tone="warn" icon="ri-lock-password-line" label="Reset password" />
                        ) : (
                          <ActionButton busy={busy === account.id} onClick={() => runAction(account, 'resend-invitation')} tone="warn" icon="ri-mail-send-line" label="Resend invitation" />
                        )}
                        {account.isActive ? (
                          <ActionButton busy={busy === account.id} onClick={() => runAction(account, 'suspend')} tone="bad" icon="ri-forbid-line" label="Suspend" />
                        ) : (
                          <ActionButton busy={busy === account.id} onClick={() => runAction(account, 'restore')} tone="ok" icon="ri-refresh-line" label="Restore" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} count={count} onPage={setPage} />
        </div>
      </DataPanel>

      {editingAccess && (
        <AccessPanel
          account={editingAccess}
          isSelf={auth.account?.id === editingAccess.id}
          onClose={() => setEditingAccess(null)}
          onSaved={(access) =>
            // Patch the row in place so the new grant shows without a refetch.
            setData(prev => prev && ({
              ...prev,
              results: prev.results.map(r =>
                r.id === editingAccess.id ? { ...r, access } : r),
            }))
          }
        />
      )}

      <SourceNote>
        Suspending an account revokes its live sessions immediately and is recorded in the access log.
        A role cannot be changed here — it is derived from the person&apos;s enrolment record each request,
        so change their position in the staff form instead.
      </SourceNote>
    </AdminPage>
  );
}

function ActionButton({ onClick, tone, icon, label, busy }: {
  onClick: () => void; tone: 'ok' | 'bad' | 'warn'; icon: string; label: string; busy: boolean;
}) {
  const map = {
    ok: 'text-emerald-700 border-emerald-200/60 hover:bg-emerald-50',
    bad: 'text-red-700 border-red-200/60 hover:bg-red-50',
    warn: 'text-amber-700 border-amber-200/60 hover:bg-amber-50',
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${map[tone]}`}
    >
      <AppIcon className={`${busy ? 'ri-loader-4-line animate-spin' : icon} mr-1`}></AppIcon>{label}
    </button>
  );
}
