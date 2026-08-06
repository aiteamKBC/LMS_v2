import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { PRE_ACTIVE_LEARNERS, PRE_ACTIVE_STATS } from '@/mocks/pre-active-learners';
import type { PreActiveLearner } from '@/mocks/pre-active-learners';
import { CaseHeader } from './components/CaseHeader';
import { JourneyTimeline } from './components/JourneyTimeline';
import { LearnerList } from './components/LearnerList';

const complianceNav = roleNavMap.compliance;

export default function PreActiveLearnerJourneyPage() {
  const [selectedLearner, setSelectedLearner] = useState<PreActiveLearner>(PRE_ACTIVE_LEARNERS[0]);

  return (
    <WorkspaceShell
      role="compliance"
      roleLabel={complianceNav.label}
      navItems={complianceNav.items}
      workspaceLabel={complianceNav.workspaceLabel}
      pageTitle="Pre-Active Learner Journey"
      pageSubtitle="Manage learners through the 15-stage pre-active pipeline — from lead to activation"
      userName="Eleanor Hart"
      userRole="Compliance Officer"
    >
      <div className="p-6 space-y-5">
        {/* Stats banner */}
        <StatsBanner />

        {/* Selected learner case header */}
        <CaseHeader learner={selectedLearner} />

        {/* Two column: journey timeline + learner list */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <JourneyTimeline learner={selectedLearner} />
          </div>
          <div>
            <LearnerList
              selectedId={selectedLearner.id}
              onSelect={setSelectedLearner}
            />
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function StatsBanner() {
  const stats = [
    { label: 'Total Pre-Active', value: PRE_ACTIVE_STATS.total, icon: 'ri-user-line', color: 'primary' as const },
    { label: 'Ready for Activation', value: PRE_ACTIVE_STATS.readyForActivation, icon: 'ri-rocket-line', color: 'accent' as const },
    { label: 'Overdue Actions', value: PRE_ACTIVE_STATS.overdueActions, icon: 'ri-alert-line', color: 'secondary' as const },
    { label: 'At High Risk', value: PRE_ACTIVE_STATS.byRisk.high, icon: 'ri-error-warning-line', color: 'secondary' as const },
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