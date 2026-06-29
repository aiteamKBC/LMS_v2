import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface PointsRule {
  id: string;
  name: string;
  description: string;
  points: number;
  category: string;
  frequency: string;
  active: boolean;
  trigger: string;
  learnersImpacted: number;
  totalPointsAwarded: number;
}

const POINTS_RULES: PointsRule[] = [
  { id: 'pr-01', name: 'Session Attendance', description: 'Attend a scheduled live session', points: 10, category: 'Attendance', frequency: 'Per session', active: true, trigger: 'Automatic on attendance mark', learnersImpacted: 48, totalPointsAwarded: 480 },
  { id: 'pr-02', name: 'Evidence Submission', description: 'Submit evidence for a KSB', points: 15, category: 'Evidence', frequency: 'Per submission', active: true, trigger: 'On evidence upload', learnersImpacted: 35, totalPointsAwarded: 525 },
  { id: 'pr-03', name: 'Evidence Approved', description: 'Evidence approved by tutor/assessor', points: 25, category: 'Evidence', frequency: 'Per approval', active: true, trigger: 'On approval status change', learnersImpacted: 28, totalPointsAwarded: 700 },
  { id: 'pr-04', name: 'Quiz Pass', description: 'Pass a module quiz with 70%+', points: 20, category: 'Assessment', frequency: 'Per quiz', active: true, trigger: 'On quiz completion', learnersImpacted: 42, totalPointsAwarded: 840 },
  { id: 'pr-05', name: 'Club Attendance', description: 'Attend a learner club session', points: 15, category: 'Clubs', frequency: 'Per session', active: true, trigger: 'On club attendance', learnersImpacted: 22, totalPointsAwarded: 330 },
  { id: 'pr-06', name: 'Club Contribution', description: 'Lead or contribute to a club activity', points: 30, category: 'Clubs', frequency: 'Per contribution', active: true, trigger: 'Manual by ambassador', learnersImpacted: 8, totalPointsAwarded: 240 },
  { id: 'pr-07', name: 'Message Response', description: 'Respond to coach message within 24h', points: 5, category: 'Communication', frequency: 'Per response', active: true, trigger: 'On message reply', learnersImpacted: 45, totalPointsAwarded: 225 },
  { id: 'pr-08', name: 'Monthly Progress Review', description: 'Complete monthly progress review', points: 50, category: 'Progress', frequency: 'Monthly', active: true, trigger: 'On review completion', learnersImpacted: 38, totalPointsAwarded: 1900 },
  { id: 'pr-09', name: 'Employer Feedback', description: 'Employer submits positive feedback', points: 20, category: 'Employer', frequency: 'Per feedback', active: true, trigger: 'On feedback submission', learnersImpacted: 15, totalPointsAwarded: 300 },
  { id: 'pr-10', name: 'Catch-up Session', description: 'Attend a scheduled catch-up session', points: 10, category: 'Attendance', frequency: 'Per session', active: true, trigger: 'On catch-up attendance', learnersImpacted: 12, totalPointsAwarded: 120 },
  { id: 'pr-11', name: 'Referral', description: 'Refer another learner to a club', points: 15, category: 'Clubs', frequency: 'Per referral', active: true, trigger: 'On referral completion', learnersImpacted: 6, totalPointsAwarded: 90 },
  { id: 'pr-12', name: 'Milestone Completion', description: 'Complete a programme milestone', points: 100, category: 'Progress', frequency: 'Per milestone', active: true, trigger: 'On milestone achieved', learnersImpacted: 10, totalPointsAwarded: 1000 },
];

export default function PointsRulesPage() {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const filtered = POINTS_RULES.filter(r => {
    const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
    const matchActive = !activeOnly || r.active;
    return matchCat && matchActive;
  });
  const totalPoints = POINTS_RULES.reduce((s, r) => s + r.totalPointsAwarded, 0);
  const activeRules = POINTS_RULES.filter(r => r.active).length;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Points Rules" pageSubtitle="Configure engagement point rules, thresholds, and reward triggers"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Points Rules Engine"
          description={`${activeRules} active rules. ${totalPoints.toLocaleString()} total points awarded this month. ${POINTS_RULES.length} rules configured across 6 categories. Configure new rules, adjust point values, and set triggers.`}
          icon="ri-gift-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=points%20rewards%20gamification%20system%20modern%20dashboard%20warm%20professional%20lighting&width=400&height=160&seq=points-01&orientation=landscape"
          imageAlt="Points Rules"
          stats={[{ label: 'Active', value: String(activeRules) }, { label: 'Points', value: totalPoints.toLocaleString() }, { label: 'Categories', value: '6' }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/rewards-shop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-shopping-bag-3-line text-sm"></i> Rewards Shop
          </button>
          <button onClick={() => navigate('/engagement/voucher-claims')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-coupon-line text-sm"></i> Voucher Claims
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-thumb-up-line text-sm"></i> Recognition
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'Attendance', 'Evidence', 'Assessment', 'Clubs', 'Communication', 'Progress', 'Employer'].map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
            Active only
          </label>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Points Rules</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} rules</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(rule => (
              <div key={rule.id} className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold">{rule.points}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] font-semibold text-foreground-900">{rule.name}</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{rule.category}</span>
                    <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${rule.active ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{rule.active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <p className="text-[11px] text-foreground-500">{rule.description}</p>
                  <div className="flex items-center gap-3 text-[10px] text-foreground-400 mt-1">
                    <span>Frequency: {rule.frequency}</span>
                    <span>Trigger: {rule.trigger}</span>
                    <span>{rule.learnersImpacted} learners</span>
                    <span>{rule.totalPointsAwarded} pts awarded</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-edit-line mr-1"></i> Edit
                  </button>
                  <button className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-bar-chart-line mr-1"></i> Stats
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}