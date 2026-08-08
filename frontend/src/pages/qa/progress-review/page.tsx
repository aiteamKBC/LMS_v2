import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface ProgressReviewQA {
  id: string;
  learner: string;
  coach: string;
  reviewDate: string;
  period: string;
  overallProgress: number;
  ksbProgress: number;
  otjhProgress: number;
  attendance: number;
  status: 'Pending' | 'Reviewed' | 'Approved' | 'Flagged';
  risk: 'low' | 'medium' | 'high';
  notes: string;
}

const PROGRESS_QA_DATA: ProgressReviewQA[] = [
  { id: 'prq-01', learner: 'Sophie Williams', coach: 'Sarah Chen', reviewDate: '5 Jun', period: 'Apr–Jun 2026', overallProgress: 72, ksbProgress: 68, otjhProgress: 74, attendance: 92, status: 'Pending', risk: 'low', notes: 'Strong progress in marketing modules. Needs more workplace evidence for KSB S7.' },
  { id: 'prq-02', learner: 'James Okonkwo', coach: 'David Thompson', reviewDate: '4 Jun', period: 'Apr–Jun 2026', overallProgress: 45, ksbProgress: 38, otjhProgress: 52, attendance: 78, status: 'Flagged', risk: 'high', notes: 'Significant concerns. Attendance below 80%. KSB gaps in data analysis. Intervention required.' },
  { id: 'prq-03', learner: 'Aisha Patel', coach: 'Emily Watson', reviewDate: '3 Jun', period: 'Apr–Jun 2026', overallProgress: 65, ksbProgress: 70, otjhProgress: 60, attendance: 88, status: 'Pending', risk: 'medium', notes: 'Good financial accounting progress. OTJH slightly behind due to workplace workload.' },
  { id: 'prq-04', learner: 'Liam Foster', coach: 'James Harrington', reviewDate: '2 Jun', period: 'Apr–Jun 2026', overallProgress: 58, ksbProgress: 55, otjhProgress: 61, attendance: 85, status: 'Pending', risk: 'medium', notes: 'Project risk evidence rejected. Needs resubmission. Risk management KSBs underdeveloped.' },
  { id: 'prq-05', learner: 'Emily Watson', coach: 'Rebecca Okonkwo', reviewDate: '1 Jun', period: 'Apr–Jun 2026', overallProgress: 80, ksbProgress: 82, otjhProgress: 78, attendance: 95, status: 'Approved', risk: 'low', notes: 'Excellent progress across all dimensions. Ready for gateway assessment.' },
  { id: 'prq-06', learner: 'Sarah Mitchell', coach: 'Sarah Chen', reviewDate: '31 May', period: 'Apr–Jun 2026', overallProgress: 70, ksbProgress: 72, otjhProgress: 68, attendance: 90, status: 'Approved', risk: 'low', notes: 'Consistent progress. Strong business admin evidence. Meeting all targets.' },
  { id: 'prq-07', learner: 'David Chen', coach: 'Tom Whitfield', reviewDate: '30 May', period: 'Apr–Jun 2026', overallProgress: 75, ksbProgress: 78, otjhProgress: 72, attendance: 94, status: 'Reviewed', risk: 'low', notes: 'Strong technical progress. Code review documentation needs improvement.' },
  { id: 'prq-08', learner: 'Maya Kapoor', coach: 'Priya Patel', reviewDate: '29 May', period: 'Apr–Jun 2026', overallProgress: 55, ksbProgress: 50, otjhProgress: 60, attendance: 82, status: 'Pending', risk: 'medium', notes: 'HR induction module complete. Needs more workplace evidence for KSB B3.' },
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

function ProgressBar({ value, label }: { value: number; label: string }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="w-20">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-foreground-400">{label}</span>
      </div>
      <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }}></div>
      </div>
      <span className="text-[9px] text-foreground-600 font-medium">{value}%</span>
    </div>
  );
}

export default function QAProgressReviewPage() {
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = filterStatus === 'All' ? PROGRESS_QA_DATA : PROGRESS_QA_DATA.filter(p => p.status === filterStatus);

  const stats = {
    pending: PROGRESS_QA_DATA.filter(p => p.status === 'Pending').length,
    reviewed: PROGRESS_QA_DATA.filter(p => p.status === 'Reviewed').length,
    approved: PROGRESS_QA_DATA.filter(p => p.status === 'Approved').length,
    flagged: PROGRESS_QA_DATA.filter(p => p.status === 'Flagged').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Progress Review QA" pageSubtitle="Review progress reviews for quality, consistency, and Ofsted readiness"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Progress Review QA"
          description={`${stats.pending} pending review. ${stats.flagged} flagged. ${stats.approved} approved. Reviewing ${PROGRESS_QA_DATA.length} total progress reviews.`}
          icon="ri-file-chart-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20progress%20review%20assessment%20report%20chart%20dashboard%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-progress-hero&orientation=landscape"
          imageAlt="Progress Review QA"
          stats={[
            { label: 'Pending', value: String(stats.pending) },
            { label: 'Flagged', value: String(stats.flagged) },
            { label: 'Approved', value: String(stats.approved) },
          ]}
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Pending', value: stats.pending, icon: 'ri-time-line', color: 'amber' },
            { label: 'Reviewed', value: stats.reviewed, icon: 'ri-eye-line', color: 'primary' },
            { label: 'Approved', value: stats.approved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Flagged', value: stats.flagged, icon: 'ri-alert-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
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
          {['All', 'Pending', 'Reviewed', 'Approved', 'Flagged'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        {/* Progress Reviews */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="divide-y divide-background-200/30">
            {filtered.map(item => (
              <div key={item.id} className={`p-4 ${item.risk === 'high' ? 'bg-red-50/30' : ''}`}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[item.status].bg} ${statusConfig[item.status].text}`}>
                      <AppIcon className="ri-file-chart-line text-sm"></AppIcon>
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground-900">{item.learner}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[item.status].bg} ${statusConfig[item.status].text}`}>{item.status}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${riskConfig[item.risk].bg} ${riskConfig[item.risk].text}`}>{item.risk === 'low' ? 'Low' : item.risk === 'medium' ? 'Medium' : 'High'}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">Coach: {item.coach} &middot; {item.reviewDate} &middot; {item.period}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 flex-wrap">
                    <ProgressBar value={item.overallProgress} label="Overall" />
                    <ProgressBar value={item.ksbProgress} label="KSB" />
                    <ProgressBar value={item.otjhProgress} label="OTJH" />
                    <ProgressBar value={item.attendance} label="Attendance" />
                  </div>
                </div>
                <div className="mt-3 ml-11 bg-background-100/50 rounded-lg p-3">
                  <p className="text-[11px] text-foreground-600 leading-relaxed">{item.notes}</p>
                </div>
                <div className="mt-3 ml-11 flex items-center gap-2">
                  {item.status === 'Pending' && (
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review</button>
                  )}
                  {item.status === 'Flagged' && (
                    <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">Investigate</button>
                  )}
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">View Full Review</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}