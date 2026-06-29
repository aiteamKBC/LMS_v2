import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Module {
  id: string;
  name: string;
  programme: string;
  level: number;
  standard: string;
  duration: string;
  order: number;
  type: 'Core' | 'Optional' | 'Gateway';
  deliveryMode: string;
  sessions: number;
  assignedCohorts: string[];
  tutor: string;
  status: 'Active' | 'Draft' | 'Archived';
  otjhHours: number;
  ksbCount: number;
}

const MODULES: Module[] = [
  { id: 'm-1', name: 'Business Communication', programme: 'Business Administrator', level: 3, standard: 'ST0070', duration: '4 weeks', order: 1, type: 'Core', deliveryMode: 'Blended', sessions: 8, assignedCohorts: ['Cohort A', 'Cohort C'], tutor: 'Rachel Myers', status: 'Active', otjhHours: 30, ksbCount: 4 },
  { id: 'm-2', name: 'Customer Service Excellence', programme: 'Business Administrator', level: 3, standard: 'ST0070', duration: '3 weeks', order: 2, type: 'Core', deliveryMode: 'Blended', sessions: 6, assignedCohorts: ['Cohort A', 'Cohort C'], tutor: 'Crispin Jones', status: 'Active', otjhHours: 25, ksbCount: 3 },
  { id: 'm-3', name: 'Data Entry & Analysis', programme: 'Business Administrator', level: 3, standard: 'ST0070', duration: '4 weeks', order: 3, type: 'Core', deliveryMode: 'Blended', sessions: 8, assignedCohorts: ['Cohort A', 'Cohort C'], tutor: 'Rachel Myers', status: 'Active', otjhHours: 35, ksbCount: 5 },
  { id: 'm-4', name: 'Marketing Principles', programme: 'Digital Marketer', level: 3, standard: 'ST0094', duration: '5 weeks', order: 1, type: 'Core', deliveryMode: 'Remote', sessions: 5, assignedCohorts: ['Cohort B'], tutor: 'Dr. Helen Park', status: 'Active', otjhHours: 40, ksbCount: 6 },
  { id: 'm-5', name: 'Digital Channels', programme: 'Digital Marketer', level: 3, standard: 'ST0094', duration: '4 weeks', order: 2, type: 'Core', deliveryMode: 'Remote', sessions: 4, assignedCohorts: ['Cohort B'], tutor: 'Dr. Helen Park', status: 'Active', otjhHours: 35, ksbCount: 5 },
  { id: 'm-6', name: 'Campaign Planning', programme: 'Digital Marketer', level: 3, standard: 'ST0094', duration: '6 weeks', order: 3, type: 'Core', deliveryMode: 'Remote', sessions: 6, assignedCohorts: ['Cohort B'], tutor: 'Dr. Helen Park', status: 'Active', otjhHours: 45, ksbCount: 7 },
  { id: 'm-7', name: 'Data Analysis & Visualisation', programme: 'Data Technician', level: 3, standard: 'ST0118', duration: '6 weeks', order: 1, type: 'Core', deliveryMode: 'Remote', sessions: 6, assignedCohorts: ['Cohort D'], tutor: 'Dr. Helen Park', status: 'Active', otjhHours: 50, ksbCount: 8 },
  { id: 'm-8', name: 'Database Management', programme: 'Data Technician', level: 3, standard: 'ST0118', duration: '5 weeks', order: 2, type: 'Core', deliveryMode: 'Remote', sessions: 5, assignedCohorts: ['Cohort D'], tutor: 'Dr. Helen Park', status: 'Active', otjhHours: 40, ksbCount: 6 },
  { id: 'm-9', name: 'Child Development', programme: 'Early Years Educator', level: 3, standard: 'ST0135', duration: '8 weeks', order: 1, type: 'Core', deliveryMode: 'On-site', sessions: 16, assignedCohorts: ['Cohort E'], tutor: 'Louise Baker', status: 'Active', otjhHours: 60, ksbCount: 10 },
  { id: 'm-10', name: 'Programming Fundamentals', programme: 'Software Developer', level: 4, standard: 'ST0116', duration: '8 weeks', order: 1, type: 'Core', deliveryMode: 'Remote', sessions: 8, assignedCohorts: ['Cohort F'], tutor: 'Mike Harrison', status: 'Draft', otjhHours: 80, ksbCount: 12 },
  { id: 'm-11', name: 'Gateway Review', programme: 'Business Administrator', level: 3, standard: 'ST0070', duration: '2 weeks', order: 4, type: 'Gateway', deliveryMode: 'Blended', sessions: 2, assignedCohorts: ['Cohort A'], tutor: 'Rachel Myers', status: 'Draft', otjhHours: 10, ksbCount: 2 },
  { id: 'm-12', name: 'Advanced Analytics', programme: 'Data Technician', level: 3, standard: 'ST0118', duration: '4 weeks', order: 3, type: 'Optional', deliveryMode: 'Remote', sessions: 4, assignedCohorts: [], tutor: 'TBC', status: 'Draft', otjhHours: 30, ksbCount: 4 },
];

const typeColour = (t: Module['type']) => {
  switch (t) {
    case 'Core': return 'bg-primary-100 text-primary-700';
    case 'Optional': return 'bg-secondary-100 text-secondary-700';
    case 'Gateway': return 'bg-accent-100 text-accent-700';
    default: return 'bg-foreground-100 text-foreground-500';
  }
};

const statusColour = (s: Module['status']) => {
  switch (s) {
    case 'Active': return 'bg-emerald-100 text-emerald-700';
    case 'Draft': return 'bg-primary-100 text-primary-700';
    case 'Archived': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

export default function MisModuleAllocationPage() {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterProgramme, setFilterProgramme] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = MODULES.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase()) || m.programme.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === 'All' || m.type === filterType;
    const matchProg = filterProgramme === 'All' || m.programme === filterProgramme;
    return matchSearch && matchType && matchProg;
  });

  const programmes = Array.from(new Set(MODULES.map(m => m.programme)));

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Module Allocation" pageSubtitle="Map curriculum modules to delivery schedules, cohorts, and tutor assignments"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Modules', value: String(MODULES.length), icon: 'ri-layout-4-line', color: 'primary' },
            { label: 'Active', value: String(MODULES.filter(m => m.status === 'Active').length), icon: 'ri-play-circle-line', color: 'accent' },
            { label: 'Core', value: String(MODULES.filter(m => m.type === 'Core').length), icon: 'ri-star-line', color: 'secondary' },
            { label: 'Total OTJH', value: String(MODULES.reduce((s, m) => s + m.otjhHours, 0)) + 'h', icon: 'ri-time-line', color: 'primary' },
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search module, programme..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Core', 'Optional', 'Gateway'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterProgramme} onChange={e => setFilterProgramme(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              <option>All</option>
              {programmes.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Module List */}
        <div className="space-y-2">
          {filtered.map(mod => {
            const isExpanded = expandedId === mod.id;
            return (
              <div key={mod.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-sm font-bold">{mod.order}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{mod.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${typeColour(mod.type)}`}>{mod.type}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColour(mod.status)}`}>{mod.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{mod.programme} L{mod.level} &middot; {mod.standard} &middot; {mod.duration}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{mod.sessions} sessions</span>
                    <span className="text-foreground-300">|</span>
                    <span>{mod.otjhHours}h OTJH</span>
                    <span className="text-foreground-300">|</span>
                    <span>{mod.ksbCount} KSBs</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : mod.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Delivery</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Tutor:</span> <strong className="text-foreground-800">{mod.tutor}</strong></p>
                        <p><span className="text-foreground-400">Mode:</span> <strong className="text-foreground-800">{mod.deliveryMode}</strong></p>
                        <p><span className="text-foreground-400">Sessions:</span> <strong className="text-foreground-800">{mod.sessions}</strong></p>
                        <p><span className="text-foreground-400">Duration:</span> <strong className="text-foreground-800">{mod.duration}</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Cohorts</p>
                      <div className="space-y-1">
                        {mod.assignedCohorts.length > 0 ? mod.assignedCohorts.map(c => (
                          <span key={c} className="inline-block text-[11px] bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full mr-1 mb-1">{c}</span>
                        )) : <span className="text-[12px] text-foreground-400">Not assigned to any cohort</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Actions</p>
                      <div className="flex flex-col gap-2">
                        <Link to="/curriculum/module-builder" className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <i className="ri-edit-line mr-1"></i> Edit Module
                        </Link>
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
    </WorkspaceShell>
  );
}