import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const PROGRAMMES = [
  { name: 'Business Admin L3', code: 'ST0070', level: 3, learners: 12, completion: 65, achievement: 82, engagement: 88, employerRating: 4.6, evidenceQuality: 84, gatewayReadiness: 62, cohorts: 2, risk: 'low' as const },
  { name: 'Management L4', code: 'ST0384', level: 4, learners: 8, completion: 42, achievement: 60, engagement: 78, employerRating: 4.3, evidenceQuality: 71, gatewayReadiness: 38, cohorts: 1, risk: 'medium' as const },
  { name: 'Data Analyst L4', code: 'ST0118', level: 4, learners: 5, completion: 0, achievement: 0, engagement: 65, employerRating: 3.8, evidenceQuality: 0, gatewayReadiness: 0, cohorts: 1, risk: 'high' as const },
  { name: 'Ops Manager L5', code: 'ST0385', level: 5, learners: 4, completion: 94, achievement: 100, engagement: 95, employerRating: 5.0, evidenceQuality: 92, gatewayReadiness: 88, cohorts: 1, risk: 'low' as const },
  { name: 'HR Consultant L5', code: 'ST0696', level: 5, learners: 3, completion: 71, achievement: 85, engagement: 82, employerRating: 4.5, evidenceQuality: 76, gatewayReadiness: 64, cohorts: 1, risk: 'low' as const },
  { name: 'Project Manager L4', code: 'ST0411', level: 4, learners: 5, completion: 22, achievement: 45, engagement: 70, employerRating: 4.0, evidenceQuality: 55, gatewayReadiness: 18, cohorts: 1, risk: 'high' as const },
  { name: 'Software Dev L4', code: 'ST1357', level: 4, learners: 6, completion: 100, achievement: 100, engagement: 94, employerRating: 4.9, evidenceQuality: 98, gatewayReadiness: 100, cohorts: 1, risk: 'low' as const },
];

const totalL = PROGRAMMES.reduce((s, p) => s + p.learners, 0);

export default function ProgrammePerformancePage() {
  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Programme Performance" pageSubtitle="Programme-level performance — completion, achievement, engagement, employer involvement, evidence quality and gateway/EPA readiness" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Programme Performance" description={`${PROGRAMMES.length} programmes · ${totalL} learners · Real-time programme-level intelligence`} icon="ri-stack-line" stats={[{ label: 'Programmes', value: String(PROGRAMMES.length) }, { label: 'Total Learners', value: String(totalL) }, { label: 'Avg Achievement', value: `${Math.round(PROGRAMMES.reduce((s, p) => s + p.achievement, 0) / PROGRAMMES.length)}%` }]} />

        {/* Programme Cards */}
        <div className="space-y-3">
          {PROGRAMMES.map(p => (
            <div key={p.code} className={`bg-background-50 rounded-xl border p-5 ${p.risk === 'high' ? 'border-red-200/60' : p.risk === 'medium' ? 'border-amber-200/60' : 'border-foreground-200'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{p.name}</h3>
                    <span className="text-[10px] font-medium text-foreground-400 bg-background-100/70 px-2 py-0.5 rounded">{p.code} · L{p.level}</span>
                    <span className={`w-2 h-2 rounded-full ${p.risk === 'high' ? 'bg-red-500' : p.risk === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                  </div>
                  <p className="text-[10px] text-foreground-400">{p.learners} learners · {p.cohorts} cohorts</p>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { l: 'Completion', v: `${p.completion}%`, c: p.completion >= 70 ? 'text-emerald-600' : p.completion >= 40 ? 'text-amber-600' : 'text-red-600' },
                    { l: 'Achievement', v: `${p.achievement}%`, c: p.achievement >= 80 ? 'text-emerald-600' : p.achievement >= 50 ? 'text-amber-600' : 'text-red-600' },
                    { l: 'Engagement', v: `${p.engagement}%`, c: p.engagement >= 80 ? 'text-emerald-600' : p.engagement >= 65 ? 'text-amber-600' : 'text-red-600' },
                    { l: 'Employer Rating', v: `${p.employerRating}/5`, c: p.employerRating >= 4.5 ? 'text-emerald-600' : p.employerRating >= 4.0 ? 'text-amber-600' : 'text-red-600' },
                    { l: 'Evidence Quality', v: `${p.evidenceQuality}%`, c: p.evidenceQuality >= 80 ? 'text-emerald-600' : p.evidenceQuality >= 60 ? 'text-amber-600' : 'text-red-600' },
                    { l: 'Gateway Ready', v: `${p.gatewayReadiness}%`, c: p.gatewayReadiness >= 60 ? 'text-emerald-600' : p.gatewayReadiness >= 30 ? 'text-amber-600' : 'text-red-600' },
                  ].map(m => (
                    <div key={m.l} className="bg-background-100/60 rounded-lg p-2 text-center">
                      <p className={`text-[13px] font-bold ${m.c}`}>{m.v}</p>
                      <p className="text-[8px] text-foreground-400">{m.l}</p>
                    </div>
                  ))}
                </div>
              </div>
              {/* Programme health bars */}
              <div className="grid grid-cols-3 gap-3 mt-3">
                {[
                  { label: 'Completion Progress', val: p.completion, cl: p.completion >= 70 ? 'bg-emerald-500' : p.completion >= 40 ? 'bg-amber-500' : 'bg-red-500' },
                  { label: 'Evidence Quality', val: p.evidenceQuality, cl: p.evidenceQuality >= 80 ? 'bg-emerald-500' : p.evidenceQuality >= 60 ? 'bg-amber-500' : 'bg-red-500' },
                  { label: 'Gateway Readiness', val: p.gatewayReadiness, cl: p.gatewayReadiness >= 60 ? 'bg-emerald-500' : p.gatewayReadiness >= 30 ? 'bg-amber-500' : 'bg-red-500' },
                ].map(b => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="text-[9px] text-foreground-500 whitespace-nowrap w-24">{b.label}</span>
                    <div className="flex-1 bg-background-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${b.cl}`} style={{ width: `${b.val}%` }}></div>
                    </div>
                    <span className="text-[9px] font-semibold text-foreground-700 w-7">{b.val}%</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}