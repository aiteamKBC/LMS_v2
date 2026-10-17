export type DashboardTabId = 'overview' | 'weekly' | 'monthly' | 'training' | 'rewards';

const TAB_IDS: readonly DashboardTabId[] = ['weekly', 'monthly', 'training', 'overview', 'rewards'];

/** The tab the Dashboard opens on: an explicit `?tab=`, a monthly/training deep link, or Weekly Learning. */
export function initialDashboardTab(): DashboardTabId {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('tab');
  if (TAB_IDS.includes(requested as DashboardTabId)) return requested as DashboardTabId;
  if (params.has('subject') || params.has('month') || window.location.hash === '#module-timeline' || window.location.hash === '#training-plan-details') {
    return window.location.hash === '#module-timeline' || window.location.hash === '#training-plan-details' ? 'training' : 'monthly';
  }
  return 'weekly';
}
