import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const COHORTS_DATA = [
  { id: 'c1', name: 'Cohort A — Business Admin L3', programme: 'Business Administrator L3', standard: 'ST0070', startDate: 'Sep 2024', endDate: 'Mar 2026', learners: 12, coaches: 2, tutors: 2, status: 'active' as const, progress: 78, attendance: 92 },
  { id: 'c2', name: 'Cohort B — Digital Marketing L3', programme: 'Digital Marketer L3', standard: 'ST0118', startDate: 'Mar 2025', endDate: 'Sep 2026', learners: 8, coaches: 1, tutors: 2, status: 'active' as const, progress: 45, attendance: 88 },
  { id: 'c3', name: 'Cohort C — Business Admin L3', programme: 'Business Administrator L3', standard: 'ST0070', startDate: 'Mar 2026', endDate: 'Sep 2027', learners: 8, coaches: 1, tutors: 1, status: 'active' as const, progress: 12, attendance: 95 },
  { id: 'c4', name: 'Cohort D — Software Dev L4', programme: 'Software Developer L4', standard: 'ST0120', startDate: 'Sep 2025', endDate: 'Sep 2027', learners: 5, coaches: 1, tutors: 1, status: 'active' as const, progress: 35, attendance: 90 },
  { id: 'c5', name: 'Cohort E — Project Manager L4', programme: 'Project Manager L4', standard: 'ST0330', startDate: 'Jan 2026', endDate: 'Jan 2028', learners: 4, coaches: 1, tutors: 1, status: 'active' as const, progress: 22, attendance: 94 },
  { id: 'c6', name: 'Cohort F — Data Analyst L4', programme: 'Data Analyst L4', standard: 'ST0600', startDate: 'Mar 2025', endDate: 'Mar 2027', learners: 6, coaches: 1, tutors: 1, status: 'active' as const, progress: 40, attendance: 86 },
  { id: 'c7', name: 'Cohort G — Operations Manager L5', programme: 'Operations Manager L5', standard: 'ST0470', startDate: 'Sep 2026', endDate: 'Mar 2029', learners: 0, coaches: 0, tutors: 0, status: 'planned' as const, progress: 0, attendance: 0 },
  { id: 'c8', name: 'Cohort H — Customer Service L2', programme: 'Customer Service L2', standard: 'ST0301', startDate: 'Jan 2027', endDate: 'Jan 2028', learners: 0, coaches: 0, tutors: 0, status: 'planned' as const, progress: 0, attendance: 0 },
];

export default function AdminCohortsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null);

  const activeCount = COHORTS_DATA.filter(c => c.status === 'active').length;
  const plannedCount = COHORTS_DATA.filter(c => c.status === 'planned').length;
  const totalLearners = COHORTS_DATA.reduce((a, b) => a + b.learners, 0);
  const avgAttendance = Math.round(COHORTS_DATA.filter(c => c.status === 'active').reduce((a, b) => a + b.attendance, 0) / activeCount);

  const filtered = COHORTS_DATA.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.programme.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const cohort = selectedCohort ? COHORTS_DATA.find(c => c.id === selectedCohort) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Cohorts" pageSubtitle="Cohort management, allocation, and performance tracking" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-group-2-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Cohort Management</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{COHORTS_DATA.length} cohorts</strong> — {activeCount} active, {plannedCount} planned. {totalLearners} learners enrolled. {avgAttendance}% avg attendance.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{COHORTS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Cohorts</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalLearners}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Learners</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgAttendance}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Attendance</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search cohorts..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1.5"></AppIcon> New Cohort
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cohorts List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(c => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                planned: 'bg-accent-50 text-accent-700 border-accent-200/50',
                completed: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={c.id} onClick={() => setSelectedCohort(c.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedCohort === c.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-12 h-12 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                    <span className="text-secondary-700 font-bold text-sm">{c.name.split(' ')[1]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{c.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[c.status]}`}>{c.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{c.programme} · {c.startDate} — {c.endDate}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-foreground-500 shrink-0">
                    <span><AppIcon className="ri-graduation-cap-line mr-1"></AppIcon>{c.learners}</span>
                    <span><AppIcon className="ri-heart-line mr-1"></AppIcon>{c.coaches}</span>
                    <span><AppIcon className="ri-user-settings-line mr-1"></AppIcon>{c.tutors}</span>
                    {c.status === 'active' && (
                      <div className="flex items-center gap-1">
                        <div className="w-12 h-1.5 bg-background-200 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${c.progress}%` }}></div>
                        </div>
                        <span className="text-[10px]">{c.progress}%</span>
                      </div>
                    )}
                  </div>
                  <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedCohort === c.id ? 'text-primary-500' : ''}`}></AppIcon>
                </div>
              );
            })}
          </div>

          {/* Cohort Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {cohort ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{cohort.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{cohort.programme} · {cohort.standard}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{cohort.learners}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Learners</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{cohort.coaches}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Coaches</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{cohort.tutors}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Tutors</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{cohort.attendance}%</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Attendance</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Progress</h4>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-background-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${cohort.progress}%` }}></div>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground-700">{cohort.progress}%</span>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Start Date</span>
                    <span className="text-foreground-700 font-medium">{cohort.startDate}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">End Date</span>
                    <span className="text-foreground-700 font-medium">{cohort.endDate}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className="text-foreground-700 font-medium capitalize">{cohort.status}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Cohort</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">View Learners</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-group-2-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select a cohort to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}