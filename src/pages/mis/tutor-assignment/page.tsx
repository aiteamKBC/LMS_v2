import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Tutor {
  id: string;
  name: string;
  email: string;
  role: string;
  specialism: string;
  sessionsPerWeek: number;
  maxSessions: number;
  cohorts: string[];
  programmes: string[];
  modules: string[];
  activeLearners: number;
  totalLearners: number;
  region: string;
  availability: 'Available' | 'Heavy load' | 'At capacity' | 'On leave';
  markingTurnaround: number;
  lastSession: string;
  status: 'Active' | 'Inactive';
}

const TUTORS: Tutor[] = [
  { id: 'tu-1', name: 'Rachel Myers', email: 'rachel.myers@kbc.test', role: 'Curriculum Tutor', specialism: 'Business Administration', sessionsPerWeek: 4, maxSessions: 6, cohorts: ['Cohort A — BA'], programmes: ['Business Administrator'], modules: ['Business Communication', 'Business Admin Practice', 'Gateway Review'], activeLearners: 14, totalLearners: 22, region: 'London', availability: 'Available', markingTurnaround: 3, lastSession: 'Today', status: 'Active' },
  { id: 'tu-2', name: 'Dr. Helen Park', email: 'helen.park@kbc.test', role: 'Senior Tutor', specialism: 'Marketing & Data', sessionsPerWeek: 6, maxSessions: 6, cohorts: ['Cohort B — DM', 'Cohort D — DT'], programmes: ['Digital Marketer', 'Data Technician'], modules: ['Marketing Principles', 'Digital Channels', 'Data Analysis', 'Database Management'], activeLearners: 22, totalLearners: 30, region: 'Manchester', availability: 'Heavy load', markingTurnaround: 5, lastSession: 'Today', status: 'Active' },
  { id: 'tu-3', name: 'Crispin Jones', email: 'crispin.jones@kbc.test', role: 'Curriculum Tutor', specialism: 'Marketing Planning', sessionsPerWeek: 4, maxSessions: 6, cohorts: ['Cohort C — BA'], programmes: ['Business Administrator'], modules: ['Customer Service', 'Marketing Planning'], activeLearners: 8, totalLearners: 15, region: 'London', availability: 'Available', markingTurnaround: 2, lastSession: 'Yesterday', status: 'Active' },
  { id: 'tu-4', name: 'Louise Baker', email: 'louise.baker@kbc.test', role: 'Curriculum Tutor', specialism: 'Early Years', sessionsPerWeek: 2, maxSessions: 4, cohorts: ['Cohort E — EYE'], programmes: ['Early Years Educator'], modules: ['Child Development'], activeLearners: 9, totalLearners: 12, region: 'Leeds', availability: 'Available', markingTurnaround: 4, lastSession: 'Today', status: 'Active' },
  { id: 'tu-5', name: 'Mike Harrison', email: 'mike.harrison@kbc.test', role: 'Technical Tutor', specialism: 'Software Development', sessionsPerWeek: 2, maxSessions: 6, cohorts: ['Cohort F — SWE'], programmes: ['Software Developer'], modules: ['Programming Fundamentals'], activeLearners: 6, totalLearners: 10, region: 'London', availability: 'Available', markingTurnaround: 2, lastSession: '2 days ago', status: 'Active' },
  { id: 'tu-6', name: 'Dr. Patricia Stone', email: 'patricia.stone@kbc.test', role: 'External Tutor', specialism: 'HR & Management', sessionsPerWeek: 0, maxSessions: 4, cohorts: [], programmes: [], modules: [], activeLearners: 0, totalLearners: 0, region: 'London', availability: 'Available', markingTurnaround: 0, lastSession: 'N/A', status: 'Inactive' },
];

const availabilityColour = (a: Tutor['availability']) => {
  switch (a) {
    case 'Available': return 'bg-emerald-100 text-emerald-700';
    case 'Heavy load': return 'bg-amber-100 text-amber-700';
    case 'At capacity': return 'bg-rose-100 text-rose-700';
    case 'On leave': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

export default function MisTutorAssignmentPage() {
  const [search, setSearch] = useState('');
  const [filterAvailability, setFilterAvailability] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedTutor, setSelectedTutor] = useState<string | null>(null);

  const filtered = TUTORS.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.specialism.toLowerCase().includes(search.toLowerCase()) || t.email.toLowerCase().includes(search.toLowerCase());
    const matchAvail = filterAvailability === 'All' || t.availability === filterAvailability;
    return matchSearch && matchAvail;
  });

  const totalActive = TUTORS.filter(t => t.status === 'Active').length;
  const totalSessions = TUTORS.reduce((s, t) => s + t.sessionsPerWeek, 0);
  const totalMax = TUTORS.reduce((s, t) => s + t.maxSessions, 0);

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Tutor Assignment" pageSubtitle="Manage curriculum tutor schedules, sessions, and teaching load"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Tutors', value: String(totalActive), icon: 'ri-user-settings-line', color: 'primary' },
            { label: 'Weekly Sessions', value: String(totalSessions), icon: 'ri-calendar-line', color: 'accent' },
            { label: 'Capacity', value: `${Math.round((totalSessions / totalMax) * 100)}%`, icon: 'ri-bar-chart-2-line', color: 'secondary' },
            { label: 'Available', value: String(TUTORS.filter(t => t.availability === 'Available').length), icon: 'ri-check-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tutor, specialism..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterAvailability} onChange={e => setFilterAvailability(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Available', 'Heavy load', 'At capacity', 'On leave'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> Add Tutor
            </button>
          </div>
        </div>

        {/* Tutor List */}
        <div className="space-y-2">
          {filtered.map(tutor => {
            const isExpanded = expandedId === tutor.id;
            const fillPct = Math.round((tutor.sessionsPerWeek / tutor.maxSessions) * 100);
            return (
              <div key={tutor.id} className={`bg-background-50 rounded-xl border p-4 overflow-hidden ${tutor.availability === 'Heavy load' ? 'border-amber-200/50 bg-amber-50/10' : 'border-foreground-200/60'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${tutor.availability === 'Heavy load' ? 'bg-amber-100 text-amber-700' : 'bg-secondary-100 text-secondary-700'}`}>
                      {tutor.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{tutor.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${availabilityColour(tutor.availability)}`}>{tutor.availability}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${tutor.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{tutor.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{tutor.role} &middot; {tutor.specialism} &middot; {tutor.region}</p>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[160px] hidden sm:block">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">Session Load</span>
                      <span className="text-[10px] text-foreground-600 font-medium">{tutor.sessionsPerWeek}/{tutor.maxSessions}</span>
                    </div>
                    <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${fillPct >= 90 ? 'bg-amber-500' : fillPct >= 75 ? 'bg-primary-500' : 'bg-emerald-500'}`} style={{ width: `${fillPct}%` }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{tutor.cohorts.length} cohort{tutor.cohorts.length !== 1 ? 's' : ''}</span>
                    <span className="text-foreground-300">|</span>
                    <span>{tutor.activeLearners} learners</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : tutor.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-foreground-200/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Contact & Performance</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Email:</span> <strong className="text-foreground-800">{tutor.email}</strong></p>
                        <p><span className="text-foreground-400">Marking turnaround:</span> <strong className="text-foreground-800">{tutor.markingTurnaround} days</strong></p>
                        <p><span className="text-foreground-400">Last session:</span> <strong className="text-foreground-800">{tutor.lastSession}</strong></p>
                        <p><span className="text-foreground-400">Total learners:</span> <strong className="text-foreground-800">{tutor.totalLearners}</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Cohorts & Modules</p>
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                          {tutor.cohorts.map(c => (
                            <span key={c} className="inline-block text-[10px] bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">{c}</span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tutor.modules.map(m => (
                            <span key={m} className="inline-block text-[10px] bg-secondary-100 text-secondary-700 px-2 py-0.5 rounded-full">{m}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Actions</p>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => { setSelectedTutor(tutor.id); setShowAssign(true); }} className="px-3 py-1.5 bg-accent-500 text-white rounded-lg text-[11px] font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <i className="ri-calendar-line mr-1"></i> Assign Session
                        </button>
                        <Link to="/mis/timetables" className="px-3 py-1.5 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <i className="ri-calendar-line mr-1"></i> View Timetable
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
              <h2 className="text-base font-heading font-semibold text-foreground-900">Assign Session</h2>
              <button onClick={() => setShowAssign(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <i className="ri-close-line text-foreground-500"></i>
              </button>
            </div>
            <p className="text-[13px] text-foreground-600 mb-4">Assign a session to <strong className="text-foreground-900">{TUTORS.find(t => t.id === selectedTutor)?.name}</strong></p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[11px] font-medium text-foreground-600 mb-1">Module</label>
                <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 cursor-pointer">
                  <option>Select module...</option>
                  <option>Business Communication</option>
                  <option>Marketing Principles</option>
                  <option>Data Analysis</option>
                  <option>Programming Fundamentals</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Day</label>
                  <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 cursor-pointer">
                    <option>Mon</option>
                    <option>Tue</option>
                    <option>Wed</option>
                    <option>Thu</option>
                    <option>Fri</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Time</label>
                  <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 cursor-pointer">
                    <option>09:00</option>
                    <option>11:00</option>
                    <option>14:00</option>
                    <option>16:00</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-foreground-600 mb-1">Cohort</label>
                <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 cursor-pointer">
                  <option>Select cohort...</option>
                  <option>Cohort A — BA</option>
                  <option>Cohort B — DM</option>
                  <option>Cohort C — BA</option>
                  <option>Cohort D — DT</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowAssign(false)} className="px-4 py-2 text-[12px] font-medium text-foreground-600 bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={() => setShowAssign(false)} className="px-4 py-2 text-[12px] font-semibold text-white bg-accent-500 rounded-lg hover:bg-accent-600 cursor-pointer whitespace-nowrap">Assign Session</button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}