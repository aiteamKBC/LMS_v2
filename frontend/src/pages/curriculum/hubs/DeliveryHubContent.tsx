import { useAuth } from '@/hooks/useAuth';
import type { DeliveryOverview } from './useDeliveryData';
import { catalogueModuleActive, useCatalogueActivity } from '../module-builder/useCatalogueActivity';
import DeliveryWorkspace, { type DeliveryWorkspaceProps } from './DeliveryWorkspace';
import { deliveryActiveGroupIds, deliveryLiveSessions, deliveryStaffing } from './deliveryDashboard';
import { useDeliverySessions } from './useDeliverySessions';

type Props = Pick<DeliveryWorkspaceProps, 'description' | 'cards' | 'attentionItems' | 'loading' | 'unavailable' | 'error' | 'onRetry'> & {
  overview: DeliveryOverview | null;
};

/** Mounted only on Delivery; reuse existing read-only sources without starting the Teams workspace. */
export default function DeliveryHubContent({ overview, ...props }: Props) {
  const { auth } = useAuth();
  const scope = JSON.stringify([auth?.account?.id, auth?.account?.role, auth?.account?.access, auth?.tenant?.id]);
  const sessions = useDeliverySessions(scope);
  const modules = [...new Map((overview?.modules ?? []).map(module => [module.moduleCatalogueId || module.id, module])).values()];
  // Do not wait for overview or refetch activity when list metadata arrives.
  const activity = useCatalogueActivity('delivery-dashboard', scope, { revalidateOnMount: true });
  const cohorts = overview?.cohorts ?? [];
  const groups = overview?.groups ?? [];
  const activeCohorts = new Set(cohorts.filter(cohort => cohort.status?.trim().toLowerCase() === 'active').map(cohort => cohort.id));
  const activeModules = !modules.length ? 0 : activity.data
    ? modules.filter(module => catalogueModuleActive(activity.data[module.moduleCatalogueId || module.id], activity.today)).length : null;
  const live = deliveryLiveSessions(sessions.sessions);
  const activeIds = new Set(modules.filter(module => catalogueModuleActive(activity.data?.[module.moduleCatalogueId || module.id], activity.today))
    .map(module => module.moduleCatalogueId || module.id));
  const activeGroups = deliveryActiveGroupIds(groups, overview?.modules ?? [], activeIds);
  const staffing = deliveryStaffing(modules, groups, sessions.sessions, activeIds, activity.today, activeGroups);
  const staffingKnown = !props.unavailable && (!modules.length || Boolean(activity.data && (!sessions.error || sessions.sessions.length)));
  return <DeliveryWorkspace {...props}
    // To restore the previous title card, change this one value to "classic".
    heroVariant="glass"
    onRetrySessions={sessions.reload}
    onRetryActivity={activity.reload}
    staffing={{ needsTutor: staffingKnown ? staffing.needsTutor : null, needsCoach: props.unavailable || !activity.data ? null : staffing.needsCoach,
      loading: props.loading || Boolean((modules.length || groups.length) && activity.loading && !activity.data),
      tutorLoading: props.loading || Boolean(modules.length && activity.loading && !activity.data) || sessions.loading }}
    cohorts={cohorts} activeCohortGroups={groups.filter(group => activeCohorts.has(group.cohortId)).length}
    activeGroups={!groups.length ? 0 : activity.data ? activeGroups.size : null} totalGroups={groups.length}
    activeModules={activeModules} totalModules={modules.length}
    modulesLoading={Boolean((modules.length || groups.length) && activity.loading && !activity.data)} modulesError={modules.length || groups.length ? activity.error : null}
    sessions={sessions.sessions} sessionsLoading={sessions.loading} sessionsError={sessions.error}
    undatedSessionCount={sessions.undatedSessionCount}
    cards={props.cards.map(card => card.href === '/curriculum/session-calendar'
      ? { ...card, meta: sessions.loading ? 'Loading' : sessions.error && !live.length ? 'Unavailable' : `${live.length} sessions` } : card)}
  />;
}
