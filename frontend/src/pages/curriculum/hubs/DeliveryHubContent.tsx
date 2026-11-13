import { useAuth } from '@/hooks/useAuth';
import type { CurriculumOverview } from '@/lib/curriculumApi';
import { catalogueModuleActive, useCatalogueActivity } from '../module-builder/useCatalogueActivity';
import DeliveryWorkspace, { type DeliveryWorkspaceProps } from './DeliveryWorkspace';
import { deliveryLiveSessions, deliveryStaffing } from './deliveryDashboard';
import { useDeliverySessions } from './useDeliverySessions';

type Props = Pick<DeliveryWorkspaceProps, 'description' | 'cards' | 'attentionItems' | 'loading' | 'unavailable' | 'error'> & {
  overview: CurriculumOverview | null;
};

/** Mounted only on Delivery; reuse existing read-only sources without starting the Teams workspace. */
export default function DeliveryHubContent({ overview, ...props }: Props) {
  const { auth } = useAuth();
  const scope = JSON.stringify([auth?.account?.id, auth?.account?.role, auth?.account?.access, auth?.tenant?.id]);
  const sessions = useDeliverySessions(Boolean(overview) || !props.loading, scope);
  const modules = [...new Map((overview?.modules ?? []).map(module => [module.moduleCatalogueId || module.id, module])).values()];
  const refreshKey = modules.map(module => [module.moduleCatalogueId || module.id, module.lastUpdated, module.startDate, module.endDate, module.sourceType].join(':')).join('|');
  const activity = useCatalogueActivity(refreshKey, scope);
  const cohorts = overview?.cohorts ?? [];
  const groups = overview?.groups ?? [];
  const activeCohorts = new Set(cohorts.filter(cohort => cohort.status?.trim().toLowerCase() === 'active').map(cohort => cohort.id));
  const activeModules = !modules.length ? 0 : activity.data
    ? modules.filter(module => catalogueModuleActive(activity.data[module.moduleCatalogueId || module.id], activity.today)).length : null;
  const live = deliveryLiveSessions(sessions.sessions);
  const activeIds = new Set(modules.filter(module => catalogueModuleActive(activity.data?.[module.moduleCatalogueId || module.id], activity.today))
    .map(module => module.moduleCatalogueId || module.id));
  const staffing = deliveryStaffing(modules, groups, sessions.sessions, activeIds, activity.today);
  const staffingKnown = !props.unavailable && (!modules.length || Boolean(activity.data && (!sessions.error || sessions.sessions.length)));
  return <DeliveryWorkspace {...props}
    // To restore the previous title card, change this one value to "classic".
    heroVariant="glass"
    staffing={{ needsTutor: staffingKnown ? staffing.needsTutor : null, needsCoach: props.unavailable ? null : staffing.needsCoach,
      loading: props.loading || Boolean(modules.length && activity.loading && !activity.data) || sessions.loading }}
    cohorts={cohorts} activeCohortGroups={groups.filter(group => activeCohorts.has(group.cohortId)).length}
    activeGroups={groups.filter(group => group.status?.trim().toLowerCase() === 'active').length} totalGroups={groups.length}
    activeModules={activeModules} totalModules={modules.length}
    modulesLoading={Boolean(modules.length && activity.loading && !activity.data)} modulesError={modules.length ? activity.error : null}
    sessions={sessions.sessions} sessionsLoading={sessions.loading} sessionsError={sessions.error}
    cards={props.cards.map(card => card.href === '/curriculum/session-calendar'
      ? { ...card, meta: sessions.loading ? 'Loading' : sessions.error && !live.length ? 'Unavailable' : `${live.length} sessions` } : card)}
  />;
}
