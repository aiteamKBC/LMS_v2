import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface DeliverySetupQA {
  id: string;
  cohort: string;
  programme: string;
  standard: string;
  learners: number;
  startDate: string;
  qaStatus: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  qaOfficer: string;
  checks: { label: string; passed: boolean }[];
}

const DELIVERY_SETUP_DATA: DeliverySetupQA[] = [
  { id: 'ds-01', cohort: 'Cohort B — DM', programme: 'Digital Marketing L3', standard: 'ST0094', learners: 14, startDate: '15 Jun', qaStatus: 'Pending', risk: 'medium', qaOfficer: 'Emma Clarke', checks: [{ label: 'Timetable Complete', passed: true }, { label: 'Staff Assigned', passed: true }, { label: 'Venue Confirmed', passed: false }, { label: 'Resources Ready', passed: true }] },
  { id: 'ds-02', cohort: 'Cohort A — BA', programme: 'Business Admin L3', standard: 'ST0070', learners: 18, startDate: '1 Jul', qaStatus: 'Reviewed', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'Timetable Complete', passed: true }, { label: 'Staff Assigned', passed: true }, { label: 'Venue Confirmed', passed: true }, { label: 'Resources Ready', passed: true }] },
  { id: 'ds-03', cohort: 'Cohort C — DT', programme: 'Data Technician L3', standard: 'ST0118', learners: 12, startDate: '22 Jun', qaStatus: 'Flagged', risk: 'high', qaOfficer: 'Emma Clarke', checks: [{ label: 'Timetable Complete', passed: false }, { label: 'Staff Assigned', passed: false }, { label: 'Venue Confirmed', passed: true }, { label: 'Resources Ready', passed: false }] },
  { id: 'ds-04', cohort: 'Cohort D — SD', programme: 'Software Dev L4', standard: 'ST0116', learners: 10, startDate: '8 Jul', qaStatus: 'Pending', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'Timetable Complete', passed: true }, { label: 'Staff Assigned', passed: true }, { label: 'Venue Confirmed', passed: true }, { label: 'Resources Ready', passed: false }] },
  { id: 'ds-05', cohort: 'Cohort A — EY', programme: 'Early Years L3', standard: 'ST0135', learners: 16, startDate: '1 Aug', qaStatus: 'Approved', risk: 'low', qaOfficer: 'Emma Clarke', checks: [{ label: 'Timetable Complete', passed: true }, { label: 'Staff Assigned', passed: true }, { label: 'Venue Confirmed', passed: true }, { label: 'Resources Ready', passed: true }] },
  { id: 'ds-06', cohort: 'Cohort B — PM', programme: 'Project Management L4', standard: 'ST0723', learners: 8, startDate: '15 Jul', qaStatus: 'Pending', risk: 'low', qaOfficer: 'James Whitfield', checks: [{ label: 'Timetable Complete', passed: true }, { label: 'Staff Assigned', passed: true }, { label: 'Venue Confirmed', passed: true }, { label: 'Resources Ready', passed: true }] },
  { id: 'ds-07', cohort: 'Cohort C — HR', programme: 'HR Consultant L5', standard: 'ST0234', learners: 6, startDate: '1 Sep', qaStatus: 'Pending', risk: 'low', qaOfficer: 'Emma Clarke', checks: [{ label: 'Timetable Complete', passed: true }, { label: 'Staff Assigned', passed: false }, { label: 'Venue Confirmed', passed: true }, { label: 'Resources Ready', passed: true }] },
  { id: 'ds-08', cohort: 'Cohort B — BA', programme: 'Business Admin L3', standard: 'ST0070', learners: 20, startDate: '5 Jul', qaStatus: 'Flagged', risk: 'high', qaOfficer: 'James Whitfield', checks: [{ label: 'Timetable Complete', passed: false }, { label: 'Staff Assigned', passed: true }, { label: 'Venue Confirmed', passed: false }, { label: 'Resources Ready', passed: false }] },
];

const statusConfig: Record<string, { bg: string; text: string }> = {
  Pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
  Reviewed: { bg: 'bg-primary-100', text: 'text-primary-700' },
  Approved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Flagged: { bg: 'bg-red-100', text: 'text-red-700' },
};

const riskConfig: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

export default function QADeliverySetupPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterRisk, setFilterRisk] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = DELIVERY_SETUP_DATA.filter(p => {
    const statusMatch = filterStatus === 'All' || p.qaStatus === filterStatus;
    const riskMatch = filterRisk === 'All' || p.risk === filterRisk;
    return statusMatch && riskMatch;
  });

  const stats = {
    pending: DELIVERY_SETUP_DATA.filter(p => p.qaStatus === 'Pending').length,
    approved: DELIVERY_SETUP_DATA.filter(p => p.qaStatus === 'Approved').length,
    flagged: DELIVERY_SETUP_DATA.filter(p => p.qaStatus === 'Flagged').length,
    reviewed: DELIVERY_SETUP_DATA.filter(p => p.qaStatus === 'Reviewed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Delivery Setup QA" pageSubtitle="Quality assure timetables, staffing, venues and resources before cohort launch"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Delivery Setup QA"
          description={`${stats.pending} cohorts pending QA. ${stats.flagged} flagged for review. ${stats.approved} approved and ready for launch.`}
          icon="ri-calendar-schedule-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20apprenticeship%20delivery%20setup%20quality%20assurance%20timetable%20scheduling%20staffing%20warm%20amber%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-delivery-setup-hero&orientation=landscape"
          imageAlt="Delivery Setup QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Flagged', value: String(stats.flagged), variant: 'danger' },
            { label: 'Approved', value: String(stats.approved) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: stats.pending, icon: 'ri-time-line', color: 'amber' },
            { label: 'Reviewed', value: stats.reviewed, icon: 'ri-eye-line', color: 'primary' },
            { label: 'Approved', value: stats.approved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Flagged', value: stats.flagged, icon: 'ri-alert-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="coach-metric-card">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Pending', 'Reviewed', 'Approved', 'Flagged'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Risk:</span>
          {['All', 'low', 'medium', 'high'].map(r => (
            <button key={r} onClick={() => setFilterRisk(r)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterRisk === r ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Delivery Setup Pipeline</h3>
            <p className="text-[11px] text-foreground-400 mt-0.5">{filtered.length} cohorts matching filters</p>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(record => {
              const isExpanded = expandedId === record.id;
              return (
                <div key={record.id} className={`p-4 ${isExpanded ? 'bg-background-100/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>
                        <AppIcon className="ri-calendar-schedule-line text-sm"></AppIcon>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-foreground-900">{record.cohort}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[record.qaStatus].bg} ${statusConfig[record.qaStatus].text}`}>{record.qaStatus}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[record.risk].bg} ${riskConfig[record.risk].text}`}>{record.risk === 'low' ? 'Low' : record.risk === 'medium' ? 'Medium' : 'High'}</span>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-foreground-400">{record.programme}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-medium text-foreground-500">{record.standard}</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[11px] text-foreground-400">{record.learners} learners</span>
                          <span className="text-[8px] text-foreground-300">&middot;</span>
                          <span className="text-[10px] font-semibold text-foreground-600">Starts {record.startDate}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-foreground-400">{record.qaOfficer}</span>
                      <button onClick={() => setExpandedId(isExpanded ? null : record.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer transition-smooth">
                        <AppIcon className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></AppIcon>
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-11 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {record.checks.map(check => (
                        <div key={check.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] ${check.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          <AppIcon className={check.passed ? 'ri-check-line' : 'ri-close-line'}></AppIcon>
                          <span>{check.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
