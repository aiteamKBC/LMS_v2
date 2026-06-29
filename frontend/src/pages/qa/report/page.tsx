import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface ReportQA {
  id: string;
  title: string;
  type: string;
  author: string;
  submitted: string;
  status: 'Draft' | 'Under Review' | 'Approved' | 'Rejected';
  pages: number;
  contains: string[];
  reviewNotes: string;
}

const REPORT_QA_DATA: ReportQA[] = [
  { id: 'rq-01', title: 'Q2 2026 Cohort Performance Report', type: 'Performance', author: 'Priya Sharma', submitted: '5 Jun', status: 'Under Review', pages: 24, contains: ['Attendance', 'KSB', 'OTJH', 'Gateway'], reviewNotes: 'Strong data visualisation. Missing employer engagement section.' },
  { id: 'rq-02', title: 'Business Admin L3 — Programme Review', type: 'Programme', author: 'Sarah Chen', submitted: '4 Jun', status: 'Approved', pages: 18, contains: ['KSB Mapping', 'Assessment', 'Employer Feedback'], reviewNotes: 'Comprehensive review. Approved for leadership distribution.' },
  { id: 'rq-03', title: 'Digital Marketing L3 — Skills Gap Analysis', type: 'Analysis', author: 'Tom Whitfield', submitted: '3 Jun', status: 'Rejected', pages: 12, contains: ['Skills', 'KSB', 'Evidence'], reviewNotes: 'Methodology insufficient. Needs peer review before resubmission.' },
  { id: 'rq-04', title: 'Monthly QA Summary — May 2026', type: 'Summary', author: 'Emma Clarke', submitted: '1 Jun', status: 'Approved', pages: 8, contains: ['Sampling', 'Findings', 'Actions'], reviewNotes: 'Standard monthly summary. Accurate and complete.' },
  { id: 'rq-05', title: 'Ofsted Readiness Evidence Pack', type: 'Compliance', author: 'James Whitfield', submitted: '31 May', status: 'Under Review', pages: 56, contains: ['Evidence', 'SAR', 'QIP', 'Data'], reviewNotes: 'Comprehensive pack. Cross-referencing needs verification.' },
  { id: 'rq-06', title: 'Early Years L3 — Employer Satisfaction', type: 'Survey', author: 'Dr. Amara Okafor', submitted: '30 May', status: 'Draft', pages: 14, contains: ['Survey', 'Feedback', 'Actions'], reviewNotes: 'Pending completion of Q2 survey data.' },
  { id: 'rq-07', title: 'Data Technician L3 — Progression Report', type: 'Performance', author: 'Priya Patel', submitted: '29 May', status: 'Under Review', pages: 20, contains: ['Progress', 'KSB', 'Gateway'], reviewNotes: 'Good structure. Needs more visual charts.' },
  { id: 'rq-08', title: 'Software Dev L4 — OTJH Compliance Report', type: 'Compliance', author: 'David Chen', submitted: '28 May', status: 'Approved', pages: 10, contains: ['OTJH', 'Attendance', 'Funding'], reviewNotes: 'Clear compliance summary. All thresholds met.' },
];

const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  Draft: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-draft-line' },
  'Under Review': { bg: 'bg-primary-100', text: 'text-primary-700', icon: 'ri-eye-line' },
  Approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-check-line' },
  Rejected: { bg: 'bg-red-100', text: 'text-red-700', icon: 'ri-close-line' },
};

export default function QAReportPage() {
  const [filterStatus, setFilterStatus] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = filterStatus === 'All' ? REPORT_QA_DATA : REPORT_QA_DATA.filter(r => r.status === filterStatus);

  const stats = {
    draft: REPORT_QA_DATA.filter(r => r.status === 'Draft').length,
    review: REPORT_QA_DATA.filter(r => r.status === 'Under Review').length,
    approved: REPORT_QA_DATA.filter(r => r.status === 'Approved').length,
    rejected: REPORT_QA_DATA.filter(r => r.status === 'Rejected').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="Report QA" pageSubtitle="Quality assure internal reports before leadership distribution"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Report QA"
          description={`${stats.draft} drafts. ${stats.review} under review. ${stats.approved} approved. ${stats.rejected} rejected.`}
          icon="ri-bar-chart-box-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20business%20report%20review%20quality%20assurance%20document%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-report-hero&orientation=landscape"
          imageAlt="Report QA"
          stats={[
            { label: 'Under Review', value: String(stats.review) },
            { label: 'Approved', value: String(stats.approved) },
            { label: 'Rejected', value: String(stats.rejected) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Draft', value: stats.draft, icon: 'ri-draft-line', color: 'amber' },
            { label: 'Under Review', value: stats.review, icon: 'ri-eye-line', color: 'primary' },
            { label: 'Approved', value: stats.approved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Rejected', value: stats.rejected, icon: 'ri-close-line', color: 'red' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Status:</span>
          {['All', 'Draft', 'Under Review', 'Approved', 'Rejected'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="divide-y divide-background-200/30">
            {filtered.map(report => {
              const isExpanded = expandedId === report.id;
              return (
                <div key={report.id} className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[report.status].bg} ${statusConfig[report.status].text}`}>
                        <i className={`${statusConfig[report.status].icon} text-sm`}></i>
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-foreground-900">{report.title}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[report.status].bg} ${statusConfig[report.status].text}`}>{report.status}</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{report.type}</span>
                        </div>
                        <p className="text-[11px] text-foreground-400 mt-0.5">{report.author} &middot; {report.submitted} &middot; {report.pages} pages</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-wrap gap-1">
                        {report.contains.map(c => (
                          <span key={c} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{c}</span>
                        ))}
                      </div>
                      <button onClick={() => setExpandedId(isExpanded ? null : report.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer transition-smooth">
                        <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-11 bg-background-100/50 rounded-lg p-3">
                      <p className="text-[11px] text-foreground-600 leading-relaxed mb-2">{report.reviewNotes}</p>
                      <div className="flex items-center gap-2">
                        {report.status === 'Under Review' && (
                          <button className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap">Approve</button>
                        )}
                        {report.status === 'Under Review' && (
                          <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">Reject</button>
                        )}
                        <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">View Report</button>
                      </div>
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