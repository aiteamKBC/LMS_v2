import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const SAMPLING_OVERVIEW = { planned: 40, completed: 32, findings: 14, rejected: 3, closureRate: 78, repeatIssues: 4 };

const FINDINGS_SEVERITY = { critical: 0, major: 4, minor: 7, advisory: 3 };

const RECENT_FINDINGS = [
  { id: 'F-1042', area: 'Initial Assessment QA', severity: 'major' as const, description: 'BKSB results not cross-referenced with programme requirements', status: 'open' as const, owner: 'QA Officer', date: '05 Jun 2026' },
  { id: 'F-1041', area: 'Evidence QA', severity: 'minor' as const, description: 'OTJH evidence missing employer verification signature', status: 'open' as const, owner: 'Coach', date: '04 Jun 2026' },
  { id: 'F-1040', area: 'RPL QA', severity: 'major' as const, description: 'RPL calculation methodology not consistently applied', status: 'in-progress' as const, owner: 'Enrolment Officer', date: '03 Jun 2026' },
  { id: 'F-1039', area: 'Employer Contracting QA', severity: 'minor' as const, description: 'Employer declaration form version out of date', status: 'resolved' as const, owner: 'Enrolment Officer', date: '01 Jun 2026' },
  { id: 'F-1038', area: 'Onboarding QA', severity: 'major' as const, description: 'Missing apprenticeship agreement signature on 2 files', status: 'open' as const, owner: 'Employer Engagement', date: '30 May 2026' },
  { id: 'F-1037', area: 'Progress Review QA', severity: 'minor' as const, description: 'Review documentation missing SMART target setting', status: 'in-progress' as const, owner: 'Coach', date: '28 May 2026' },
  { id: 'F-1036', area: 'Eligibility QA', severity: 'advisory' as const, description: 'Right-to-work evidence format could be standardised', status: 'resolved' as const, owner: 'Enrolment Officer', date: '25 May 2026' },
  { id: 'F-1035', area: 'Module QA', severity: 'major' as const, description: 'Module content not aligned to latest IFATE standard revision', status: 'open' as const, owner: 'Curriculum Designer', date: '23 May 2026' },
];

const SAMPLE_PLANS = [
  { area: 'Onboarding QA', planned: 6, completed: 5, findings: 2, status: 'in-progress' as const },
  { area: 'Employer Contracting QA', planned: 4, completed: 4, findings: 1, status: 'completed' as const },
  { area: 'Eligibility QA', planned: 5, completed: 4, findings: 1, status: 'in-progress' as const },
  { area: 'Initial Assessment QA', planned: 4, completed: 3, findings: 2, status: 'in-progress' as const },
  { area: 'RPL QA', planned: 3, completed: 2, findings: 1, status: 'in-progress' as const },
  { area: 'Evidence QA', planned: 6, completed: 5, findings: 3, status: 'in-progress' as const },
  { area: 'Progress Review QA', planned: 4, completed: 3, findings: 2, status: 'in-progress' as const },
  { area: 'Module QA', planned: 4, completed: 3, findings: 1, status: 'in-progress' as const },
  { area: 'Delivery Setup QA', planned: 2, completed: 2, findings: 0, status: 'completed' as const },
  { area: 'Gateway & EPA QA', planned: 2, completed: 1, findings: 1, status: 'in-progress' as const },
];

export default function QaSamplingPage() {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'major' | 'minor'>('all');
  const filteredFindings = severityFilter === 'all' ? RECENT_FINDINGS : RECENT_FINDINGS.filter(f => f.severity === severityFilter);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="QA Sampling" pageSubtitle="Sample plans, completed samples, findings, rejected items, repeated issues, severity and closure status" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="QA Sampling Overview" description={`${SAMPLING_OVERVIEW.completed}/${SAMPLING_OVERVIEW.planned} samples completed · ${SAMPLING_OVERVIEW.findings} findings · ${SAMPLING_OVERVIEW.closureRate}% closure`} icon="ri-pie-chart-2-line" stats={[{ label: 'Completed', value: `${SAMPLING_OVERVIEW.completed}/${SAMPLING_OVERVIEW.planned}` }, { label: 'Findings', value: String(SAMPLING_OVERVIEW.findings) }, { label: 'Closure Rate', value: `${SAMPLING_OVERVIEW.closureRate}%` }]} />

        {/* Severity Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { l: 'Critical', v: FINDINGS_SEVERITY.critical, c: 'bg-red-500' },
            { l: 'Major', v: FINDINGS_SEVERITY.major, c: 'bg-amber-500' },
            { l: 'Minor', v: FINDINGS_SEVERITY.minor, c: 'bg-accent-500' },
            { l: 'Advisory', v: FINDINGS_SEVERITY.advisory, c: 'bg-secondary-500' },
          ].map(s => (
            <div key={s.l} className="bg-background-50 rounded-xl border border-background-200/50 p-4 text-center">
              <span className={`w-10 h-10 rounded-lg ${s.c} flex items-center justify-center mx-auto mb-2`}><span className="text-white text-lg font-bold">{s.v}</span></span>
              <p className="text-[10px] font-semibold text-foreground-600">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Sample Plans Grid */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Sample Plans by Area</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {SAMPLE_PLANS.map(sp => (
              <div key={sp.area} className="p-3 rounded-lg border border-foreground-200">
                <p className="text-[11px] font-semibold text-foreground-800 mb-2">{sp.area}</p>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-foreground-400">Progress</span>
                  <span className="text-[10px] font-semibold text-foreground-700">{sp.completed}/{sp.planned}</span>
                </div>
                <div className="w-full bg-background-200 rounded-full h-1.5 mb-1">
                  <div className={`h-1.5 rounded-full ${sp.completed === sp.planned ? 'bg-emerald-500' : 'bg-accent-500'}`} style={{ width: `${(sp.completed / sp.planned) * 100}%` }}></div>
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-foreground-400">Findings: <span className="font-semibold text-foreground-600">{sp.findings}</span></span>
                  <span className={`font-medium ${sp.status === 'completed' ? 'text-emerald-600' : 'text-amber-600'}`}>{sp.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Findings Filter & Table */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Recent QA Findings</h3>
            <div className="flex items-center gap-1 bg-background-100 rounded-lg p-0.5">
              {[{ key: 'all' as const, label: 'All' }, { key: 'major' as const, label: 'Major' }, { key: 'minor' as const, label: 'Minor' }].map(f => (
                <button key={f.key} onClick={() => setSeverityFilter(f.key)} className={`px-3 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap cursor-pointer transition-smooth ${severityFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">ID</th>
                  <th className="text-left py-2.5">Area</th>
                  <th className="text-left py-2.5">Description</th>
                  <th className="text-center py-2.5">Severity</th>
                  <th className="text-center py-2.5">Status</th>
                  <th className="text-left py-2.5">Owner</th>
                  <th className="text-left py-2.5">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredFindings.map(f => (
                  <tr key={f.id} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2.5 px-4 font-mono text-[10px] text-foreground-500">{f.id}</td>
                    <td className="py-2.5 text-foreground-700">{f.area}</td>
                    <td className="py-2.5 text-foreground-600 max-w-[240px] truncate">{f.description}</td>
                    <td className="text-center py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold ${f.severity === 'major' ? 'bg-red-100 text-red-700' : f.severity === 'minor' ? 'bg-amber-100 text-amber-700' : 'bg-accent-100 text-accent-700'}`}>{f.severity.toUpperCase()}</span>
                    </td>
                    <td className="text-center py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-semibold ${f.status === 'open' ? 'bg-red-100 text-red-700' : f.status === 'in-progress' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{f.status.replace('-', ' ').toUpperCase()}</span>
                    </td>
                    <td className="py-2.5 text-foreground-500">{f.owner}</td>
                    <td className="py-2.5 text-foreground-400">{f.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}