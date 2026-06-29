import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Cohort {
  id: string;
  name: string;
  programme: string;
  level: number;
  standard: string;
  startDate: string;
  endDate: string;
  duration: string;
  status: 'Active' | 'Starting' | 'Scheduled' | 'Completed' | 'Paused';
  learnerCount: number;
  maxLearners: number;
  groups: number;
  coach: string;
  tutor: string;
  deliveryMode: 'Blended' | 'Remote' | 'On-site';
  sessionsPerWeek: number;
  fundingBand: string;
  region: string;
}

const COHORTS: Cohort[] = [
  { id: 'co-a', name: 'Cohort A — BA L3', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '01 Sep 2025', endDate: '28 Feb 2027', duration: '18 months', status: 'Active', learnerCount: 14, maxLearners: 20, groups: 2, coach: 'Med Maher', tutor: 'Rachel Myers', deliveryMode: 'Blended', sessionsPerWeek: 2, fundingBand: '£5,000', region: 'London' },
  { id: 'co-b', name: 'Cohort B — DM L3', programme: 'Digital Marketer', level: 3, standard: 'ST0094', startDate: '05 Jan 2026', endDate: '31 Jul 2027', duration: '18 months', status: 'Active', learnerCount: 10, maxLearners: 15, groups: 1, coach: 'Sarah Chen', tutor: 'Dr. Helen Park', deliveryMode: 'Remote', sessionsPerWeek: 1, fundingBand: '£9,000', region: 'Manchester' },
  { id: 'co-c', name: 'Cohort C — BA L3', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '10 Mar 2026', endDate: '09 Sep 2027', duration: '18 months', status: 'Active', learnerCount: 8, maxLearners: 20, groups: 1, coach: 'Med Maher', tutor: 'Crispin Jones', deliveryMode: 'Blended', sessionsPerWeek: 2, fundingBand: '£5,000', region: 'London' },
  { id: 'co-d', name: 'Cohort D — DT L3', programme: 'Data Technician', level: 3, standard: 'ST0118', startDate: '01 May 2026', endDate: '30 Nov 2027', duration: '18 months', status: 'Active', learnerCount: 12, maxLearners: 15, groups: 2, coach: 'James Porter', tutor: 'Dr. Helen Park', deliveryMode: 'Remote', sessionsPerWeek: 1, fundingBand: '£15,000', region: 'Birmingham' },
  { id: 'co-e', name: 'Cohort E — EYE L3', programme: 'Early Years Educator', level: 3, standard: 'ST0135', startDate: '15 Jun 2026', endDate: '14 Dec 2027', duration: '18 months', status: 'Starting', learnerCount: 9, maxLearners: 15, groups: 1, coach: 'Aisha Khan', tutor: 'Louise Baker', deliveryMode: 'On-site', sessionsPerWeek: 2, fundingBand: '£7,000', region: 'Leeds' },
  { id: 'co-f', name: 'Cohort F — SWE L4', programme: 'Software Developer', level: 4, standard: 'ST0116', startDate: '01 Sep 2026', endDate: '31 Mar 2028', duration: '18 months', status: 'Scheduled', learnerCount: 6, maxLearners: 12, groups: 1, coach: 'Tom Briggs', tutor: 'Mike Harrison', deliveryMode: 'Remote', sessionsPerWeek: 1, fundingBand: '£27,000', region: 'London' },
  { id: 'co-g', name: 'Cohort G — HR L5', programme: 'HR Consultant', level: 5, standard: 'ST0234', startDate: '01 Nov 2026', endDate: '31 Oct 2028', duration: '24 months', status: 'Scheduled', learnerCount: 0, maxLearners: 10, groups: 0, coach: 'TBC', tutor: 'TBC', deliveryMode: 'Blended', sessionsPerWeek: 1, fundingBand: '£7,000', region: 'London' },
  { id: 'co-z', name: 'Cohort Z — PM L4', programme: 'Project Manager', level: 4, standard: 'ST0723', startDate: '01 Mar 2024', endDate: '28 Feb 2026', duration: '24 months', status: 'Completed', learnerCount: 11, maxLearners: 12, groups: 2, coach: 'Sarah Chen', tutor: 'Crispin Jones', deliveryMode: 'Blended', sessionsPerWeek: 2, fundingBand: '£27,000', region: 'Manchester' },
];

const statusColour = (s: Cohort['status']) => {
  switch (s) {
    case 'Active': return 'bg-emerald-100 text-emerald-700';
    case 'Starting': return 'bg-primary-100 text-primary-700';
    case 'Scheduled': return 'bg-secondary-100 text-secondary-700';
    case 'Completed': return 'bg-foreground-100 text-foreground-500';
    case 'Paused': return 'bg-amber-100 text-amber-700';
    default: return 'bg-foreground-100 text-foreground-500';
  }
};

const modeColour = (m: Cohort['deliveryMode']) => {
  switch (m) {
    case 'Blended': return 'bg-accent-100 text-accent-700';
    case 'Remote': return 'bg-primary-100 text-primary-700';
    case 'On-site': return 'bg-secondary-100 text-secondary-700';
    default: return '';
  }
};

export default function MisCohortsPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterMode, setFilterMode] = useState<string>('All');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = COHORTS.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.programme.toLowerCase().includes(search.toLowerCase()) || c.standard.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || c.status === filterStatus;
    const matchMode = filterMode === 'All' || c.deliveryMode === filterMode;
    return matchSearch && matchStatus && matchMode;
  });

  const totalLearners = COHORTS.reduce((s, c) => s + c.learnerCount, 0);
  const activeCohorts = COHORTS.filter(c => c.status === 'Active').length;
  const totalCapacity = COHORTS.reduce((s, c) => s + c.maxLearners, 0);

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Cohort Management" pageSubtitle="Create, configure and manage all cohorts across programmes"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Cohorts', value: String(COHORTS.length), icon: 'ri-group-line', color: 'primary' },
            { label: 'Active', value: String(activeCohorts), icon: 'ri-play-circle-line', color: 'accent' },
            { label: 'Enrolled Learners', value: String(totalLearners), icon: 'ri-user-line', color: 'secondary' },
            { label: 'Total Capacity', value: String(totalCapacity), icon: 'ri-bar-chart-2-line', color: 'primary' },
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cohorts, programme, standard..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              {['All', 'Active', 'Starting', 'Scheduled', 'Completed', 'Paused'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              {['All', 'Blended', 'Remote', 'On-site'].map(m => <option key={m}>{m}</option>)}
            </select>
            <button onClick={() => setShowForm(true)} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> New Cohort
            </button>
          </div>
        </div>

        {/* Cohort List */}
        <div className="space-y-2">
          {filtered.map(cohort => {
            const fillPct = Math.round((cohort.learnerCount / cohort.maxLearners) * 100);
            const isExpanded = expandedId === cohort.id;
            return (
              <div key={cohort.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                {/* Header Row */}
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${statusColour(cohort.status)}`}>
                      <i className="ri-group-line text-sm"></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{cohort.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColour(cohort.status)}`}>{cohort.status}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${modeColour(cohort.deliveryMode)}`}>{cohort.deliveryMode}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{cohort.programme} L{cohort.level} &middot; {cohort.standard} &middot; {cohort.region}</p>
                    </div>
                  </div>

                  {/* Capacity Bar */}
                  <div className="flex-1 max-w-[160px] hidden sm:block">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">Capacity</span>
                      <span className="text-[10px] text-foreground-600 font-medium">{cohort.learnerCount}/{cohort.maxLearners}</span>
                    </div>
                    <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${fillPct >= 90 ? 'bg-amber-500' : fillPct >= 70 ? 'bg-primary-500' : 'bg-emerald-500'}`} style={{ width: `${fillPct}%` }}></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{cohort.startDate} — {cohort.endDate}</span>
                    <span className="text-foreground-300">|</span>
                    <span>{cohort.groups} group{cohort.groups !== 1 ? 's' : ''}</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : cohort.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 transition-colors cursor-pointer">
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Delivery</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Coach:</span> <strong className="text-foreground-800">{cohort.coach}</strong></p>
                        <p><span className="text-foreground-400">Tutor:</span> <strong className="text-foreground-800">{cohort.tutor}</strong></p>
                        <p><span className="text-foreground-400">Sessions/wk:</span> <strong className="text-foreground-800">{cohort.sessionsPerWeek}</strong></p>
                        <p><span className="text-foreground-400">Mode:</span> <strong className="text-foreground-800">{cohort.deliveryMode}</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Funding</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Band:</span> <strong className="text-foreground-800">{cohort.fundingBand}</strong></p>
                        <p><span className="text-foreground-400">Standard:</span> <strong className="text-foreground-800">{cohort.standard}</strong></p>
                        <p><span className="text-foreground-400">Duration:</span> <strong className="text-foreground-800">{cohort.duration}</strong></p>
                        <p><span className="text-foreground-400">Region:</span> <strong className="text-foreground-800">{cohort.region}</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Enrolment</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Learners:</span> <strong className="text-foreground-800">{cohort.learnerCount}/{cohort.maxLearners}</strong></p>
                        <p><span className="text-foreground-400">Groups:</span> <strong className="text-foreground-800">{cohort.groups}</strong></p>
                        <p><span className="text-foreground-400">Fill rate:</span> <strong className="text-foreground-800">{fillPct}%</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Actions</p>
                      <div className="flex flex-col gap-2">
                        <Link to={`/curriculum/cohorts/${cohort.id}`} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <i className="ri-eye-line mr-1"></i> View Details
                        </Link>
                        <Link to={`/curriculum/cohorts/${cohort.id}/allocate`} className="px-3 py-1.5 bg-accent-500 text-white rounded-lg text-[11px] font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap text-center">
                          <i className="ri-user-add-line mr-1"></i> Allocate Learners
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

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i className="ri-group-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No cohorts found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>

      {/* New Cohort Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Create New Cohort</h2>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <i className="ri-close-line text-foreground-500"></i>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              {[
                { label: 'Cohort Name', placeholder: 'e.g. Cohort H — Project Manager' },
                { label: 'Programme', placeholder: 'e.g. Business Administrator' },
                { label: 'IfATE Standard Code', placeholder: 'e.g. ST0070' },
                { label: 'Start Date', placeholder: 'DD Mon YYYY' },
                { label: 'End Date', placeholder: 'DD Mon YYYY' },
                { label: 'Max Learners', placeholder: '15' },
              ].map(f => (
                <div key={f.label}>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">{f.label}</label>
                  <input placeholder={f.placeholder} className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-300 focus:outline-none focus:border-primary-400" />
                </div>
              ))}
              <div>
                <label className="block text-[11px] font-medium text-foreground-600 mb-1">Delivery Mode</label>
                <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-primary-400 cursor-pointer">
                  {['Blended', 'Remote', 'On-site'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-foreground-600 mb-1">Region</label>
                <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-primary-400 cursor-pointer">
                  {['London', 'Manchester', 'Birmingham', 'Leeds', 'Bristol', 'Sheffield'].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[12px] font-medium text-foreground-600 bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[12px] font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 cursor-pointer whitespace-nowrap">Create Cohort</button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}