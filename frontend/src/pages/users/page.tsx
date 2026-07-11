import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { CASE_OWNER_OPTIONS } from '@/mocks/enrolment-console';
import { fetchEnrolmentUsers, STATUS_OPTIONS, TYPE_OPTIONS, PROGRAMME_STATUS_OPTIONS } from '@/api/enrolmentUsers';
import type { UserListRow, UsersFilter } from './types';
import { StatusBadge, Pagination, Hero, StatCard, inputClass, btnPrimary, btnSecondary, iconBtn } from './components/ui';
import { CreateUserModal } from './components/CreateUserModal';

const enrolmentNav = roleNavMap.compliance;
const PAGE_SIZE = 8;

const EMPTY_FILTER: UsersFilter = {
  userName: '', groups: [], email: '', statuses: [], type: 'all', programme: '',
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

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">{label}</label>
      <select className={`${inputClass} cursor-pointer`} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function matches(row: UserListRow, f: UsersFilter): boolean {
  if (f.userName && !row.name.toLowerCase().includes(f.userName.toLowerCase())) return false;
  if (f.email && !row.email.toLowerCase().includes(f.email.toLowerCase())) return false;
  if (f.groups && f.groups.length > 0 && !f.groups.includes(row.group)) return false;
  if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(row.subscriptionStatus)) return false;
  if (f.type && f.type !== 'all' && row.type !== f.type) return false;
  if (f.programme && !(row.programmeStatus ?? '').toLowerCase().includes(f.programme.toLowerCase()) && !(row.group ?? '').toLowerCase().includes(f.programme.toLowerCase())) return false;
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
  const createRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<UserListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchEnrolmentUsers()
      .then((data) => setRows(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (createRef.current && !createRef.current.contains(e.target as Node)) setCreateOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const groupOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.group).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) => matches(r, applied)), [rows, applied]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const learners = rows.filter((r) => r.type === 'User').length;
  const admins = rows.filter((r) => r.type !== 'User').length;
  const active = rows.filter((r) => r.programmeStatus === 'Active').length;

  const set = (patch: Partial<UsersFilter>) => setDraft((d) => ({ ...d, ...patch }));
  const search = () => { setApplied(draft); setPage(1); };
  const reset = () => { setDraft(EMPTY_FILTER); setApplied(EMPTY_FILTER); setPage(1); };
  const openUser = (id: string) => navigate(`/users/${id}`);

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Users" pageSubtitle="Directory of learners and administrators" userName="Enrolment Officer" userRole="Enrolment Officer">
      <div className="p-6 space-y-6">
        {/* Hero */}
        <div className="animate-fade-in-up">
          <Hero
            icon="ri-group-line"
            title="User Management"
            subtitle={<><strong>{rows.length} users</strong> — {learners} learners, {admins} admins, {active} active on programme.</>}
            right={
              <div className="relative" ref={createRef}>
                <button
                  onClick={() => setCreateOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white text-primary-700 rounded-xl text-[13px] font-semibold hover:bg-white/90 transition-smooth cursor-pointer shadow-lg shadow-black/10"
                >
                  <i className="ri-add-line" />Create<i className="ri-arrow-down-s-line" />
                </button>
                {createOpen && (
                  <div className="absolute right-0 mt-1.5 w-44 bg-background-50 border border-foreground-200 rounded-xl shadow-xl py-1.5 z-30">
                    <button className="w-full text-left px-3 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer" onClick={() => { setCreateOpen(false); setCreateModalOpen(true); }}><i className="ri-user-add-line mr-2 text-foreground-400" />Create user</button>
                    <button className="w-full text-left px-3 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer" onClick={() => navigate('/admin/bulk-user-import')}><i className="ri-upload-2-line mr-2 text-foreground-400" />Import users</button>
                  </div>
                )}
              </div>
            }
          />
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
          <StatCard icon="ri-group-line" label="Total users" value={rows.length} tint="primary" />
          <StatCard icon="ri-graduation-cap-line" label="Learners" value={learners} tint="accent" />
          <StatCard icon="ri-shield-user-line" label="Admins" value={admins} tint="secondary" />
          <StatCard icon="ri-play-circle-line" label="Active on programme" value={active} tint="emerald" />
        </div>

        {/* Filter card */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 card-premium">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <TextFilter label="User name" value={draft.userName ?? ''} onChange={(v) => set({ userName: v })} />
            <MultiSelect label="Group" placeholder="Select groups" options={groupOptions} selected={draft.groups ?? []} onChange={(v) => set({ groups: v })} />
            <TextFilter label="Email" value={draft.email ?? ''} onChange={(v) => set({ email: v })} />
            <MultiSelect label="Status" placeholder="Select statuses" options={STATUS_OPTIONS} selected={draft.statuses ?? []} onChange={(v) => set({ statuses: v })} />
            <SelectFilter label="Type" value={draft.type ?? 'all'} onChange={(v) => set({ type: v as UsersFilter['type'] })} options={[{ value: 'all', label: '--All--' }, ...TYPE_OPTIONS.map((t) => ({ value: t, label: t }))]} />
            <TextFilter label="Programme" value={draft.programme ?? ''} onChange={(v) => set({ programme: v })} />
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
                  {['User', 'Type', 'Email', 'Group', 'Subscription status', 'Learning plan', 'Programme status', 'Notes', 'Tasks', 'Edit'].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={10} className="py-10 text-center text-[13px] text-foreground-400"><i className="ri-loader-4-line animate-spin mr-2" />Loading users…</td></tr>}
                {!loading && error && (
                  <tr><td colSpan={10} className="py-10 text-center text-[13px]">
                    <p className="text-red-600 mb-2"><i className="ri-error-warning-line mr-1.5" />{error}</p>
                    <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
                  </td></tr>
                )}
                {!loading && !error && pageRows.map((row, i) => {
                  const isLearner = row.type === 'User';
                  return (
                  <tr key={row.id} className={`border-b border-foreground-100 hover:bg-primary-50/30 transition-smooth ${i % 2 === 1 ? 'bg-background-100/20' : ''}`}>
                    <td className="py-2.5 px-3">
                      <button onClick={() => openUser(row.id)} className="flex items-center gap-2.5 cursor-pointer group text-left">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold shrink-0 ${isLearner ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-700'}`}>{initials(row.name)}</span>
                        <span className="text-primary-600 group-hover:text-primary-700 group-hover:underline font-medium">{row.name}</span>
                      </button>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isLearner ? 'bg-primary-50 text-primary-700 border-primary-200/50' : 'bg-secondary-50 text-secondary-700 border-secondary-200/50'}`}>{row.type}</span>
                    </td>
                    <td className="py-2.5 px-3 text-foreground-600 max-w-[220px] break-words">{row.email}</td>
                    <td className="py-2.5 px-3 text-foreground-600">{row.group}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="text-foreground-700">{row.subscriptionStatus}</span>
                      {row.subscriptionStatus ? (row.subscriptionVerified ? <i className="ri-checkbox-circle-fill text-emerald-500 ml-1.5 align-middle" title="Verified" /> : <i className="ri-close-circle-fill text-red-500 ml-1.5 align-middle" title="Unverified" />) : null}
                    </td>
                    <td className="py-2.5 px-3">{isLearner && row.learningPlan ? <button onClick={() => openUser(row.id)} className="text-primary-600 hover:underline cursor-pointer">Learning plan</button> : null}</td>
                    <td className="py-2.5 px-3">{isLearner && row.programmeStatus ? <StatusBadge status={row.programmeStatus} /> : null}</td>
                    <td className="py-2.5 px-3 text-foreground-600">{isLearner ? <span className="inline-flex items-center gap-1"><i className="ri-sticky-note-line text-foreground-400" />{row.notesCount ?? 0}</span> : null}</td>
                    <td className="py-2.5 px-3">{isLearner ? <button className={iconBtn} aria-label="Tasks"><i className="ri-folder-line text-sm" /></button> : null}</td>
                    <td className="py-2.5 px-3"><button className={iconBtn} aria-label="Edit user" onClick={() => openUser(row.id)}><i className="ri-pencil-line text-sm" /></button></td>
                  </tr>
                  );
                })}
                {!loading && !error && pageRows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-[13px] text-foreground-400">{rows.length === 0 ? 'No users yet. Use “Create” to add the first learner.' : 'No users match your filters.'}</td></tr>}
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
    </WorkspaceShell>
  );
}
