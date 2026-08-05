import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { ONBOARDING_STATS } from '@/mocks/self-onboarding';
import { SELF_ONBOARDING_LEARNERS } from '@/mocks/self-onboarding-learners';
import type { SelfOnboardingLearner } from '@/mocks/self-onboarding';
import { OnboardingHeader } from './components/OnboardingHeader';
import { OnboardingForm } from './components/OnboardingForm';
import { PolicyTracker } from './components/PolicyTracker';
import { EvidenceTracker } from './components/EvidenceTracker';

const complianceNav = roleNavMap.compliance;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'form', label: 'Full Form' },
  { id: 'policies', label: 'Policy Acknowledgements' },
  { id: 'evidence', label: 'Evidence Uploads' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function SelfOnboardingPage() {
  const [selectedLearner, setSelectedLearner] = useState<SelfOnboardingLearner>(SELF_ONBOARDING_LEARNERS[0]);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const filteredLearners = SELF_ONBOARDING_LEARNERS.filter(l => {
    if (searchQuery && !l.learnerName.toLowerCase().includes(searchQuery.toLowerCase()) && !l.employer.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== 'all' && l.overallStatus !== statusFilter) return false;
    if (riskFilter !== 'all' && l.riskStatus !== riskFilter) return false;
    return true;
  });

  const activeStatuses = [...new Set(SELF_ONBOARDING_LEARNERS.map(l => l.overallStatus))];

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={complianceNav.label}
      navItems={complianceNav.items}
      workspaceLabel={complianceNav.workspaceLabel}
      pageTitle="Learner Self-Onboarding"
      pageSubtitle="Review learner onboarding submissions — 22 sections across personal details, employment, support, policies, evidence, and declarations"
      userName="Eleanor Hart"
      userRole="Compliance Officer"
    >
      <div className="p-6 space-y-5">
        {/* Stats banner */}
        <StatsBanner />

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Left: Learner list */}
          <div className="lg:col-span-1">
            <LearnerList
              learners={filteredLearners}
              selectedId={selectedLearner.id}
              onSelect={setSelectedLearner}
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
            <OnboardingHeader learner={selectedLearner} />

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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="lg:col-span-2">
                  <OnboardingForm learner={selectedLearner} />
                </div>
              </div>
            )}
            {activeTab === 'form' && (
              <OnboardingForm learner={selectedLearner} />
            )}
            {activeTab === 'policies' && (
              <div className="max-w-2xl">
                <PolicyTracker policies={selectedLearner.policyAcknowledgements} learnerName={selectedLearner.learnerName} />
              </div>
            )}
            {activeTab === 'evidence' && (
              <div className="max-w-2xl">
                <EvidenceTracker learner={selectedLearner} />
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
    { label: 'Total Learners', value: ONBOARDING_STATS.total, icon: 'ri-user-line', color: 'primary' as const },
    { label: 'Submitted', value: ONBOARDING_STATS.submitted, icon: 'ri-send-plane-line', color: 'accent' as const },
    { label: 'In Progress', value: ONBOARDING_STATS.inProgress, icon: 'ri-loader-4-line', color: 'secondary' as const },
    { label: 'Missing Info / Returned', value: ONBOARDING_STATS.missingInfo + ONBOARDING_STATS.returnedForCorrection, icon: 'ri-alert-line', color: 'secondary' as const },
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
                <AppIcon className={`${stat.icon} text-sm`}></AppIcon>
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

function LearnerList({
  learners,
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
  learners: SelfOnboardingLearner[];
  selectedId: string;
  onSelect: (l: SelfOnboardingLearner) => void;
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
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Onboarding Records</h3>
        <span className="text-[10px] font-medium text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{learners.length} learner{learners.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
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
        {learners.map(l => (
          <button
            key={l.id}
            onClick={() => onSelect(l)}
            className={`w-full text-left px-3 py-3 rounded-lg border transition-smooth cursor-pointer ${
              selectedId === l.id
                ? 'border-primary-300/60 bg-primary-50/40 shadow-sm'
                : 'border-background-200/40 bg-background-50 hover:border-background-300/60 hover:bg-background-50'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[13px] font-medium text-foreground-800 truncate">{l.learnerName}</p>
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${
                l.riskStatus === 'High' ? 'bg-red-500' : l.riskStatus === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
              }`} title={`Risk: ${l.riskStatus}`}></span>
            </div>
            <p className="text-[11px] text-foreground-400 truncate">{l.programme.split(' Level')[0]}</p>
            <p className="text-[10px] text-foreground-300 truncate mb-1.5">{l.employer}</p>
            <div className="flex items-center gap-2">
              <StatusBadge status={l.overallStatus} />
              <span className="text-[10px] text-foreground-400">{l.sectionsComplete}/{l.totalSections}</span>
            </div>
          </button>
        ))}
        {learners.length === 0 && (
          <p className="text-[12px] text-foreground-400 text-center py-6">No learners match filters</p>
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
  if (/approved|submitted/i.test(status) && !/returned/i.test(status)) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-600' };
  }
  if (/in progress|under review/i.test(status)) {
    return { bg: 'bg-primary-50', text: 'text-primary-600' };
  }
  if (/returned|missing/i.test(status)) {
    return { bg: 'bg-amber-50', text: 'text-amber-600' };
  }
  if (/rejected|escalated/i.test(status)) {
    return { bg: 'bg-red-50', text: 'text-red-600' };
  }
  return { bg: 'bg-background-200', text: 'text-foreground-400' };
}