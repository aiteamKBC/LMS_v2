import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EMPLOYER_CONTRACTING_RECORDS, CONTRACTING_STATS } from '@/mocks/employer-contracting';
import type { EmployerContractingRecord } from '@/mocks/employer-contracting';
import { EmployerCaseHeader } from './components/EmployerCaseHeader';
import { ContractingTimeline } from './components/ContractingTimeline';
import { ContractingForm } from './components/ContractingForm';
import { DocumentTracker } from './components/DocumentTracker';

const complianceNav = roleNavMap.compliance;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'form', label: 'Employer Details' },
  { id: 'documents', label: 'Documents' },
  { id: 'timeline', label: 'Status Timeline' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function EmployerContractingPage() {
  const [selectedRecord, setSelectedRecord] = useState<EmployerContractingRecord>(EMPLOYER_CONTRACTING_RECORDS[0]);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const filteredRecords = EMPLOYER_CONTRACTING_RECORDS.filter(r => {
    if (searchQuery && !r.employerLegalName.toLowerCase().includes(searchQuery.toLowerCase()) && !r.learnerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== 'all' && r.currentStatus !== statusFilter) return false;
    if (riskFilter !== 'all' && r.riskStatus !== riskFilter) return false;
    return true;
  });

  const activeStatuses = [...new Set(EMPLOYER_CONTRACTING_RECORDS.map(r => r.currentStatus))];

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={complianceNav.label}
      navItems={complianceNav.items}
      workspaceLabel={complianceNav.workspaceLabel}
      pageTitle="Employer Contracting"
      pageSubtitle="Manage employer contracts, workplace validation, and DAS setup — from detail capture to signed agreement"
      userName="Eleanor Hart"
      userRole="Compliance Officer"
    >
      <div className="p-6 space-y-5">
        {/* Stats banner */}
        <StatsBanner />

        {/* Main layout: left sidebar (records list) + right panel (detail) */}
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
            <EmployerCaseHeader record={selectedRecord} />

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
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2">
                  <ContractingTimeline record={selectedRecord} />
                </div>
                <div>
                  <DocumentTracker record={selectedRecord} />
                </div>
              </div>
            )}
            {activeTab === 'form' && <ContractingForm record={selectedRecord} />}
            {activeTab === 'documents' && (
              <div className="max-w-2xl">
                <DocumentTracker record={selectedRecord} />
              </div>
            )}
            {activeTab === 'timeline' && (
              <div className="max-w-2xl">
                <ContractingTimeline record={selectedRecord} />
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
    { label: 'Total Employers', value: CONTRACTING_STATS.total, icon: 'ri-building-2-line', color: 'primary' as const },
    { label: 'Ready for Onboarding', value: CONTRACTING_STATS.readyForOnboarding, icon: 'ri-rocket-line', color: 'accent' as const },
    { label: 'Awaiting Signature', value: CONTRACTING_STATS.awaitingSignature, icon: 'ri-pen-nib-line', color: 'secondary' as const },
    { label: 'Overdue Actions', value: CONTRACTING_STATS.overdueActions, icon: 'ri-alert-line', color: 'secondary' as const },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(stat => {
        const iconBg = stat.color === 'primary' ? 'bg-primary-100 text-primary-600'
          : stat.color === 'accent' ? 'bg-accent-50 text-accent-700'
          : 'bg-secondary-100 text-secondary-600';

        return (
          <div key={stat.label} className="coach-metric-card cursor-pointer">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
                <AppIcon className={`${stat.icon} text-sm`}></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-foreground-500">{stat.label}</p>
                <p className="mt-1 text-[25px] font-semibold leading-none tabular-nums text-foreground-900">{stat.value}</p>
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
  records: EmployerContractingRecord[];
  selectedId: string;
  onSelect: (r: EmployerContractingRecord) => void;
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
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Employer Records</h3>
        <span className="text-[10px] font-medium text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{records.length} record{records.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search employer or learner..."
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
        {records.map(r => (
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
              <p className="text-[13px] font-medium text-foreground-800 truncate">{r.employerLegalName}</p>
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                r.riskStatus === 'High' ? 'bg-red-500' : r.riskStatus === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
              }`} title={`Risk: ${r.riskStatus}`}></span>
            </div>
            <p className="text-[11px] text-foreground-400 truncate">{r.learnerName} · {r.programme.split(' Level')[0]}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <StatusBadge status={r.currentStatus} />
            </div>
          </button>
        ))}
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
  if (/signed|ready/i.test(status) && !/awaiting/i.test(status)) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-600' };
  }
  if (/sent|awaiting|in review/i.test(status)) {
    return { bg: 'bg-amber-50', text: 'text-amber-600' };
  }
  if (/required|missing|failed|invalid|action required/i.test(status)) {
    return { bg: 'bg-red-50', text: 'text-red-600' };
  }
  return { bg: 'bg-background-100', text: 'text-foreground-400' };
}
