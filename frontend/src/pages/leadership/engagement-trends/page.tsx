import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const ENGAGEMENT_METRICS = [
  { metric: 'LMS Activity', current: 85, target: 90, trend: 'up' as const, detail: '85% of learners completing weekly LMS activities' },
  { metric: 'Evidence Submission', current: 72, target: 85, trend: 'flat' as const, detail: '72% on-time evidence submissions across all programmes' },
  { metric: 'Quiz Activity', current: 78, target: 80, trend: 'up' as const, detail: '78% quiz completion rate — up 5% from last quarter' },
  { metric: 'Monthly Cycle Completion', current: 68, target: 80, trend: 'down' as const, detail: '68% monthly cycle completion — declined 3% this period' },
  { metric: 'Communication Response', current: 91, target: 95, trend: 'up' as const, detail: '91% response rate to coach and tutor communications' },
  { metric: 'Rewards Activity', current: 64, target: 70, trend: 'up' as const, detail: '64% of learners actively engaged with rewards programme' },
  { metric: 'Club Participation', current: 45, target: 60, trend: 'flat' as const, detail: '45% of learners participating in at least one club' },
];

const ENGAGEMENT_MONTHLY = [
  { month: 'Jan', lmsActivity: 78, evidence: 65, quizzes: 70, monthlyCycle: 62, comms: 85, rewards: 55, clubs: 38 },
  { month: 'Feb', lmsActivity: 80, evidence: 68, quizzes: 72, monthlyCycle: 64, comms: 87, rewards: 58, clubs: 40 },
  { month: 'Mar', lmsActivity: 82, evidence: 70, quizzes: 74, monthlyCycle: 66, comms: 88, rewards: 60, clubs: 42 },
  { month: 'Apr', lmsActivity: 83, evidence: 71, quizzes: 75, monthlyCycle: 67, comms: 89, rewards: 62, clubs: 43 },
  { month: 'May', lmsActivity: 84, evidence: 72, quizzes: 76, monthlyCycle: 67, comms: 90, rewards: 63, clubs: 44 },
  { month: 'Jun', lmsActivity: 85, evidence: 72, quizzes: 78, monthlyCycle: 68, comms: 91, rewards: 64, clubs: 45 },
];

export default function EngagementTrendsPage() {
  const avg = Math.round(ENGAGEMENT_METRICS.reduce((s, m) => s + m.current, 0) / ENGAGEMENT_METRICS.length);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Engagement Trends" pageSubtitle="LMS activity, evidence submission, quiz activity, monthly cycle, communications, rewards and club participation" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Engagement Trends" description={`Overall engagement ${avg}% · ${ENGAGEMENT_METRICS.filter(e => e.trend === 'up').length} metrics trending up`} icon="ri-heart-pulse-line" stats={[{ label: 'Overall', value: `${avg}%` }, { label: 'Trending Up', value: String(ENGAGEMENT_METRICS.filter(e => e.trend === 'up').length) }, { label: 'Needs Attention', value: String(ENGAGEMENT_METRICS.filter(e => e.trend === 'down' || e.trend === 'flat').length) }]} />

        {/* Engagement Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ENGAGEMENT_METRICS.map(em => (
            <div key={em.metric} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-foreground-700">{em.metric}</span>
                <span className={`text-[14px] ${em.trend === 'up' ? 'text-emerald-500' : em.trend === 'down' ? 'text-red-500' : 'text-amber-500'}`}>
                  <AppIcon className={`${em.trend === 'up' ? 'ri-arrow-up-line' : em.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'}`}></AppIcon>
                </span>
              </div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-2xl font-heading font-bold text-foreground-900">{em.current}%</span>
                <span className="text-[10px] text-foreground-400 pb-0.5">/ {em.target}% target</span>
              </div>
              <div className="w-full bg-background-200 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full ${em.current >= em.target ? 'bg-emerald-500' : em.current >= em.target * 0.85 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${(em.current / em.target) * 100}%` }}></div>
              </div>
              <p className="text-[9px] text-foreground-400 mt-2">{em.detail}</p>
            </div>
          ))}
        </div>

        {/* Monthly Engagement Trend */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">6-Month Engagement Trend</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left py-2 px-3 text-foreground-400 font-medium">Month</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">LMS</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">Evidence</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">Quizzes</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">Mth Cycle</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">Comms</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">Rewards</th>
                  <th className="text-center py-2 px-2 text-foreground-400 font-medium">Clubs</th>
                </tr>
              </thead>
              <tbody>
                {ENGAGEMENT_MONTHLY.map(m => (
                  <tr key={m.month} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2 px-3 font-medium text-foreground-600">{m.month}</td>
                    {[
                      { v: m.lmsActivity, t: 90 }, { v: m.evidence, t: 85 }, { v: m.quizzes, t: 80 },
                      { v: m.monthlyCycle, t: 80 }, { v: m.comms, t: 95 }, { v: m.rewards, t: 70 }, { v: m.clubs, t: 60 },
                    ].map((cell, i) => (
                      <td key={i} className="text-center py-2">
                        <span className={`text-[11px] font-semibold ${cell.v >= cell.t ? 'text-emerald-600' : cell.v >= cell.t * 0.85 ? 'text-amber-600' : 'text-red-600'}`}>{cell.v}%</span>
                      </td>
                    ))}
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