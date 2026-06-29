import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface LearnerClub {
  id: string;
  name: string;
  description: string;
  category: string;
  apprenticeMembers: string[];
  totalMembers: number;
  nextSession: string;
  employerAccess: 'full' | 'limited' | 'pending';
  activeStatus: 'active' | 'inactive';
}

const LEARNER_CLUBS: LearnerClub[] = [
  { id: 'lc-1', name: 'Marketing & Brand Club', description: 'Learner-led club exploring marketing strategies, brand campaigns, and creative projects. Sophie Williams and Tom Richards are active members.', category: 'Professional Development', apprenticeMembers: ['Sophie Williams', 'Tom Richards'], totalMembers: 18, nextSession: '14 Jun 2026', employerAccess: 'full', activeStatus: 'active' },
  { id: 'lc-2', name: 'Digital Skills Lab', description: 'Hands-on digital skills workshops — social media, analytics, content creation. Mark Jensen regularly participates.', category: 'Skills Workshop', apprenticeMembers: ['Mark Jensen'], totalMembers: 22, nextSession: '16 Jun 2026', employerAccess: 'full', activeStatus: 'active' },
  { id: 'lc-3', name: 'Business Admin Peer Group', description: 'Peer support group for Business Administrator apprentices sharing workplace experiences and revision support. Daniel Clarke is a member.', category: 'Peer Support', apprenticeMembers: ['Daniel Clarke'], totalMembers: 14, nextSession: '19 Jun 2026', employerAccess: 'full', activeStatus: 'active' },
  { id: 'lc-4', name: 'Data & Analytics Society', description: 'Community for data analyst apprentices exploring real-world data projects, tools and techniques. Rachel Thompson is an active contributor.', category: 'Professional Development', apprenticeMembers: ['Rachel Thompson'], totalMembers: 11, nextSession: '21 Jun 2026', employerAccess: 'limited', activeStatus: 'active' },
  { id: 'lc-5', name: 'Leadership & Management Forum', description: 'Discussion space for apprentices on leadership pathways — case studies, workplace challenges and management theory.', category: 'Professional Development', apprenticeMembers: ['Lucy Barnes'], totalMembers: 9, nextSession: '25 Jun 2026', employerAccess: 'full', activeStatus: 'active' },
  { id: 'lc-6', name: 'Apprentice Wellbeing Circle', description: 'Safe space for apprentices to discuss wellbeing, work-life balance and mental health in a supportive environment.', category: 'Wellbeing', apprenticeMembers: ['Sophie Williams', 'Daniel Clarke'], totalMembers: 16, nextSession: '13 Jun 2026', employerAccess: 'limited', activeStatus: 'active' },
];

const CLUB_ANNOUNCEMENTS = [
  { id: 'an-1', club: 'Marketing & Brand Club', message: 'Sophie Williams presented the Tim Hortons breakfast campaign at the last club session — received great feedback from peers', date: '7 Jun 2026', type: 'achievement' as const },
  { id: 'an-2', club: 'Digital Skills Lab', message: 'New workshop series on AI tools for marketing starts next week — all marketing apprentices encouraged to attend', date: '5 Jun 2026', type: 'announcement' as const },
  { id: 'an-3', club: 'Business Admin Peer Group', message: 'Daniel Clarke shared revision tips that helped him pass the latest knowledge assessment with 92%', date: '3 Jun 2026', type: 'achievement' as const },
  { id: 'an-4', club: 'Marketing & Brand Club', message: 'Guest speaker session confirmed: Senior Brand Manager from Pret a Manger on 28 June', date: '1 Jun 2026', type: 'announcement' as const },
];

export default function EmployerLearnerClubs() {
  const [search, setSearch] = useState('');
  const [selectedClub, setSelectedClub] = useState<LearnerClub | null>(null);

  const filtered = LEARNER_CLUBS.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const myApprenticeClubs = LEARNER_CLUBS.filter(c => c.employerAccess === 'full');
  const limitedClubs = LEARNER_CLUBS.filter(c => c.employerAccess === 'limited');

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Learner Clubs" pageSubtitle="View and participate in clubs where your apprentices are members" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-team-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Learner Clubs</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{myApprenticeClubs.length} clubs</strong> with full employer access · {limitedClubs.length} with limited access
              </p>
            </div>
          </div>
        </div>

        <div className="relative sm:max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clubs..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(club => {
            const isFull = club.employerAccess === 'full';
            return (
              <div key={club.id} className={`bg-background-50 rounded-xl border p-5 card-premium cursor-pointer ${isFull ? 'border-primary-200/50 bg-primary-50/5' : 'border-foreground-200/60'}`} onClick={() => setSelectedClub(club)}>
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isFull ? 'bg-primary-100 text-primary-600' : 'bg-secondary-100 text-secondary-600'}`}>
                    <i className={`${club.category === 'Skills Workshop' ? 'ri-tools-line' : club.category === 'Peer Support' ? 'ri-chat-smile-2-line' : club.category === 'Wellbeing' ? 'ri-heart-line' : 'ri-lightbulb-line'} text-lg`}></i>
                  </div>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${isFull ? 'bg-emerald-100 text-emerald-700' : 'bg-secondary-100 text-secondary-600'}`}>
                    {isFull ? 'Full Access' : 'Limited Access'}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-foreground-900 mb-1">{club.name}</h3>
                <p className="text-[12px] text-foreground-500 leading-relaxed mb-4 line-clamp-2">{club.description}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-400 mb-1">
                  <span><i className="ri-group-line mr-1"></i> {club.totalMembers} members</span>
                  <span><i className="ri-calendar-line mr-1"></i> Next: {club.nextSession}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  {club.apprenticeMembers.map(a => (
                    <span key={a} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-accent-50 text-accent-700">{a}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {myApprenticeClubs.length > 0 && (
          <section>
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Recent Club Activity</h3>
            <div className="space-y-2">
              {CLUB_ANNOUNCEMENTS.map(ann => (
                <div key={ann.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-start gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ann.type === 'achievement' ? 'bg-accent-50 text-accent-600' : 'bg-primary-100 text-primary-600'}`}>
                    <i className={`${ann.type === 'achievement' ? 'ri-trophy-line' : 'ri-megaphone-line'} text-sm`}></i>
                  </span>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ann.club}</span>
                      <span className="text-[10px] text-foreground-400">{ann.date}</span>
                    </div>
                    <p className="text-[12px] text-foreground-700">{ann.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {selectedClub && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelectedClub(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedClub.name}</h3>
                <button onClick={() => setSelectedClub(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-foreground-500"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-[13px] text-foreground-600 leading-relaxed">{selectedClub.description}</p>
                <div className="bg-background-100 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-user-line text-foreground-400"></i>
                    <span className="text-foreground-500">Your Apprentices:</span>
                    <span className="font-medium text-foreground-900">{selectedClub.apprenticeMembers.join(', ')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-group-line text-foreground-400"></i>
                    <span className="text-foreground-500">Total Members:</span>
                    <span className="font-medium text-foreground-900">{selectedClub.totalMembers}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-calendar-line text-foreground-400"></i>
                    <span className="text-foreground-500">Next Session:</span>
                    <span className="font-medium text-foreground-900">{selectedClub.nextSession}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <i className="ri-shield-line text-foreground-400"></i>
                    <span className="text-foreground-500">Employer Access:</span>
                    <span className={`font-medium ${selectedClub.employerAccess === 'full' ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {selectedClub.employerAccess === 'full' ? 'Full — View announcements and comment' : 'Limited — View only'}
                    </span>
                  </div>
                </div>
                <button className="w-full px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-eye-line mr-1"></i> View Club Details
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}