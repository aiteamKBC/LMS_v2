import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const LEARNER_JOURNEY = [
  { stage: 'Onboarding', total: 8, completed: 6, inProgress: 2, blocked: 0, color: 'bg-accent-500' },
  { stage: 'Active Learning', total: 28, completed: 22, inProgress: 4, blocked: 2, color: 'bg-primary-500' },
  { stage: 'Monthly Cycle', total: 28, completed: 18, inProgress: 7, blocked: 3, color: 'bg-secondary-500' },
  { stage: 'Progress Reviews', total: 28, completed: 20, inProgress: 5, blocked: 3, color: 'bg-amber-500' },
  { stage: 'Gateway Preparation', total: 12, completed: 6, inProgress: 4, blocked: 2, color: 'bg-emerald-500' },
  { stage: 'Gateway', total: 6, completed: 4, inProgress: 1, blocked: 1, color: 'bg-emerald-600' },
  { stage: 'EPA', total: 4, completed: 1, inProgress: 3, blocked: 0, color: 'bg-emerald-700' },
  { stage: 'Achieved', total: 2, completed: 2, inProgress: 0, blocked: 0, color: 'bg-primary-700' },
];

const COHORT_PROGRESS = [
  { cohort: 'ME-L4 May 2026', onboarding: '100%', activeLearning: '75%', monthlyCycle: '44%', reviews: '38%', gateway: '0%', epa: '0%' },
  { cohort: 'BA-L3 June 2026', onboarding: '83%', activeLearning: '50%', monthlyCycle: '100%', reviews: '17%', gateway: '0%', epa: '0%' },
  { cohort: 'DA-L4 April 2026', onboarding: '0%', activeLearning: '0%', monthlyCycle: '0%', reviews: '0%', gateway: '0%', epa: '0%' },
  { cohort: 'OM-L5 Jan 2025', onboarding: '100%', activeLearning: '100%', monthlyCycle: '88%', reviews: '100%', gateway: '75%', epa: '50%' },
  { cohort: 'HR-L5 March 2025', onboarding: '100%', activeLearning: '100%', monthlyCycle: '75%', reviews: '89%', gateway: '33%', epa: '0%' },
  { cohort: 'PM-L4 Feb 2026', onboarding: '40%', activeLearning: '20%', monthlyCycle: '33%', reviews: '20%', gateway: '0%', epa: '0%' },
  { cohort: 'SD-L4 Sep 2024', onboarding: '100%', activeLearning: '100%', monthlyCycle: '92%', reviews: '100%', gateway: '100%', epa: '67%' },
];

const STAGES = ['onboarding', 'activeLearning', 'monthlyCycle', 'reviews', 'gateway', 'epa'] as const;

export default function LearnerProgressPage() {
  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Learner Progress" pageSubtitle="Aggregated learner journey progress — onboarding, active learning, monthly cycle, reviews, gateway and EPA" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Learner Progress" description="Aggregated view of learner progress across all stages of the apprenticeship journey" icon="ri-user-line" stats={[{ label: 'Total Learners', value: '42' }, { label: 'On Track', value: '32' }, { label: 'Gateway-Ready', value: '6' }]} />

        {/* Journey Pipeline */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Learner Journey Pipeline</h3>
          <div className="flex flex-wrap gap-3">
            {LEARNER_JOURNEY.map((s, i) => (
              <div key={s.stage} className="flex-1 min-w-[100px]">
                <div className={`${s.color} rounded-lg p-3 text-white mb-2`}>
                  <p className="text-2xl font-heading font-bold">{s.total}</p>
                  <p className="text-[10px] opacity-80">{s.stage}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px]">
                    <span className="text-foreground-400">Completed</span>
                    <span className="font-semibold text-foreground-700">{s.completed}</span>
                  </div>
                  <div className="flex justify-between text-[9px]">
                    <span className="text-foreground-400">In Progress</span>
                    <span className="font-semibold text-foreground-700">{s.inProgress}</span>
                  </div>
                  {s.blocked > 0 && (
                    <div className="flex justify-between text-[9px]">
                      <span className="text-red-500">Blocked</span>
                      <span className="font-semibold text-red-600">{s.blocked}</span>
                    </div>
                  )}
                </div>
                {i < LEARNER_JOURNEY.length - 1 && <div className="flex justify-center mt-2 text-foreground-300"><i className="ri-arrow-right-line text-sm"></i></div>}
              </div>
            ))}
          </div>
        </div>

        {/* Cohort Progress Table */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">Progress by Cohort</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30">
                  <th className="text-left py-2.5 px-4 text-foreground-400 font-medium">Cohort</th>
                  {STAGES.map(s => <th key={s} className="text-center py-2.5 px-2 text-foreground-400 font-medium capitalize">{s.replace('activeLearning', 'Active').replace('monthlyCycle', 'Mth Cycle').replace('reviews', 'Reviews')}</th>)}
                </tr>
              </thead>
              <tbody>
                {COHORT_PROGRESS.map((c, i) => (
                  <tr key={c.cohort} className={`border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth ${i % 2 === 0 ? '' : 'bg-background-50/50'}`}>
                    <td className="py-2.5 px-4 font-medium text-foreground-700">{c.cohort}</td>
                    {STAGES.map(s => {
                      const val = parseInt(c[s]);
                      return (
                        <td key={s} className="text-center py-2.5">
                          <span className={`text-[11px] font-semibold ${val >= 70 ? 'text-emerald-600' : val >= 40 ? 'text-amber-600' : val > 0 ? 'text-red-600' : 'text-foreground-300'}`}>{c[s]}</span>
                        </td>
                      );
                    })}
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