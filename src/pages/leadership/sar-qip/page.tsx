import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const QIP_ACTIONS = [
  { id: 'QIP-001', area: 'Quality of Education', action: 'Standardise BKSB initial assessment interpretation across all programmes', owner: 'Curriculum Designer', deadline: '30 Jun 2026', progress: 65, status: 'in-progress' as const, impact: 'high' as const },
  { id: 'QIP-002', area: 'Apprenticeship Progress', action: 'Implement OTJH monthly validation tracker for all cohorts', owner: 'MIS Operations', deadline: '15 Jul 2026', progress: 40, status: 'in-progress' as const, impact: 'high' as const },
  { id: 'QIP-003', area: 'Personal Development', action: 'Develop enrichment programme evidence framework', owner: 'Engagement Manager', deadline: '31 Aug 2026', progress: 20, status: 'in-progress' as const, impact: 'medium' as const },
  { id: 'QIP-004', area: 'Leadership and Management', action: 'Quarterly governance board reviews with employer representation', owner: 'Director of Apprenticeships', deadline: '30 Sep 2026', progress: 50, status: 'in-progress' as const, impact: 'high' as const },
  { id: 'QIP-005', area: 'Employer Involvement', action: 'Bi-annual employer satisfaction survey with action planning', owner: 'Employer Engagement', deadline: '15 Jul 2026', progress: 80, status: 'in-progress' as const, impact: 'medium' as const },
  { id: 'QIP-006', area: 'Impact of Learning at Work', action: 'Capture 8 workplace impact case studies across all programmes', owner: 'Coach Team', deadline: '31 Aug 2026', progress: 25, status: 'at-risk' as const, impact: 'high' as const },
  { id: 'QIP-007', area: 'Safeguarding', action: 'Annual safeguarding update training for all delivery staff', owner: 'DSL', deadline: '30 Jun 2026', progress: 95, status: 'in-progress' as const, impact: 'critical' as const },
  { id: 'QIP-008', area: 'Curriculum Sequencing', action: 'Map curriculum intent to implementation for all programmes', owner: 'Curriculum Designer', deadline: '15 Aug 2026', progress: 45, status: 'in-progress' as const, impact: 'high' as const },
];

const SAR_SECTIONS = [
  { section: 'Context & Provider Information', completeness: 100, lastUpdated: '01 Jun 2026', status: 'complete' as const },
  { section: 'Quality of Education — Strengths', completeness: 85, lastUpdated: '28 May 2026', status: 'in-progress' as const },
  { section: 'Quality of Education — Areas for Improvement', completeness: 70, lastUpdated: '25 May 2026', status: 'in-progress' as const },
  { section: 'Behaviour and Attitudes', completeness: 90, lastUpdated: '30 May 2026', status: 'complete' as const },
  { section: 'Personal Development', completeness: 65, lastUpdated: '22 May 2026', status: 'in-progress' as const },
  { section: 'Leadership and Management', completeness: 80, lastUpdated: '28 May 2026', status: 'in-progress' as const },
  { section: 'Apprenticeship Outcomes', completeness: 60, lastUpdated: '20 May 2026', status: 'in-progress' as const },
  { section: 'Safeguarding & Prevent', completeness: 95, lastUpdated: '01 Jun 2026', status: 'complete' as const },
  { section: 'Equality & Diversity', completeness: 88, lastUpdated: '29 May 2026', status: 'complete' as const },
];

export default function SarQipPage() {
  const [filter, setFilter] = useState<'all' | 'at-risk' | 'high'>('all');
  const filtered = filter === 'all' ? QIP_ACTIONS : QIP_ACTIONS.filter(q => filter === 'at-risk' ? q.status === 'at-risk' : q.impact === 'high' || q.impact === 'critical');
  const totalActions = QIP_ACTIONS.length;
  const avgProgress = Math.round(QIP_ACTIONS.reduce((s, q) => s + q.progress, 0) / QIP_ACTIONS.length);
  const atRiskActions = QIP_ACTIONS.filter(q => q.status === 'at-risk').length;

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="SAR/QIP Evidence" pageSubtitle="Self-assessment evidence, quality improvement plan indicators, actions, owners, deadlines, progress and impact" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="SAR/QIP Evidence" description={`${totalActions} QIP actions · Avg progress ${avgProgress}% · ${atRiskActions} at-risk · SAR ${SAR_SECTIONS.length} sections`} icon="ri-file-text-line" stats={[{ label: 'QIP Actions', value: String(totalActions) }, { label: 'Avg Progress', value: `${avgProgress}%` }, { label: 'At-Risk', value: String(atRiskActions) }]} />

        {/* SAR Sections */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Self-Assessment Report (SAR) — Section Completeness</h3>
          <div className="space-y-3">
            {SAR_SECTIONS.map(s => (
              <div key={s.section} className="flex items-center gap-4 p-3 rounded-lg border border-foreground-200">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-foreground-800">{s.section}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'complete' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s.status.toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-background-200 rounded-full h-2">
                      <div className={`h-2 rounded-full ${s.completeness >= 90 ? 'bg-emerald-500' : s.completeness >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${s.completeness}%` }}></div>
                    </div>
                    <span className="text-[10px] font-semibold text-foreground-700 w-8 text-right">{s.completeness}%</span>
                  </div>
                </div>
                <span className="text-[10px] text-foreground-400 whitespace-nowrap">{s.lastUpdated}</span>
              </div>
            ))}
          </div>
        </div>

        {/* QIP Actions */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Quality Improvement Plan (QIP) Actions</h3>
            <div className="flex items-center gap-1 bg-background-100 rounded-lg p-0.5">
              {[
                { key: 'all' as const, label: 'All' }, { key: 'high' as const, label: 'High Impact' }, { key: 'at-risk' as const, label: 'At-Risk' },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap cursor-pointer transition-smooth ${filter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
              ))}
            </div>
          </div>
          <div className="space-y-2 px-5 pb-5">
            {filtered.map(q => (
              <div key={q.id} className={`p-4 rounded-lg border ${q.status === 'at-risk' ? 'border-red-200/60 bg-red-50/20' : 'border-foreground-200'}`}>
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-mono text-foreground-400">{q.id}</span>
                      <span className="text-[10px] bg-background-100 px-2 py-0.5 rounded text-foreground-500">{q.area}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold ${q.impact === 'critical' ? 'bg-red-100 text-red-700' : q.impact === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-accent-100 text-accent-700'}`}>{q.impact.toUpperCase()}</span>
                    </div>
                    <p className="text-[12px] font-medium text-foreground-800">{q.action}</p>
                  </div>
                  {q.status === 'at-risk' && <span className="text-[9px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full whitespace-nowrap">AT RISK</span>}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[10px]">
                  <span className="text-foreground-500"><span className="font-medium">Owner:</span> {q.owner}</span>
                  <span className="text-foreground-500"><span className="font-medium">Deadline:</span> {q.deadline}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground-500">Progress:</span>
                    <div className="w-20 bg-background-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${q.progress >= 80 ? 'bg-emerald-500' : q.progress >= 50 ? 'bg-amber-500' : q.progress >= 25 ? 'bg-primary-500' : 'bg-red-500'}`} style={{ width: `${q.progress}%` }}></div>
                    </div>
                    <span className="font-semibold text-foreground-700">{q.progress}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}