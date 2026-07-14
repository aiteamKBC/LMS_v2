import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useToast } from '@/hooks/useToast';
import { fetchCommercialUsers, updateCommercialUser, type CommercialUserRow } from '@/api/commercialUsers';
import { fetchEnrolmentUsers, updateEnrolmentUser, PROGRAMME_STATUS_OPTIONS } from '@/api/enrolmentUsers';
import { fetchLearnerCoach, updateLearnerCoach } from '@/api/coach';
import type { UserListRow, ProgrammeStatus } from '@/pages/users/types';
import { Hero, Table, EmptyState, btnPrimary, inputClass } from '@/pages/users/components/ui';
import { CommercialUserModal } from './CommercialUserModal';

// Inline per-row programme-status picker. Optimistically updates, reverts on error.
function StatusSelect({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setVal(value), [value]);
  const change = async (next: string) => {
    const prev = val;
    setVal(next);
    setSaving(true);
    try {
      await onSave(next);
    } catch {
      setVal(prev);
    } finally {
      setSaving(false);
    }
  };
  return (
    <select
      value={val}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => change(e.target.value)}
      disabled={saving}
      className={`${inputClass} !py-1 !text-[12px] cursor-pointer min-w-[150px]`}
    >
      <option value="">— Set status —</option>
      {PROGRAMME_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// Two inline inputs (coach name + email) + an explicit Save button, stored on
// the learner's Active_users mirror. Loads current values on mount. When a coach
// is saved, a "Coach assigned" badge is shown above the inputs. Only Active
// learners have a mirror row — a 404 means "set the learner Active first", so
// the inputs are hidden with a hint.
function CoachFields({ learnerId }: { learnerId: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Last-saved values, to detect unsaved edits and drive the "has coach" badge.
  const [saved, setSaved] = useState<{ name: string; email: string }>({ name: '', email: '' });
  const [available, setAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLearnerCoach(learnerId)
      .then((c) => {
        if (cancelled) return;
        setName(c.coachName);
        setEmail(c.coachEmail);
        setSaved({ name: c.coachName, email: c.coachEmail });
      })
      .catch((e) => {
        if (cancelled) return;
        if ((e as { status?: number }).status === 404) setAvailable(false);
      });
    return () => { cancelled = true; };
  }, [learnerId]);

  const dirty = name.trim() !== saved.name || email.trim() !== saved.email;
  const hasCoach = !!(saved.name || saved.email);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(false);
    try {
      const res = await updateLearnerCoach(learnerId, { coachName: name.trim(), coachEmail: email.trim() });
      setName(res.coachName);
      setEmail(res.coachEmail);
      setSaved({ name: res.coachName, email: res.coachEmail });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  if (!available) {
    return <span className="text-[11px] text-foreground-300 italic">Set learner Active to add a coach</span>;
  }

  return (
    <div className="flex flex-col gap-1 min-w-[190px]" onClick={(e) => e.stopPropagation()}>
      {/* Persistent "has coach" indicator */}
      {hasCoach && (
        <span
          className="inline-flex items-center gap-1 self-start text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"
          title={saved.email ? `${saved.name || 'Coach'} · ${saved.email}` : saved.name}
        >
          <i className="ri-user-star-line text-[11px]" />
          Coach: {saved.name || saved.email}
        </span>
      )}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Coach name"
        className={`${inputClass} !py-1 !text-[12px]`}
      />
      <input
        value={email}
        type="email"
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Coach email"
        className={`${inputClass} !py-1 !text-[12px]`}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className={`${btnPrimary} !py-1 !px-3 !text-[11px] disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {saving ? <><i className="ri-loader-4-line animate-spin" />Saving…</> : <><i className="ri-save-line" />Save</>}
        </button>
        {error && <span className="text-[10px] text-red-600">Couldn’t save</span>}
        {!error && !dirty && hasCoach && <span className="text-[10px] text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}

// ============================================================================
// Learners hub — two tables side by side:
//   1. Commercial enrolled learners  (enrolment."Commercial_users")
//   2. Apprenticeship enrolled learners (enrolment."Enrolment_Users")
// Each has an "Add learner" action; selecting any row opens the training-plan
// builder for that learner.
// ============================================================================

const enrolmentNav = roleNavMap.compliance;

function TableCard({
  title,
  icon,
  count,
  action,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 card-premium overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-foreground-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-primary-50 border border-primary-200/40 flex items-center justify-center shrink-0">
            <i className={`${icon} text-primary-600 text-[15px]`} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-heading font-semibold text-foreground-900 truncate">{title}</h3>
            <p className="text-[11px] text-foreground-400">{count} learner{count === 1 ? '' : 's'}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="flex-1 overflow-x-auto">{children}</div>
    </div>
  );
}

export default function LearnersPage() {
  const navigate = useNavigate();
  const { error } = useToast();
  const [commercial, setCommercial] = useState<CommercialUserRow[]>([]);
  const [apprentices, setApprentices] = useState<UserListRow[]>([]);
  const [loadingC, setLoadingC] = useState(true);
  const [loadingA, setLoadingA] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const loadCommercial = () => {
    setLoadingC(true);
    fetchCommercialUsers()
      .then(setCommercial)
      .catch((e) => error('Could not load commercial learners', e instanceof Error ? e.message : 'Unexpected error'))
      .finally(() => setLoadingC(false));
  };

  useEffect(() => {
    loadCommercial();
    fetchEnrolmentUsers()
      .then((rows) => setApprentices(rows.filter((r) => r.type === 'User')))
      .catch((e) => error('Could not load apprenticeship learners', e instanceof Error ? e.message : 'Unexpected error'))
      .finally(() => setLoadingA(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = commercial.length + apprentices.length;

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={enrolmentNav.label}
      navItems={enrolmentNav.items}
      workspaceLabel={enrolmentNav.workspaceLabel}
      pageTitle="delivery"
      pageSubtitle="Learners & training plans"
      userName="Enrolment Officer"
      userRole="Enrolment Officer"
    >
      <div className="p-6 space-y-6">
        <Hero
          icon="ri-briefcase-4-line"
          title="Enrolled learners"
          subtitle={<><strong>{total} learners</strong> — {commercial.length} commercial, {apprentices.length} apprenticeship. Select a learner to build their training plan.</>}
        />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* Commercial learners */}
          <TableCard
            title="Commercial enrolled learners"
            icon="ri-briefcase-4-line"
            count={commercial.length}
            action={
              <button className={`${btnPrimary} !py-2 !text-[12px]`} onClick={() => setAddOpen(true)}>
                <i className="ri-add-line" />Add learner
              </button>
            }
          >
            {loadingC ? (
              <div className="p-4"><EmptyState text="Loading…" /></div>
            ) : commercial.length === 0 ? (
              <div className="p-4"><EmptyState text="No commercial learners yet." /></div>
            ) : (
              <Table headers={['Name', 'Email', 'Employer', 'Programme', 'Programme status', 'Coach', '']}>
                {commercial.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-foreground-100/60 last:border-0 hover:bg-background-100/50"
                  >
                    <td className="py-2.5 px-3 text-foreground-900 font-medium whitespace-nowrap">{u.username || '—'}</td>
                    <td className="py-2.5 px-3 text-foreground-600 whitespace-nowrap">{u.email || '—'}</td>
                    <td className="py-2.5 px-3 text-foreground-600 whitespace-nowrap">{u.employer || '—'}</td>
                    <td className="py-2.5 px-3 text-foreground-600 whitespace-nowrap">{u.programme || <span className="text-foreground-300">Not set</span>}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <StatusSelect
                        value={u.programmeStatus}
                        onSave={async (v) => {
                          await updateCommercialUser(u.id, { programmeStatus: v });
                          setCommercial((prev) => prev.map((r) => (r.id === u.id ? { ...r, programmeStatus: v } : r)));
                        }}
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap align-top">
                      <CoachFields learnerId={String(u.id)} />
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-4">
                        <button
                          onClick={() => navigate(`/training-plan/commercial/${u.id}`)}
                          className="text-[12px] text-primary-600 hover:text-primary-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          Training plan<i className="ri-arrow-right-line" />
                        </button>
                        <button
                          onClick={() => navigate(`/workspace/learner/commercial/${u.id}`)}
                          className="text-[12px] text-foreground-600 hover:text-foreground-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <i className="ri-external-link-line" />Open learner page
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </TableCard>

          {/* Apprenticeship learners */}
          <TableCard
            title="Apprenticeship enrolled learners"
            icon="ri-graduation-cap-line"
            count={apprentices.length}
            action={
              <button className={`${btnPrimary} !py-2 !text-[12px]`} onClick={() => navigate('/users')}>
                <i className="ri-add-line" />Add learner
              </button>
            }
          >
            {loadingA ? (
              <div className="p-4"><EmptyState text="Loading…" /></div>
            ) : apprentices.length === 0 ? (
              <div className="p-4"><EmptyState text="No apprenticeship learners yet." /></div>
            ) : (
              <Table headers={['Name', 'Email', 'Group', 'Programme status', 'Coach', '']}>
                {apprentices.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-foreground-100/60 last:border-0 hover:bg-background-100/50"
                  >
                    <td className="py-2.5 px-3 text-foreground-900 font-medium whitespace-nowrap">{u.name || '—'}</td>
                    <td className="py-2.5 px-3 text-foreground-600 whitespace-nowrap">{u.email || '—'}</td>
                    <td className="py-2.5 px-3 text-foreground-600 whitespace-nowrap">{u.group || '—'}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <StatusSelect
                        value={u.programmeStatus || ''}
                        onSave={async (v) => {
                          await updateEnrolmentUser(u.id, { programmeStatus: v });
                          setApprentices((prev) => prev.map((r) => (r.id === u.id ? { ...r, programmeStatus: v as ProgrammeStatus } : r)));
                        }}
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap align-top">
                      <CoachFields learnerId={String(u.id)} />
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-4">
                        <button
                          onClick={() => navigate(`/training-plan/apprenticeship/${u.id}`)}
                          className="text-[12px] text-primary-600 hover:text-primary-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          Training plan<i className="ri-arrow-right-line" />
                        </button>
                        <button
                          onClick={() => navigate(`/workspace/learner/apprenticeship/${u.id}`)}
                          className="text-[12px] text-foreground-600 hover:text-foreground-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <i className="ri-external-link-line" />Open learner page
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </TableCard>
        </div>
      </div>

      {addOpen && (
        <CommercialUserModal
          onClose={() => setAddOpen(false)}
          onCreated={(row) => setCommercial((prev) => [...prev, row])}
        />
      )}
    </WorkspaceShell>
  );
}
