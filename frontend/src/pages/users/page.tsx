import { useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { CASE_OWNER_OPTIONS } from '@/mocks/enrolment-console';
import { fetchEnrolmentUsers, STATUS_OPTIONS, TYPE_OPTIONS, PROGRAMME_STATUS_OPTIONS } from '@/api/enrolmentUsers';
import { fetchStaffUsers, type StaffUserRow } from '@/api/staffUsers';
import { fetchProgrammes, fetchCohorts, fetchGroups } from '@/api/curriculum';
import { listEmployers, type EmployerRow } from '@/api/employers';
import type { UserListRow, UsersFilter } from './types';
import { StatusBadge, Pagination, Hero, StatCard, inputClass, btnPrimary, btnSecondary } from './components/ui';
import { CreateUserModal } from './components/CreateUserModal';
import { CreateAdminModal } from './components/CreateAdminModal';
import { CreateEmployerModal } from './components/CreateEmployerModal';
import { CreateOrganisationModal } from './components/CreateOrganisationModal';
import { EditStaffModal } from './components/EditStaffModal';
import { LearningPlanModal } from './components/LearningPlanModal';

const enrolmentNav = roleNavMap.apprentice;
const PAGE_SIZE = 8;
// The learning plan is only editable once the three onboarding reviews are
// signed and the learner has moved into delivery — see the backend's
// promote_to_delivery_if_ready.
const DELIVERY_STATUS = 'Delivery';

/**
 * A directory row. Learner rows are plain UserListRows; staff rows carry the
 * extra Staff_users columns the edit modal prefills from, so the list holds the
 * union and narrows on `source === 'staff'`.
 */
type DirectoryRow = UserListRow & Partial<StaffUserRow> & { employer?: EmployerRow };

/**
 * An employer contact, shaped like a UserListRow so the directory can list them
 * alongside learners and staff.
 *
 * Employers aren't learners or staff: they have no subscription, learning plan or
 * programme, so those columns stay blank rather than being filled with something
 * that isn't true. Their organisations stand in for the Group column, which is
 * the closest real equivalent — a learner's group is their cohort, an employer's
 * is the company they belong to.
 */
function employerToRow(e: EmployerRow): DirectoryRow {
  return {
    id: e.id,
    uuid: null,
    name: e.name,
    type: 'Employer',
    email: e.email,
    group: e.employerGroupNames.join(', '),
    subscriptionStatus: '',
    subscriptionVerified: false,
    learningPlan: false,
    programmeStatus: '',
    source: 'employer',
    // Kept whole so the edit modal can prefill without a refetch.
    employer: e,
  };
}

const EMPTY_FILTER: UsersFilter = {
  userName: '', groups: [], email: '', statuses: [], type: 'all', programme: '', cohort: '',
  programmeStatus: '', niNumber: '', caseOwner: 'any', referenceNumber: '', page: 1, pageSize: PAGE_SIZE,
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function MultiSelect({ label, placeholder, options, selected, onChange }: { label: string; placeholder: string; options: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const toggle = (opt: string) => onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">{label}</label>
      <div className="relative" ref={ref}>
        <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputClass} text-left flex items-center justify-between cursor-pointer`}>
          <span className={selected.length ? 'text-foreground-900 truncate' : 'text-foreground-300'}>{selected.length ? selected.join(', ') : placeholder}</span>
          <i className="ri-arrow-down-s-line text-foreground-400 shrink-0" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full bg-background-50 border border-foreground-200 rounded-lg shadow-lg max-h-56 overflow-y-auto py-1">
            {options.length === 0 && <p className="px-3 py-1.5 text-[12px] text-foreground-300">No options</p>}
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground-700 hover:bg-background-100 cursor-pointer">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-primary-500" />{opt}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TextFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">{label}</label>
      <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectFilter({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">{label}</label>
      <select className={`${inputClass} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** True when a row value doesn't match a chosen filter value, ignoring case/padding. */
function differs(rowValue: string | undefined, filterValue: string): boolean {
  return (rowValue ?? '').trim().toLowerCase() !== filterValue.trim().toLowerCase();
}

/** Distinct non-empty values of one row column, sorted. */
function distinct(from: DirectoryRow[], pick: (r: DirectoryRow) => string | undefined): string[] {
  return Array.from(new Set(from.map(pick).filter(Boolean) as string[])).sort();
}

function matches(row: DirectoryRow, f: UsersFilter): boolean {
  if (f.userName && !row.name.toLowerCase().includes(f.userName.toLowerCase())) return false;
  if (f.email && !row.email.toLowerCase().includes(f.email.toLowerCase())) return false;
  // Folded like programme/cohort below: group names can now come from the
  // curriculum lookup rather than only from the rows themselves.
  if (f.groups && f.groups.length > 0 && !f.groups.some((g) => !differs(row.group, g))) return false;
  if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(row.subscriptionStatus)) return false;
  if (f.type && f.type !== 'all' && row.type !== f.type) return false;
  // Programme and cohort are picked from the curriculum lists, but the values on
  // the row were written as free text at create time, so both sides are folded
  // before comparing — casing drift on an older row shouldn't empty the results.
  if (f.programme && differs(row.programme, f.programme)) return false;
  if (f.cohort && differs(row.cohort, f.cohort)) return false;
  if (f.programmeStatus && (row.programmeStatus ?? '') !== f.programmeStatus) return false;
  if (f.referenceNumber && !(row.reference ?? '').toLowerCase().includes(f.referenceNumber.toLowerCase())) return false;
  return true;
}

export default function UsersListPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<UsersFilter>(EMPTY_FILTER);
  const [applied, setApplied] = useState<UsersFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [createEmployerOpen, setCreateEmployerOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Viewport coords for the portalled Create menu, measured from the button.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const [rows, setRows] = useState<DirectoryRow[]>([]);
  // The curriculum lookups behind the programme -> cohort -> group filters. They
  // come from curriculum.cohort_authoring_details, the same source the create
  // form picks from, so a filter can only offer combinations that really exist.
  const [programmes, setProgrammes] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState<string[]>([]);
  const [cascadeGroups, setCascadeGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The staff row currently being edited, if any.
  const [editStaff, setEditStaff] = useState<StaffUserRow | null>(null);
  // Likewise for employer contacts.
  const [editEmployer, setEditEmployer] = useState<EmployerRow | null>(null);
  // The learner whose learning plan is open, if any. Only offered once a learner
  // reaches Delivery — before that their modules aren't settled.
  const [planFor, setPlanFor] = useState<UserListRow | null>(null);

  // One directory for the whole enrolment section: every learner — both
  // apprenticeship and commercial — comes from the single Enrolment_Users table
  // in one call, each row carrying its own `learnerType`/`source`. Staff/admin
  // accounts come from Staff_users, employer contacts from Employers.
  //
  // Only the learner call is allowed to fail the page: it's the bulk of the
  // directory. The other two are swallowed so a missing table or a 502 on either
  // one leaves the learners listed instead of blanking the whole screen.
  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchEnrolmentUsers(),
      fetchStaffUsers().catch(() => [] as StaffUserRow[]),
      listEmployers().then((r) => r.results).catch(() => [] as EmployerRow[]),
    ])
      .then(([learners, staff, employers]) => {
        setRows([
          ...learners,
          // Staff rows already arrive in UserListRow shape from to_staff_row.
          ...staff.map((r) => ({ ...r, source: 'staff' as const })),
          ...employers.map(employerToRow),
        ]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // A failed lookup isn't worth an error banner over the whole directory: the
  // dropdown falls back to the programmes/cohorts the loaded rows already carry.
  useEffect(() => {
    let cancelled = false;
    fetchProgrammes()
      .then((rows) => { if (!cancelled) setProgrammes(rows); })
      .catch(() => { if (!cancelled) setProgrammes([]); });
    return () => { cancelled = true; };
  }, []);

  // Cohorts belong to a programme and groups to a cohort, so each level is
  // refetched when its parent changes — and cleared first, so the list can never
  // show a moment of the previous programme's cohorts.
  useEffect(() => {
    let cancelled = false;
    setCohorts([]);
    if (!draft.programme) return;
    fetchCohorts(draft.programme)
      .then((rows) => { if (!cancelled) setCohorts(rows); })
      .catch(() => { if (!cancelled) setCohorts([]); });
    return () => { cancelled = true; };
  }, [draft.programme]);

  useEffect(() => {
    let cancelled = false;
    setCascadeGroups([]);
    if (!draft.programme || !draft.cohort) return;
    fetchGroups(draft.programme, draft.cohort)
      .then((rows) => { if (!cancelled) setCascadeGroups(rows); })
      .catch(() => { if (!cancelled) setCascadeGroups([]); });
    return () => { cancelled = true; };
  }, [draft.programme, draft.cohort]);

  // The menu lives in a portal, so an outside-click test has to exempt it too.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (createRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setCreateOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Anchor the portalled menu under the button, and keep it there while the
  // page scrolls or resizes (fixed positioning doesn't follow the anchor).
  useEffect(() => {
    if (!createOpen) { setMenuPos(null); return; }
    const place = () => {
      const r = createBtnRef.current?.getBoundingClientRect();
      if (r) setMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [createOpen]);

  // The curriculum list is the source of truth, but rows created before a
  // programme was renamed (or imported from elsewhere) can carry a name that
  // isn't in it — union so those learners stay reachable from the filter.
  const programmeOptions = useMemo(
    () => Array.from(new Set([...programmes, ...distinct(rows, (r) => r.programme)])).sort(),
    [programmes, rows],
  );
  const cohortOptions = useMemo(
    () => Array.from(new Set([
      ...cohorts,
      ...distinct(draft.programme ? rows.filter((r) => !differs(r.programme, draft.programme!)) : [], (r) => r.cohort),
    ])).sort(),
    [cohorts, rows, draft.programme],
  );
  // Groups narrow with whatever has been chosen above them: the curriculum list
  // once a cohort is picked, otherwise the groups of the rows still in scope.
  const groupOptions = useMemo(() => {
    const inScope = rows.filter(
      (r) => (!draft.programme || !differs(r.programme, draft.programme))
        && (!draft.cohort || !differs(r.cohort, draft.cohort)),
    );
    return Array.from(new Set([...cascadeGroups, ...distinct(inScope, (r) => r.group)])).sort();
  }, [cascadeGroups, rows, draft.programme, draft.cohort]);
  // Staff rows report their position (Curriculum team, Operations team, ...) as
  // their type, so the filter list is derived from the loaded rows rather than
  // the fixed TYPE_OPTIONS — otherwise staff would be unfilterable.
  const typeOptions = useMemo(
    () => Array.from(new Set([...TYPE_OPTIONS, ...rows.map((r) => r.type).filter(Boolean)])).sort(),
    [rows],
  );

  const filtered = useMemo(() => rows.filter((r) => matches(r, applied)), [rows, applied]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const learners = rows.filter((r) => r.type === 'User').length;
  // Counted by source, not "not a learner": employers are in the table too now,
  // and lumping them under Admins would misreport both.
  const admins = rows.filter((r) => r.source === 'staff').length;
  const employerCount = rows.filter((r) => r.source === 'employer').length;
  const active = rows.filter((r) => r.programmeStatus === 'Active').length;

  // Choosing a programme or cohort invalidates the levels below it, so a stale
  // cohort/group can't survive into a search for a different programme.
  const set = (patch: Partial<UsersFilter>) =>
    setDraft((d) => ({
      ...d,
      ...('programme' in patch ? { cohort: '', groups: [] } : {}),
      ...('cohort' in patch ? { groups: [] } : {}),
      ...patch,
    }));
  const search = () => { setApplied(draft); setPage(1); };
  const reset = () => { setDraft(EMPTY_FILTER); setApplied(EMPTY_FILTER); setPage(1); };
  // Commercial and apprenticeship ids come from different tables and overlap,
  // so every row action carries the row's source.
  const q = (row: UserListRow) => (row.source === 'commercial' ? '?source=commercial' : '');
  // Staff and employers live in their own tables and have no learner
  // profile/wizard, so their rows aren't links — routing one to /users/<id>
  // would read a learner record with a colliding id.
  const isNonLearner = (row: UserListRow) => row.source === 'staff' || row.source === 'employer';

  const openUser = (row: UserListRow) => {
    if (isNonLearner(row)) return;
    navigate(`/users/${row.id}${q(row)}`);
  };

  // The learner's own workspace view. `source` doubles as the :kind segment —
  // staff and employers have no learner record, so their rows get no link.
  const openLearnerPage = (row: UserListRow) => {
    if (isNonLearner(row)) return;
    const kind = row.source === 'commercial' ? 'commercial' : 'apprenticeship';
    navigate(`/workspace/learner/${kind}/${row.id}`);
  };

  // Staff/admin rows have no profile page — editing their details in place is
  // the only way to correct an email, phone or position after creation.
  const openStaffEdit = (row: DirectoryRow) => setEditStaff(row as StaffUserRow);

  // Patch the edited row in place rather than refetching the whole directory,
  // so the table doesn't flash back to its loading state on every save.
  const applyStaffUpdate = (updated: StaffUserRow) => {
    setRows((prev) =>
      prev.map((r) =>
        r.source === 'staff' && r.id === updated.id ? { ...updated, source: 'staff' as const } : r,
      ),
    );
  };

  // Employers have no profile page either, so the row's Edit action is their
  // only edit surface — same arrangement as staff.
  const applyEmployerUpdate = (updated: EmployerRow) => {
    setRows((prev) =>
      prev.map((r) => (r.source === 'employer' && r.id === updated.id ? employerToRow(updated) : r)),
    );
  };

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Users" pageSubtitle="Directory of learners and administrators" userName="Enrolment Officer" userRole="Enrolment Officer">
      <div className="p-6 space-y-6">
        {/* Hero */}
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-group-line"
            title="User Management"
            subtitle={<><strong>{rows.length} users</strong> — {learners} learners, {admins} admins, {employerCount} employers, {active} active on programme.</>}
            right={
              <div ref={createRef}>
                <button
                  ref={createBtnRef}
                  onClick={() => setCreateOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white text-primary-700 rounded-xl text-[13px] font-semibold hover:bg-white/90 transition-smooth cursor-pointer shadow-lg shadow-black/10"
                >
                  <i className="ri-add-line" />Create<i className="ri-arrow-down-s-line" />
                </button>
                {/* Rendered into document.body: the Hero banner and the stats
                    cards below it both create stacking contexts that paint over
                    an in-flow menu no matter its z-index. A portal sidesteps
                    that, so the menu is positioned from the button's rect. */}
                {createOpen && menuPos && createPortal(
                  <div
                    ref={menuRef}
                    style={{ top: menuPos.top, right: menuPos.right }}
                    className="fixed w-56 bg-background-50 border border-foreground-200 rounded-xl shadow-xl py-1.5 z-[200]"
                  >
                    <button className="w-full text-left px-3 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer" onClick={() => { setCreateOpen(false); setCreateModalOpen(true); }}><i className="ri-user-add-line mr-2 text-foreground-400" />Create user</button>
                    <button className="w-full text-left px-3 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer" onClick={() => { setCreateOpen(false); setCreateAdminOpen(true); }}><i className="ri-shield-user-line mr-2 text-foreground-400" />Create admin</button>
                    <button className="w-full text-left px-3 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer" onClick={() => { setCreateOpen(false); setCreateEmployerOpen(true); }}><i className="ri-briefcase-line mr-2 text-foreground-400" />Create employer profile</button>
                    <button className="w-full text-left px-3 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer" onClick={() => { setCreateOpen(false); setCreateOrgOpen(true); }}><i className="ri-building-line mr-2 text-foreground-400" />Create organisation profile</button>
                  </div>,
                  document.body
                )}
              </div>
            }
          />
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 stagger-children">
          <StatCard icon="ri-group-line" label="Total users" value={rows.length} tint="primary" />
          <StatCard icon="ri-graduation-cap-line" label="Learners" value={learners} tint="accent" />
          <StatCard icon="ri-shield-user-line" label="Admins" value={admins} tint="secondary" />
          <StatCard icon="ri-briefcase-line" label="Employers" value={employerCount} tint="amber" />
          <StatCard icon="ri-play-circle-line" label="Active on programme" value={active} tint="emerald" />
        </div>

        {/* Filter card */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 card-premium">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <TextFilter label="User name" value={draft.userName ?? ''} onChange={(v) => set({ userName: v })} />
            <MultiSelect label="Group" placeholder={draft.cohort ? 'Select groups in this cohort' : 'Select groups'} options={groupOptions} selected={draft.groups ?? []} onChange={(v) => set({ groups: v })} />
            <TextFilter label="Email" value={draft.email ?? ''} onChange={(v) => set({ email: v })} />
            <MultiSelect label="Status" placeholder="Select statuses" options={STATUS_OPTIONS} selected={draft.statuses ?? []} onChange={(v) => set({ statuses: v })} />
            <SelectFilter label="Type" value={draft.type ?? 'all'} onChange={(v) => set({ type: v as UsersFilter['type'] })} options={[{ value: 'all', label: '--All--' }, ...typeOptions.map((t) => ({ value: t, label: t }))]} />
            <SelectFilter label="Programme" value={draft.programme ?? ''} onChange={(v) => set({ programme: v })} options={[{ value: '', label: '--All--' }, ...programmeOptions.map((p) => ({ value: p, label: p }))]} />
            {/* Single-select on purpose: the group lookup takes one programme and
                one cohort, so this is what narrows the Group list below. */}
            <SelectFilter
              label="Cohort"
              value={draft.cohort ?? ''}
              onChange={(v) => set({ cohort: v })}
              disabled={!draft.programme}
              options={draft.programme
                ? [{ value: '', label: '--All--' }, ...cohortOptions.map((c) => ({ value: c, label: c }))]
                : [{ value: '', label: 'Select a programme first' }]}
            />
            <SelectFilter label="Programme status" value={draft.programmeStatus ?? ''} onChange={(v) => set({ programmeStatus: v })} options={[{ value: '', label: '--All--' }, ...PROGRAMME_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))]} />
            <TextFilter label="NI number" value={draft.niNumber ?? ''} onChange={(v) => set({ niNumber: v })} />
            <SelectFilter label="Case owner" value={draft.caseOwner ?? 'any'} onChange={(v) => set({ caseOwner: v })} options={[{ value: 'any', label: 'Any' }, ...CASE_OWNER_OPTIONS.map((c) => ({ value: c, label: c }))]} />
            <TextFilter label="Reference number" value={draft.referenceNumber ?? ''} onChange={(v) => set({ referenceNumber: v })} />
          </div>
          <div className="flex items-center justify-end gap-3 mt-4">
            <button className={btnSecondary} onClick={reset}><i className="ri-refresh-line" />Reset</button>
            <button className={btnPrimary} onClick={search}><i className="ri-search-line" />Search</button>
          </div>
        </div>

        {/* Results table */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden card-premium">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-200/70 bg-background-100/50">
                  {['User', 'Type', 'Email', 'Group', 'Programme', 'Subscription status', 'Learning plan', 'Programme status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="py-10 text-center text-[13px] text-foreground-400"><i className="ri-loader-4-line animate-spin mr-2" />Loading users…</td></tr>}
                {!loading && error && (
                  <tr><td colSpan={9} className="py-10 text-center text-[13px]">
                    <p className="text-red-600 mb-2"><i className="ri-error-warning-line mr-1.5" />{error}</p>
                    <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
                  </td></tr>
                )}
                {!loading && !error && pageRows.map((row, i) => {
                  const isLearner = row.type === 'User';
                  const isStaff = row.source === 'staff';
                  const isEmployer = row.source === 'employer';
                  // Neither has a learner record, so their name never routes to
                  // one. Staff open their edit modal in place; an employer opens
                  // their own side page, which is where their learners and the
                  // documents they must sign live.
                  const openInPlace = isStaff
                    ? () => openStaffEdit(row)
                    : isEmployer
                      ? () => navigate(`/employers/${row.id}`)
                      : null;
                  return (
                  <tr key={`${row.source ?? 'apprenticeship'}-${row.id}`} className={`border-b border-foreground-100 hover:bg-primary-50/30 transition-smooth ${i % 2 === 1 ? 'bg-background-100/20' : ''}`}>
                    <td className="py-2.5 px-3">
                      {openInPlace ? (
                        <button onClick={openInPlace} className="flex items-center gap-2.5 cursor-pointer group text-left">
                          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold shrink-0 bg-secondary-100 text-secondary-700">{initials(row.name)}</span>
                          <span className="text-secondary-700 group-hover:underline font-medium">{row.name}</span>
                        </button>
                      ) : (
                        <button onClick={() => openUser(row)} className="flex items-center gap-2.5 cursor-pointer group text-left">
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold shrink-0 ${isLearner ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-700'}`}>{initials(row.name)}</span>
                          <span className="text-primary-600 group-hover:text-primary-700 group-hover:underline font-medium">{row.name}</span>
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isLearner ? 'bg-primary-50 text-primary-700 border-primary-200/50' : 'bg-secondary-50 text-secondary-700 border-secondary-200/50'}`}>{row.type}</span>
                    </td>
                    <td className="py-2.5 px-3 text-foreground-600 max-w-[220px] break-words">{row.email}</td>
                    <td className="py-2.5 px-3 text-foreground-600">{row.group}</td>
                    {/* Learners only: staff, admins and employers have no
                        programme, so a dash is more honest than an empty cell. */}
                    <td className="py-2.5 px-3 text-foreground-600 max-w-[180px] break-words">
                      {isLearner && row.programme
                        ? row.programme
                        : <span className="text-foreground-300">—</span>}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="text-foreground-700">{row.subscriptionStatus}</span>
                      {row.subscriptionStatus ? (row.subscriptionVerified ? <i className="ri-checkbox-circle-fill text-emerald-500 ml-1.5 align-middle" title="Verified" /> : <i className="ri-close-circle-fill text-red-500 ml-1.5 align-middle" title="Unverified" />) : null}
                    </td>
                    <td className="py-2.5 px-3">
                      {isLearner && row.programmeStatus === DELIVERY_STATUS ? (
                        <button
                          onClick={() => setPlanFor(row)}
                          title={`${row.hasLearningPlan ? 'Edit' : 'Add'} ${row.name}'s learning plan`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[12px] font-medium text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                        >
                          <i className={`ri-${row.hasLearningPlan ? 'edit' : 'add'}-line`} />
                          {row.hasLearningPlan ? 'Edit learning plan' : 'Add learning plan'}
                        </button>
                      ) : isLearner && row.learningPlan ? (
                        <button onClick={() => openUser(row)} className="text-primary-600 hover:underline cursor-pointer">Learning plan</button>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3">{isLearner && row.programmeStatus ? <StatusBadge status={row.programmeStatus} /> : null}</td>
                    <td className="py-2.5 px-3">
                      {openInPlace ? (
                        <span className="flex items-center gap-2">
                          <button
                            onClick={openInPlace}
                            title={isEmployer ? `Open ${row.name}'s employer page` : `Edit ${row.name}'s details`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[12px] font-medium text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                          >
                            {isEmployer
                              ? <><i className="ri-external-link-line text-[13px]" />View</>
                              : <><i className="ri-edit-line text-[13px]" />Edit</>}
                          </button>
                          {/* An employer's own details are still editable — the
                              primary action is now their page, so this is a
                              secondary link rather than the main button. */}
                          {isEmployer && row.employer && (
                            <button
                              onClick={() => setEditEmployer(row.employer!)}
                              title={`Edit ${row.name}'s details`}
                              className="text-[12px] text-foreground-400 hover:text-primary-600 hover:underline cursor-pointer whitespace-nowrap"
                            >
                              Edit
                            </button>
                          )}
                        </span>
                      ) : isLearner ? (
                        <button
                          onClick={() => openLearnerPage(row)}
                          title={`Open ${row.name}'s learner page`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[12px] font-medium text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-external-link-line text-[13px]" />View
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
                {!loading && !error && pageRows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-[13px] text-foreground-400">{rows.length === 0 ? 'No users yet. Use “Create” to add the first learner.' : 'No users match your filters.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="border-t border-foreground-100"><Pagination page={page} totalPages={totalPages} onChange={setPage} /></div>
        </div>

        <div className="flex items-center justify-center gap-4 text-[11px] text-foreground-400">
          <a href="#" className="hover:text-primary-600">Export</a>
          <span className="w-1 h-1 rounded-full bg-foreground-200" />
          <a href="#" className="hover:text-primary-600">Column settings</a>
        </div>
      </div>

      {createModalOpen && <CreateUserModal onClose={() => setCreateModalOpen(false)} onCreated={load} />}
      {createAdminOpen && <CreateAdminModal onClose={() => setCreateAdminOpen(false)} onCreated={load} />}
      {editStaff && <EditStaffModal row={editStaff} onClose={() => setEditStaff(null)} onSaved={applyStaffUpdate} />}
      {planFor && (
        <LearningPlanModal
          learnerId={planFor.id}
          learnerName={planFor.name}
          onClose={() => setPlanFor(null)}
          onSaved={load}
        />
      )}
      {/* Organisations are companies rather than people, so they don't belong in
          a directory of users — creating one just confirms and closes. Employers
          are people and do get listed. */}
      {createEmployerOpen && <CreateEmployerModal onClose={() => setCreateEmployerOpen(false)} onCreated={load} />}
      {createOrgOpen && <CreateOrganisationModal onClose={() => setCreateOrgOpen(false)} onCreated={() => {}} />}
      {editEmployer && (
        <CreateEmployerModal
          row={editEmployer}
          onClose={() => setEditEmployer(null)}
          onCreated={applyEmployerUpdate}
        />
      )}
    </WorkspaceShell>
  );
}
