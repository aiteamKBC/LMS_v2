import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const KSB_DATA = [
  { learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', knowledge: 42, skills: 35, behaviours: 38, overall: 38, validated: 8, evidenced: 12, applied: 6, notStarted: 14, trend: 'stable' as const },
  { learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', knowledge: 30, skills: 22, behaviours: 28, overall: 25, validated: 4, evidenced: 6, applied: 3, notStarted: 21, trend: 'down' as const },
  { learner: 'Aisha Patel', initials: 'AP', programme: 'Accountancy L3', knowledge: 28, skills: 20, behaviours: 22, overall: 22, validated: 3, evidenced: 5, applied: 2, notStarted: 18, trend: 'down' as const },
  { learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', knowledge: 75, skills: 70, behaviours: 72, overall: 72, validated: 22, evidenced: 28, applied: 18, notStarted: 4, trend: 'stable' as const },
  { learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', knowledge: 95, skills: 90, behaviours: 92, overall: 92, validated: 32, evidenced: 38, applied: 28, notStarted: 1, trend: 'up' as const },
  { learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', knowledge: 60, skills: 58, behaviours: 56, overall: 58, validated: 14, evidenced: 20, applied: 12, notStarted: 10, trend: 'stable' as const },
  { learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', knowledge: 66, skills: 64, behaviours: 62, overall: 64, validated: 18, evidenced: 22, applied: 16, notStarted: 8, trend: 'stable' as const },
  { learner: 'Maya Kapoor', initials: 'MK', programme: 'HR Consultant L5', knowledge: 12, skills: 10, behaviours: 10, overall: 10, validated: 2, evidenced: 3, applied: 1, notStarted: 24, trend: 'up' as const },
];

export default function CoachKsbImpact() {
  const [filter, setFilter] = useState<'all' | 'high-risk' | 'on-track' | 'gateway-ready'>('all');

  const filtered = KSB_DATA.filter(l => {
    if (filter === 'high-risk') return l.overall < 40;
    if (filter === 'on-track') return l.overall >= 40 && l.overall < 80;
    if (filter === 'gateway-ready') return l.overall >= 80;
    return true;
  });

  const avgKnowledge = Math.round(KSB_DATA.reduce((a, b) => a + b.knowledge, 0) / KSB_DATA.length);
  const avgSkills = Math.round(KSB_DATA.reduce((a, b) => a + b.skills, 0) / KSB_DATA.length);
  const avgBehaviours = Math.round(KSB_DATA.reduce((a, b) => a + b.behaviours, 0) / KSB_DATA.length);
  const highRisk = KSB_DATA.filter(l => l.overall < 40).length;
  const gatewayReady = KSB_DATA.filter(l => l.overall >= 80).length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Monthly KSB Impact" pageSubtitle="Track Knowledge, Skills and Behaviours progress across your caseload" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-bar-chart-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Monthly KSB Impact</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Average KSB: Knowledge {avgKnowledge}%, Skills {avgSkills}%, Behaviours {avgBehaviours}%. {highRisk} high-risk, {gatewayReady} Gateway-ready.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgKnowledge}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Knowledge</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgSkills}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Skills</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgBehaviours}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Behaviours</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setFilter('all')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'all' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>All <span className="text-[10px] opacity-60">({KSB_DATA.length})</span></button>
          <button onClick={() => setFilter('high-risk')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'high-risk' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>High Risk <span className="text-[10px] opacity-60">({highRisk})</span></button>
          <button onClick={() => setFilter('on-track')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'on-track' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>On Track</button>
          <button onClick={() => setFilter('gateway-ready')} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === 'gateway-ready' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Gateway Ready <span className="text-[10px] opacity-60">({gatewayReady})</span></button>
        </div>

        {/* KSB Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span>Learner</span>
            <span className="text-center">Knowledge</span>
            <span className="text-center">Skills</span>
            <span className="text-center">Behaviours</span>
            <span className="text-center">Overall</span>
            <span className="text-center">Validated</span>
            <span className="text-center">Evidenced</span>
            <span className="text-center">Applied</span>
            <span className="text-center">Trend</span>
            <span className="text-center">Action</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(row => (
              <div key={row.initials} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${row.overall < 40 ? 'bg-red-100 text-red-700' : row.overall >= 80 ? 'bg-accent-100 text-accent-700' : 'bg-primary-100 text-primary-700'}`}>{row.initials}</div>
                  <div>
                    <p className="text-[12px] font-medium text-foreground-900">{row.learner}</p>
                    <p className="text-[10px] text-foreground-400">{row.programme}</p>
                  </div>
                </div>
                <span className={`text-[11px] font-semibold text-center ${row.knowledge >= 80 ? 'text-emerald-600' : row.knowledge >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{row.knowledge}%</span>
                <span className={`text-[11px] font-semibold text-center ${row.skills >= 80 ? 'text-emerald-600' : row.skills >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{row.skills}%</span>
                <span className={`text-[11px] font-semibold text-center ${row.behaviours >= 80 ? 'text-emerald-600' : row.behaviours >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{row.behaviours}%</span>
                <span className={`text-[13px] font-bold text-center ${row.overall >= 80 ? 'text-emerald-600' : row.overall >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{row.overall}%</span>
                <span className="text-[11px] text-foreground-500 text-center">{row.validated}</span>
                <span className="text-[11px] text-foreground-500 text-center">{row.evidenced}</span>
                <span className="text-[11px] text-foreground-500 text-center">{row.applied}</span>
                <div className="flex justify-center">
                  <i className={`${row.trend === 'up' ? 'ri-arrow-up-line text-emerald-500' : row.trend === 'down' ? 'ri-arrow-down-line text-red-500' : 'ri-subtract-line text-foreground-400'} text-sm`}></i>
                </div>
                <div className="text-center">
                  <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}