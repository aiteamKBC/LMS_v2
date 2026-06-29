import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const COHORTS_DETAIL = [
  { name: 'ME-L4 May 2026', programme: 'Management L4', learners: 8, completion: 42, attendance: 90, otjh: 62, ksb: 38, monthlyCycle: 44, reviewsDone: 3, riskLevel: 'medium' as const, tutor: 'Helen Curtis', coach: 'Martin Reeves', started: 'May 2026', gatewayEstimate: 'Nov 2027' },
  { name: 'BA-L3 June 2026', programme: 'Business Admin L3', learners: 6, completion: 11, attendance: 96, otjh: 16, ksb: 13, monthlyCycle: 100, reviewsDone: 1, riskLevel: 'low' as const, tutor: 'Crispin Jones', coach: 'Martin Reeves', started: 'Jun 2026', gatewayEstimate: 'Dec 2027' },
  { name: 'DA-L4 April 2026', programme: 'Data Analyst L4', learners: 5, completion: 0, attendance: 0, otjh: 0, ksb: 0, monthlyCycle: 0, reviewsDone: 0, riskLevel: 'high' as const, tutor: 'Rachel Oduya', coach: 'Unassigned', started: 'Apr 2026', gatewayEstimate: 'Oct 2027' },
  { name: 'OM-L5 Jan 2025', programme: 'Ops Manager L5', learners: 4, completion: 94, attendance: 97, otjh: 98, ksb: 96, monthlyCycle: 88, reviewsDone: 12, riskLevel: 'low' as const, tutor: 'Crispin Jones', coach: 'Sarah Collins', started: 'Jan 2025', gatewayEstimate: 'Jul 2026' },
  { name: 'HR-L5 March 2025', programme: 'HR Consultant L5', learners: 3, completion: 71, attendance: 93, otjh: 74, ksb: 68, monthlyCycle: 75, reviewsDone: 8, riskLevel: 'low' as const, tutor: 'Crispin Jones', coach: 'Daniel Foster', started: 'Mar 2025', gatewayEstimate: 'Sep 2026' },
  { name: 'PM-L4 Feb 2026', programme: 'Project Manager L4', learners: 5, completion: 22, attendance: 71, otjh: 20, ksb: 18, monthlyCycle: 33, reviewsDone: 1, riskLevel: 'high' as const, tutor: 'Crispin Jones', coach: 'Martin Reeves', started: 'Feb 2026', gatewayEstimate: 'Aug 2027' },
  { name: 'SD-L4 Sep 2024', programme: 'Software Dev L4', learners: 6, completion: 100, attendance: 98, otjh: 100, ksb: 100, monthlyCycle: 92, reviewsDone: 18, riskLevel: 'low' as const, tutor: 'Rachel Oduya', coach: 'Sarah Collins', started: 'Sep 2024', gatewayEstimate: 'Mar 2026' },
];

const MONTHLY_COHORT_TRENDS = [
  { month: 'Jan', me: 28, ba: 0, da: 0, om: 82, hr: 60, pm: 0, sd: 88 },
  { month: 'Feb', me: 32, ba: 0, da: 0, om: 86, hr: 64, pm: 8, sd: 90 },
  { month: 'Mar', me: 36, ba: 0, da: 0, om: 90, hr: 66, pm: 12, sd: 94 },
  { month: 'Apr', me: 40, ba: 0, da: 0, om: 92, hr: 68, pm: 16, sd: 96 },
  { month: 'May', me: 42, ba: 0, da: 0, om: 94, hr: 71, pm: 20, sd: 98 },
  { month: 'Jun', me: 42, ba: 11, da: 0, om: 94, hr: 71, pm: 22, sd: 100 },
];

export default function CohortPerformancePage() {
  const [selectedRisk, setSelectedRisk] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const filtered = selectedRisk === 'all' ? COHORTS_DETAIL : COHORTS_DETAIL.filter(c => c.riskLevel === selectedRisk);
  const highCount = COHORTS_DETAIL.filter(c => c.riskLevel === 'high').length;
  const avgComp = Math.round(COHORTS_DETAIL.filter(c => c.completion > 0).reduce((s, c) => s + c.completion, 0) / COHORTS_DETAIL.filter(c => c.completion > 0).length);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Cohort Performance" pageSubtitle="Performance by cohort — learner progress, attendance, OTJH, KSB, monthly cycle and risk" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Cohort Performance" description={`${COHORTS_DETAIL.length} active cohorts · ${highCount} at-risk · Avg completion ${avgComp}%`} icon="ri-group-line" stats={[{ label: 'Cohorts', value: String(COHORTS_DETAIL.length) }, { label: 'At-Risk', value: String(highCount) }, { label: 'Avg Completion', value: `${avgComp}%` }]} />

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {[{ key: 'all' as const, label: 'All Cohorts' }, { key: 'high' as const, label: 'High Risk' }, { key: 'medium' as const, label: 'Medium Risk' }, { key: 'low' as const, label: 'Low Risk' }].map(f => (
            <button key={f.key} onClick={() => setSelectedRisk(f.key)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-smooth ${selectedRisk === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
          ))}
        </div>

        {/* Cohort Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(c => {
            const health = Math.round((c.completion + c.attendance + (c.otjh || 0) + c.ksb) / 4);
            return (
              <div key={c.name} className={`bg-background-50 rounded-xl border p-5 ${c.riskLevel === 'high' ? 'border-red-200/60' : c.riskLevel === 'medium' ? 'border-amber-200/60' : 'border-foreground-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{c.name}</h3>
                    <p className="text-[10px] text-foreground-400">{c.programme} · {c.learners} learners · Started {c.started}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${c.riskLevel === 'high' ? 'bg-red-100 text-red-700' : c.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{c.riskLevel.toUpperCase()}</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                  {[
                    { l: 'Completion', v: `${c.completion}%` }, { l: 'Attendance', v: `${c.attendance}%` }, { l: 'OTJH', v: `${c.otjh}%` },
                    { l: 'KSB', v: `${c.ksb}%` }, { l: 'Monthly Cycle', v: `${c.monthlyCycle}%` }, { l: 'Reviews', v: String(c.reviewsDone) },
                  ].map(m => (
                    <div key={m.l} className="bg-background-100/60 rounded-lg p-2 text-center">
                      <p className="text-[13px] font-bold text-foreground-900">{m.v}</p>
                      <p className="text-[8px] text-foreground-400">{m.l}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px] text-foreground-500">
                  <span>Tutor: {c.tutor}</span>
                  <span>Coach: {c.coach}</span>
                  <span>Gateway: {c.gatewayEstimate}</span>
                </div>
                <div className="mt-2 w-full bg-background-200 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${health >= 80 ? 'bg-emerald-500' : health >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${health}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Completion Trend by Cohort */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Completion Trend by Cohort</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left py-2 px-3 text-foreground-400 font-medium">Month</th>
                  {COHORTS_DETAIL.slice(0, 6).map(c => <th key={c.name} className="text-center py-2 px-2 text-foreground-400 font-medium">{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {MONTHLY_COHORT_TRENDS.map((m, i) => (
                  <tr key={m.month} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2 px-3 font-medium text-foreground-600">{m.month}</td>
                    <td className="text-center py-2">{m.me}%</td>
                    <td className="text-center py-2">{m.ba > 0 ? `${m.ba}%` : '—'}</td>
                    <td className="text-center py-2">{m.da > 0 ? `${m.da}%` : '—'}</td>
                    <td className="text-center py-2">{m.om}%</td>
                    <td className="text-center py-2">{m.hr}%</td>
                    <td className="text-center py-2">{m.pm > 0 ? `${m.pm}%` : '—'}</td>
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