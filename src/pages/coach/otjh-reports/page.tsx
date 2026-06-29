import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const OTJH_DATA = [
  { learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', planned: 120, actual: 74, remaining: 46, pace: 62, status: 'behind' as const, lastMonth: 12, avgPerMonth: 10, risk: 'amber' as const },
  { learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', planned: 100, actual: 22, remaining: 78, pace: 22, status: 'behind' as const, lastMonth: 4, avgPerMonth: 4, risk: 'red' as const },
  { learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', planned: 100, actual: 30, remaining: 70, pace: 30, status: 'behind' as const, lastMonth: 6, avgPerMonth: 6, risk: 'amber' as const },
  { learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', planned: 120, actual: 88, remaining: 32, pace: 73, status: 'on-track' as const, lastMonth: 14, avgPerMonth: 13, risk: 'green' as const },
  { learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', planned: 120, actual: 110, remaining: 10, pace: 92, status: 'ahead' as const, lastMonth: 16, avgPerMonth: 15, risk: 'green' as const },
  { learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', planned: 110, actual: 62, remaining: 48, pace: 56, status: 'on-track' as const, lastMonth: 10, avgPerMonth: 9, risk: 'green' as const },
  { learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', planned: 120, actual: 72, remaining: 48, pace: 60, status: 'on-track' as const, lastMonth: 11, avgPerMonth: 10, risk: 'green' as const },
  { learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', planned: 80, actual: 8, remaining: 72, pace: 10, status: 'on-track' as const, lastMonth: 8, avgPerMonth: 8, risk: 'green' as const },
];

export default function CoachOtjhReports() {
  const [filter, setFilter] = useState<'all' | 'behind' | 'on-track' | 'ahead'>('all');

  const filtered = OTJH_DATA.filter(l => filter === 'all' || l.status === filter);
  const behind = OTJH_DATA.filter(l => l.status === 'behind').length;
  const onTrack = OTJH_DATA.filter(l => l.status === 'on-track').length;
  const ahead = OTJH_DATA.filter(l => l.status === 'ahead').length;
  const totalPlanned = OTJH_DATA.reduce((a, b) => a + b.planned, 0);
  const totalActual = OTJH_DATA.reduce((a, b) => a + b.actual, 0);

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="OTJH Reports" pageSubtitle="Monitor Off-The-Job Hours progress and pace" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-time-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">OTJH Reports</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Total caseload: <strong>{totalActual}/{totalPlanned} hours</strong> ({Math.round(totalActual/totalPlanned*100)}%). {behind} behind, {onTrack} on track, {ahead} ahead.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalActual}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Actual hrs</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalPlanned}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Planned hrs</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-300">{behind}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Behind</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({OTJH_DATA.length})</span></button>
          <button onClick={() => setFilter('behind')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'behind' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Behind <span className="text-[10px] opacity-60">({behind})</span></button>
          <button onClick={() => setFilter('on-track')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'on-track' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>On Track <span className="text-[10px] opacity-60">({onTrack})</span></button>
          <button onClick={() => setFilter('ahead')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'ahead' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Ahead <span className="text-[10px] opacity-60">({ahead})</span></button>
        </div>

        {/* OTJH Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span className="text-center">Planned</span>
            <span className="text-center">Actual</span>
            <span className="text-center">Remaining</span>
            <span className="text-center">Pace</span>
            <span className="text-center">Last Month</span>
            <span className="text-center">Avg/Month</span>
            <span className="text-center">Risk</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(row => (
              <div key={row.initials} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${row.risk === 'red' ? 'bg-red-100 text-red-700' : row.risk === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.initials}</div>
                  <div>
                    <p className="text-[12px] font-medium text-foreground-900">{row.learner}</p>
                    <p className="text-[10px] text-foreground-400">{row.programme}</p>
                  </div>
                </div>
                <span className="text-[11px] text-foreground-500 text-center">{row.planned}</span>
                <span className="text-[11px] font-semibold text-center text-primary-600">{row.actual}</span>
                <span className="text-[11px] text-foreground-500 text-center">{row.remaining}</span>
                <span className={`text-[11px] font-semibold text-center ${row.pace >= 75 ? 'text-emerald-600' : row.pace >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{row.pace}%</span>
                <span className="text-[11px] text-foreground-500 text-center">{row.lastMonth}</span>
                <span className="text-[11px] text-foreground-500 text-center">{row.avgPerMonth}</span>
                <div className="flex justify-center">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${row.risk === 'green' ? 'bg-emerald-100 text-emerald-700' : row.risk === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{row.risk}</span>
                </div>
                <div className="text-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Details</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}