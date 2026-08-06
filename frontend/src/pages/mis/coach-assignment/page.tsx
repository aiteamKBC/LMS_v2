import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Coach {
  id: string;
  name: string;
  email: string;
  role: string;
  caseload: number;
  maxCaseload: number;
  activeLearners: number;
  cohorts: string[];
  programmes: string[];
  specialisms: string[];
  region: string;
  availability: 'Available' | 'At capacity' | 'Overloaded' | 'On leave';
  lastActivity: string;
  nextReview: string;
  status: 'Active' | 'Inactive';
}

const COACHES: Coach[] = [
  { id: 'ch-1', name: 'Med Maher', email: 'med.maher@kbc.test', role: 'Progress Coach', caseload: 24, maxCaseload: 30, activeLearners: 22, cohorts: ['Cohort A — BA', 'Cohort C — BA'], programmes: ['Business Administrator'], specialisms: ['Business Admin', 'Leadership'], region: 'London', availability: 'At capacity', lastActivity: 'Today', nextReview: '15 Jun 2026', status: 'Active' },
  { id: 'ch-2', name: 'Sarah Chen', email: 'sarah.chen@kbc.test', role: 'Progress Coach', caseload: 18, maxCaseload: 25, activeLearners: 18, cohorts: ['Cohort B — DM'], programmes: ['Digital Marketer'], specialisms: ['Marketing', 'Communications'], region: 'Manchester', availability: 'Available', lastActivity: 'Today', nextReview: '20 Jun 2026', status: 'Active' },
  { id: 'ch-3', name: 'James Porter', email: 'james.porter@kbc.test', role: 'Senior Coach', caseload: 16, maxCaseload: 25, activeLearners: 12, cohorts: ['Cohort D — DT'], programmes: ['Data Technician'], specialisms: ['Data', 'Technology'], region: 'Birmingham', availability: 'Available', lastActivity: 'Yesterday', nextReview: '18 Jun 2026', status: 'Active' },
  { id: 'ch-4', name: 'Aisha Khan', email: 'aisha.khan@kbc.test', role: 'Progress Coach', caseload: 15, maxCaseload: 20, activeLearners: 9, cohorts: ['Cohort E — EYE'], programmes: ['Early Years Educator'], specialisms: ['Early Years', 'Education'], region: 'Leeds', availability: 'Available', lastActivity: 'Today', nextReview: '22 Jun 2026', status: 'Active' },
  { id: 'ch-5', name: 'Tom Briggs', email: 'tom.briggs@kbc.test', role: 'Progress Coach', caseload: 10, maxCaseload: 20, activeLearners: 6, cohorts: ['Cohort F — SWE'], programmes: ['Software Developer'], specialisms: ['Software', 'Development'], region: 'London', availability: 'Available', lastActivity: '2 days ago', nextReview: '25 Jun 2026', status: 'Active' },
  { id: 'ch-6', name: 'David Morgan', email: 'david.morgan@kbc.test', role: 'Progress Coach', caseload: 0, maxCaseload: 20, activeLearners: 0, cohorts: [], programmes: [], specialisms: ['Project Management'], region: 'London', availability: 'Available', lastActivity: '1 week ago', nextReview: '01 Jul 2026', status: 'Inactive' },
];

const availabilityColour = (a: Coach['availability']) => {
  switch (a) {
    case 'Available': return 'bg-emerald-100 text-emerald-700';
    case 'At capacity': return 'bg-amber-100 text-amber-700';
    case 'Overloaded': return 'bg-rose-100 text-rose-700';
    case 'On leave': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

export default function MisCoachAssignmentPage() {
  const [search, setSearch] = useState('');
  const [filterAvailability, setFilterAvailability] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedCoach, setSelectedCoach] = useState<string | null>(null);

  const filtered = COACHES.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase()) || c.specialisms.some(s => s.toLowerCase().includes(search.toLowerCase()));
    const matchAvail = filterAvailability === 'All' || c.availability === filterAvailability;
    return matchSearch && matchAvail;
  });

  const totalActive = COACHES.filter(c => c.status === 'Active').length;
  const totalCaseload = COACHES.reduce((s, c) => s + c.caseload, 0);
  const totalMax = COACHES.reduce((s, c) => s + c.maxCaseload, 0);

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Coach Assignment" pageSubtitle="Manage progress coach caseloads, assignments, and availability"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Coaches', value: String(totalActive), icon: 'ri-heart-line', color: 'primary' },
            { label: 'Total Caseload', value: String(totalCaseload), icon: 'ri-user-line', color: 'accent' },
            { label: 'Capacity', value: `${Math.round((totalCaseload / totalMax) * 100)}%`, icon: 'ri-bar-chart-2-line', color: 'secondary' },
            { label: 'Available', value: String(COACHES.filter(c => c.availability === 'Available').length), icon: 'ri-check-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search coach, specialism..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterAvailability} onChange={e => setFilterAvailability(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Available', 'At capacity', 'Overloaded', 'On leave'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1"></AppIcon> Add Coach
            </button>
          </div>
        </div>

        {/* Coach List */}
        <div className="space-y-2">
          {filtered.map(coach => {
            const isExpanded = expandedId === coach.id;
            const fillPct = Math.round((coach.caseload / coach.maxCaseload) * 100);
            return (
              <div key={coach.id} className={`bg-background-50 rounded-xl border p-4 overflow-hidden ${coach.availability === 'At capacity' ? 'border-amber-200/50 bg-amber-50/10' : coach.availability === 'Overloaded' ? 'border-rose-200/50 bg-rose-50/10' : 'border-foreground-200/60'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${coach.availability === 'At capacity' ? 'bg-amber-100 text-amber-700' : coach.availability === 'Overloaded' ? 'bg-rose-100 text-rose-700' : 'bg-primary-100 text-primary-700'}`}>
                      {coach.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{coach.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${availabilityColour(coach.availability)}`}>{coach.availability}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${coach.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{coach.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{coach.role} &middot; {coach.region} &middot; {coach.specialisms.join(', ')}</p>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[160px] hidden sm:block">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">Caseload</span>
                      <span className="text-[10px] text-foreground-600 font-medium">{coach.caseload}/{coach.maxCaseload}</span>
                    </div>
                    <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${fillPct >= 90 ? 'bg-amber-500' : fillPct >= 75 ? 'bg-primary-500' : 'bg-emerald-500'}`} style={{ width: `${fillPct}%` }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{coach.cohorts.length} cohort{coach.cohorts.length !== 1 ? 's' : ''}</span>
                    <span className="text-foreground-300">|</span>
                    <span>{coach.activeLearners} learners</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : coach.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <AppIcon className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></AppIcon>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-foreground-200/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Contact</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Email:</span> <strong className="text-foreground-800">{coach.email}</strong></p>
                        <p><span className="text-foreground-400">Last activity:</span> <strong className="text-foreground-800">{coach.lastActivity}</strong></p>
                        <p><span className="text-foreground-400">Next review:</span> <strong className="text-foreground-800">{coach.nextReview}</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Cohorts</p>
                      <div className="space-y-1">
                        {coach.cohorts.map(c => (
                          <span key={c} className="inline-block text-[11px] bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full mr-1 mb-1">{c}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Actions</p>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => { setSelectedCoach(coach.id); setShowAssign(true); }} className="px-3 py-1.5 bg-accent-500 text-white rounded-lg text-[11px] font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <AppIcon className="ri-user-add-line mr-1"></AppIcon> Assign Learners
                        </button>
                        <Link to="/mis/cohorts" className="px-3 py-1.5 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <AppIcon className="ri-group-line mr-1"></AppIcon> View Cohorts
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Assign Modal */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Assign Learners</h2>
              <button onClick={() => setShowAssign(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
              </button>
            </div>
            <p className="text-[13px] text-foreground-600 mb-4">Select learners to assign to <strong className="text-foreground-900">{COACHES.find(c => c.id === selectedCoach)?.name}</strong></p>
            <div className="space-y-2 mb-5 max-h-[300px] overflow-y-auto">
              {['Aisha Patel', 'James O\'Connor', 'Sophie Williams', 'Mohamed Ali', 'Emily Chen', 'Olivia Brown', 'Daniel Smith', 'Fatima Hassan', 'Liam Taylor', 'Chloe Davis'].map((name, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-background-100 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-primary-500" />
                  <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-bold shrink-0">{name.charAt(0)}</div>
                  <span className="text-[13px] text-foreground-800">{name}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowAssign(false)} className="px-4 py-2 text-[12px] font-medium text-foreground-600 bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={() => setShowAssign(false)} className="px-4 py-2 text-[12px] font-semibold text-white bg-accent-500 rounded-lg hover:bg-accent-600 cursor-pointer whitespace-nowrap">Assign Selected</button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}