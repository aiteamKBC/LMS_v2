import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const TUTOR_SLA_DETAIL = [
  { name: 'Helen Curtis', cohorts: 'ME-L4 May 2026', markingTAT: 1.8, tatTarget: 3, feedbackQuality: 4.9, sessionRating: 4.8, responseTimeHrs: 3, slaMet: true, overdueMarking: 0, totalMarking: 48, feedbackAvgChars: 342 },
  { name: 'Crispin Jones', cohorts: 'BA-L3 / HR-L5 / PM-L4', markingTAT: 2.2, tatTarget: 3, feedbackQuality: 4.7, sessionRating: 4.7, responseTimeHrs: 5, slaMet: true, overdueMarking: 1, totalMarking: 62, feedbackAvgChars: 298 },
  { name: 'Rachel Oduya', cohorts: 'DA-L4 / SD-L4', markingTAT: 3.5, tatTarget: 3, feedbackQuality: 4.4, sessionRating: 4.5, responseTimeHrs: 9, slaMet: false, overdueMarking: 3, totalMarking: 38, feedbackAvgChars: 256 },
];

const MARKING_TREND = [
  { week: 'Wk 1', markingTAT: 2.1, feedbackQuality: 4.6, overdueCount: 2 },
  { week: 'Wk 2', markingTAT: 1.9, feedbackQuality: 4.7, overdueCount: 1 },
  { week: 'Wk 3', markingTAT: 2.3, feedbackQuality: 4.5, overdueCount: 3 },
  { week: 'Wk 4', markingTAT: 2.0, feedbackQuality: 4.8, overdueCount: 1 },
  { week: 'Wk 5', markingTAT: 1.7, feedbackQuality: 4.9, overdueCount: 0 },
  { week: 'Wk 6', markingTAT: 2.4, feedbackQuality: 4.6, overdueCount: 2 },
  { week: 'Wk 7', markingTAT: 1.8, feedbackQuality: 4.7, overdueCount: 1 },
  { week: 'Wk 8', markingTAT: 1.6, feedbackQuality: 4.8, overdueCount: 0 },
];

export default function TutorSlaPage() {
  const avgTAT = Math.round(TUTOR_SLA_DETAIL.reduce((s, t) => s + t.markingTAT, 0) / TUTOR_SLA_DETAIL.length * 10) / 10;
  const slaMet = TUTOR_SLA_DETAIL.filter(t => t.slaMet).length;
  const totalOverdue = TUTOR_SLA_DETAIL.reduce((s, t) => s + t.overdueMarking, 0);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Tutor SLA" pageSubtitle="Marking timeliness, evidence validation timeliness, feedback quality and overdue marking" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Tutor SLA Performance" description={`Avg marking TAT ${avgTAT}d · ${slaMet}/${TUTOR_SLA_DETAIL.length} tutors meeting SLA · ${totalOverdue} overdue items`} icon="ri-user-settings-line" stats={[{ label: 'Avg TAT', value: `${avgTAT}d` }, { label: 'SLA Met', value: `${slaMet}/${TUTOR_SLA_DETAIL.length}` }, { label: 'Overdue', value: String(totalOverdue) }]} />

        {/* Tutor SLA Cards */}
        <div className="space-y-3">
          {TUTOR_SLA_DETAIL.map(t => (
            <div key={t.name} className={`bg-background-50 rounded-xl border p-5 ${t.slaMet ? 'border-foreground-200' : 'border-red-200/60 bg-red-50/20'}`}>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{t.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${t.slaMet ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.slaMet ? 'SLA MET' : 'SLA BREACH'}</span>
                  </div>
                  <p className="text-[10px] text-foreground-400">{t.cohorts} · {t.totalMarking} total marked</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { l: 'Marking TAT', v: `${t.markingTAT}d/${t.tatTarget}d`, warn: t.markingTAT > t.tatTarget },
                    { l: 'Feedback Quality', v: `${t.feedbackQuality}/5`, warn: t.feedbackQuality < 4.5 },
                    { l: 'Session Rating', v: `${t.sessionRating}/5` },
                    { l: 'Response Time', v: `${t.responseTimeHrs}h`, warn: t.responseTimeHrs > 6 },
                  ].map(m => (
                    <div key={m.l} className={`rounded-lg p-2 text-center ${m.warn ? 'bg-red-100/60' : 'bg-background-100/60'}`}>
                      <p className={`text-[13px] font-bold ${m.warn ? 'text-red-700' : 'text-foreground-900'}`}>{m.v}</p>
                      <p className="text-[8px] text-foreground-400">{m.l}</p>
                    </div>
                  ))}
                  <div className="rounded-lg p-2 text-center bg-background-100/60">
                    <p className="text-[13px] font-bold text-foreground-900">{t.feedbackAvgChars}</p>
                    <p className="text-[8px] text-foreground-400">Avg Chars</p>
                  </div>
                  <div className={`rounded-lg p-2 text-center ${t.overdueMarking > 0 ? 'bg-red-100/60' : 'bg-background-100/60'}`}>
                    <p className={`text-[13px] font-bold ${t.overdueMarking > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{t.overdueMarking}</p>
                    <p className="text-[8px] text-foreground-400">Overdue</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Weekly Marking Trend */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">8-Week Marking Trend (All Tutors)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="text-left py-2 px-3 text-foreground-400 font-medium">Week</th>
                  <th className="text-center py-2 px-3 text-foreground-400 font-medium">Avg TAT (days)</th>
                  <th className="text-center py-2 px-3 text-foreground-400 font-medium">Feedback Quality</th>
                  <th className="text-center py-2 px-3 text-foreground-400 font-medium">Overdue Count</th>
                </tr>
              </thead>
              <tbody>
                {MARKING_TREND.map(m => (
                  <tr key={m.week} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2 px-3 font-medium text-foreground-600">{m.week}</td>
                    <td className="text-center"><span className={`font-semibold ${m.markingTAT <= 2 ? 'text-emerald-600' : m.markingTAT <= 2.5 ? 'text-amber-600' : 'text-red-600'}`}>{m.markingTAT}d</span></td>
                    <td className="text-center"><span className={`font-semibold ${m.feedbackQuality >= 4.7 ? 'text-emerald-600' : m.feedbackQuality >= 4.5 ? 'text-amber-600' : 'text-red-600'}`}>{m.feedbackQuality}/5</span></td>
                    <td className="text-center"><span className={`font-semibold ${m.overdueCount === 0 ? 'text-emerald-600' : m.overdueCount <= 2 ? 'text-amber-600' : 'text-red-600'}`}>{m.overdueCount}</span></td>
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