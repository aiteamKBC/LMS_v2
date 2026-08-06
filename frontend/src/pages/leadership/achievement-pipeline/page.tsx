import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const PIPELINE_STAGES = [
  { stage: 'Onboarding', count: 8, target: 8, color: 'bg-accent-500', icon: 'ri-user-received-line' },
  { stage: 'Active Learning', count: 28, target: 30, color: 'bg-primary-500', icon: 'ri-book-open-line' },
  { stage: 'Approaching Gateway', count: 6, target: 8, color: 'bg-secondary-500', icon: 'ri-flag-line' },
  { stage: 'Gateway Ready', count: 6, target: 6, color: 'bg-amber-500', icon: 'ri-check-double-line' },
  { stage: 'EPA Active', count: 4, target: 5, color: 'bg-emerald-500', icon: 'ri-award-line' },
  { stage: 'Achieved', count: 2, target: 3, color: 'bg-emerald-700', icon: 'ri-trophy-line' },
  { stage: 'Resit/Retake', count: 0, target: 0, color: 'bg-red-400', icon: 'ri-refresh-line' },
  { stage: 'Completed', count: 2, target: 3, color: 'bg-primary-700', icon: 'ri-verified-badge-line' },
];

const ACHIEVEMENT_BY_PROGRAMME = [
  { programme: 'Ops Manager L5', total: 4, achieved: 2, epaActive: 2, gatewayReady: 0, approachingGateway: 0, rate: 50 },
  { programme: 'Software Dev L4', total: 6, achieved: 0, epaActive: 2, gatewayReady: 4, approachingGateway: 0, rate: 0 },
  { programme: 'HR Consultant L5', total: 3, achieved: 0, epaActive: 0, gatewayReady: 2, approachingGateway: 1, rate: 0 },
  { programme: 'Business Admin L3', total: 12, achieved: 0, epaActive: 0, gatewayReady: 0, approachingGateway: 3, rate: 0 },
  { programme: 'Management L4', total: 8, achieved: 0, epaActive: 0, gatewayReady: 0, approachingGateway: 2, rate: 0 },
  { programme: 'Project Manager L4', total: 5, achieved: 0, epaActive: 0, gatewayReady: 0, approachingGateway: 0, rate: 0 },
  { programme: 'Data Analyst L4', total: 5, achieved: 0, epaActive: 0, gatewayReady: 0, approachingGateway: 0, rate: 0 },
];

export default function AchievementPipelinePage() {
  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Achievement Pipeline" pageSubtitle="Learners moving towards gateway, EPA, achievement, resit/retake and completion" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Achievement Pipeline" description="End-to-end achievement pipeline — from active learning through to completion and certification" icon="ri-flag-line" stats={[{ label: 'Achieved', value: '2' }, { label: 'In EPA', value: '4' }, { label: 'Gateway Ready', value: '6' }]} />

        {/* Pipeline Flow */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Achievement Flow</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {PIPELINE_STAGES.map((ps, i) => (
              <div key={ps.stage} className="flex flex-col items-center">
                <div className={`w-14 h-14 rounded-xl ${ps.color} flex items-center justify-center mb-2`}>
                  <AppIcon className={`${ps.icon} text-white text-xl`}></AppIcon>
                </div>
                <span className="text-xs font-semibold text-foreground-900 text-center leading-tight">{ps.stage}</span>
                <span className="text-xl font-heading font-bold text-foreground-900">{ps.count}</span>
                <div className="w-full bg-background-200 rounded-full h-1.5 mt-1">
                  <div className={`h-1.5 rounded-full ${ps.color}`} style={{ width: `${ps.target > 0 ? (ps.count / ps.target) * 100 : 0}%` }}></div>
                </div>
                <span className="text-[9px] text-foreground-400 mt-0.5">{ps.target > 0 ? `${ps.count}/${ps.target}` : 'N/A'}</span>
                {i < PIPELINE_STAGES.length - 1 && (
                  <span className="text-foreground-300 text-sm mt-1"><AppIcon className="ri-arrow-down-line"></AppIcon></span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Achievement by Programme */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Achievement by Programme</h3>
          <div className="space-y-3">
            {ACHIEVEMENT_BY_PROGRAMME.map(p => (
              <div key={p.programme} className="flex items-center gap-4 p-3 rounded-lg border border-foreground-200">
                <div className="w-40 min-w-0">
                  <p className="text-[12px] font-semibold text-foreground-900 truncate">{p.programme}</p>
                  <p className="text-[9px] text-foreground-400">{p.total} learners</p>
                </div>
                <div className="flex-1 grid grid-cols-4 gap-2">
                  {[
                    { l: 'Approaching G/W', v: p.approachingGateway, max: p.total },
                    { l: 'Gateway Ready', v: p.gatewayReady, max: p.total },
                    { l: 'EPA Active', v: p.epaActive, max: p.total },
                    { l: 'Achieved', v: p.achieved, max: p.total },
                  ].map(s => (
                    <div key={s.l} className="text-center">
                      <p className="text-[13px] font-bold text-foreground-900">{s.v}</p>
                      <p className="text-[7px] text-foreground-400">{s.l}</p>
                      <div className="w-full bg-background-200 rounded-full h-1 mt-0.5">
                        <div className="h-1 rounded-full bg-primary-500" style={{ width: `${(s.v / s.max) * 100}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-right">
                  <p className="text-lg font-heading font-bold text-emerald-600">{p.rate}%</p>
                  <p className="text-[9px] text-foreground-400">Achievement Rate</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}