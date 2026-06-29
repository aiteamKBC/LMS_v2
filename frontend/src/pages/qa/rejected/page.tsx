import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface RejectedItem {
  id: string;
  learner: string;
  item: string;
  type: string;
  category: string;
  reason: string;
  rejectedBy: string;
  date: string;
  status: 'Resubmit Required' | 'Appealed' | 'Resubmitted' | 'Closed';
  resubmissionDeadline: string;
  daysOverdue: number;
}

const REJECTED_DATA: RejectedItem[] = [
  { id: 'rj-01', learner: 'Liam Foster', item: 'Project Risk Register', type: 'Evidence', category: 'Project Management', reason: 'Insufficient workplace context — missing employer sign-off', rejectedBy: 'QA Officer', date: '5 Jun', status: 'Resubmit Required', resubmissionDeadline: '12 Jun', daysOverdue: 0 },
  { id: 'rj-02', learner: 'James Okonkwo', item: 'Data Analysis OTJH (3 Jun)', type: 'OTJH', category: 'Data Technician', reason: 'Hours not verifiable — no Teams attendance record', rejectedBy: 'QA Officer', date: '4 Jun', status: 'Resubmit Required', resubmissionDeadline: '11 Jun', daysOverdue: 0 },
  { id: 'rj-03', learner: 'Aisha Patel', item: 'KSB K8 Validation', type: 'KSB', category: 'Financial Accounting', reason: 'Single evidence item insufficient for KSB validation — minimum 2 required', rejectedBy: 'QA Lead', date: '3 Jun', status: 'Appealed', resubmissionDeadline: '10 Jun', daysOverdue: 0 },
  { id: 'rj-04', learner: 'David Chen', item: 'Code Review Documentation', type: 'Evidence', category: 'Software Development', reason: 'Missing peer review signature', rejectedBy: 'QA Officer', date: '2 Jun', status: 'Resubmitted', resubmissionDeadline: '9 Jun', daysOverdue: 0 },
  { id: 'rj-05', learner: 'Maya Kapoor', item: 'Initial Assessment Reflection', type: 'Evidence', category: 'HR Induction', reason: 'Reflection too brief — does not demonstrate KSB application', rejectedBy: 'QA Officer', date: '1 Jun', status: 'Resubmit Required', resubmissionDeadline: '8 Jun', daysOverdue: 2 },
  { id: 'rj-06', learner: 'Oliver Smith', item: 'Marketing Campaign Report', type: 'Evidence', category: 'Marketing Planning', reason: 'No clear KSB linkage — all evidence must map to specific KSBs', rejectedBy: 'QA Lead', date: '31 May', status: 'Closed', resubmissionDeadline: '7 Jun', daysOverdue: 0 },
  { id: 'rj-07', learner: 'Chloe Brown', item: 'Website Analytics Report', type: 'Report', category: 'Digital Channels', reason: 'Data sources not cited — cannot verify authenticity', rejectedBy: 'QA Officer', date: '30 May', status: 'Appealed', resubmissionDeadline: '6 Jun', daysOverdue: 5 },
  { id: 'rj-08', learner: 'Sophie Williams', item: 'Customer Persona Draft', type: 'Evidence', category: 'Marketing Planning', reason: 'Incomplete — missing competitor analysis section', rejectedBy: 'QA Officer', date: '29 May', status: 'Resubmitted', resubmissionDeadline: '5 Jun', daysOverdue: 0 },
];

const statusConfig: Record<string, { bg: string; text: string }> = {
  'Resubmit Required': { bg: 'bg-red-100', text: 'text-red-700' },
  'Appealed': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Resubmitted': { bg: 'bg-primary-100', text: 'text-primary-700' },
  'Closed': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

export default function QARejectedPage() {
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = filterStatus === 'All' ? REJECTED_DATA : REJECTED_DATA.filter(r => r.status === filterStatus);

  const stats = {
    resubmit: REJECTED_DATA.filter(r => r.status === 'Resubmit Required').length,
    appealed: REJECTED_DATA.filter(r => r.status === 'Appealed').length,
    resubmitted: REJECTED_DATA.filter(r => r.status === 'Resubmitted').length,
    closed: REJECTED_DATA.filter(r => r.status === 'Closed').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Rejected Items" pageSubtitle="Track and manage rejected QA items requiring rework and resubmission"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Rejected Items"
          description={`${stats.resubmit} need resubmission. ${stats.appealed} under appeal. ${stats.resubmitted} resubmitted. ${stats.closed} closed.`}
          icon="ri-close-circle-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20rejected%20document%20review%20quality%20assurance%20correction%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-rejected-hero&orientation=landscape"
          imageAlt="Rejected Items"
          stats={[
            { label: 'Resubmit', value: String(stats.resubmit), variant: 'danger' },
            { label: 'Appealed', value: String(stats.appealed) },
            { label: 'Resubmitted', value: String(stats.resubmitted) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Resubmit Required', value: stats.resubmit, icon: 'ri-close-line', color: 'red' },
            { label: 'Appealed', value: stats.appealed, icon: 'ri-hand-heart-line', color: 'amber' },
            { label: 'Resubmitted', value: stats.resubmitted, icon: 'ri-refresh-line', color: 'primary' },
            { label: 'Closed', value: stats.closed, icon: 'ri-check-line', color: 'emerald' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'red' ? 'bg-red-100 text-red-700' : s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : 'bg-emerald-100 text-emerald-700'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Resubmit Required', 'Appealed', 'Resubmitted', 'Closed'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map(item => (
            <div key={item.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[item.status].bg} ${statusConfig[item.status].text}`}>{item.status}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{item.type}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{item.category}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-foreground-400">{item.date}</span>
                  {item.daysOverdue > 0 && (
                    <span className="text-[10px] text-red-600 font-medium ml-2">{item.daysOverdue}d overdue</span>
                  )}
                </div>
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-1">{item.item}</h4>
              <p className="text-[11px] text-foreground-400 mb-2">{item.learner}</p>
              <div className="bg-red-50/50 rounded-lg p-3 mb-3">
                <p className="text-[11px] text-red-700 leading-relaxed">
                  <strong>Reason:</strong> {item.reason}
                </p>
                <p className="text-[10px] text-red-500 mt-1">Rejected by: {item.rejectedBy}</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-foreground-400 mb-3">
                <span><i className="ri-calendar-line mr-0.5"></i>Resubmit by: {item.resubmissionDeadline}</span>
              </div>
              <div className="flex items-center gap-2">
                {item.status === 'Resubmit Required' && (
                  <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">Uphold Rejection</button>
                )}
                {item.status === 'Appealed' && (
                  <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap">Review Appeal</button>
                )}
                {item.status === 'Resubmitted' && (
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Review Resubmission</button>
                )}
                <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Message Learner</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}