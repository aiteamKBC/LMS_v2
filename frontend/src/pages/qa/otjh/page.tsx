import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface OTJHQA {
  id: string;
  learner: string;
  hours: number;
  activity: string;
  type: 'Live Session' | 'Self-Study' | 'Workplace' | 'Coaching' | 'Project';
  date: string;
  status: 'Pending' | 'Validated' | 'Sampled' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  verifiedBy: string;
  attendanceRecord: boolean;
  employerSignOff: boolean;
}

const OTJH_QA_DATA: OTJHQA[] = [
  { id: 'oq-01', learner: 'Sophie Williams', hours: 2.5, activity: 'Customer Segmentation Workshop', type: 'Live Session', date: '4 Jun', status: 'Pending', risk: 'low', verifiedBy: '—', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-02', learner: 'James Okonkwo', hours: 1.5, activity: 'Self-Study: Data Analysis', type: 'Self-Study', date: '3 Jun', status: 'Flagged', risk: 'high', verifiedBy: '—', attendanceRecord: false, employerSignOff: false },
  { id: 'oq-03', learner: 'Aisha Patel', hours: 3.0, activity: 'Workplace: Financial Records', type: 'Workplace', date: '2 Jun', status: 'Pending', risk: 'medium', verifiedBy: '—', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-04', learner: 'Liam Foster', hours: 2.0, activity: 'Project Risk Assessment', type: 'Project', date: '1 Jun', status: 'Sampled', risk: 'low', verifiedBy: 'Emma Clarke', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-05', learner: 'Sarah Mitchell', hours: 1.0, activity: 'Coaching Meeting', type: 'Coaching', date: '31 May', status: 'Pending', risk: 'low', verifiedBy: '—', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-06', learner: 'Emily Watson', hours: 2.5, activity: 'Campaign Analytics Review', type: 'Live Session', date: '30 May', status: 'Validated', risk: 'low', verifiedBy: 'Emma Clarke', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-07', learner: 'David Chen', hours: 4.0, activity: 'Agile Sprint Planning', type: 'Workplace', date: '29 May', status: 'Pending', risk: 'medium', verifiedBy: '—', attendanceRecord: true, employerSignOff: false },
  { id: 'oq-08', learner: 'Maya Kapoor', hours: 1.5, activity: 'HR Policy Review', type: 'Self-Study', date: '28 May', status: 'Pending', risk: 'low', verifiedBy: '—', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-09', learner: 'Oliver Smith', hours: 3.0, activity: 'Brand Strategy Workshop', type: 'Live Session', date: '27 May', status: 'Validated', risk: 'low', verifiedBy: 'Emma Clarke', attendanceRecord: true, employerSignOff: true },
  { id: 'oq-10', learner: 'Chloe Brown', hours: 2.0, activity: 'Website UX Review', type: 'Workplace', date: '26 May', status: 'Sampled', risk: 'low', verifiedBy: 'James Whitfield', attendanceRecord: true, employerSignOff: true },
];

const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  Pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-time-line' },
  Validated: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-check-line' },
  Sampled: { bg: 'bg-accent-100', text: 'text-accent-700', icon: 'ri-pie-chart-2-line' },
  Flagged: { bg: 'bg-red-100', text: 'text-red-700', icon: 'ri-alert-line' },
};

const riskConfig: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  high: { bg: 'bg-red-100', text: 'text-red-700' },
};

export default function QAOTJHPage() {
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = filterStatus === 'All' ? OTJH_QA_DATA : OTJH_QA_DATA.filter(o => o.status === filterStatus);

  const stats = {
    pending: OTJH_QA_DATA.filter(o => o.status === 'Pending').length,
    validated: OTJH_QA_DATA.filter(o => o.status === 'Validated').length,
    sampled: OTJH_QA_DATA.filter(o => o.status === 'Sampled').length,
    flagged: OTJH_QA_DATA.filter(o => o.status === 'Flagged').length,
  };

  const totalHours = OTJH_QA_DATA.reduce((s, o) => s + o.hours, 0);

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="OTJH QA" pageSubtitle="Review OTJH claims for accuracy, validity, and funding compliance"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="OTJH QA"
          description={`${stats.pending} entries pending. ${stats.flagged} flagged. ${stats.validated} validated. ${totalHours} total hours under review.`}
          icon="ri-time-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20time%20tracking%20training%20hours%20review%20clock%20schedule%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-otjh-hero&orientation=landscape"
          imageAlt="OTJH QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Flagged', value: String(stats.flagged) },
            { label: 'Total Hours', value: String(totalHours) },
          ]}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: stats.pending, icon: 'ri-time-line', color: 'amber' },
            { label: 'Validated', value: stats.validated, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Sampled', value: stats.sampled, icon: 'ri-pie-chart-2-line', color: 'accent' },
            { label: 'Flagged', value: stats.flagged, icon: 'ri-alert-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="coach-metric-card">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-red-100 text-red-700'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Pending', 'Validated', 'Sampled', 'Flagged'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        {/* OTJH List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="divide-y divide-background-200/30">
            {filtered.map(item => (
              <div key={item.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${item.risk === 'high' ? 'bg-red-50/30' : ''}`}>
                <div className={`rounded-lg px-3 py-2 text-center shrink-0 ${statusConfig[item.status].bg} ${statusConfig[item.status].text}`}>
                  <p className="text-xs font-bold">{item.hours}h</p>
                  <p className="text-[9px]">OTJH</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-foreground-900">{item.activity}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[item.risk].bg} ${riskConfig[item.risk].text}`}>{item.risk === 'low' ? 'Low' : item.risk === 'medium' ? 'Medium' : 'High'}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{item.type}</span>
                  </div>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{item.learner} &middot; {item.date}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px] text-foreground-400">
                  <span className={`flex items-center gap-1 ${item.attendanceRecord ? 'text-emerald-600' : 'text-red-600'}`}>
                    <AppIcon className={item.attendanceRecord ? 'ri-check-line' : 'ri-close-line'}></AppIcon> Attendance
                  </span>
                  <span className="text-foreground-300">|</span>
                  <span className={`flex items-center gap-1 ${item.employerSignOff ? 'text-emerald-600' : 'text-red-600'}`}>
                    <AppIcon className={item.employerSignOff ? 'ri-check-line' : 'ri-close-line'}></AppIcon> Employer
                  </span>
                  <span className="text-foreground-300">|</span>
                  <span>{item.verifiedBy !== '—' ? `Verified: ${item.verifiedBy}` : 'Unverified'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[item.status].bg} ${statusConfig[item.status].text}`}>{item.status}</span>
                  {item.status === 'Pending' && (
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Verify</button>
                  )}
                  {item.status === 'Flagged' && (
                    <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">Investigate</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
