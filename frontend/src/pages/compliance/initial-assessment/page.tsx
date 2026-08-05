import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { INITIAL_ASSESSMENT_STATS } from '@/mocks/initial-assessment';
import { INITIAL_ASSESSMENT_LEARNERS } from '@/mocks/initial-assessment-data';
import type { InitialAssessmentRecord } from '@/mocks/initial-assessment';
import { InitialAssessmentHeader } from './components/InitialAssessmentHeader';
import { BKSBPanel } from './components/BKSBPanel';
import { LearningStylePanel } from './components/LearningStylePanel';
import { ReadinessScore } from './components/ReadinessScore';

const complianceNav = roleNavMap.compliance;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'bksb', label: 'BKSB Results' },
  { id: 'support', label: 'Support & Style' },
  { id: 'history', label: 'History' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function InitialAssessmentPage() {
  const [selectedRecord, setSelectedRecord] = useState<InitialAssessmentRecord>(INITIAL_ASSESSMENT_LEARNERS[0]);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const filteredRecords = INITIAL_ASSESSMENT_LEARNERS.filter(r => {
    if (searchQuery && !r.learnerName.toLowerCase().includes(searchQuery.toLowerCase()) && !r.employer.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== 'all' && r.overallStatus !== statusFilter) return false;
    if (riskFilter !== 'all' && r.riskStatus !== riskFilter) return false;
    return true;
  });

  const activeStatuses = [...new Set(INITIAL_ASSESSMENT_LEARNERS.map(r => r.overallStatus))];

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={complianceNav.label}
      navItems={complianceNav.items}
      workspaceLabel={complianceNav.workspaceLabel}
      pageTitle="Initial Assessment"
      pageSubtitle="BKSB English & Maths diagnostics, learning style assessment, and programme readiness scoring"
      userName="Marcus Webb"
      userRole="Skills Assessor"
    >
      <div className="p-6 space-y-5">
        <StatsBanner />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
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

          <div className="lg:col-span-3 space-y-5">
            <InitialAssessmentHeader record={selectedRecord} />

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

            <div className="max-w-3xl space-y-5">
              {activeTab === 'overview' && (
                <>
                  <BKSBPanel results={selectedRecord.bksbResults} />
                  <ReadinessScore readiness={selectedRecord.readiness} />
                  <LearningStylePanel
                    profile={selectedRecord.learningStyle}
                    supportRequirements={selectedRecord.supportRequirements}
                    diagnosticSummary={selectedRecord.diagnosticSummary}
                    assessorRecommendation={selectedRecord.assessorRecommendation}
                  />
                </>
              )}
              {activeTab === 'bksb' && (
                <BKSBPanel results={selectedRecord.bksbResults} />
              )}
              {activeTab === 'support' && (
                <div className="space-y-5">
                  <ReadinessScore readiness={selectedRecord.readiness} />
                  <LearningStylePanel
                    profile={selectedRecord.learningStyle}
                    supportRequirements={selectedRecord.supportRequirements}
                    diagnosticSummary={selectedRecord.diagnosticSummary}
                    assessorRecommendation={selectedRecord.assessorRecommendation}
                  />
                </div>
              )}
              {activeTab === 'history' && (
                <ActionHistory actions={selectedRecord.actionHistory} notes={selectedRecord.notes} />
              )}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function StatsBanner() {
  const stats = [
    { label: 'Total Assessed', value: INITIAL_ASSESSMENT_STATS.totalAssessed, icon: 'ri-clipboard-line', color: 'primary' as const },
    { label: 'Ready for Programme', value: INITIAL_ASSESSMENT_STATS.readyForProgramme, icon: 'ri-check-line', color: 'accent' as const },
    { label: 'Requires LSP', value: INITIAL_ASSESSMENT_STATS.requiresLSP, icon: 'ri-user-heart-line', color: 'secondary' as const },
    { label: 'Below Required', value: INITIAL_ASSESSMENT_STATS.belowRequired, icon: 'ri-arrow-down-line', color: 'secondary' as const },
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

function RecordsList({
  records, selectedId, onSelect, searchQuery, onSearchChange, statusFilter, onStatusFilterChange, riskFilter, onRiskFilterChange, activeStatuses,
}: {
  records: InitialAssessmentRecord[]; selectedId: string; onSelect: (r: InitialAssessmentRecord) => void;
  searchQuery: string; onSearchChange: (q: string) => void;
  statusFilter: string; onStatusFilterChange: (s: string) => void;
  riskFilter: string; onRiskFilterChange: (r: string) => void;
  activeStatuses: string[];
}) {
  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Assessment Records</h3>
        <span className="text-[10px] font-medium text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{records.length} record{records.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="relative mb-3">
        <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
        <input type="text" value={searchQuery} onChange={e => onSearchChange(e.target.value)} placeholder="Search learner or employer..."
          className="w-full pl-9 pr-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 transition-smooth text-sm"
        />
      </div>
      <div className="flex gap-2 mb-3">
        <select value={statusFilter} onChange={e => onStatusFilterChange(e.target.value)} className="flex-1 text-[11px] text-foreground-600 bg-background-50 border border-foreground-200 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:border-primary-300/60">
          <option value="all">All statuses</option>
          {activeStatuses.map(s => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select value={riskFilter} onChange={e => onRiskFilterChange(e.target.value)} className="flex-1 text-[11px] text-foreground-600 bg-background-50 border border-foreground-200 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:border-primary-300/60">
          <option value="all">All risks</option>
          <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
        </select>
      </div>
      <div className="space-y-2 max-h-[calc(100vh-420px)] overflow-y-auto pr-1">
        {records.map(r => (
          <button key={r.id} onClick={() => onSelect(r)}
            className={`w-full text-left px-3 py-3 rounded-lg border transition-smooth cursor-pointer ${
              selectedId === r.id ? 'border-primary-300/60 bg-primary-50/40 shadow-sm' : 'border-foreground-200/60 bg-background-50 hover:border-background-300/60 hover:bg-background-50'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[13px] font-medium text-foreground-800 truncate">{r.learnerName}</p>
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1 ${r.riskStatus === 'High' ? 'bg-red-500' : r.riskStatus === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
            </div>
            <p className="text-[11px] text-foreground-400 truncate">{r.programme.split(' Level')[0]}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <StatusBadge status={r.overallStatus} />
              {r.readiness.percentage > 0 && (
                <span className="text-[10px] text-foreground-400">{r.readiness.percentage}% readiness</span>
              )}
            </div>
          </button>
        ))}
        {records.length === 0 && <p className="text-[12px] text-foreground-400 text-center py-6">No records match filters</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = getBadgeConfig(status);
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${config.bg} ${config.text}`}>{status}</span>;
}

function getBadgeConfig(status: string): { bg: string; text: string } {
  if (/ready.*programme/i.test(status)) return { bg: 'bg-emerald-50', text: 'text-emerald-600' };
  if (/assessed|awaiting/i.test(status)) return { bg: 'bg-primary-50', text: 'text-primary-600' };
  if (/below|not started/i.test(status)) return { bg: 'bg-red-50', text: 'text-red-600' };
  if (/lsp/i.test(status)) return { bg: 'bg-amber-50', text: 'text-amber-600' };
  if (/escalated/i.test(status)) return { bg: 'bg-secondary-50', text: 'text-secondary-600' };
  return { bg: 'bg-background-200', text: 'text-foreground-400' };
}

function ActionHistory({ actions, notes }: {
  actions: { action: string; by: string; timestamp: string; detail: string }[];
  notes: { author: string; text: string; timestamp: string; visibility: string }[];
}) {
  const allItems = [
    ...actions.map(a => ({ ...a, type: 'action' as const })),
    ...notes.map(n => ({ action: 'Note added', by: n.author, timestamp: n.timestamp, detail: n.text, type: 'note' as const, visibility: n.visibility })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <h3 className="text-[15px] font-heading font-semibold text-foreground-900 mb-4">Action History</h3>
      <div className="space-y-0">
        {allItems.map((item, i) => (
          <div key={i} className={`flex gap-3 py-3 ${i < allItems.length - 1 ? 'border-b border-background-100' : ''}`}>
            <div className="flex flex-col items-center">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                item.type === 'note' ? 'bg-primary-50 text-primary-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                <AppIcon className={item.type === 'note' ? 'ri-chat-1-line text-xs' : 'ri-check-line text-xs'}></AppIcon>
              </span>
              {i < allItems.length - 1 && <div className="w-px flex-1 bg-background-200 mt-1 mb-1"></div>}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[13px] font-medium text-foreground-800">{item.action}</p>
                {item.type === 'note' && 'visibility' in item && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-400">{item.visibility}</span>
                )}
              </div>
              <p className="text-[12px] text-foreground-500 mt-0.5">{item.detail}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-foreground-400">{item.by}</span>
                <span className="text-[8px] text-foreground-300">&middot;</span>
                <span className="text-[10px] text-foreground-400">{formatDate(item.timestamp)}</span>
              </div>
            </div>
          </div>
        ))}
        {allItems.length === 0 && <p className="text-[12px] text-foreground-400 text-center py-6">No history yet</p>}
      </div>
    </section>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}