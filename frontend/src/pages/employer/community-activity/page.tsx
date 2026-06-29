import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface ActivityItem {
  id: string;
  type: 'club-participation' | 'discussion' | 'event' | 'achievement' | 'recognition' | 'challenge' | 'contribution';
  title: string;
  description: string;
  apprentice: string;
  club: string;
  date: string;
  likes: number;
  comments: number;
}

const ACTIVITIES: ActivityItem[] = [
  { id: 'ac-01', type: 'achievement', title: 'Sophie Williams presented Tim Hortons breakfast campaign', description: 'Sophie delivered an impressive presentation on the summer breakfast campaign at the Marketing & Brand Club. Her segmentation analysis received excellent peer feedback and the club voted it "Project of the Month".', apprentice: 'Sophie Williams', club: 'Marketing & Brand Club', date: '7 Jun 2026', likes: 24, comments: 8 },
  { id: 'ac-02', type: 'challenge', title: 'Workplace Challenge: Customer Service Excellence', description: 'New challenge launched! Sophie Williams and Tom Richards are participating in a cross-location customer service improvement project. Employers can contribute best practices from their stores.', apprentice: 'Sophie Williams, Tom Richards', club: 'Marketing & Brand Club', date: '5 Jun 2026', likes: 18, comments: 12 },
  { id: 'ac-03', type: 'recognition', title: 'Daniel Clarke — Apprentice of the Month Nomination', description: 'Daniel has been nominated for Apprentice of the Month following his 92% knowledge assessment score and consistent workplace contributions. Employer endorsement requested.', apprentice: 'Daniel Clarke', club: 'Business Admin Peer Group', date: '3 Jun 2026', likes: 31, comments: 15 },
  { id: 'ac-04', type: 'discussion', title: 'How are you supporting off-the-job training?', description: 'Active employer discussion on practical ways to create protected learning time during shifts. Several line managers have shared scheduling approaches — join the conversation.', apprentice: '—', club: 'Employer Clubs', date: '2 Jun 2026', likes: 14, comments: 22 },
  { id: 'ac-05', type: 'event', title: 'Upcoming: Employer Networking Breakfast Q3 2026', description: 'Quarterly networking breakfast confirmed for 22 June at KBC Campus. Agenda includes funding reform update, apprenticeship quality metrics, and employer feedback session.', apprentice: '—', club: 'Employer Clubs', date: '1 Jun 2026', likes: 8, comments: 3 },
  { id: 'ac-06', type: 'contribution', title: 'Employer Contribution Opportunity: Industry Project Ideas', description: 'KBC is seeking employer input on real-world project briefs for the next module. Share industry challenges that could become apprentice projects — your input shapes the curriculum.', apprentice: '—', club: 'Employer Clubs', date: '31 May 2026', likes: 11, comments: 9 },
  { id: 'ac-07', type: 'club-participation', title: 'Rachel Thompson led Data & Analytics Society session', description: 'Rachel facilitated a hands-on workshop on customer footfall analysis using real Tim Hortons data. Employers commended the practical application of data skills.', apprentice: 'Rachel Thompson', club: 'Data & Analytics Society', date: '29 May 2026', likes: 16, comments: 5 },
  { id: 'ac-08', type: 'achievement', title: 'Mark Jensen completed Digital Skills Lab advanced module', description: 'Mark completed the advanced digital analytics module with distinction. His final project on social media ROI measurement was highlighted as exemplary by the club facilitator.', apprentice: 'Mark Jensen', club: 'Digital Skills Lab', date: '27 May 2026', likes: 20, comments: 7 },
];

export default function EmployerCommunityActivity() {
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = typeFilter === 'all' ? ACTIVITIES : ACTIVITIES.filter(a => a.type === typeFilter);

  const typeLabels: Record<string, string> = {
    'club-participation': 'Club Activity',
    'discussion': 'Discussion',
    'event': 'Event',
    'achievement': 'Achievement',
    'recognition': 'Recognition',
    'challenge': 'Workplace Challenge',
    'contribution': 'Opportunity',
  };

  const typeIcons: Record<string, string> = {
    'club-participation': 'ri-team-line',
    'discussion': 'ri-chat-smile-2-line',
    'event': 'ri-calendar-event-line',
    'achievement': 'ri-star-line',
    'recognition': 'ri-trophy-line',
    'challenge': 'ri-lightbulb-line',
    'contribution': 'ri-hand-heart-line',
  };

  const typeColors: Record<string, string> = {
    'club-participation': 'bg-accent-50 text-accent-700 border-accent-200',
    'discussion': 'bg-secondary-50 text-secondary-700 border-secondary-200',
    'event': 'bg-primary-50 text-primary-700 border-primary-200',
    'achievement': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'recognition': 'bg-amber-50 text-amber-700 border-amber-200',
    'challenge': 'bg-rose-50 text-rose-700 border-rose-200',
    'contribution': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  };

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Community Activity" pageSubtitle="Employer-facing community updates, apprentice achievements and engagement opportunities" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-heart-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Community Activity</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Stay connected with your apprentices' learning journey and the wider employer community
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 flex-wrap">
          {[{ key: 'all', label: 'All Activity' },{ key: 'achievement', label: 'Achievements' },{ key: 'recognition', label: 'Recognition' },{ key: 'challenge', label: 'Challenges' },{ key: 'club-participation', label: 'Club Activity' },{ key: 'discussion', label: 'Discussions' },{ key: 'contribution', label: 'Opportunities' }].map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(activity => (
            <div key={activity.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth">
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${typeColors[activity.type]}`}>
                  <i className={`${typeIcons[activity.type]} text-sm`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground-900 leading-snug">{activity.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{typeLabels[activity.type]}</span>
                    <span className="text-[10px] text-foreground-400">{activity.date}</span>
                  </div>
                </div>
              </div>
              <p className="text-[12px] text-foreground-500 leading-relaxed mb-3">{activity.description}</p>
              {activity.apprentice !== '—' && (
                <div className="flex items-center gap-2 mb-3">
                  <i className="ri-user-line text-foreground-400 text-[10px]"></i>
                  <span className="text-[11px] text-foreground-600">{activity.apprentice}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{activity.club}</span>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-background-100">
                <div className="flex items-center gap-3 text-[11px] text-foreground-400">
                  <span className="flex items-center gap-1 cursor-pointer hover:text-accent-600 transition-smooth">
                    <i className="ri-heart-line"></i> {activity.likes}
                  </span>
                  <span className="flex items-center gap-1 cursor-pointer hover:text-primary-600 transition-smooth">
                    <i className="ri-chat-1-line"></i> {activity.comments}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {activity.type === 'recognition' && (
                    <button className="px-3 py-1.5 bg-accent-500 text-white rounded-lg text-[10px] font-semibold hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-thumb-up-line mr-1"></i> Endorse
                    </button>
                  )}
                  {activity.type === 'contribution' && (
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-add-line mr-1"></i> Contribute
                    </button>
                  )}
                  {activity.type === 'discussion' && (
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-chat-1-line mr-1"></i> Join Discussion
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-background-100/50 rounded-xl border border-background-200/30 p-4">
          <div className="flex items-start gap-3">
            <i className="ri-information-line text-foreground-400 mt-0.5"></i>
            <div>
              <p className="text-[12px] font-medium text-foreground-700">Community Visibility</p>
              <p className="text-[11px] text-foreground-400">You are viewing employer-facing community content only. Private learner discussions, internal tutor notes, safeguarding information, and non-approved content are not visible in this space. If you have questions about community activity, message the coach or engagement team.</p>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}