import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const KSB_COVERAGE = [
  { area: 'Knowledge', total: 42, covered: 36, validated: 28, gap: 6, weakAreas: 4, progress: 68, target: 100 },
  { area: 'Skills', total: 38, covered: 30, validated: 22, gap: 8, weakAreas: 6, progress: 56, target: 100 },
  { area: 'Behaviours', total: 24, covered: 22, validated: 18, gap: 2, weakAreas: 2, progress: 72, target: 100 },
];

const KSB_BY_COHORT = [
  { cohort: 'SD-L4 Sep 2024', knowledge: 100, skills: 100, behaviours: 100 },
  { cohort: 'OM-L5 Jan 2025', knowledge: 96, skills: 94, behaviours: 98 },
  { cohort: 'HR-L5 March 2025', knowledge: 68, skills: 64, behaviours: 72 },
  { cohort: 'ME-L4 May 2026', knowledge: 38, skills: 34, behaviours: 42 },
  { cohort: 'BA-L3 June 2026', knowledge: 13, skills: 11, behaviours: 15 },
  { cohort: 'PM-L4 Feb 2026', knowledge: 18, skills: 15, behaviours: 21 },
  { cohort: 'DA-L4 April 2026', knowledge: 0, skills: 0, behaviours: 0 },
];

const WEAK_AREAS = [
  { area: 'Data Analysis Methods', type: 'Knowledge', cohort: 'ME-L4 May 2026', coverage: 28, severity: 'high' as const },
  { area: 'Project Planning Tools', type: 'Skills', cohort: 'PM-L4 Feb 2026', coverage: 22, severity: 'high' as const },
  { area: 'Regulatory Compliance', type: 'Knowledge', cohort: 'HR-L5 March 2025', coverage: 45, severity: 'medium' as const },
  { area: 'Stakeholder Communication', type: 'Skills', cohort: 'ME-L4 May 2026', coverage: 52, severity: 'medium' as const },
  { area: 'Professional Ethics', type: 'Behaviours', cohort: 'BA-L3 June 2026', coverage: 40, severity: 'medium' as const },
  { area: 'Resource Management', type: 'Skills', cohort: 'PM-L4 Feb 2026', coverage: 35, severity: 'high' as const },
];

export default function KsbProgressPage() {
  const avgProgress = Math.round(KSB_COVERAGE.reduce((s, k) => s + k.progress, 0) / KSB_COVERAGE.length);
  const totalGaps = KSB_COVERAGE.reduce((s, k) => s + k.gap, 0);
  const totalWeak = KSB_COVERAGE.reduce((s, k) => s + k.weakAreas, 0);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="KSB Progress" pageSubtitle="KSB coverage, validation, weak areas, evidence gaps and progression towards gateway readiness" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="KSB Progress" description={`Overall KSB progress ${avgProgress}% · ${totalGaps} gap areas · ${totalWeak} weak KSBs identified`} icon="ri-bar-chart-2-line" stats={[{ label: 'Overall Progress', value: `${avgProgress}%` }, { label: 'Gap Areas', value: String(totalGaps) }, { label: 'Weak KSBs', value: String(totalWeak) }]} />

        {/* KSB Coverage Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {KSB_COVERAGE.map(k => (
            <div key={k.area} className="bg-background-50 rounded-xl border border-background-200/50 p-5">
              <h3 className="text-[12px] font-heading font-semibold text-foreground-900 mb-3">{k.area}</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { l: 'Total KSBs', v: String(k.total) }, { l: 'Covered', v: String(k.covered) },
                  { l: 'Validated', v: String(k.validated) }, { l: 'Gaps', v: String(k.gap), warn: true },
                ].map(s => (
                  <div key={s.l} className="bg-background-100/60 rounded-lg p-2 text-center">
                    <p className={`text-[15px] font-bold ${s.warn ? 'text-red-600' : 'text-foreground-900'}`}>{s.v}</p>
                    <p className="text-[8px] text-foreground-400">{s.l}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="w-full bg-background-200 rounded-full h-3 flex overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${(k.validated / k.total) * 100}%` }}></div>
                  <div className="h-full bg-amber-500" style={{ width: `${((k.covered - k.validated) / k.total) * 100}%` }}></div>
                  <div className="h-full bg-red-200" style={{ width: `${(k.gap / k.total) * 100}%` }}></div>
                </div>
                <div className="flex items-center justify-between text-[9px] text-foreground-400">
                  <span>{k.progress}% of target</span>
                  <span>{k.weakAreas} weak areas</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* KSB by Cohort */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">KSB Progress by Cohort</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">Cohort</th>
                  <th className="text-center py-2.5">Knowledge</th>
                  <th className="text-center py-2.5">Skills</th>
                  <th className="text-center py-2.5">Behaviours</th>
                  <th className="text-center py-2.5">Overall</th>
                </tr>
              </thead>
              <tbody>
                {KSB_BY_COHORT.map(c => {
                  const avg = Math.round((c.knowledge + c.skills + c.behaviours) / 3);
                  return (
                    <tr key={c.cohort} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                      <td className="py-2.5 px-4 font-medium text-foreground-700">{c.cohort}</td>
                      {[c.knowledge, c.skills, c.behaviours].map((v, i) => (
                        <td key={i} className="text-center py-2.5">
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-16 bg-background-200 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${v >= 80 ? 'bg-emerald-500' : v >= 50 ? 'bg-amber-500' : v > 0 ? 'bg-red-500' : 'bg-background-300'}`} style={{ width: `${v}%` }}></div>
                            </div>
                            <span className={`text-[11px] font-semibold w-7 ${v >= 80 ? 'text-emerald-600' : v >= 50 ? 'text-amber-600' : v > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{v > 0 ? `${v}%` : '—'}</span>
                          </div>
                        </td>
                      ))}
                      <td className="text-center"><span className={`text-[11px] font-bold ${avg >= 80 ? 'text-emerald-600' : avg >= 50 ? 'text-amber-600' : avg > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{avg > 0 ? `${avg}%` : '—'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Weak KSB Areas */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Weak KSB Areas Requiring Attention</h3>
          <div className="space-y-2">
            {WEAK_AREAS.map(w => (
              <div key={w.area} className={`flex items-center justify-between p-3 rounded-lg border ${w.severity === 'high' ? 'border-red-200/60 bg-red-50/20' : 'border-amber-200/60 bg-amber-50/20'}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${w.severity === 'high' ? 'bg-red-500' : 'bg-amber-500'}`}></span>
                  <div>
                    <p className="text-[12px] font-semibold text-foreground-900">{w.area}</p>
                    <p className="text-[10px] text-foreground-400">{w.type} · {w.cohort}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[12px] font-bold text-foreground-900">{w.coverage}%</p>
                    <p className="text-[8px] text-foreground-400">coverage</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-semibold ${w.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{w.severity.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}