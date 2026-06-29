import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface EmployerClub {
  id: string;
  name: string;
  description: string;
  category: string;
  members: number;
  apprentices: number;
  nextEvent: string;
  joined: boolean;
  status: 'active' | 'inactive';
}

const EMPLOYER_CLUBS: EmployerClub[] = [
  { id: 'ec-1', name: 'Tim Hortons Apprenticeship Network', description: 'Connect with other line managers running apprenticeship programmes across Tim Hortons UK locations', category: 'Industry Network', members: 34, apprentices: 12, nextEvent: '18 Jun 2026', joined: true, status: 'active' },
  { id: 'ec-2', name: 'Hospitality & Retail Employer Forum', description: 'Cross-employer forum for hospitality and retail sector employers sharing best practices in apprenticeship delivery', category: 'Sector Forum', members: 87, apprentices: 42, nextEvent: '22 Jun 2026', joined: true, status: 'active' },
  { id: 'ec-3', name: 'KBC Employer Partnership Board', description: 'Quarterly partnership board for employers working with Kent Business College on apprenticeship programmes', category: 'Partnership', members: 28, apprentices: 64, nextEvent: '5 Jul 2026', joined: true, status: 'active' },
  { id: 'ec-4', name: 'Marketing Apprenticeship Community', description: 'Employer community specifically for Marketing Executive and Digital Marketer apprenticeship programmes', category: 'Programme Community', members: 19, apprentices: 8, nextEvent: '12 Jun 2026', joined: false, status: 'active' },
  { id: 'ec-5', name: 'Line Manager Support Network', description: 'Peer support network for line managers new to supervising apprentices — share experiences and practical tips', category: 'Peer Support', members: 52, apprentices: 26, nextEvent: '15 Jun 2026', joined: false, status: 'active' },
  { id: 'ec-6', name: 'South East Apprenticeship Employers', description: 'Regional employer group covering Kent, Sussex and Surrey — policy updates, funding changes, local events', category: 'Regional', members: 143, apprentices: 210, nextEvent: '28 Jun 2026', joined: false, status: 'active' },
  { id: 'ec-7', name: 'Data & Digital Skills Employer Group', description: 'Employer working group focused on data analyst and digital skills apprenticeship standards and delivery', category: 'Programme Community', members: 23, apprentices: 15, nextEvent: '—', joined: false, status: 'inactive' },
];

export default function EmployerEmployerClubs() {
  const [search, setSearch] = useState('');
  const [joinedFilter, setJoinedFilter] = useState<string>('all');

  const filtered = EMPLOYER_CLUBS.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (joinedFilter === 'joined' && !c.joined) return false;
    if (joinedFilter === 'available' && c.joined) return false;
    return true;
  });

  const joinedCount = EMPLOYER_CLUBS.filter(c => c.joined).length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Employer Clubs" pageSubtitle="Professional clubs and communities for employers and line managers" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-building-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Employer Clubs</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{EMPLOYER_CLUBS.length} clubs</strong> · {joinedCount} joined · professional employer-facing communities
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clubs..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All Clubs' },{ key: 'joined', label: 'My Clubs' },{ key: 'available', label: 'Available' }].map(f => (
              <button key={f.key} onClick={() => setJoinedFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${joinedFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(club => (
            <div key={club.id} className={`bg-background-50 rounded-xl border p-5 card-premium ${club.joined ? 'border-primary-200/50 bg-primary-50/10' : 'border-foreground-200/60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${club.joined ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-400'}`}>
                    <i className={`${club.category === 'Industry Network' ? 'ri-global-line' : club.category === 'Sector Forum' ? 'ri-message-3-line' : club.category === 'Partnership' ? 'ri-chat-smile-2-line' : club.category === 'Programme Community' ? 'ri-stack-line' : club.category === 'Peer Support' ? 'ri-user-heart-line' : club.category === 'Regional' ? 'ri-map-pin-line' : 'ri-terminal-box-line'} text-lg`}></i>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{club.name}</p>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{club.category}</span>
                  </div>
                </div>
                {club.joined ? (
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                    <i className="ri-check-line text-[8px]"></i> Member
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">
                    {club.status === 'inactive' ? 'Inactive' : 'Available'}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-foreground-500 leading-relaxed mb-4">{club.description}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-400 mb-4">
                <span><i className="ri-group-line mr-1"></i> {club.members} employers</span>
                <span><i className="ri-user-line mr-1"></i> {club.apprentices} apprentices</span>
                {club.nextEvent !== '—' && <span><i className="ri-calendar-line mr-1"></i> Next: {club.nextEvent}</span>}
              </div>
              <div className="flex items-center gap-2">
                {club.joined ? (
                  <>
                    <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap text-center">
                      <i className="ri-eye-line mr-1"></i> View Club
                    </button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-mail-line mr-1"></i> Notifications
                    </button>
                  </>
                ) : club.status === 'active' ? (
                  <button className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap text-center">
                    <i className="ri-add-circle-line mr-1"></i> Join Club
                  </button>
                ) : (
                  <button className="flex-1 px-3 py-1.5 bg-background-100 text-foreground-400 rounded-lg text-[11px] font-medium cursor-not-allowed whitespace-nowrap text-center" disabled>
                    Currently Inactive
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-background-100/50 rounded-xl border border-background-200/30 p-4">
          <div className="flex items-start gap-3">
            <i className="ri-information-line text-foreground-400 mt-0.5"></i>
            <div>
              <p className="text-[12px] font-medium text-foreground-700">Employer Club Access Rules</p>
              <p className="text-[11px] text-foreground-400">Employer clubs are professional spaces for line managers and employers. You can join approved clubs, attend employer-facing events, see club announcements, and comment where allowed. Private learner discussions, internal tutor notes, safeguarding information, and non-approved content are not visible in this space.</p>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}