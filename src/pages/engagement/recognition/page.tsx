import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface Recognition {
  id: string;
  learner: string;
  programme: string;
  cohort: string;
  type: 'badge' | 'certificate' | 'spotlight' | 'milestone' | 'achievement';
  title: string;
  description: string;
  awardedBy: string;
  awardedAt: string;
  category: string;
  points: number;
  public: boolean;
}

const RECOGNITIONS: Recognition[] = [
  { id: 'rec-01', learner: 'Emily Watson', programme: 'Digital Marketer L3', cohort: 'Cohort B', type: 'badge', title: 'Perfect Attendance', description: 'Attended all sessions for 4 consecutive weeks', awardedBy: 'Sarah Chen', awardedAt: 'Today', category: 'Attendance', points: 50, public: true },
  { id: 'rec-02', learner: 'Olivia Park', programme: 'Marketing Executive L4', cohort: 'Cohort B', type: 'spotlight', title: 'Top Club Contributor', description: 'Led 3 successful Marketing Club activities this month', awardedBy: 'Rebecca Okonkwo', awardedAt: 'Yesterday', category: 'Clubs', points: 100, public: true },
  { id: 'rec-03', learner: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F', type: 'certificate', title: 'Coding Excellence', description: 'Completed advanced coding challenge with 98% score', awardedBy: 'James Harrington', awardedAt: '8 Jun 2026', category: 'Assessment', points: 150, public: true },
  { id: 'rec-04', learner: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A', type: 'milestone', title: '50% Programme Complete', description: 'Reached the halfway point of the programme with strong performance', awardedBy: 'Sarah Chen', awardedAt: '7 Jun 2026', category: 'Progress', points: 200, public: true },
  { id: 'rec-05', learner: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', type: 'achievement', title: 'Evidence Master', description: 'Submitted 15 pieces of evidence with 100% first-time approval', awardedBy: 'Med Maher', awardedAt: '6 Jun 2026', category: 'Evidence', points: 100, public: true },
  { id: 'rec-06', learner: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', type: 'badge', title: 'First Catch-up', description: 'Successfully completed first catch-up session after absence', awardedBy: 'James Harrington', awardedAt: '5 Jun 2026', category: 'Attendance', points: 25, public: false },
  { id: 'rec-07', learner: 'Sarah Mitchell', programme: 'Business Admin L3', cohort: 'Cohort A', type: 'spotlight', title: 'Peer Mentor', description: 'Helped 3 fellow learners with evidence submissions', awardedBy: 'Sarah Chen', awardedAt: '4 Jun 2026', category: 'Support', points: 75, public: true },
  { id: 'rec-08', learner: 'Lucas Nguyen', programme: 'Software Developer L4', cohort: 'Cohort F', type: 'badge', title: 'Quick Responder', description: 'Responded to all coach messages within 2 hours for 2 weeks', awardedBy: 'James Harrington', awardedAt: '3 Jun 2026', category: 'Communication', points: 30, public: false },
];

const typeConfig: Record<string, { icon: string; bg: string; text: string }> = {
  badge: { icon: 'ri-award-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  certificate: { icon: 'ri-file-shield-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  spotlight: { icon: 'ri-star-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  milestone: { icon: 'ri-flag-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
  achievement: { icon: 'ri-trophy-line', bg: 'bg-amber-100', text: 'text-amber-700' },
};

export default function RecognitionPage() {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [publicOnly, setPublicOnly] = useState(false);
  const filtered = RECOGNITIONS.filter(r => {
    const matchType = typeFilter === 'all' || r.type === typeFilter;
    const matchPublic = !publicOnly || r.public;
    return matchType && matchPublic;
  });
  const totalPoints = RECOGNITIONS.reduce((s, r) => s + r.points, 0);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Recognition" pageSubtitle="Celebrate learner achievements with badges, certificates, and public recognition"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Recognition & Awards"
          description={`${RECOGNITIONS.length} recognitions awarded this month. ${totalPoints.toLocaleString()} total recognition points. ${RECOGNITIONS.filter(r => r.public).length} public spotlights. Celebrate learner achievements and boost engagement.`}
          icon="ri-thumb-up-line"
          imageUrl="https://readdy.ai/api/search-image?query=celebration%20awards%20recognition%20achievement%20ceremony%20warm%20professional%20modern&width=400&height=160&seq=recognition-01&orientation=landscape"
          imageAlt="Recognition"
          stats={[{ label: 'Awards', value: String(RECOGNITIONS.length) }, { label: 'Points', value: String(totalPoints) }, { label: 'Public', value: String(RECOGNITIONS.filter(r => r.public).length) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/clubs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-team-line text-sm"></i> Learner Clubs
          </button>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-gift-2-line text-sm"></i> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/rewards-shop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-shopping-bag-3-line text-sm"></i> Rewards Shop
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'badge', 'certificate', 'spotlight', 'milestone', 'achievement'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className={`${t === 'all' ? 'ri-list-check' : typeConfig[t]?.icon || 'ri-award-line'} text-sm`}></i>
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
            <input type="checkbox" checked={publicOnly} onChange={e => setPublicOnly(e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
            Public only
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(rec => {
            const cfg = typeConfig[rec.type] || { icon: 'ri-award-line', bg: 'bg-background-100', text: 'text-foreground-500' };
            return (
              <div key={rec.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${rec.public ? 'border-accent-200/50' : 'border-foreground-200/60'}`}>
                <div className="flex items-start gap-3 mb-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
                    <i className={`${cfg.icon} text-lg`}></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] font-semibold text-foreground-900">{rec.title}</h4>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{rec.category}</span>
                    {rec.public && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700 ml-1">Public</span>}
                  </div>
                </div>
                <p className="text-[11px] text-foreground-500 mb-3">{rec.description}</p>
                <div className="space-y-1 text-[10px] text-foreground-400 mb-3">
                  <p><i className="ri-user-line mr-1 text-primary-500"></i>{rec.learner} ({rec.cohort})</p>
                  <p><i className="ri-shield-star-line mr-1 text-secondary-500"></i>Awarded by: {rec.awardedBy}</p>
                  <p><i className="ri-calendar-line mr-1 text-primary-500"></i>{rec.awardedAt}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-accent-600">{rec.points} pts</span>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-share-line mr-1"></i> Share
                    </button>
                    <button className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-edit-line mr-1"></i> Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}