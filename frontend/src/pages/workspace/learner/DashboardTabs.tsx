import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode, type KeyboardEvent } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { DashboardPlanState } from './useDashboardPlan';
import styles from './DashboardTabs.module.css';

const OverviewTab = lazy(() => import('./tabs/DashboardOverviewTab'));
const WeeklyTab = lazy(() => import('./tabs/DashboardWeeklyTab'));
const MonthlyTab = lazy(() => import('./tabs/DashboardMonthlyTab'));
const TrainingTab = lazy(() => import('./tabs/DashboardTrainingTab'));
const RewardsTab = lazy(() => import('./tabs/DashboardRewardsTab'));

export type DashboardTabId = 'overview' | 'weekly' | 'monthly' | 'training' | 'rewards';
const tabs: { id: DashboardTabId; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'weekly', label: 'Weekly Learning' }, { id: 'monthly', label: 'Monthly Plan' },
  { id: 'training', label: 'Training Plan' }, { id: 'rewards', label: 'Rewards' },
];

export type DashboardTabsProps = {
  kind: LearnerKind; learnerId: string; plan: DashboardPlanState; programmeStartDate?: string | null; programmeEndDate?: string | null;
  canOpenRewards?: boolean; real?: { programmeStatus?: string }; canSeeNavItem: (id: string) => boolean;
  pageError?: string | null;
  metrics: { programmeValue: string; programmeSummary: string; programmePercent: number | null; attendanceValue: string; attendanceSummary: string; attendanceTotalValue: string; attendancePercent: number | null; otjActualValue: string; otjSummary: string; otjPlannedValue: string; otjPercent: number | null; ksbValue: string; ksbSummary: string; ksbPercent: number | null };
  overviewExtra?: ReactNode;
};

function initialTab(): DashboardTabId {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('tab');
  if (tabs.some(tab => tab.id === requested)) return requested as DashboardTabId;
  if (params.has('subject') || params.has('month') || window.location.hash === '#module-timeline' || window.location.hash === '#training-plan-details') {
    return window.location.hash === '#module-timeline' || window.location.hash === '#training-plan-details' ? 'training' : 'monthly';
  }
  return tabs[0].id;
}

export function DashboardTabs(props: DashboardTabsProps) {
  const [active, setActive] = useState<DashboardTabId>(initialTab);
  const [visited, setVisited] = useState<Set<DashboardTabId>>(() => new Set([initialTab()]));
  useEffect(() => { setVisited(current => current.has(active) ? current : new Set(current).add(active)); }, [active]);
  const activeIndex = tabs.findIndex(tab => tab.id === active);
  const activate = (id: DashboardTabId) => setActive(id);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (activeIndex + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    activate(tabs[next].id);
    document.getElementById(`learner-dashboard-tab-${tabs[next].id}`)?.focus();
  };
  const panelProps = useMemo(() => props, [props]);
  return <section className={styles.tabs} aria-label="Learner dashboard sections">
    <div className={styles.tabList} role="tablist" aria-label="Dashboard tabs">
      {tabs.map(tab => <button key={tab.id} id={`learner-dashboard-tab-${tab.id}`} type="button" role="tab" className={styles.tab}
        aria-selected={active === tab.id} aria-controls={`learner-dashboard-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1}
        onClick={() => activate(tab.id)} onKeyDown={onKeyDown}>{tab.label}</button>)}
    </div>
    {tabs.filter(tab => visited.has(tab.id)).map(tab => <div key={tab.id} id={`learner-dashboard-panel-${tab.id}`} role="tabpanel" aria-labelledby={`learner-dashboard-tab-${tab.id}`} hidden={active !== tab.id} className={styles.panel}>
      <Suspense fallback={<div role="status" className={styles.loading}>Loading {tab.label.toLowerCase()}…</div>}>
        {tab.id === 'overview' && <OverviewTab {...panelProps} />}
        {tab.id === 'weekly' && <WeeklyTab {...panelProps} />}
        {tab.id === 'monthly' && <MonthlyTab {...panelProps} />}
        {tab.id === 'training' && <TrainingTab {...panelProps} />}
        {tab.id === 'rewards' && <RewardsTab {...panelProps} />}
      </Suspense>
    </div>)}
  </section>;
}
