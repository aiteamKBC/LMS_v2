import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Report {
  id: string;
  name: string;
  category: string;
  description: string;
  lastRun: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'On-demand';
  format: 'Excel' | 'CSV' | 'PDF';
  status: 'Ready' | 'Pending' | 'Error';
  size: string;
  recipients: string[];
}

const REPORTS: Report[] = [
  { id: 'r-1', name: 'ILR Extract', category: 'ILR', description: 'Full Individualised Learner Record extract for ESFA submission including all required fields.', lastRun: 'Today 08:30', frequency: 'Monthly', format: 'CSV', status: 'Ready', size: '245 KB', recipients: ['MIS Team', 'Compliance'] },
  { id: 'r-2', name: 'Cohort Attendance Summary', category: 'Attendance', description: 'Weekly attendance percentage by cohort with learner-level breakdown and catch-up flags.', lastRun: 'Yesterday 17:00', frequency: 'Weekly', format: 'Excel', status: 'Ready', size: '128 KB', recipients: ['MIS Team', 'Coaches', 'Leadership'] },
  { id: 'r-3', name: 'Funding Claim Summary', category: 'Finance', description: 'Monthly funding claim summary by programme with co-investment, employer contribution, and DAS tracking.', lastRun: '01 Jun 2026', frequency: 'Monthly', format: 'Excel', status: 'Ready', size: '312 KB', recipients: ['Finance', 'Leadership'] },
  { id: 'r-4', name: 'Learner Progress Tracker', category: 'Progress', description: 'Individual learner progress with module completion, KSB mapping, OTJH hours, and gateway readiness.', lastRun: 'Yesterday 16:30', frequency: 'Weekly', format: 'Excel', status: 'Ready', size: '567 KB', recipients: ['Coaches', 'Tutors', 'QA'] },
  { id: 'r-5', name: 'Tutor Delivery Report', category: 'Delivery', description: 'Tutor session delivery summary with attendance, marking turnaround, and learner satisfaction.', lastRun: 'Yesterday 17:00', frequency: 'Weekly', format: 'Excel', status: 'Ready', size: '189 KB', recipients: ['Leadership', 'QA'] },
  { id: 'r-6', name: 'Coach Caseload Report', category: 'Coaching', description: 'Coach caseload distribution with learner risk flags, meeting frequency, and engagement scores.', lastRun: 'Yesterday 17:00', frequency: 'Weekly', format: 'Excel', status: 'Ready', size: '156 KB', recipients: ['Leadership', 'MIS Team'] },
  { id: 'r-7', name: 'Data Quality Audit', category: 'Data Quality', description: 'Comprehensive data quality audit with ILR validation errors, missing fields, and compliance flags.', lastRun: 'Today 09:00', frequency: 'Daily', format: 'Excel', status: 'Ready', size: '98 KB', recipients: ['MIS Team', 'Compliance'] },
  { id: 'r-8', name: 'Employer Engagement Report', category: 'Employer', description: 'Employer engagement metrics including response times, signature status, and workplace confirmation.', lastRun: '01 Jun 2026', frequency: 'Monthly', format: 'PDF', status: 'Ready', size: '445 KB', recipients: ['Engagement', 'Leadership'] },
  { id: 'r-9', name: 'OTJH Compliance Report', category: 'OTJH', description: 'Off-the-job training hours compliance by cohort with funding risk analysis and intervention flags.', lastRun: 'Yesterday 17:00', frequency: 'Weekly', format: 'Excel', status: 'Ready', size: '234 KB', recipients: ['Coaches', 'Compliance', 'Finance'] },
  { id: 'r-10', name: 'KSB Progress Matrix', category: 'KSB', description: 'Knowledge, Skills, and Behaviours progress matrix with assessment status and evidence gaps.', lastRun: '01 Jun 2026', frequency: 'Monthly', format: 'Excel', status: 'Ready', size: '378 KB', recipients: ['Tutors', 'QA', 'Leadership'] },
  { id: 'r-11', name: 'DAS Reconciliation', category: 'Compliance', description: 'Digital Apprenticeship Service reconciliation with commitment statement, payment, and withdrawal tracking.', lastRun: '01 Jun 2026', frequency: 'Monthly', format: 'CSV', status: 'Pending', size: '-', recipients: ['Compliance', 'Finance'] },
  { id: 'r-12', name: 'Annual Performance Report', category: 'Performance', description: 'Annual performance summary with achievement rates, timely completion, and retention metrics.', lastRun: '01 Apr 2026', frequency: 'Quarterly', format: 'PDF', size: '2.4 MB', status: 'Ready', recipients: ['Leadership', 'Ofsted'] },
];

const statusColour = (s: Report['status']) => {
  switch (s) {
    case 'Ready': return 'bg-emerald-100 text-emerald-700';
    case 'Pending': return 'bg-primary-100 text-primary-700';
    case 'Error': return 'bg-rose-100 text-rose-700';
    default: return '';
  }
};

const categoryColour = (c: string) => {
  const map: Record<string, string> = {
    'ILR': 'bg-primary-100 text-primary-700',
    'Attendance': 'bg-accent-100 text-accent-700',
    'Finance': 'bg-emerald-100 text-emerald-700',
    'Progress': 'bg-secondary-100 text-secondary-700',
    'Delivery': 'bg-primary-100 text-primary-700',
    'Coaching': 'bg-amber-100 text-amber-700',
    'Data Quality': 'bg-rose-100 text-rose-700',
    'Employer': 'bg-secondary-100 text-secondary-700',
    'OTJH': 'bg-primary-100 text-primary-700',
    'KSB': 'bg-accent-100 text-accent-700',
    'Compliance': 'bg-primary-100 text-primary-700',
    'Performance': 'bg-emerald-100 text-emerald-700',
  };
  return map[c] || 'bg-foreground-100 text-foreground-500';
};

export default function MisReportsPage() {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = REPORTS.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === 'All' || r.category === filterCategory;
    const matchStatus = filterStatus === 'All' || r.status === filterStatus;
    return matchSearch && matchCategory && matchStatus;
  });

  const categories = Array.from(new Set(REPORTS.map(r => r.category)));

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Reports" pageSubtitle="Generate, schedule, and download MIS-specific reports for all operational needs"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Reports', value: String(REPORTS.length), icon: 'ri-bar-chart-box-line', color: 'primary' },
            { label: 'Ready', value: String(REPORTS.filter(r => r.status === 'Ready').length), icon: 'ri-check-line', color: 'accent' },
            { label: 'Pending', value: String(REPORTS.filter(r => r.status === 'Pending').length), icon: 'ri-time-line', color: 'secondary' },
            { label: 'Scheduled', value: String(REPORTS.filter(r => r.frequency !== 'On-demand').length), icon: 'ri-calendar-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search report, description..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              <option>All</option>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Ready', 'Pending', 'Error'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Reports List */}
        <div className="space-y-2">
          {filtered.map(report => {
            const isExpanded = expandedId === report.id;
            return (
              <div key={report.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${categoryColour(report.category)}`}>
                      <AppIcon className="ri-file-chart-line text-sm"></AppIcon>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{report.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${categoryColour(report.category)}`}>{report.category}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColour(report.status)}`}>{report.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{report.frequency} &middot; {report.format} &middot; {report.lastRun}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{report.size}</span>
                    <span className="text-foreground-300">|</span>
                    <span>{report.recipients.length} recipients</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : report.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <AppIcon className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></AppIcon>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Description</p>
                      <p className="text-[12px] text-foreground-700">{report.description}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Recipients</p>
                      <div className="flex flex-wrap gap-1">
                        {report.recipients.map(r => (
                          <span key={r} className="inline-block text-[10px] bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">{r}</span>
                        ))}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-3">
                        <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-download-line mr-1"></AppIcon> Download {report.format}
                        </button>
                        <button className="px-4 py-2 border border-background-300 bg-background-50 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-refresh-line mr-1"></AppIcon> Run Now
                        </button>
                        <button className="px-4 py-2 border border-background-300 bg-background-50 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-mail-line mr-1"></AppIcon> Send to Recipients
                        </button>
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