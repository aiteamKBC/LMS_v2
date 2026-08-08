import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface Learner {
  id: string;
  name: string;
  programme: string;
  cohort: string;
  progress: number;
  attendance: number;
  evidenceSubmitted: number;
  evidenceRequired: number;
  lastActive: string;
  riskLevel: 'low' | 'medium' | 'high';
  ksbStatus: string;
  otjhHours: number;
  otjhTarget: number;
}

const LEARNERS: Learner[] = [
  { id: 'l-01', name: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C — BA', progress: 42, attendance: 86, evidenceSubmitted: 12, evidenceRequired: 18, lastActive: '8 Jun', riskLevel: 'medium', ksbStatus: '3 of 15 validated', otjhHours: 124, otjhTarget: 278 },
  { id: 'l-02', name: 'Sarah Mitchell', programme: 'Business Admin L3', cohort: 'Cohort A — BA', progress: 68, attendance: 94, evidenceSubmitted: 22, evidenceRequired: 24, lastActive: '6 Jun', riskLevel: 'low', ksbStatus: '11 of 12 validated', otjhHours: 210, otjhTarget: 278 },
  { id: 'l-03', name: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D — DT', progress: 28, attendance: 78, evidenceSubmitted: 5, evidenceRequired: 16, lastActive: '7 Jun', riskLevel: 'high', ksbStatus: '2 of 14 validated', otjhHours: 68, otjhTarget: 278 },
  { id: 'l-04', name: 'Emily Watson', programme: 'Digital Marketer L3', cohort: 'Cohort B — DM', progress: 85, attendance: 100, evidenceSubmitted: 28, evidenceRequired: 30, lastActive: '5 Jun', riskLevel: 'low', ksbStatus: '14 of 14 validated', otjhHours: 256, otjhTarget: 278 },
  { id: 'l-05', name: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C — BA', progress: 31, attendance: 83, evidenceSubmitted: 4, evidenceRequired: 14, lastActive: '6 Jun', riskLevel: 'high', ksbStatus: '1 of 12 validated', otjhHours: 72, otjhTarget: 278 },
  { id: 'l-06', name: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F — SWE', progress: 55, attendance: 94, evidenceSubmitted: 16, evidenceRequired: 20, lastActive: '4 Jun', riskLevel: 'low', ksbStatus: '8 of 16 validated', otjhHours: 162, otjhTarget: 278 },
  { id: 'l-07', name: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A — BA', progress: 60, attendance: 91, evidenceSubmitted: 18, evidenceRequired: 22, lastActive: '4 Jun', riskLevel: 'low', ksbStatus: '9 of 14 validated', otjhHours: 184, otjhTarget: 278 },
  { id: 'l-08', name: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E — EYE', progress: 12, attendance: 100, evidenceSubmitted: 2, evidenceRequired: 8, lastActive: '1 Jun', riskLevel: 'medium', ksbStatus: '1 of 10 validated', otjhHours: 34, otjhTarget: 278 },
  { id: 'l-09', name: 'Omar Hassan', programme: 'Business Admin L3', cohort: 'Cohort A — BA', progress: 45, attendance: 88, evidenceSubmitted: 10, evidenceRequired: 16, lastActive: '9 Jun', riskLevel: 'medium', ksbStatus: '5 of 12 validated', otjhHours: 118, otjhTarget: 278 },
  { id: 'l-10', name: 'Chloe Evans', programme: 'Digital Marketer L3', cohort: 'Cohort B — DM', progress: 72, attendance: 92, evidenceSubmitted: 20, evidenceRequired: 24, lastActive: '10 Jun', riskLevel: 'low', ksbStatus: '12 of 14 validated', otjhHours: 198, otjhTarget: 278 },
];

export default function TutorLearnersPage() {
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);

  const selectedLearner = LEARNERS.find(l => l.id === selectedLearnerId) || null;

  const filtered = LEARNERS.filter(l => {
    if (riskFilter !== 'all' && l.riskLevel !== riskFilter) return false;
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.programme.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const atRisk = LEARNERS.filter(l => l.riskLevel === 'high').length;
  const lowProgress = LEARNERS.filter(l => l.progress < 40).length;

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Learners" pageSubtitle="View all learners assigned to your teaching cohorts with progress, attendance and KSB tracking" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-user-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">My Learners</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{LEARNERS.length} learners across 5 cohorts · {atRisk} flagged at risk · {lowProgress} below 40% progress</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{LEARNERS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-red-300">{atRisk}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">At Risk</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{Math.round(LEARNERS.reduce((s, l) => s + l.attendance, 0) / LEARNERS.length)}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Avg Att.</p></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'High Risk', value: String(atRisk), sub: 'immediate intervention', icon: 'ri-alert-line', color: 'red' },
            { label: 'Below 40% Progress', value: String(lowProgress), sub: 'needs acceleration', icon: 'ri-speed-mini-line', color: 'amber' },
            { label: 'Attendance <85%', value: String(LEARNERS.filter(l => l.attendance < 85).length), sub: 'attendance concern', icon: 'ri-calendar-check-line', color: 'amber' },
            { label: 'On Track', value: String(LEARNERS.filter(l => l.progress >= 60 && l.riskLevel === 'low').length), sub: 'meeting targets', icon: 'ri-check-double-line', color: 'emerald' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4 cursor-pointer">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.color === 'red' ? 'bg-red-100 text-red-600' : s.color === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}><AppIcon className={`${s.icon} text-sm`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400 mb-1">{s.label}</p>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{s.value}</p>
              <p className="text-[11px] text-foreground-400 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 max-w-xs">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
              <input type="text" placeholder="Search learners..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-background-50 border border-foreground-200 rounded-lg text-[12px] text-foreground-900 placeholder-foreground-300 outline-none focus:border-primary-300" />
            </div>
            <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
              {['all', 'high', 'medium', 'low'].map(r => (
                <button key={r} onClick={() => setRiskFilter(r)} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${riskFilter === r ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1) + ' Risk'}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
            <span className="col-span-3">Learner</span>
            <span className="col-span-2 text-center">Progress</span>
            <span className="col-span-1 text-center">Attendance</span>
            <span className="col-span-2 text-center">Evidence</span>
            <span className="col-span-2 text-center">KSB Status</span>
            <span className="col-span-2 text-center">OTJH</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(l => (
              <div key={l.id} onClick={() => setSelectedLearnerId(l.id)} className={`grid grid-cols-12 gap-3 px-4 py-3.5 items-center cursor-pointer transition-smooth ${l.riskLevel === 'high' ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-background-100/50'}`}>
                <div className="col-span-3 flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${l.riskLevel === 'high' ? 'bg-red-100 text-red-700' : l.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{l.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900 truncate">{l.name}</p>
                    <p className="text-[11px] text-foreground-400 truncate">{l.programme} · {l.cohort}</p>
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <div className="flex-1 bg-background-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${l.progress >= 80 ? 'bg-emerald-500' : l.progress >= 50 ? 'bg-accent-500' : l.progress >= 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${l.progress}%` }}></div>
                  </div>
                  <span className="text-[11px] font-medium text-foreground-600 w-8 text-right">{l.progress}%</span>
                </div>
                <span className={`col-span-1 text-center text-[11px] font-medium ${l.attendance < 85 ? 'text-red-600' : 'text-foreground-500'}`}>{l.attendance}%</span>
                <span className="col-span-2 text-center text-[11px] text-foreground-500">{l.evidenceSubmitted}/{l.evidenceRequired}</span>
                <span className="col-span-2 text-center text-[11px] text-foreground-500">{l.ksbStatus}</span>
                <span className="col-span-2 text-center text-[11px] text-foreground-500">{l.otjhHours}/{l.otjhTarget} hrs</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Slide Panel — Learner Detail */}
        <RightSlidePanel
          isOpen={selectedLearner !== null}
          onClose={() => setSelectedLearnerId(null)}
          title={selectedLearner?.name || 'Learner Detail'}
          width="w-[440px]"
        >
          {selectedLearner && (
            <div className="space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedLearner.name}</h3>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{selectedLearner.programme} · {selectedLearner.cohort}</p>
                  <p className="text-[11px] text-foreground-400">Last active: {selectedLearner.lastActive}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${selectedLearner.riskLevel === 'high' ? 'bg-red-100 text-red-700' : selectedLearner.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {selectedLearner.riskLevel === 'high' ? 'High Risk' : selectedLearner.riskLevel === 'medium' ? 'Medium Risk' : 'Low Risk'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-100/50 rounded-xl p-3.5 text-center">
                  <p className="text-[10px] text-foreground-400 mb-1">Progress</p>
                  <div className="w-full bg-background-200 rounded-full h-2 mb-1.5">
                    <div className={`h-2 rounded-full ${selectedLearner.progress >= 80 ? 'bg-emerald-500' : selectedLearner.progress >= 50 ? 'bg-accent-500' : selectedLearner.progress >= 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${selectedLearner.progress}%` }}></div>
                  </div>
                  <p className="text-xl font-heading font-bold text-foreground-900">{selectedLearner.progress}%</p>
                </div>
                <div className="bg-background-100/50 rounded-xl p-3.5 text-center">
                  <p className="text-[10px] text-foreground-400 mb-1">Attendance</p>
                  <p className={`text-xl font-heading font-bold ${selectedLearner.attendance >= 90 ? 'text-emerald-600' : selectedLearner.attendance >= 85 ? 'text-amber-600' : 'text-red-600'}`}>{selectedLearner.attendance}%</p>
                </div>
                <div className="bg-background-100/50 rounded-xl p-3.5 text-center">
                  <p className="text-[10px] text-foreground-400 mb-1">Evidence</p>
                  <p className="text-xl font-heading font-bold text-foreground-900">{selectedLearner.evidenceSubmitted}/{selectedLearner.evidenceRequired}</p>
                </div>
                <div className="bg-background-100/50 rounded-xl p-3.5 text-center">
                  <p className="text-[10px] text-foreground-400 mb-1">OTJH</p>
                  <p className="text-xl font-heading font-bold text-foreground-900">{selectedLearner.otjhHours}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">KSB Status</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.ksbStatus}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Cohort</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.cohort}</span>
                </div>
                <div className="flex justify-between py-2 text-[12px]">
                  <span className="text-foreground-400">Last Active</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.lastActive}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-file-chart-line mr-1.5"></AppIcon> View Full Profile
                </button>
                <button className="w-full px-4 py-2.5 bg-background-50 border border-background-200/50 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <AppIcon className="ri-mail-line mr-1.5"></AppIcon> Message Coach
                </button>
              </div>
            </div>
          )}
        </RightSlidePanel>
      </div>
    </WorkspaceShell>
  );
}