import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface NewStarter {
  name: string;
  programme: string;
  employer: string;
  source: 'Import' | 'Referral' | 'Campaign' | 'Manual';
  date: string;
  status: 'Assigned' | 'Pending' | 'In Review';
  cohort: string;
  coach: string;
}

const STARTERS: NewStarter[] = [
  { name: 'Priya Sharma', programme: 'Business Admin L3', employer: 'NatWest', source: 'Campaign', date: '10 Jun 2026', status: 'Assigned', cohort: 'G', coach: 'David Thompson' },
  { name: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', source: 'Import', date: '9 Jun 2026', status: 'Assigned', cohort: 'F', coach: 'Sarah Mitchell' },
  { name: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', source: 'Referral', date: '8 Jun 2026', status: 'Assigned', cohort: 'F', coach: 'David Thompson' },
  { name: 'Marcus Webb', programme: 'Team Leader L3', employer: 'Maidstone Borough Council', source: 'Campaign', date: '7 Jun 2026', status: 'Pending', cohort: '—', coach: '—' },
  { name: 'Fatima Hassan', programme: 'Healthcare Support L2', employer: 'Medway NHS Trust', source: 'Import', date: '6 Jun 2026', status: 'Assigned', cohort: 'G', coach: 'Sarah Mitchell' },
  { name: 'Jake Morrison', programme: 'Software Developer L4', employer: 'Tech Kent Ltd', source: 'Manual', date: '5 Jun 2026', status: 'In Review', cohort: '—', coach: '—' },
  { name: 'Lucy Chen', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', source: 'Referral', date: '4 Jun 2026', status: 'Assigned', cohort: 'F', coach: 'David Thompson' },
  { name: 'Thomas Blake', programme: 'Accountancy L3', employer: 'Kent County Council', source: 'Campaign', date: '3 Jun 2026', status: 'Assigned', cohort: 'G', coach: 'Sarah Mitchell' },
  { name: 'Zara Iqbal', programme: 'Business Admin L3', employer: 'Dartford Borough Council', source: 'Import', date: '2 Jun 2026', status: 'Pending', cohort: '—', coach: '—' },
  { name: 'Nathan Cross', programme: 'Customer Service L2', employer: 'Gravesham Borough', source: 'Manual', date: '1 Jun 2026', status: 'Assigned', cohort: 'F', coach: 'David Thompson' },
  { name: 'Isabella Rossi', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', source: 'Referral', date: '31 May 2026', status: 'In Review', cohort: '—', coach: '—' },
  { name: 'George Kumar', programme: 'Data Technician L3', employer: 'Kent Fire & Rescue', source: 'Campaign', date: '30 May 2026', status: 'Assigned', cohort: 'G', coach: 'Sarah Mitchell' },
];

export default function NewStartersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = STARTERS.filter(s => {
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) && !s.employer.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (sourceFilter !== 'all' && s.source !== sourceFilter) return false;
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    return true;
  });

  const assigned = STARTERS.filter(s => s.status === 'Assigned').length;
  const pending = STARTERS.filter(s => s.status === 'Pending').length;
  const inReview = STARTERS.filter(s => s.status === 'In Review').length;

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="New Starters" pageSubtitle="Learners recently created, imported, referred or converted from campaigns" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="New Starters" description={`${STARTERS.length} learners recently added to the enrolment pipeline — ${assigned} assigned to cohorts, ${pending} pending assignment, ${inReview} under review.`} icon="ri-user-add-line" imageUrl="https://readdy.ai/api/search-image?query=welcoming%20bright%20professional%20office%20new%20employee%20onboarding%20desk%20documents%20warm%20natural%20lighting%20clean%20modern%20aesthetic%20editorial%20photography&width=400&height=160&seq=new-starters-hero-01&orientation=landscape" imageAlt="New starters onboarding" stats={[{ label: 'Total', value: String(STARTERS.length) }, { label: 'Assigned', value: String(assigned), variant: 'success' }, { label: 'Pending', value: String(pending), variant: 'warning' }]} />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Campaign', count: STARTERS.filter(s => s.source === 'Campaign').length, icon: 'ri-megaphone-line', color: 'bg-primary-100 text-primary-600' },
            { label: 'Import', count: STARTERS.filter(s => s.source === 'Import').length, icon: 'ri-upload-line', color: 'bg-accent-100 text-accent-700' },
            { label: 'Referral', count: STARTERS.filter(s => s.source === 'Referral').length, icon: 'ri-share-forward-line', color: 'bg-secondary-100 text-secondary-600' },
            { label: 'Manual', count: STARTERS.filter(s => s.source === 'Manual').length, icon: 'ri-user-add-line', color: 'bg-foreground-100 text-foreground-600' },
          ].map(stat => (
            <div key={stat.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${stat.color}`}><AppIcon className={`${stat.icon} text-xs`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400">{stat.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
            <input type="text" placeholder="Search by name or employer..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 transition-smooth" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {['all', 'Campaign', 'Import', 'Referral', 'Manual'].map(src => (
              <button key={src} onClick={() => setSourceFilter(src)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${sourceFilter === src ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{src === 'all' ? 'All Sources' : src}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {['all', 'Assigned', 'Pending', 'In Review'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All Status' : s}</button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Programme</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Employer</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Cohort</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Coach</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((s, i) => (
                  <tr key={i} className="hover:bg-background-100/50 transition-smooth">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          s.status === 'Assigned' ? 'bg-primary-100 text-primary-700' : s.status === 'In Review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'
                        }`}>{s.name.charAt(0)}</span>
                        <span className="text-[13px] font-medium text-foreground-900 whitespace-nowrap">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{s.programme}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{s.employer}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        s.source === 'Campaign' ? 'bg-primary-50 text-primary-600' : s.source === 'Import' ? 'bg-accent-50 text-accent-700' : s.source === 'Referral' ? 'bg-secondary-50 text-secondary-600' : 'bg-foreground-100 text-foreground-500'
                      }`}>{s.source}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-foreground-400 whitespace-nowrap">{s.date}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        s.status === 'Assigned' ? 'bg-emerald-50 text-emerald-700' : s.status === 'In Review' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                      }`}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-medium text-foreground-700 whitespace-nowrap">{s.cohort}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-500 whitespace-nowrap">{s.coach}</td>
                    <td className="px-4 py-3">
                      <button className="text-foreground-300 hover:text-primary-600 transition-smooth cursor-pointer"><AppIcon className="ri-more-2-fill"></AppIcon></button>
                    </td>
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