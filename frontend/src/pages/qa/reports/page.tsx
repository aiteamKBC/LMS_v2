import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const qaNav = roleNavMap.qa;

interface QAReport {
  id: string;
  title: string;
  type: string;
  period: string;
  author: string;
  date: string;
  pages: number;
  recipients: string[];
  status: 'Draft' | 'Published' | 'Archived';
  summary: string;
}

const QA_REPORTS_DATA: QAReport[] = [
  { id: 'qr-01', title: 'Q2 2026 QA Summary Report', type: 'Quarterly', period: 'Apr–Jun 2026', author: 'Emma Clarke', date: '5 Jun', pages: 32, recipients: ['Leadership', 'Ofsted'], status: 'Draft', summary: 'Comprehensive quarterly summary covering all QA activities, findings, and recommendations for Q2 2026.' },
  { id: 'qr-02', title: 'Evidence Sampling Report — May 2026', type: 'Sampling', period: 'May 2026', author: 'James Whitfield', date: '1 Jun', pages: 18, recipients: ['QA Lead', 'Compliance'], status: 'Published', summary: 'Detailed sampling outcomes for evidence items across all cohorts. 15% target achieved with key findings.' },
  { id: 'qr-03', title: 'KSB Validation Audit Report', type: 'Audit', period: 'Q2 2026', author: 'QA Lead', date: '3 Jun', pages: 24, recipients: ['Leadership', 'Curriculum'], status: 'Published', summary: 'Audit of KSB validation processes across all programmes. Identifies inconsistencies and recommends standardisation.' },
  { id: 'qr-04', title: 'OTJH Compliance Report — Q2', type: 'Compliance', period: 'Q2 2026', author: 'Emma Clarke', date: '2 Jun', pages: 12, recipients: ['Finance', 'Compliance'], status: 'Published', summary: 'OTJH compliance analysis including verification rates, flagged entries, and funding risk assessment.' },
  { id: 'qr-05', title: 'Progress Review Quality Report', type: 'Quality', period: 'Apr–Jun 2026', author: 'James Whitfield', date: '31 May', pages: 20, recipients: ['Leadership', 'Coaches'], status: 'Draft', summary: 'Analysis of progress review quality across all coaches. Identifies variance and recommends training.' },
  { id: 'qr-06', title: 'Ofsted Readiness Report', type: 'Compliance', period: 'Jun 2026', author: 'QA Lead', date: '1 Jun', pages: 45, recipients: ['Leadership', 'Ofsted', 'Auditor'], status: 'Published', summary: 'Complete Ofsted readiness assessment including evidence packs, SAR, QIP, and inspection preparation.' },
  { id: 'qr-07', title: 'Monthly QA Dashboard — May 2026', type: 'Monthly', period: 'May 2026', author: 'Emma Clarke', date: '31 May', pages: 8, recipients: ['Leadership'], status: 'Archived', summary: 'Standard monthly dashboard with key QA metrics, trends, and action items for May 2026.' },
  { id: 'qr-08', title: 'Employer Satisfaction QA Report', type: 'Survey', period: 'Q2 2026', author: 'Dr. Amara Okafor', date: '30 May', pages: 16, recipients: ['Engagement', 'Leadership'], status: 'Published', summary: 'QA review of employer satisfaction survey results with recommendations for improvement.' },
];

const statusConfig: Record<string, { bg: string; text: string; icon: string }> = {
  Draft: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-draft-line' },
  Published: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-check-line' },
  Archived: { bg: 'bg-foreground-100', text: 'text-foreground-500', icon: 'ri-folder-close-line' },
};

export default function QAReportsPage() {
  const [filterType, setFilterType] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  const filtered = QA_REPORTS_DATA.filter(r => {
    const typeMatch = filterType === 'All' || r.type === filterType;
    const statusMatch = filterStatus === 'All' || r.status === filterStatus;
    return typeMatch && statusMatch;
  });

  const stats = {
    draft: QA_REPORTS_DATA.filter(r => r.status === 'Draft').length,
    published: QA_REPORTS_DATA.filter(r => r.status === 'Published').length,
    archived: QA_REPORTS_DATA.filter(r => r.status === 'Archived').length,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="QA Reports" pageSubtitle="Generate comprehensive QA reports for Ofsted and governance meetings"
      userName="Emma Clarke" userRole="QA Officer"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="QA Reports"
          description={`${stats.draft} drafts. ${stats.published} published. ${stats.archived} archived. Generate and manage all QA reports.`}
          icon="ri-file-list-3-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20report%20generation%20quality%20assurance%20documents%20stack%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-reports-hero&orientation=landscape"
          imageAlt="QA Reports"
          stats={[
            { label: 'Draft', value: String(stats.draft) },
            { label: 'Published', value: String(stats.published) },
            { label: 'Archived', value: String(stats.archived) },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Draft', value: stats.draft, icon: 'ri-draft-line', color: 'amber' },
            { label: 'Published', value: stats.published, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Archived', value: stats.archived, icon: 'ri-folder-close-line', color: 'foreground' },
          ].map(s => (
            <div key={s.label} className="coach-metric-card">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'amber' ? 'bg-amber-100 text-amber-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-foreground-400">Type:</span>
            {['All', 'Quarterly', 'Monthly', 'Sampling', 'Audit', 'Compliance', 'Quality', 'Survey'].map(t => (
              <button key={t} onClick={() => setFilterType(t)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterType === t ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{t}</button>
            ))}
            <span className="text-[12px] text-foreground-400 ml-2">Status:</span>
            {['All', 'Draft', 'Published', 'Archived'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-add-line mr-1"></AppIcon> New Report
          </button>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="divide-y divide-background-200/30">
            {filtered.map(report => (
              <div key={report.id} className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${statusConfig[report.status].bg} ${statusConfig[report.status].text}`}>
                      <AppIcon className={`${statusConfig[report.status].icon} text-sm`}></AppIcon>
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground-900">{report.title}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[report.status].bg} ${statusConfig[report.status].text}`}>{report.status}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{report.type}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{report.author} &middot; {report.date} &middot; {report.pages} pages &middot; {report.period}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex flex-wrap gap-1">
                      {report.recipients.map(r => (
                        <span key={r} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{r}</span>
                      ))}
                    </div>
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View</button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Download</button>
                  </div>
                </div>
                <p className="mt-2 ml-11 text-[11px] text-foreground-600 leading-relaxed">{report.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
