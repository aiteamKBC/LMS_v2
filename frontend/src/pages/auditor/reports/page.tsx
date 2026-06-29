import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const auditorConfig = roleNavMap.auditor;

interface AuditReport {
  id: string;
  title: string;
  category: 'Compliance' | 'Evidence' | 'Funding' | 'Safeguarding' | 'Ofsted' | 'Performance' | 'Risk';
  description: string;
  status: 'Generated' | 'Draft' | 'Scheduled';
  lastGenerated: string;
  generatedBy: string;
  format: 'PDF' | 'Excel' | 'Both';
  findings: number;
  recommendations: number;
}

const AUDIT_REPORTS: AuditReport[] = [
  { id: 'RPT-001', title: 'Quarterly Compliance Audit', category: 'Compliance', description: 'Comprehensive compliance review covering DAS, ILR, GDPR, and funding rule adherence', status: 'Generated', lastGenerated: '10 Jun 2026', generatedBy: 'Patricia Stone', format: 'Both', findings: 3, recommendations: 5 },
  { id: 'RPT-002', title: 'Evidence Sampling Report', category: 'Evidence', description: 'Randomised evidence sample review across all active programmes with KSB coverage analysis', status: 'Generated', lastGenerated: '08 Jun 2026', generatedBy: 'Patricia Stone', format: 'PDF', findings: 2, recommendations: 3 },
  { id: 'RPT-003', title: 'Funding Audit — Q2 2026', category: 'Funding', description: 'Detailed funding audit including co-investment tracking, withdrawal impact, and band compliance', status: 'Draft', lastGenerated: '—', generatedBy: 'Rebecca Holmes', format: 'Excel', findings: 0, recommendations: 0 },
  { id: 'RPT-004', title: 'Safeguarding Audit Report', category: 'Safeguarding', description: 'Safeguarding practices review — case management, Prevent duty, DSL arrangements, and safer recruitment', status: 'Generated', lastGenerated: '05 Jun 2026', generatedBy: 'Dr. Helen Park', format: 'PDF', findings: 1, recommendations: 2 },
  { id: 'RPT-005', title: 'Ofsted Readiness Assessment', category: 'Ofsted', description: 'Inspection readiness assessment with evidence pack status, section-by-section gap analysis', status: 'Generated', lastGenerated: '02 Jun 2026', generatedBy: 'Patricia Stone', format: 'Both', findings: 2, recommendations: 4 },
  { id: 'RPT-006', title: 'Learner Progress Audit', category: 'Performance', description: 'Audit of learner progress against planned milestones — completion, attendance, OTJH and KSB metrics', status: 'Generated', lastGenerated: '07 Jun 2026', generatedBy: 'Patricia Stone', format: 'Excel', findings: 4, recommendations: 6 },
  { id: 'RPT-007', title: 'Funding Risk Assessment', category: 'Risk', description: 'Risk-based funding audit identifying high-risk learners, programmes, and employer accounts', status: 'Draft', lastGenerated: '—', generatedBy: 'Rebecca Holmes', format: 'Both', findings: 0, recommendations: 0 },
  { id: 'RPT-008', title: 'Signature Compliance Audit', category: 'Compliance', description: 'Audit of digital signature compliance across apprenticeship agreements and training plans', status: 'Scheduled', lastGenerated: 'Scheduled: 15 Jun', generatedBy: 'Patricia Stone', format: 'PDF', findings: 0, recommendations: 0 },
  { id: 'RPT-009', title: 'Employer Engagement Review', category: 'Performance', description: 'Review of employer engagement metrics — satisfaction, communication frequency, and escalation trends', status: 'Generated', lastGenerated: '04 Jun 2026', generatedBy: 'Patricia Stone', format: 'PDF', findings: 1, recommendations: 2 },
  { id: 'RPT-010', title: 'Data Quality & ILR Audit', category: 'Compliance', description: 'Data quality audit of ILR submissions — validation errors, completeness, and accuracy checks', status: 'Generated', lastGenerated: '07 Jun 2026', generatedBy: 'Lisa Nguyen', format: 'Excel', findings: 5, recommendations: 3 },
];

const statusColour = (s: AuditReport['status']) => {
  switch (s) {
    case 'Generated': return 'bg-emerald-100 text-emerald-700';
    case 'Draft': return 'bg-amber-100 text-amber-700';
    case 'Scheduled': return 'bg-secondary-100 text-secondary-700';
    default: return '';
  }
};

const categoryColour = (c: AuditReport['category']) => {
  switch (c) {
    case 'Compliance': return 'bg-primary-100 text-primary-700';
    case 'Evidence': return 'bg-accent-100 text-accent-700';
    case 'Funding': return 'bg-secondary-100 text-secondary-700';
    case 'Safeguarding': return 'bg-rose-100 text-rose-700';
    case 'Ofsted': return 'bg-violet-100 text-violet-700';
    case 'Performance': return 'bg-emerald-100 text-emerald-700';
    case 'Risk': return 'bg-red-100 text-red-700';
    default: return '';
  }
};

export default function AuditorReportsPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterCategory, setFilterCategory] = useState<string>('All');

  const filtered = AUDIT_REPORTS.filter(r => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase()) || r.category.toLowerCase().includes(search.toLowerCase()) || r.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || r.status === filterStatus;
    const matchCategory = filterCategory === 'All' || r.category === filterCategory;
    return matchSearch && matchStatus && matchCategory;
  });

  const generatedCount = AUDIT_REPORTS.filter(r => r.status === 'Generated').length;
  const draftCount = AUDIT_REPORTS.filter(r => r.status === 'Draft').length;
  const totalFindings = AUDIT_REPORTS.reduce((s, r) => s + r.findings, 0);
  const totalRecommendations = AUDIT_REPORTS.reduce((s, r) => s + r.recommendations, 0);

  return (
    <WorkspaceShell role="auditor" roleLabel={auditorConfig.label} navItems={auditorConfig.items} workspaceLabel={auditorConfig.workspaceLabel} pageTitle="Audit Reports" pageSubtitle="Generate, review and export external audit reports with findings, recommendations and action tracking" userName="Patricia Stone" userRole="External Auditor">
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Reports Generated', value: String(generatedCount), icon: 'ri-file-text-line', colour: 'emerald' },
            { label: 'Drafts', value: String(draftCount), icon: 'ri-draft-line', colour: 'amber' },
            { label: 'Total Findings', value: String(totalFindings), icon: 'ri-search-eye-line', colour: 'primary' },
            { label: 'Recommendations', value: String(totalRecommendations), icon: 'ri-lightbulb-line', colour: 'accent' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.colour === 'primary' ? 'bg-primary-100 text-primary-600' : s.colour === 'accent' ? 'bg-accent-100 text-accent-700' : s.colour === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports by title, category, ID..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Statuses</option>
              <option>Generated</option>
              <option>Draft</option>
              <option>Scheduled</option>
            </select>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Categories</option>
              <option>Compliance</option>
              <option>Evidence</option>
              <option>Funding</option>
              <option>Safeguarding</option>
              <option>Ofsted</option>
              <option>Performance</option>
              <option>Risk</option>
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> New Report
            </button>
          </div>
        </div>

        {/* Reports Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(report => (
            <div key={report.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 hover:border-background-300/60 transition-smooth">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${categoryColour(report.category)}`}>
                    <i className="ri-file-text-line text-sm"></i>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{report.title}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${categoryColour(report.category)}`}>{report.category}</span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColour(report.status)}`}>{report.status}</span>
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-foreground-400 font-mono">{report.id}</span>
              </div>
              <p className="text-[12px] text-foreground-600 mb-4">{report.description}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div>
                  <p className="text-[9px] text-foreground-400 uppercase">Last Generated</p>
                  <p className="text-[12px] font-medium text-foreground-700">{report.lastGenerated}</p>
                </div>
                <div>
                  <p className="text-[9px] text-foreground-400 uppercase">Format</p>
                  <p className="text-[12px] font-medium text-foreground-700">{report.format}</p>
                </div>
                <div>
                  <p className="text-[9px] text-foreground-400 uppercase">Findings</p>
                  <p className="text-[12px] font-medium text-foreground-700">{report.findings}</p>
                </div>
                <div>
                  <p className="text-[9px] text-foreground-400 uppercase">Recommendations</p>
                  <p className="text-[12px] font-medium text-foreground-700">{report.recommendations}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-background-200/30">
                <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                  <i className="ri-download-line mr-1"></i> Download
                </button>
                <button className="px-3 py-1.5 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap">
                  <i className="ri-edit-line mr-1"></i> Edit
                </button>
                <button className="px-3 py-1.5 border border-background-300 bg-background-50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap">
                  <i className="ri-share-line mr-1"></i> Share
                </button>
                <span className="text-[10px] text-foreground-400 ml-auto">By {report.generatedBy}</span>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i className="ri-file-text-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No audit reports found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}