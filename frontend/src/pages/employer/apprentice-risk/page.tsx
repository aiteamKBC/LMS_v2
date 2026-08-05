import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface AtRiskApprentice {
  id: string;
  name: string;
  initials: string;
  programme: string;
  level: string;
  riskLevel: 'High' | 'Medium' | 'Low';
  riskCategories: string[];
  progress: number;
  attendance: number;
  otjhGap: number;
  lastReview: string;
  coach: string;
  actionRequired: string;
  daysSinceFlagged: number;
}

const AT_RISK_APPRENTICES: AtRiskApprentice[] = [
  { id: 'ar-01', name: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive', level: 'L4', riskLevel: 'High', riskCategories: ['Attendance', 'OTJH Gap', 'Progress Below Target'], progress: 38, attendance: 82, otjhGap: 14, lastReview: '28 May 2026', coach: 'Med Maher', actionRequired: 'Attendance improvement plan and catch-up sessions needed', daysSinceFlagged: 14 },
  { id: 'ar-02', name: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive', level: 'L4', riskLevel: 'Medium', riskCategories: ['OTJH Gap', 'Evidence Submission Delays'], progress: 42, attendance: 86, otjhGap: 8, lastReview: '25 Jun 2026', coach: 'Med Maher', actionRequired: 'Employer confirmation of OTJH backlog needed', daysSinceFlagged: 7 },
  { id: 'ar-03', name: 'Mark Jensen', initials: 'MJ', programme: 'Digital Marketer', level: 'L3', riskLevel: 'Medium', riskCategories: ['KSB Portfolio Incomplete', 'Gateway Approaching'], progress: 72, attendance: 88, otjhGap: 5, lastReview: '22 Jun 2026', coach: 'Med Maher', actionRequired: 'KSB portfolio evidence validation required before gateway', daysSinceFlagged: 3 },
  { id: 'ar-04', name: 'Lucy Barnes', initials: 'LB', programme: 'HR Consultant', level: 'L5', riskLevel: 'Low', riskCategories: ['Slow Start — Monitoring'], progress: 30, attendance: 97, otjhGap: 2, lastReview: '15 Jul 2026', coach: 'David Osei', actionRequired: 'Monitor early progress and support workplace integration', daysSinceFlagged: 21 },
];

export default function EmployerApprenticeRisk() {
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [selected, setSelected] = useState<AtRiskApprentice | null>(null);

  const filtered = levelFilter === 'all' ? AT_RISK_APPRENTICES : AT_RISK_APPRENTICES.filter(a => a.riskLevel === levelFilter);

  const highRisk = AT_RISK_APPRENTICES.filter(a => a.riskLevel === 'High').length;
  const mediumRisk = AT_RISK_APPRENTICES.filter(a => a.riskLevel === 'Medium').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Apprentice Risk" pageSubtitle="Monitor and manage apprentices requiring attention or intervention" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-alert-line text-white text-2xl"></AppIcon>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Apprentice Risk</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{AT_RISK_APPRENTICES.length} apprentices flagged</strong> · {highRisk} high risk · {mediumRisk} medium risk
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-200">{highRisk}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">High Risk</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-200">{mediumRisk}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Medium</p>
              </div>
            </div>
          </div>
        </div>

        {highRisk > 0 && (
          <div className="bg-red-50 border border-red-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-error-warning-line text-red-600 text-base"></AppIcon>
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">{highRisk} apprentice{highRisk > 1 ? 's' : ''} at high risk — action required</p>
              <p className="text-[12px] text-red-600 mt-0.5">These apprentices may be at risk of failing to complete their apprenticeship without intervention</p>
            </div>
            <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-[12px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-alert-line mr-1"></AppIcon> Review All
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
          {[{ key: 'all', label: 'All', count: AT_RISK_APPRENTICES.length },{ key: 'High', label: 'High Risk', count: highRisk },{ key: 'Medium', label: 'Medium', count: mediumRisk },{ key: 'Low', label: 'Low', count: AT_RISK_APPRENTICES.filter(a => a.riskLevel === 'Low').length }].map(f => (
            <button key={f.key} onClick={() => setLevelFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${levelFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label} <span className="ml-1 text-[10px] opacity-60">{f.count}</span></button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map(app => {
            const riskColor = app.riskLevel === 'High' ? 'border-red-200/50 bg-red-50/20' : app.riskLevel === 'Medium' ? 'border-amber-200/50 bg-amber-50/20' : 'border-foreground-200/60';
            const riskBadge = app.riskLevel === 'High' ? 'bg-red-100 text-red-700' : app.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
            return (
              <div key={app.id} className={`bg-background-50 rounded-xl border p-4 ${riskColor} cursor-pointer`} onClick={() => setSelected(app)}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${app.riskLevel === 'High' ? 'bg-red-100 text-red-700 ring-red-200' : app.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                    <span className="text-sm font-bold">{app.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-foreground-900">{app.name}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskBadge}`}>Risk: {app.riskLevel}</span>
                      <span className="text-[10px] text-foreground-400">Flagged {app.daysSinceFlagged} days ago</span>
                    </div>
                    <p className="text-[11px] text-foreground-400">{app.programme} {app.level} · {app.progress}% progress · {app.attendance}% attendance · OTJH gap: {app.otjhGap}h</p>
                    <div className="flex flex-wrap items-center gap-1 mt-2">
                      {app.riskCategories.map(cat => (
                        <span key={cat} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{cat}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={e => { e.stopPropagation(); }} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-eye-line mr-1"></AppIcon> View
                    </button>
                    <button onClick={e => { e.stopPropagation(); }} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-chat-1-line mr-1"></AppIcon> Discuss
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ${selected.riskLevel === 'High' ? 'bg-red-100 text-red-700 ring-red-200' : selected.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                    <span className="text-xs font-bold">{selected.initials}</span>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{selected.name}</h3>
                </div>
                <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                  <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.progress}%</p><p className="text-[10px] text-foreground-400">Progress</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.attendance}%</p><p className="text-[10px] text-foreground-400">Attendance</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.otjhGap}h</p><p className="text-[10px] text-foreground-400">OTJH Gap</p></div>
                </div>
                <div className="bg-red-50 rounded-xl border border-red-200/50 p-4">
                  <p className="text-[12px] font-semibold text-red-800 mb-1">Action Required</p>
                  <p className="text-[12px] text-red-700">{selected.actionRequired}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-user-heart-line text-foreground-400"></AppIcon><span className="text-foreground-500">Coach:</span><span className="font-medium text-foreground-900">{selected.coach}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-calendar-line text-foreground-400"></AppIcon><span className="text-foreground-500">Last Review:</span><span className="font-medium text-foreground-900">{selected.lastReview}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><AppIcon className="ri-timer-line text-foreground-400"></AppIcon><span className="text-foreground-500">Days Since Flagged:</span><span className="font-medium text-foreground-900">{selected.daysSinceFlagged}</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Message Coach</button>
                  <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Escalate</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}