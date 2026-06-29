import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const OFSTED_CATEGORIES = [
  { category: 'Quality of Education', strength: 82, items: 48, verified: 42, gaps: 6, status: 'strong' as const, icon: 'ri-book-open-line' },
  { category: 'Behaviour and Attitudes', strength: 88, items: 32, verified: 30, gaps: 2, status: 'strong' as const, icon: 'ri-user-heart-line' },
  { category: 'Personal Development', strength: 76, items: 28, verified: 22, gaps: 6, status: 'adequate' as const, icon: 'ri-user-star-line' },
  { category: 'Leadership and Management', strength: 85, items: 36, verified: 32, gaps: 4, status: 'strong' as const, icon: 'ri-team-line' },
  { category: 'Apprenticeship Progress', strength: 72, items: 44, verified: 34, gaps: 10, status: 'adequate' as const, icon: 'ri-bar-chart-line' },
  { category: 'Employer Involvement', strength: 80, items: 24, verified: 20, gaps: 4, status: 'strong' as const, icon: 'ri-building-2-line' },
  { category: 'Safeguarding', strength: 90, items: 18, verified: 18, gaps: 0, status: 'strong' as const, icon: 'ri-shield-check-line' },
  { category: 'Curriculum Sequencing', strength: 74, items: 30, verified: 24, gaps: 6, status: 'adequate' as const, icon: 'ri-stack-line' },
  { category: 'Impact of Learning at Work', strength: 68, items: 26, verified: 18, gaps: 8, status: 'needs-improvement' as const, icon: 'ri-briefcase-line' },
];

const EVIDENCE_ITEMS = [
  { id: 'OF-001', category: 'Quality of Education', item: 'Module completion data by cohort', status: 'verified' as const, lastUpdated: '05 Jun 2026', format: 'Dashboard export' },
  { id: 'OF-002', category: 'Apprenticeship Progress', item: 'OTJH tracking reports — all cohorts', status: 'verified' as const, lastUpdated: '04 Jun 2026', format: 'System report' },
  { id: 'OF-003', category: 'Personal Development', item: 'Learner club participation records', status: 'gaps' as const, lastUpdated: '01 Jun 2026', format: 'Manual entry', note: 'Missing Jan-Mar 2026 data' },
  { id: 'OF-004', category: 'Employer Involvement', item: 'Employer satisfaction survey results', status: 'verified' as const, lastUpdated: '03 Jun 2026', format: 'Survey export' },
  { id: 'OF-005', category: 'Safeguarding', item: 'Safeguarding training records — all staff', status: 'verified' as const, lastUpdated: '30 May 2026', format: 'HR system' },
  { id: 'OF-006', category: 'Impact of Learning at Work', item: 'Workplace impact case studies', status: 'gaps' as const, lastUpdated: '25 May 2026', format: 'Documentation', note: 'Only 4 of 8 required case studies available' },
  { id: 'OF-007', category: 'Curriculum Sequencing', item: 'Curriculum intent documentation', status: 'verified' as const, lastUpdated: '28 May 2026', format: 'PDF document' },
  { id: 'OF-008', category: 'Leadership and Management', item: 'SAR and QIP documentation', status: 'in-progress' as const, lastUpdated: '02 Jun 2026', format: 'MS Word' },
];

export default function OfstedEvidencePage() {
  const totalItems = OFSTED_CATEGORIES.reduce((s, c) => s + c.items, 0);
  const verifiedItems = OFSTED_CATEGORIES.reduce((s, c) => s + c.verified, 0);
  const totalGaps = OFSTED_CATEGORIES.reduce((s, c) => s + c.gaps, 0);
  const avgStrength = Math.round(OFSTED_CATEGORIES.reduce((s, c) => s + c.strength, 0) / OFSTED_CATEGORIES.length);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Ofsted Evidence" pageSubtitle="Quality of Education, Behaviour & Attitudes, Personal Development, Leadership, Apprenticeship Progress, Employer Involvement, Safeguarding, Curriculum and Impact" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Ofsted Evidence Readiness" description={`${OFSTED_CATEGORIES.length} categories · ${verifiedItems}/${totalItems} items verified · Avg strength ${avgStrength}% · ${totalGaps} gaps`} icon="ri-government-line" stats={[{ label: 'Avg Strength', value: `${avgStrength}%` }, { label: 'Verified', value: `${verifiedItems}/${totalItems}` }, { label: 'Gaps', value: String(totalGaps) }]} />

        {/* Category Strength Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {OFSTED_CATEGORIES.map(c => (
            <div key={c.category} className={`bg-background-50 rounded-xl border p-5 ${c.status === 'needs-improvement' ? 'border-red-200/60' : c.status === 'adequate' ? 'border-amber-200/60' : 'border-emerald-200/60'}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.strength >= 80 ? 'bg-emerald-100 text-emerald-600' : c.strength >= 70 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}`}><i className={`${c.icon} text-sm`}></i></span>
                <div>
                  <h3 className="text-[12px] font-heading font-semibold text-foreground-900">{c.category}</h3>
                  <span className={`text-[9px] font-medium ${c.status === 'strong' ? 'text-emerald-600' : c.status === 'adequate' ? 'text-amber-600' : 'text-red-600'}`}>{c.status.replace('-', ' ').toUpperCase()}</span>
                </div>
              </div>
              <div className="relative w-16 h-16 mx-auto mb-2">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r="17" fill="none" stroke="oklch(var(--background-200))" strokeWidth="3"></circle>
                  <circle cx="20" cy="20" r="17" fill="none" stroke={c.strength >= 80 ? '#10b981' : c.strength >= 70 ? '#f59e0b' : '#ef4444'} strokeWidth="3" strokeDasharray={`${(c.strength / 100) * 106.8} 106.8`} strokeLinecap="round"></circle>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-heading font-bold text-foreground-900">{c.strength}%</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center text-[9px]">
                <div className="bg-background-100/60 rounded p-1.5"><span className="font-bold text-foreground-900">{c.items}</span><br /><span className="text-foreground-400">Total</span></div>
                <div className="bg-background-100/60 rounded p-1.5"><span className="font-bold text-emerald-600">{c.verified}</span><br /><span className="text-foreground-400">Verified</span></div>
                <div className={`rounded p-1.5 ${c.gaps > 0 ? 'bg-red-50/60' : 'bg-background-100/60'}`}><span className={`font-bold ${c.gaps > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{c.gaps}</span><br /><span className="text-foreground-400">Gaps</span></div>
              </div>
            </div>
          ))}
        </div>

        {/* Evidence Items */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 p-5 pb-3">Evidence Items</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-background-100/50 border-y border-background-200/30 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <th className="text-left py-2.5 px-4">ID</th>
                  <th className="text-left py-2.5">Category</th>
                  <th className="text-left py-2.5">Evidence Item</th>
                  <th className="text-center py-2.5">Status</th>
                  <th className="text-center py-2.5">Format</th>
                  <th className="text-left py-2.5">Last Updated</th>
                  <th className="text-left py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {EVIDENCE_ITEMS.map(e => (
                  <tr key={e.id} className="border-b border-foreground-200/60 hover:bg-background-100/30 transition-smooth">
                    <td className="py-2.5 px-4 font-mono text-[10px] text-foreground-500">{e.id}</td>
                    <td className="py-2.5 text-foreground-600">{e.category}</td>
                    <td className="py-2.5 text-foreground-700">{e.item}</td>
                    <td className="text-center py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-semibold ${e.status === 'verified' ? 'bg-emerald-100 text-emerald-700' : e.status === 'in-progress' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{e.status.replace('-', ' ').toUpperCase()}</span>
                    </td>
                    <td className="text-center py-2.5 text-foreground-500">{e.format}</td>
                    <td className="py-2.5 text-foreground-400">{e.lastUpdated}</td>
                    <td className="py-2.5 text-foreground-400 max-w-[180px] truncate">{e.note || '—'}</td>
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