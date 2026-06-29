import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface DeliveryMilestone {
  id: string;
  cohort: string;
  programme: string;
  level: number;
  standard: string;
  startDate: string;
  endDate: string;
  gatewayDate: string;
  epaDate: string;
  certificateDate: string;
  duration: string;
  status: 'Active' | 'Starting' | 'Scheduled' | 'Completed';
  progress: number;
  learners: number;
  modulesCompleted: number;
  totalModules: number;
  nextMilestone: string;
  nextMilestoneDate: string;
  fundingClaim: string;
  employer: string;
}

const MILESTONES: DeliveryMilestone[] = [
  { id: 'dm-1', cohort: 'Cohort A — BA', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '01 Sep 2025', endDate: '28 Feb 2027', gatewayDate: '01 Jan 2027', epaDate: '15 Feb 2027', certificateDate: '28 Feb 2027', duration: '18 months', status: 'Active', progress: 72, learners: 14, modulesCompleted: 3, totalModules: 4, nextMilestone: 'Gateway Review', nextMilestoneDate: '01 Jan 2027', fundingClaim: 'Q2 2026', employer: 'Tesco Ltd' },
  { id: 'dm-2', cohort: 'Cohort B — DM', programme: 'Digital Marketer', level: 3, standard: 'ST0094', startDate: '05 Jan 2026', endDate: '31 Jul 2027', gatewayDate: '01 Jul 2027', epaDate: '15 Jul 2027', certificateDate: '31 Jul 2027', duration: '18 months', status: 'Active', progress: 45, learners: 10, modulesCompleted: 2, totalModules: 3, nextMilestone: 'Campaign Planning Assessment', nextMilestoneDate: '01 Aug 2026', fundingClaim: 'Q3 2026', employer: 'Manchester United FC' },
  { id: 'dm-3', cohort: 'Cohort C — BA', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '10 Mar 2026', endDate: '09 Sep 2027', gatewayDate: '01 Aug 2027', epaDate: '20 Aug 2027', certificateDate: '09 Sep 2027', duration: '18 months', status: 'Active', progress: 28, learners: 8, modulesCompleted: 1, totalModules: 4, nextMilestone: 'Customer Service Assessment', nextMilestoneDate: '15 Jul 2026', fundingClaim: 'Q3 2026', employer: 'NHS Trust' },
  { id: 'dm-4', cohort: 'Cohort D — DT', programme: 'Data Technician', level: 3, standard: 'ST0118', startDate: '01 May 2026', endDate: '30 Nov 2027', gatewayDate: '01 Oct 2027', epaDate: '15 Nov 2027', certificateDate: '30 Nov 2027', duration: '18 months', status: 'Active', progress: 18, learners: 12, modulesCompleted: 1, totalModules: 3, nextMilestone: 'Database Management Assessment', nextMilestoneDate: '01 Aug 2026', fundingClaim: 'Q3 2026', employer: 'Birmingham City Council' },
  { id: 'dm-5', cohort: 'Cohort E — EYE', programme: 'Early Years Educator', level: 3, standard: 'ST0135', startDate: '15 Jun 2026', endDate: '14 Dec 2027', gatewayDate: '01 Nov 2027', epaDate: '20 Nov 2027', certificateDate: '14 Dec 2027', duration: '18 months', status: 'Starting', progress: 5, learners: 9, modulesCompleted: 0, totalModules: 3, nextMilestone: 'Initial Assessment', nextMilestoneDate: '15 Jun 2026', fundingClaim: 'Q3 2026', employer: 'Leeds City Council' },
  { id: 'dm-6', cohort: 'Cohort F — SWE', programme: 'Software Developer', level: 4, standard: 'ST0116', startDate: '01 Sep 2026', endDate: '31 Mar 2028', gatewayDate: '01 Feb 2028', epaDate: '15 Mar 2028', certificateDate: '31 Mar 2028', duration: '18 months', status: 'Scheduled', progress: 0, learners: 6, modulesCompleted: 0, totalModules: 4, nextMilestone: 'Programme Start', nextMilestoneDate: '01 Sep 2026', fundingClaim: 'Q4 2026', employer: 'Sky Ltd' },
  { id: 'dm-7', cohort: 'Cohort G — HR', programme: 'HR Consultant', level: 5, standard: 'ST0234', startDate: '01 Nov 2026', endDate: '31 Oct 2028', gatewayDate: '01 Sep 2028', epaDate: '15 Oct 2028', certificateDate: '31 Oct 2028', duration: '24 months', status: 'Scheduled', progress: 0, learners: 0, modulesCompleted: 0, totalModules: 4, nextMilestone: 'Programme Start', nextMilestoneDate: '01 Nov 2026', fundingClaim: 'Q4 2026', employer: 'TBC' },
  { id: 'dm-8', cohort: 'Cohort Z — PM', programme: 'Project Manager', level: 4, standard: 'ST0723', startDate: '01 Mar 2024', endDate: '28 Feb 2026', gatewayDate: '01 Jan 2026', epaDate: '15 Feb 2026', certificateDate: '28 Feb 2026', duration: '24 months', status: 'Completed', progress: 100, learners: 11, modulesCompleted: 4, totalModules: 4, nextMilestone: 'Completed', nextMilestoneDate: '28 Feb 2026', fundingClaim: 'Q1 2026', employer: 'HSBC' },
];

const statusColour = (s: DeliveryMilestone['status']) => {
  switch (s) {
    case 'Active': return 'bg-emerald-100 text-emerald-700';
    case 'Starting': return 'bg-primary-100 text-primary-700';
    case 'Scheduled': return 'bg-secondary-100 text-secondary-700';
    case 'Completed': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

export default function MisDeliveryDatesPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = MILESTONES.filter(m => {
    const matchSearch = m.cohort.toLowerCase().includes(search.toLowerCase()) || m.programme.toLowerCase().includes(search.toLowerCase()) || m.standard.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || m.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const activeCohorts = MILESTONES.filter(m => m.status === 'Active').length;
  const totalLearners = MILESTONES.reduce((s, m) => s + m.learners, 0);

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Delivery Dates" pageSubtitle="Key milestone dates, gateway, EPA, and funding claim timelines for all cohorts"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Cohorts', value: String(activeCohorts), icon: 'ri-group-line', color: 'primary' },
            { label: 'Scheduled', value: String(MILESTONES.filter(m => m.status === 'Scheduled').length), icon: 'ri-calendar-line', color: 'accent' },
            { label: 'Total Learners', value: String(totalLearners), icon: 'ri-user-line', color: 'secondary' },
            { label: 'Completed', value: String(MILESTONES.filter(m => m.status === 'Completed').length), icon: 'ri-check-line', color: 'primary' },
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cohort, programme, standard..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Active', 'Starting', 'Scheduled', 'Completed'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Timeline List */}
        <div className="space-y-2">
          {filtered.map(m => {
            const isExpanded = expandedId === m.id;
            return (
              <div key={m.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${statusColour(m.status)}`}>
                      <i className="ri-timer-line text-sm"></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{m.cohort}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColour(m.status)}`}>{m.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{m.programme} L{m.level} &middot; {m.standard} &middot; {m.duration}</p>
                    </div>
                  </div>

                  <div className="flex-1 max-w-[200px] hidden sm:block">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">Progress</span>
                      <span className="text-[10px] text-foreground-600 font-medium">{m.progress}%</span>
                    </div>
                    <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${m.progress >= 90 ? 'bg-emerald-500' : m.progress >= 50 ? 'bg-primary-500' : 'bg-amber-500'}`} style={{ width: `${m.progress}%` }}></div>
                    </div>
                    <p className="text-[9px] text-foreground-400 mt-0.5">{m.modulesCompleted}/{m.totalModules} modules</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{m.startDate} — {m.endDate}</span>
                    <span className="text-foreground-300">|</span>
                    <span>{m.learners} learners</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : m.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Key Dates</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Start:</span> <strong className="text-foreground-800">{m.startDate}</strong></p>
                        <p><span className="text-foreground-400">End:</span> <strong className="text-foreground-800">{m.endDate}</strong></p>
                        <p><span className="text-foreground-400">Gateway:</span> <strong className="text-foreground-800">{m.gatewayDate}</strong></p>
                        <p><span className="text-foreground-400">EPA:</span> <strong className="text-foreground-800">{m.epaDate}</strong></p>
                        <p><span className="text-foreground-400">Certificate:</span> <strong className="text-foreground-800">{m.certificateDate}</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Next Milestone</p>
                      <div className="bg-accent-50 rounded-lg p-3 border border-accent-200/50">
                        <p className="text-[13px] font-semibold text-accent-800">{m.nextMilestone}</p>
                        <p className="text-[11px] text-accent-600 mt-1">{m.nextMilestoneDate}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Funding & Employer</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Funding claim:</span> <strong className="text-foreground-800">{m.fundingClaim}</strong></p>
                        <p><span className="text-foreground-400">Employer:</span> <strong className="text-foreground-800">{m.employer}</strong></p>
                        <p><span className="text-foreground-400">Progress:</span> <strong className="text-foreground-800">{m.progress}%</strong></p>
                        <p><span className="text-foreground-400">Modules:</span> <strong className="text-foreground-800">{m.modulesCompleted}/{m.totalModules}</strong></p>
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