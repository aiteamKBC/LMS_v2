import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface DataQualityCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  severity: 'Error' | 'Warning' | 'Info';
  affectedRecords: number;
  affectedCohorts: string[];
  resolution: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  lastChecked: string;
  autoFixable: boolean;
}

const CHECKS: DataQualityCheck[] = [
  { id: 'dq-1', category: 'ILR', name: 'Missing ULN', description: 'Unique Learner Number (ULN) is required for all active learners. 3 learners missing ULN.', severity: 'Error', affectedRecords: 3, affectedCohorts: ['Cohort A — BA', 'Cohort C — BA'], resolution: 'Contact learner to obtain ULN or request from LRS', status: 'Open', lastChecked: 'Today', autoFixable: false },
  { id: 'dq-2', category: 'ILR', name: 'Invalid Postcode', description: 'Postcode format validation failed for 2 employer records.', severity: 'Error', affectedRecords: 2, affectedCohorts: ['Cohort B — DM'], resolution: 'Update employer address with valid postcode', status: 'In Progress', lastChecked: 'Today', autoFixable: false },
  { id: 'dq-3', category: 'ILR', name: 'Missing Prior Attainment', description: 'Prior attainment qualification required for ILR submission. 5 learners missing prior attainment data.', severity: 'Warning', affectedRecords: 5, affectedCohorts: ['Cohort A — BA', 'Cohort D — DT'], resolution: 'Request qualification certificates from learners', status: 'Open', lastChecked: 'Yesterday', autoFixable: false },
  { id: 'dq-4', category: 'Funding', name: 'Co-investment Mismatch', description: 'Co-investment amount does not match employer agreement. 2 records showing discrepancy.', severity: 'Error', affectedRecords: 2, affectedCohorts: ['Cohort E — EYE'], resolution: 'Reconcile co-investment with employer contract', status: 'Open', lastChecked: 'Today', autoFixable: false },
  { id: 'dq-5', category: 'Compliance', name: 'Unsigned Employer Agreement', description: 'Employer agreement not digitally signed. 1 employer has pending signature.', severity: 'Warning', affectedRecords: 1, affectedCohorts: ['Cohort F — SWE'], resolution: 'Send reminder to employer for digital signature', status: 'In Progress', lastChecked: 'Yesterday', autoFixable: false },
  { id: 'dq-6', category: 'Compliance', name: 'Missing OTJH Log', description: 'Off-the-job training hours not logged for 4 learners this month.', severity: 'Warning', affectedRecords: 4, affectedCohorts: ['Cohort B — DM', 'Cohort D — DT'], resolution: 'Prompt learners to log OTJH hours', status: 'Open', lastChecked: 'Today', autoFixable: false },
  { id: 'dq-7', category: 'Attendance', name: 'Low Attendance Flag', description: 'Learners with attendance below 85% threshold. 6 learners flagged.', severity: 'Warning', affectedRecords: 6, affectedCohorts: ['Cohort A — BA', 'Cohort B — DM'], resolution: 'Trigger engagement workflow and notify coach', status: 'Open', lastChecked: 'Today', autoFixable: false },
  { id: 'dq-8', category: 'Attendance', name: 'Duplicate Session', description: 'Duplicate session entry found in timetable. 1 duplicate detected.', severity: 'Info', affectedRecords: 1, affectedCohorts: ['Cohort C — BA'], resolution: 'Remove duplicate session entry', status: 'Resolved', lastChecked: '2 days ago', autoFixable: true },
  { id: 'dq-9', category: 'ILR', name: 'Missing End Date', description: 'Planned end date missing for 2 learners in completed cohort.', severity: 'Error', affectedRecords: 2, affectedCohorts: ['Cohort Z — PM'], resolution: 'Update planned end date from cohort records', status: 'Resolved', lastChecked: '3 days ago', autoFixable: true },
  { id: 'dq-10', category: 'Funding', name: 'DAS Record Mismatch', description: 'DAS apprentice record does not match platform data. 1 record mismatch.', severity: 'Error', affectedRecords: 1, affectedCohorts: ['Cohort A — BA'], resolution: 'Sync DAS record with platform data', status: 'In Progress', lastChecked: 'Today', autoFixable: true },
  { id: 'dq-11', category: 'Compliance', name: 'Expired Safeguarding', description: 'Safeguarding certificate expired for 1 tutor.', severity: 'Warning', affectedRecords: 1, affectedCohorts: ['Cohort E — EYE'], resolution: 'Request updated safeguarding certificate', status: 'Open', lastChecked: 'Yesterday', autoFixable: false },
  { id: 'dq-12', category: 'ILR', name: 'Duplicate ULN', description: 'Duplicate ULN found across 2 learner records.', severity: 'Error', affectedRecords: 2, affectedCohorts: ['Cohort A — BA', 'Cohort C — BA'], resolution: 'Verify correct ULN and update records', status: 'Open', lastChecked: 'Today', autoFixable: false },
];

const severityColour = (s: DataQualityCheck['severity']) => {
  switch (s) {
    case 'Error': return 'bg-rose-100 text-rose-700';
    case 'Warning': return 'bg-amber-100 text-amber-700';
    case 'Info': return 'bg-primary-100 text-primary-700';
    default: return '';
  }
};

const statusColour = (s: DataQualityCheck['status']) => {
  switch (s) {
    case 'Open': return 'bg-rose-100 text-rose-700';
    case 'In Progress': return 'bg-primary-100 text-primary-700';
    case 'Resolved': return 'bg-emerald-100 text-emerald-700';
    default: return '';
  }
};

export default function MisDataQualityPage() {
  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFix, setShowFix] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = CHECKS.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase());
    const matchSeverity = filterSeverity === 'All' || c.severity === filterSeverity;
    const matchCategory = filterCategory === 'All' || c.category === filterCategory;
    const matchStatus = filterStatus === 'All' || c.status === filterStatus;
    return matchSearch && matchSeverity && matchCategory && matchStatus;
  });

  const categories = Array.from(new Set(CHECKS.map(c => c.category)));
  const openErrors = CHECKS.filter(c => c.status === 'Open' && c.severity === 'Error').length;
  const openWarnings = CHECKS.filter(c => c.status === 'Open' && c.severity === 'Warning').length;
  const resolved = CHECKS.filter(c => c.status === 'Resolved').length;
  const autoFixable = CHECKS.filter(c => c.autoFixable && c.status !== 'Resolved').length;

  const handleFix = (id: string) => {
    setToast(`Data quality check ${CHECKS.find(c => c.id === id)?.name} has been resolved`);
    setShowFix(null);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Data Quality" pageSubtitle="Run data quality checks, resolve ILR errors, and fix compliance issues"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open Errors', value: String(openErrors), icon: 'ri-error-warning-line', color: 'primary' },
            { label: 'Open Warnings', value: String(openWarnings), icon: 'ri-alert-line', color: 'accent' },
            { label: 'Resolved', value: String(resolved), icon: 'ri-check-line', color: 'secondary' },
            { label: 'Auto-fixable', value: String(autoFixable), icon: 'ri-magic-line', color: 'primary' },
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search check, description..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              <option>All</option>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Error', 'Warning', 'Info'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'Open', 'In Progress', 'Resolved'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-refresh-line mr-1"></i> Run Checks
            </button>
          </div>
        </div>

        {/* Checks List */}
        <div className="space-y-2">
          {filtered.map(check => {
            const isExpanded = expandedId === check.id;
            return (
              <div key={check.id} className={`bg-background-50 rounded-xl border overflow-hidden ${check.severity === 'Error' ? 'border-rose-200/50 bg-rose-50/10' : check.severity === 'Warning' ? 'border-amber-200/50 bg-amber-50/10' : 'border-foreground-200/60'}`}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${severityColour(check.severity)}`}>
                      <i className={check.severity === 'Error' ? 'ri-error-warning-line text-sm' : check.severity === 'Warning' ? 'ri-alert-line text-sm' : 'ri-information-line text-sm'}></i>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{check.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${severityColour(check.severity)}`}>{check.severity}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColour(check.status)}`}>{check.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{check.category} &middot; {check.affectedRecords} records &middot; {check.affectedCohorts.join(', ')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>Checked: {check.lastChecked}</span>
                    {check.autoFixable && check.status !== 'Resolved' && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">Auto-fixable</span>
                    )}
                    <button onClick={() => setExpandedId(isExpanded ? null : check.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></i>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Description</p>
                      <p className="text-[12px] text-foreground-700">{check.description}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Resolution</p>
                      <p className="text-[12px] text-foreground-700">{check.resolution}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-3">
                        {check.status !== 'Resolved' && (
                          <button onClick={() => { setShowFix(check.id); }} className="px-4 py-2 bg-accent-500 text-white rounded-lg text-[12px] font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap">
                            <i className="ri-check-line mr-1"></i> Mark Resolved
                          </button>
                        )}
                        {check.autoFixable && check.status !== 'Resolved' && (
                          <button onClick={() => handleFix(check.id)} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                            <i className="ri-magic-line mr-1"></i> Auto Fix
                          </button>
                        )}
                        <button className="px-4 py-2 border border-background-300 bg-background-50 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap">
                          <i className="ri-file-list-line mr-1"></i> View Records
                        </button>
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
              <i className="ri-check-double-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No data quality issues found</p>
            <p className="text-[12px] text-foreground-400 mt-1">All checks pass with current filters</p>
          </div>
        )}
      </div>

      {/* Fix Modal */}
      {showFix && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Mark Resolved</h2>
              <button onClick={() => setShowFix(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <i className="ri-close-line text-foreground-500"></i>
              </button>
            </div>
            <p className="text-[13px] text-foreground-600 mb-4">Are you sure you want to mark <strong className="text-foreground-900">{CHECKS.find(c => c.id === showFix)?.name}</strong> as resolved?</p>
            <div className="mb-4">
              <label className="block text-[11px] font-medium text-foreground-600 mb-1">Resolution Notes</label>
              <textarea placeholder="How was this resolved?" className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-300 focus:outline-none focus:border-primary-400" rows={3} maxLength={500}></textarea>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowFix(null)} className="px-4 py-2 text-[12px] font-medium text-foreground-600 bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={() => handleFix(showFix)} className="px-4 py-2 text-[12px] font-semibold text-white bg-accent-500 rounded-lg hover:bg-accent-600 cursor-pointer whitespace-nowrap">Mark Resolved</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-2">
          <i className="ri-check-line"></i>
          <span className="text-[13px] font-medium">{toast}</span>
        </div>
      )}
    </WorkspaceShell>
  );
}