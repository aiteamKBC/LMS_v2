import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const AT_RISK_DATA = [
  { id: 'ar1', name: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort B', riskLevel: 'high' as const, riskFlags: ['Attendance 76%', 'OTJH behind 18%', 'KSB Amber 4'], coach: 'Med Maher', lastContact: '5 Jun 2026', actions: 3 },
  { id: 'ar2', name: 'Sophie Williams', programme: 'Business Admin L3', cohort: 'Cohort C', riskLevel: 'medium' as const, riskFlags: ['Attendance 86%', '2 absences this month'], coach: 'Med Maher', lastContact: '8 Jun 2026', actions: 2 },
  { id: 'ar3', name: 'Liam Foster', programme: 'Data Analyst L4', cohort: 'Cohort B', riskLevel: 'high' as const, riskFlags: ['Inactive 14 days', 'OTJH behind 25%', 'Missed 2 coaching'], coach: 'Med Maher', lastContact: '20 May 2026', actions: 4 },
  { id: 'ar4', name: 'Aisha Patel', programme: 'Business Admin L3', cohort: 'Cohort A', riskLevel: 'medium' as const, riskFlags: ['Attendance 82%', 'KSB Amber 2'], coach: 'Sarah Mitchell', lastContact: '6 Jun 2026', actions: 2 },
  { id: 'ar5', name: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort D', riskLevel: 'low' as const, riskFlags: ['Attendance 88%', '1 absence this month'], coach: 'Med Maher', lastContact: '9 Jun 2026', actions: 1 },
  { id: 'ar6', name: 'Emily Watson', programme: 'Business Admin L3', cohort: 'Cohort A', riskLevel: 'low' as const, riskFlags: ['Attendance 90%', 'KSB Amber 1'], coach: 'Sarah Mitchell', lastContact: '10 Jun 2026', actions: 1 },
];

export default function AdminAtRiskPage() {
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [selectedLearner, setSelectedLearner] = useState<string | null>(null);

  const highCount = AT_RISK_DATA.filter(l => l.riskLevel === 'high').length;
  const mediumCount = AT_RISK_DATA.filter(l => l.riskLevel === 'medium').length;
  const lowCount = AT_RISK_DATA.filter(l => l.riskLevel === 'low').length;
  const totalActions = AT_RISK_DATA.reduce((a, b) => a + b.actions, 0);

  const filtered = AT_RISK_DATA.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase());
    const matchRisk = riskFilter === 'all' || l.riskLevel === riskFilter;
    return matchSearch && matchRisk;
  });

  const learner = selectedLearner ? AT_RISK_DATA.find(l => l.id === selectedLearner) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="At-risk Learners" pageSubtitle="Risk monitoring, intervention tracking, and escalation management" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-alert-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">At-risk Learners</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{AT_RISK_DATA.length} learners flagged</strong> — {highCount} high risk, {mediumCount} medium, {lowCount} low. {totalActions} open actions.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{highCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">High Risk</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{mediumCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Medium</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalActions}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Actions</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search learners..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Risk Levels</option>
              <option value="high">High Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="low">Low Risk</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1.5"></AppIcon> New Action
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Learners List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(l => {
              const riskColors = {
                high: 'bg-red-50 text-red-700 border-red-200/50',
                medium: 'bg-accent-50 text-accent-700 border-accent-200/50',
                low: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
              };
              return (
                <div key={l.id} onClick={() => setSelectedLearner(l.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedLearner === l.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${l.riskLevel === 'high' ? 'bg-red-100 text-red-600' : l.riskLevel === 'medium' ? 'bg-accent-100 text-accent-600' : 'bg-secondary-100 text-secondary-600'}`}>
                    <AppIcon className="ri-alert-line text-sm"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${riskColors[l.riskLevel]}`}>{l.riskLevel} risk</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{l.programme} · {l.cohort} · Coach: {l.coach}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {l.riskFlags.map(flag => (
                        <span key={flag} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500 border border-foreground-200/60">{flag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-[12px] text-foreground-500 shrink-0 text-right">
                    <p>{l.actions} actions</p>
                    <p className="text-[10px] text-foreground-400">Last contact: {l.lastContact}</p>
                  </div>
                  <AppIcon className={`ri-arrow-right-s-line text-foreground-300 ${selectedLearner === l.id ? 'text-primary-500' : ''}`}></AppIcon>
                </div>
              );
            })}
          </div>

          {/* Learner Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {learner ? (
              <div className="space-y-5">
                <div>
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${learner.riskLevel === 'high' ? 'bg-red-100 text-red-600' : learner.riskLevel === 'medium' ? 'bg-accent-100 text-accent-600' : 'bg-secondary-100 text-secondary-600'}`}>
                    <AppIcon className="ri-alert-line text-xl"></AppIcon>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{learner.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{learner.programme} · {learner.cohort}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{learner.actions}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Actions</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900 capitalize">{learner.riskLevel}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Risk Level</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Risk Flags</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {learner.riskFlags.map(flag => (
                      <span key={flag} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200/50">{flag}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Coach</span>
                    <span className="text-foreground-700 font-medium">{learner.coach}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Last Contact</span>
                    <span className="text-foreground-700 font-medium">{learner.lastContact}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View Profile</button>
                  <button className="flex-1 px-3 py-2 bg-accent-500 text-white rounded-lg text-[12px] font-semibold hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap">Contact Coach</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-alert-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-sm text-foreground-500">Select a learner to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}