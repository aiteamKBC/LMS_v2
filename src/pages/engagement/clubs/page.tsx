import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface Club {
  id: string;
  name: string;
  description: string;
  category: string;
  ambassador: string;
  ambassadorRole: string;
  members: number;
  maxMembers: number;
  meetingsPerMonth: number;
  nextMeeting: string;
  active: boolean;
  topContributors: string[];
  region: string;
}

const CLUBS: Club[] = [
  { id: 'cl-01', name: 'Marketing Club', description: 'Share campaigns, discuss trends, and develop marketing strategies with peers.', category: 'Professional', ambassador: 'Rebecca Okonkwo', ambassadorRole: 'Marketing Ambassador', members: 28, maxMembers: 35, meetingsPerMonth: 2, nextMeeting: '13 Jun 2026', active: true, topContributors: ['Sophie Williams', 'Olivia Park'], region: 'London' },
  { id: 'cl-02', name: 'Leadership Club', description: 'Develop leadership skills, practice management techniques, and learn from industry leaders.', category: 'Career Growth', ambassador: 'Sarah Chen', ambassadorRole: 'Leadership Coach', members: 22, maxMembers: 30, meetingsPerMonth: 2, nextMeeting: '15 Jun 2026', active: true, topContributors: ['Emily Watson', 'David Chen'], region: 'London' },
  { id: 'cl-03', name: 'AI in Marketing', description: 'Explore AI tools, automation, and data-driven marketing strategies.', category: 'Special Interest', ambassador: 'Tom Whitfield', ambassadorRole: 'Tech Ambassador', members: 25, maxMembers: 30, meetingsPerMonth: 1, nextMeeting: '18 Jun 2026', active: true, topContributors: ['Sophie Williams', 'Liam Foster'], region: 'London' },
  { id: 'cl-04', name: 'Career Growth Club', description: 'Focus on career development, CV building, interview skills, and job searching.', category: 'Career Growth', ambassador: 'Priya Patel', ambassadorRole: 'Career Ambassador', members: 18, maxMembers: 25, meetingsPerMonth: 2, nextMeeting: '14 Jun 2026', active: true, topContributors: ['Maya Kapoor', 'Olivia Park'], region: 'London' },
  { id: 'cl-05', name: 'Sustainability in Business', description: 'Discuss sustainable business practices, ESG reporting, and green marketing.', category: 'Special Interest', ambassador: 'Dr. Amara Okafor', ambassadorRole: 'Sustainability Lead', members: 14, maxMembers: 20, meetingsPerMonth: 1, nextMeeting: '20 Jun 2026', active: true, topContributors: ['Sophie Williams', 'Emily Watson'], region: 'London' },
  { id: 'cl-06', name: 'Project Controls Club', description: 'Share project management tools, methodologies, and case studies.', category: 'Professional', ambassador: 'James Harrington', ambassadorRole: 'Project Ambassador', members: 18, maxMembers: 25, meetingsPerMonth: 2, nextMeeting: '16 Jun 2026', active: true, topContributors: ['Liam Foster', 'David Chen'], region: 'London' },
  { id: 'cl-07', name: 'British Values & Professional Practice', description: 'Explore British values, workplace ethics, and professional conduct standards.', category: 'Professional Development', ambassador: 'David Thompson', ambassadorRole: 'Compliance Ambassador', members: 22, maxMembers: 30, meetingsPerMonth: 1, nextMeeting: '21 Jun 2026', active: true, topContributors: ['Aisha Patel', 'James Okonkwo'], region: 'London' },
];

export default function EngagementClubsPage() {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const filtered = CLUBS.filter(c => {
    const matchCat = categoryFilter === 'all' || c.category === categoryFilter;
    const matchActive = !activeOnly || c.active;
    return matchCat && matchActive;
  });
  const totalMembers = CLUBS.reduce((s, c) => s + c.members, 0);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Learner Clubs" pageSubtitle="Manage learner clubs, societies, and extracurricular activities"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Learner Clubs"
          description={`${CLUBS.length} active clubs. ${totalMembers} total members. ${CLUBS.reduce((s, c) => s + c.meetingsPerMonth, 0)} meetings per month. Manage ambassadors, track membership, and schedule club activities.`}
          icon="ri-team-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20learner%20clubs%20group%20collaboration%20teamwork%20warm%20modern%20office%20professional&width=400&height=160&seq=clubs-01&orientation=landscape"
          imageAlt="Learner Clubs"
          stats={[{ label: 'Clubs', value: String(CLUBS.length) }, { label: 'Members', value: String(totalMembers) }, { label: 'Meetings', value: String(CLUBS.reduce((s, c) => s + c.meetingsPerMonth, 0)) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/events')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-calendar-event-line text-sm"></i> Events
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-thumb-up-line text-sm"></i> Recognition
          </button>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-gift-2-line text-sm"></i> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'Professional', 'Career Growth', 'Special Interest', 'Professional Development'].map(cat => (
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(club => {
            const pct = Math.round((club.members / club.maxMembers) * 100);
            return (
              <div key={club.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium hover:border-primary-200/50 transition-smooth">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
                    <i className="ri-team-line text-sm"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] font-semibold text-foreground-900">{club.name}</h4>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{club.category}</span>
                  </div>
                </div>
                <p className="text-[11px] text-foreground-500 mb-3">{club.description}</p>
                <div className="space-y-1 text-[10px] text-foreground-400 mb-3">
                  <p><i className="ri-shield-star-line mr-1 text-secondary-500"></i>Ambassador: {club.ambassador} ({club.ambassadorRole})</p>
                  <p><i className="ri-map-pin-line mr-1 text-primary-500"></i>Region: {club.region}</p>
                  <p><i className="ri-calendar-line mr-1 text-primary-500"></i>Next meeting: {club.nextMeeting}</p>
                  <p><i className="ri-time-line mr-1 text-primary-500"></i>{club.meetingsPerMonth} meetings/month</p>
                </div>
                <div className="mb-3">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-foreground-400">{club.members} / {club.maxMembers} members</span>
                    <span className={`font-bold ${pct >= 80 ? 'text-red-600' : pct >= 60 ? 'text-amber-600' : 'text-primary-600'}`}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-[10px] text-foreground-400">
                    <i className="ri-user-star-line text-accent-500"></i>
                    <span>Top: {club.topContributors.join(', ')}</span>
                  </div>
                  <div className="flex-1"></div>
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-edit-line mr-1"></i> Manage
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}