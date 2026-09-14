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
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AdminPage, DataPanel, Pager, SourceNote, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { accountAction, addLearnerRecord, fetchAccounts, type AccountStatus, type PlatformAccount } from '@/api/platformAdmin';
import { accessLabel, accessShortLabel, fetchStaffUser, type StaffUserRow } from '@/api/staffUsers';
import { useAuth } from '@/hooks/useAuth';
import { EditStaffModal } from '@/pages/users/components/EditStaffModal';
import { AccessPanel } from './AccessPanel';
import { fetchCohorts, fetchGroups, fetchProgrammes } from '@/api/curriculum';

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
  // The account whose access panel is open, from clicking its Access badge.
  const [editingAccess, setEditingAccess] = useState<PlatformAccount | null>(null);
  // The account being given a learner record, if any. Opens a small form for
  // the programme and cohort the record should start with.
  const [enrollingAccount, setEnrollingAccount] = useState<PlatformAccount | null>(null);
  // The person record behind an account, open for editing from clicking their
  // name. A login account holds almost none of this — name, email, position and
  // contact details live on the staff row it points at — so the record is
  // fetched by `subjectId` and handed to the directory's own edit form.
  const [editingRecord, setEditingRecord] = useState<StaffUserRow | null>(null);
  const [openingRecord, setOpeningRecord] = useState<number | null>(null);
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

  async function openRecord(account: PlatformAccount) {
    setOpeningRecord(account.id);
    setActionError(null);
    setActionNotice(null);
    try {
      setEditingRecord(await fetchStaffUser(String(account.subjectId)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open this account’s record.');
    } finally {
      setOpeningRecord(null);
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
        <>Every identity that can sign in, sourced from <strong>login.Login_accounts</strong>. People who have not been invited yet appear in the <Link to="/users" className="text-primary-700 underline underline-offset-2 hover:text-primary-800">user directory</Link>, not here.</>
      }
      stats={[{ label: 'Accounts', value: loading && !data ? '—' : count }]}
    >
      {/* Filters */}
      <div className="bg-[var(--kbc-surface)] rounded-2xl border border-[var(--kbc-border)] p-3 md:p-4 flex flex-col xl:flex-row gap-3 xl:items-center">
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
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200 min-w-0 max-w-full"
        >
          {ROLE_FILTERS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select
          value={status}
          onChange={e => setFilter('status', e.target.value)}
          className="px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200 min-w-0 max-w-full"
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
        <div className="bg-[var(--kbc-surface)] rounded-2xl border border-[var(--kbc-border)] overflow-hidden">
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
                  <tr key={account.id} className="border-b border-background-100/50 hover:bg-primary-50/40 transition-smooth">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary-100/60 flex items-center justify-center shrink-0 ring-1 ring-primary-200/50 !bg-none shadow-md shadow-primary-900/10 ring-1 ring-inset ring-primary-200/60">
                          <span className="text-primary-700 text-[10px] font-semibold">
                            {(account.displayName || account.email).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          {/* Clicking the name opens the person record behind the
                              account — the same form the user directory edits, not
                              a second one. The Access badge stays its own editor,
                              because granting access is an admin-only act with
                              rules of its own. A learner's record is not a form
                              but a whole board — programme, documents, coach — so
                              their name links to it at /users/:id rather than
                              re-drawing it here; ?source=commercial goes with it
                              because the board reads its documents by learner
                              kind. An employer account is left plain: its record
                              is the employer's, not a person's. */}
                          {account.subjectType === 'staff' ? (
                            <button
                              onClick={() => openRecord(account)}
                              disabled={openingRecord === account.id}
                              className="font-medium text-primary-600 hover:text-primary-700 hover:underline truncate cursor-pointer text-left block max-w-full disabled:opacity-50 disabled:cursor-wait"
                              title="Edit this person's record — name, email, contact details and position"
                            >
                              {openingRecord === account.id && (
                                <AppIcon className="ri-loader-4-line animate-spin mr-1 text-[11px]"></AppIcon>
                              )}
                              {account.displayName || account.email}
                            </button>
                          ) : account.subjectType === 'learner' ? (
                            <Link
                              to={`/users/${account.subjectId}${account.learnerType === 'commercial' ? '?source=commercial' : ''}`}
                              className="font-medium text-primary-600 hover:text-primary-700 hover:underline truncate block max-w-full"
                              title="Open this learner's record — programme, details, documents and coach"
                            >
                              {account.displayName || account.email}
                            </Link>
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
                      {/* Only staff have a grant. A learner's reach is fixed by
                          being a learner — their own workspace and nothing else,
                          enforced by login.permissions.learner_self_only — so
                          there is no value here to edit. Rather than a bare
                          "n/a", say that, and send the click to the thing that
                          *does* decide what this person can reach: their
                          enrolment status, on their record. */}
                      {account.subjectType === 'learner' ? (
                        <Link
                          to={`/users/${account.subjectId}${account.learnerType === 'commercial' ? '?source=commercial' : ''}`}
                          className="text-[11px] text-foreground-400 hover:text-primary-600 hover:underline whitespace-nowrap"
                          title="Learners have no access grant — their reach is fixed by being a learner. Their enrolment status is edited on their record."
                        >
                          Set by enrolment
                        </Link>
                      ) : account.subjectType !== 'staff' ? (
                        <span className="text-[11px] text-foreground-300" title="Employer accounts have no access grant — their reach comes from the employer record.">
                          Set by employer record
                        </span>
                      ) : account.access ? (
                        // The workspace they sign in to, named; anything else
                        // they hold as a count. Listing every grant in full
                        // wrapped the cell onto three lines and repeated the
                        // word "access" three times — the extra grants are
                        // worth knowing about, but they are not what this
                        // column is for. The names are a hover away, and the
                        // panel behind the click shows them properly.
                        <button
                          onClick={() => setEditingAccess(account)}
                          className="inline-flex items-center gap-1 text-left cursor-pointer group whitespace-nowrap"
                          title={
                            (account.accesses?.length ?? 0) > 1
                              ? `Signs in to ${accessLabel(account.access)}. Also holds `
                                + `${account.accesses!.filter(v => v !== account.access).map(accessLabel).join(', ')}.`
                              : `${accessLabel(account.access)}. Click to change.`
                          }
                        >
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-primary-50 text-primary-700 border-primary-200/50 group-hover:bg-primary-100 group-hover:border-primary-300">
                            {accessShortLabel(account.access)}
                          </span>
                          {(account.accesses?.length ?? 0) > 1 && (
                            <span className="text-[10px] font-semibold text-foreground-400 group-hover:text-foreground-600">
                              +{account.accesses!.length - 1}
                            </span>
                          )}
                          <AppIcon className="ri-pencil-line text-[9px] opacity-0 group-hover:opacity-60 transition-opacity"></AppIcon>
                        </button>
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
                        {/* Staff and employers can also study a programme.
                            Offered only to accounts that are not already a
                            learner — the server refuses a duplicate anyway, so
                            this hides an action that could only fail. */}
                        {account.subjectType !== 'learner' && (
                          <ActionButton busy={busy === account.id} onClick={() => setEnrollingAccount(account)} tone="ok" icon="ri-graduation-cap-line" label="Add as learner" />
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

      {editingRecord && (
        <EditStaffModal
          row={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSaved={updated => {
            // Name, email and access come straight back, so the row repaints
            // now. Role is derived from position and access on the server, so
            // the list is refreshed behind that rather than guessed at here.
            setData(prev => prev && ({
              ...prev,
              results: prev.results.map(r => (
                r.subjectType === 'staff' && String(r.subjectId) === String(updated.id)
                  ? { ...r, displayName: updated.name, email: updated.email, access: updated.access }
                  : r
              )),
            }));
            reload();
          }}
        />
      )}

      {enrollingAccount && (
        <AddLearnerModal
          account={enrollingAccount}
          onClose={() => setEnrollingAccount(null)}
          onCreated={learnerRecordId => {
            // Said plainly, with where to go next: the record exists but is a
            // draft, and the plan is assigned in the directory rather than here.
            setActionNotice(
              `${enrollingAccount.displayName || enrollingAccount.email} now has a learner record `
              + `(#${learnerRecordId}). Assign their learning plan in the user directory, then `
              + 'finish enrolment to make them a live learner.',
            );
            reload();
          }}
        />
      )}

      {editingAccess && (
        <AccessPanel
          account={editingAccess}
          isSelf={auth.account?.id === editingAccess.id}
          onClose={() => setEditingAccess(null)}
          onSaved={(access, accesses) =>
            // Patch the row in place so the new grant shows without a refetch.
            // Both fields, not just the primary: this panel seeds its ticks
            // from `accesses` when it reopens, so patching only `access` left
            // the row claiming one grant and a second access looked like it
            // had not saved — it had, on the server.
            setData(prev => prev && ({
              ...prev,
              results: prev.results.map(r =>
                r.id === editingAccess.id ? { ...r, access, accesses } : r),
            }))
          }
        />
      )}

      <SourceNote>
        Suspending an account revokes its live sessions immediately and is recorded in the access log.
        A role cannot be changed here — it is derived from the person&apos;s enrolment record each request.
        Click a name to edit that record: its position and access are what the role is computed from.
        Access itself is a staff grant only — a learner or employer has none, because what they can
        reach follows from being a learner or an employer.
      </SourceNote>
    </AdminPage>
  );
}

/**
 * Give an account a learner record as well.
 *
 * Creates only the enrolment row. The person keeps the single account they
 * already have — a second one on the same address would make sign-in ambiguous
 * and lock them out — and reaches the learner side from the workspace switcher.
 * The record starts as a draft, so it appears in the user directory where the
 * learning plan is assigned; finishing enrolment there is what makes them live.
 */
function AddLearnerModal({ account, onClose, onCreated }: {
  account: PlatformAccount;
  onClose: () => void;
  onCreated: (learnerRecordId: number) => void;
}) {
  const [programme, setProgramme] = useState('');
  const [cohort, setCohort] = useState('');
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chosen from the curriculum, not typed. A free-text programme that does not
  // match a real one leaves the learner with a plan nobody can build, and the
  // three are a cascade: a cohort belongs to a programme and a group to a
  // cohort, so each list is fetched once its parent is known.
  const [programmes, setProgrammes] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchProgrammes()
      .then(rows => { if (!cancelled) setProgrammes(rows); })
      .catch(() => { if (!cancelled) setProgrammes([]); });
    return () => { cancelled = true; };
  }, []);

  // Cleared before each refetch, so the list can never show a moment of the
  // previous programme's cohorts against the new one.
  useEffect(() => {
    let cancelled = false;
    setCohorts([]);
    setCohort('');
    setGroup('');
    if (!programme) return;
    fetchCohorts(programme)
      .then(rows => { if (!cancelled) setCohorts(rows); })
      .catch(() => { if (!cancelled) setCohorts([]); });
    return () => { cancelled = true; };
  }, [programme]);

  useEffect(() => {
    let cancelled = false;
    setGroups([]);
    setGroup('');
    if (!programme || !cohort) return;
    fetchGroups(programme, cohort)
      .then(rows => { if (!cancelled) setGroups(rows); })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, [programme, cohort]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await addLearnerRecord(account.id, {
        programme: programme.trim(),
        cohort: cohort.trim(),
        group: group.trim(),
      });
      onCreated(res.learnerRecordId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the learner record.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background-50 rounded-2xl border border-background-200 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 border-b border-foreground-200/60">
          <h3 className="text-base font-heading font-semibold text-foreground-900">Add as learner</h3>
          <p className="mt-1 text-[12px] text-foreground-500 leading-relaxed">
            Creates a learner record for <strong>{account.displayName || account.email}</strong>.
            They keep the account they already have and reach the learner workspace from the
            Workspaces menu.
          </p>
        </div>

        <div className="p-6 space-y-4">
          <label className="block">
            <span className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Programme</span>
            <select
              value={programme}
              onChange={e => setProgramme(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2 text-[13px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200"
            >
              <option value="">Select a programme</option>
              {programmes.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Cohort</span>
            <select
              value={cohort}
              onChange={e => setCohort(e.target.value)}
              disabled={!programme}
              className="mt-1.5 w-full rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2 text-[13px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{programme ? 'Select a cohort' : 'Select a programme first'}</option>
              {cohorts.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Group</span>
            <select
              value={group}
              onChange={e => setGroup(e.target.value)}
              disabled={!programme || !cohort}
              className="mt-1.5 w-full rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2 text-[13px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{!programme ? 'Select a programme first' : !cohort ? 'Select a cohort first' : 'Select a group'}</option>
              {groups.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <p className="text-[11px] text-foreground-400 leading-relaxed">
            All three are optional and can be set later. The record starts as a draft — assign a
            learning plan in the user directory, then finish enrolment to make them a live learner.
          </p>
          {error && (
            <div className="bg-red-50 border border-red-200/60 rounded-xl p-3">
              <p className="text-[11px] text-red-800 leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-foreground-200/60 flex items-center gap-3 bg-background-100/40">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-40"
          >
            <AppIcon className={`${saving ? 'ri-loader-4-line animate-spin' : 'ri-graduation-cap-line'} mr-1.5`}></AppIcon>
            {saving ? 'Adding…' : 'Add as learner'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ onClick, tone, icon, label, busy }: {
  onClick: () => void; tone: 'ok' | 'bad' | 'warn'; icon: string; label: string; busy: boolean;
}) {
  const map = {
    ok: 'bg-emerald-50/50 text-emerald-700 border-emerald-200/60 hover:bg-emerald-100',
    bad: 'bg-red-50/50 text-red-700 border-red-200/60 hover:bg-red-100',
    warn: 'bg-amber-50/50 text-amber-700 border-amber-200/60 hover:border-red-200 hover:bg-red-50 hover:text-red-700',
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
