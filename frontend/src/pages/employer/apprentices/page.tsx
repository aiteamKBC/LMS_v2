import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { formatHoursMinutes } from '@/lib/format';

const employerNav = roleNavMap.employer;

interface ApprenticeRow {
  id: string;
  name: string;
  initials: string;
  programme: string;
  level: string;
  startDate: string;
  progress: number;
  attendance: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  risk: 'Green' | 'Amber' | 'Red';
  coach: string;
  nextReview: string;
}

const APPRENTICES: ApprenticeRow[] = [
  { id: 'ap-1', name: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive', level: 'L4', startDate: '19 May 2026', progress: 42, attendance: 86, otjhCompleted: 74, otjhTarget: 120, ksbProgress: 38, risk: 'Amber', coach: 'Med Maher', nextReview: '25 Jun 2026' },
  { id: 'ap-2', name: 'Daniel Clarke', initials: 'DC', programme: 'Business Administrator', level: 'L3', startDate: '1 Sep 2025', progress: 68, attendance: 94, otjhCompleted: 210, otjhTarget: 280, ksbProgress: 72, risk: 'Green', coach: 'Med Maher', nextReview: '28 Jun 2026' },
  { id: 'ap-3', name: 'Rachel Thompson', initials: 'RT', programme: 'Data Analyst', level: 'L4', startDate: '12 Jan 2026', progress: 55, attendance: 91, otjhCompleted: 145, otjhTarget: 210, ksbProgress: 60, risk: 'Green', coach: 'Sarah Khan', nextReview: '20 Jun 2026' },
  { id: 'ap-4', name: 'Mark Jensen', initials: 'MJ', programme: 'Digital Marketer', level: 'L3', startDate: '5 Oct 2025', progress: 72, attendance: 88, otjhCompleted: 185, otjhTarget: 240, ksbProgress: 70, risk: 'Amber', coach: 'Med Maher', nextReview: '22 Jun 2026' },
  { id: 'ap-5', name: 'Lucy Barnes', initials: 'LB', programme: 'HR Consultant', level: 'L5', startDate: '1 Mar 2026', progress: 30, attendance: 97, otjhCompleted: 45, otjhTarget: 80, ksbProgress: 28, risk: 'Green', coach: 'David Osei', nextReview: '15 Jul 2026' },
  { id: 'ap-6', name: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive', level: 'L4', startDate: '19 May 2026', progress: 38, attendance: 82, otjhCompleted: 68, otjhTarget: 120, ksbProgress: 35, risk: 'Red', coach: 'Med Maher', nextReview: '25 Jun 2026' },
  { id: 'ap-7', name: 'Priya Sharma', initials: 'PS', programme: 'Business Administrator', level: 'L3', startDate: '15 Nov 2025', progress: 62, attendance: 95, otjhCompleted: 170, otjhTarget: 260, ksbProgress: 65, risk: 'Green', coach: 'Sarah Khan', nextReview: '18 Jun 2026' },
  { id: 'ap-8', name: 'Alex Morgan', initials: 'AM', programme: 'Software Developer', level: 'L4', startDate: '1 Feb 2026', progress: 48, attendance: 90, otjhCompleted: 110, otjhTarget: 180, ksbProgress: 52, risk: 'Green', coach: 'Med Maher', nextReview: '30 Jun 2026' },
];

export default function EmployerApprentices() {
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [selectedApprentice, setSelectedApprentice] = useState<ApprenticeRow | null>(null);

  const filtered = APPRENTICES.filter(a => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.programme.toLowerCase().includes(search.toLowerCase())) return false;
    if (riskFilter !== 'all' && a.risk !== riskFilter) return false;
    return true;
  });

  const green = APPRENTICES.filter(a => a.risk === 'Green').length;
  const amber = APPRENTICES.filter(a => a.risk === 'Amber').length;
  const red = APPRENTICES.filter(a => a.risk === 'Red').length;

  const p = LEARNER_PROFILE;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="My Apprentices" pageSubtitle={`${APPRENTICES.length} apprentices across ${[...new Set(APPRENTICES.map(a => a.programme))].length} programmes at Tim Hortons UK`} userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-star-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">My Apprentices</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{APPRENTICES.length} apprentices</strong> · {green} on-track · {amber} need attention · {red} at risk
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{green}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">On Track</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{amber}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Attention</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{red}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">At Risk</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apprentices..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All', count: APPRENTICES.length },{ key: 'Green', label: 'On Track', count: green },{ key: 'Amber', label: 'Attention', count: amber },{ key: 'Red', label: 'At Risk', count: red }].map(f => (
              <button key={f.key} onClick={() => setRiskFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${riskFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f.label} <span className="ml-1 text-[10px] opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Apprentices Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(app => (
            <div key={app.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth cursor-pointer" onClick={() => setSelectedApprentice(app)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${app.risk === 'Red' ? 'bg-red-100 text-red-700 ring-red-200' : app.risk === 'Amber' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                    <span className="text-sm font-bold">{app.initials}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{app.name}</p>
                    <p className="text-[11px] text-foreground-400">{app.programme} {app.level}</p>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${app.risk === 'Red' ? 'bg-red-100 text-red-700' : app.risk === 'Amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{app.risk}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-[9px] text-foreground-400 uppercase tracking-wider">Progress</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${app.progress >= 60 ? 'bg-emerald-500' : app.progress >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${app.progress}%` }}></div>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground-700">{app.progress}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-foreground-400 uppercase tracking-wider">Attendance</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${app.attendance >= 90 ? 'bg-emerald-500' : app.attendance >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${app.attendance}%` }}></div>
                    </div>
                    <span className="text-[11px] font-semibold text-foreground-700">{app.attendance}%</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-foreground-400">
                <span><AppIcon className="ri-time-line mr-0.5 text-foreground-300"></AppIcon> {app.otjhCompleted}/{app.otjhTarget}h</span>
                <span><AppIcon className="ri-user-heart-line mr-0.5 text-foreground-300"></AppIcon> {app.coach}</span>
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-background-100">
                <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap text-center">
                  <AppIcon className="ri-eye-line mr-1"></AppIcon> View Profile
                </button>
                <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-mail-line mr-1"></AppIcon> Message
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Detail Modal */}
        {selectedApprentice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedApprentice(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${selectedApprentice.risk === 'Red' ? 'bg-red-100 text-red-700 ring-red-200' : selectedApprentice.risk === 'Amber' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                    <span className="text-sm font-bold">{selectedApprentice.initials}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedApprentice.name}</h3>
                    <p className="text-[11px] text-foreground-400">{selectedApprentice.programme} {selectedApprentice.level} · Started {selectedApprentice.startDate}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedApprentice(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                  <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <QuickStat label="Progress" value={`${selectedApprentice.progress}%`} color="primary" />
                  <QuickStat label="Attendance" value={`${selectedApprentice.attendance}%`} color="accent" />
                  <QuickStat label="OTJH" value={`${formatHoursMinutes(selectedApprentice.otjhCompleted)} / ${formatHoursMinutes(selectedApprentice.otjhTarget)}`} color="secondary" />
                  <QuickStat label="KSB" value={`${selectedApprentice.ksbProgress}%`} color="primary" />
                </div>
                <div className="bg-background-100 rounded-xl p-4 space-y-3">
                  <InfoRow label="Coach" value={selectedApprentice.coach} icon="ri-user-heart-line" />
                  <InfoRow label="Next Review" value={selectedApprentice.nextReview} icon="ri-calendar-check-line" />
                  <InfoRow label="Risk Status" value={selectedApprentice.risk} icon="ri-alert-line" risk={selectedApprentice.risk} />
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-file-chart-line mr-1"></AppIcon> Full Profile
                  </button>
                  <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap" onClick={() => setSelectedApprentice(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  const bg = color === 'primary' ? 'bg-primary-100 text-primary-600' : color === 'accent' ? 'bg-accent-100 text-accent-600' : 'bg-secondary-100 text-secondary-600';
  return (
    <div className="bg-background-100 rounded-xl p-3 text-center">
      <p className="text-lg font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}

function InfoRow({ label, value, icon, risk }: { label: string; value: string; icon: string; risk?: string }) {
  return (
    <div className="flex items-center gap-3">
      <AppIcon className={`${icon} text-foreground-400 text-sm w-5`}></AppIcon>
      <span className="text-[11px] text-foreground-500 w-24">{label}</span>
      <span className={`text-[11px] font-medium ${risk === 'Red' ? 'text-red-600' : risk === 'Amber' ? 'text-amber-600' : 'text-foreground-900'}`}>{value}</span>
    </div>
  );
}
