import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { ENROLMENT_REVIEW_STATS } from '@/mocks/enrolment-review';
import { ENROLMENT_REVIEW_LEARNERS } from '@/mocks/enrolment-review-data';
import type { EnrolmentReviewRecord } from '@/mocks/enrolment-review';
import { EnrolmentReviewHeader } from './components/EnrolmentReviewHeader';
import { ReviewChecklist } from './components/ReviewChecklist';
import { ReviewActions } from './components/ReviewActions';

const complianceNav = roleNavMap.compliance;

const TABS = [
  { id: 'checklist', label: 'Review Checklist' },
  { id: 'actions', label: 'Actions & Notes' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function EnrolmentReviewPage() {
  const [selectedRecord, setSelectedRecord] = useState<EnrolmentReviewRecord>(ENROLMENT_REVIEW_LEARNERS[0]);
  const [activeTab, setActiveTab] = useState<TabId>('checklist');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const filteredRecords = ENROLMENT_REVIEW_LEARNERS.filter(r => {
    if (searchQuery && !r.learnerName.toLowerCase().includes(searchQuery.toLowerCase()) && !r.employer.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== 'all' && r.overallStatus !== statusFilter) return false;
    if (riskFilter !== 'all' && r.riskStatus !== riskFilter) return false;
    return true;
  });

  const activeStatuses = [...new Set(ENROLMENT_REVIEW_LEARNERS.map(r => r.overallStatus))];

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={complianceNav.label}
      navItems={complianceNav.items}
      workspaceLabel={complianceNav.workspaceLabel}
      pageTitle="Enrolment Team Review"
      pageSubtitle="Review learner onboarding submissions — 15-item checklist across personal details, employment, documents, and compliance readiness"
      userName="Eleanor Hart"
      userRole="Compliance Officer"
    >
      <div className="p-6 space-y-5">
        {/* Stats banner */}
        <StatsBanner />

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Left: Records list */}
          <div className="lg:col-span-1">
            <RecordsList
              records={filteredRecords}
              selectedId={selectedRecord.id}
              onSelect={setSelectedRecord}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              riskFilter={riskFilter}
              onRiskFilterChange={setRiskFilter}
              activeStatuses={activeStatuses}
            />
          </div>

          {/* Right: Detail panel */}
          <div className="lg:col-span-3 space-y-5">
            {/* Case Header */}
            <EnrolmentReviewHeader record={selectedRecord} />

            {/* Tab Navigation */}
            <div className="flex items-center gap-1 p-1 bg-background-100 rounded-full w-fit">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-background-50 text-foreground-900 shadow-sm'
                      : 'text-foreground-400 hover:text-foreground-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'checklist' && (
              <div className="max-w-3xl">
                <ReviewChecklist record={selectedRecord} />
              </div>
            )}
            {activeTab === 'actions' && (
              <div className="max-w-3xl">
                <ReviewActions record={selectedRecord} />
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function StatsBanner() {
  const stats = [
    { label: 'Total In Review', value: ENROLMENT_REVIEW_STATS.totalInReview, icon: 'ri-user-line', color: 'primary' as const },
    { label: 'Ready for Eligibility', value: ENROLMENT_REVIEW_STATS.readyForEligibility, icon: 'ri-check-line', color: 'accent' as const },
    { label: 'Missing Information', value: ENROLMENT_REVIEW_STATS.missingInfo, icon: 'ri-error-warning-line', color: 'secondary' as const },
    { label: 'High Risk', value: ENROLMENT_REVIEW_STATS.highRisk, icon: 'ri-alert-line', color: 'secondary' as const },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(stat => {
        const iconBg = stat.color === 'primary' ? 'bg-primary-100 text-primary-600'
          : stat.color === 'accent' ? 'bg-accent-50 text-accent-700'
          : 'bg-secondary-100 text-secondary-600';

        return (
          <div key={stat.label} className="bg-background-50 rounded-xl border border-background-200/50 p-3.5 card-premium cursor-pointer">
            <div className="flex items-center gap-3">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
                <i className={`${stat.icon} text-sm`}></i>
              </span>
              <div className="min-w-0">
                <p className="text-2xl font-heading font-semibold text-foreground-900">{stat.value}</p>
                <p className="text-[11px] text-foreground-400 truncate">{stat.label}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecordsList({
  records,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  riskFilter,
  onRiskFilterChange,
  activeStatuses,
}: {
  records: EnrolmentReviewRecord[];
  selectedId: string;
  onSelect: (r: EnrolmentReviewRecord) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  riskFilter: string;
  onRiskFilterChange: (r: string) => void;
  activeStatuses: string[];
}) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Enrolment Records</h3>
        <span className="text-[10px] font-medium text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{records.length} record{records.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search learner or employer..."
          className="w-full pl-9 pr-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 transition-smooth text-sm"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3">
        <select
          value={statusFilter}
          onChange={e => onStatusFilterChange(e.target.value)}
          className="flex-1 text-[11px] text-foreground-600 bg-background-50 border border-foreground-200 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:border-primary-300/60"
        >
          <option value="all">All statuses</option>
          {activeStatuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={riskFilter}
          onChange={e => onRiskFilterChange(e.target.value)}
          className="flex-1 text-[11px] text-foreground-600 bg-background-50 border border-foreground-200 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:border-primary-300/60"
        >
          <option value="all">All risks</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
        </select>
      </div>

      {/* Card list */}
      <div className="space-y-2 max-h-[calc(100vh-420px)] overflow-y-auto pr-1">
        {records.map(r => {
          const passCount = r.checkItems.filter(c => c.result === 'pass').length;
          const failCount = r.checkItems.filter(c => c.result === 'fail').length;
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className={`w-full text-left px-3 py-3 rounded-lg border transition-smooth cursor-pointer ${
                selectedId === r.id
                  ? 'border-primary-300/60 bg-primary-50/40 shadow-sm'
                  : 'border-foreground-200/60 bg-background-50 hover:border-background-300/60 hover:bg-background-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-[13px] font-medium text-foreground-800 truncate">{r.learnerName}</p>
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                  r.riskStatus === 'High' ? 'bg-red-500' : r.riskStatus === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
                }`} title={`Risk: ${r.riskStatus}`}></span>
              </div>
              <p className="text-[11px] text-foreground-400 truncate">{r.programme.split(' Level')[0]}</p>
              <p className="text-[10px] text-foreground-300 truncate mb-1.5">{r.employer}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={r.overallStatus} />
                {r.checksCompleted > 0 && (
                  <span className="text-[10px] text-foreground-400">{passCount}/{r.totalChecks} pass · {failCount} fail</span>
                )}
              </div>
            </button>
          );
        })}
        {records.length === 0 && (
          <p className="text-[12px] text-foreground-400 text-center py-6">No records match filters</p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = getBadgeConfig(status);
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${config.bg} ${config.text}`}>
      {status}
    </span>
  );
}

function getBadgeConfig(status: string): { bg: string; text: string } {
  if (/submitted|under.*review/i.test(status)) {
    return { bg: 'bg-primary-50', text: 'text-primary-600' };
  }
  if (/ready/i.test(status)) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-600' };
  }
  if (/returned|missing/i.test(status)) {
    return { bg: 'bg-amber-50', text: 'text-amber-600' };
  }
  if (/rejected/i.test(status)) {
    return { bg: 'bg-red-50', text: 'text-red-600' };
  }
  if (/escalated/i.test(status)) {
    return { bg: 'bg-secondary-50', text: 'text-secondary-600' };
  }
  return { bg: 'bg-background-200', text: 'text-foreground-400' };
}