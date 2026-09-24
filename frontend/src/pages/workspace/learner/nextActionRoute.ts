import type { LearnerDetail } from '@/api/learnerDetail';
import { componentRoute } from '@/pages/learner/video-watch/componentRoute';
import { buildLearnerJourney, completedComponentIds, componentTypeMeta, hasComponentContent, isComponentComplete } from '@/utils/learnerJourney';
import { isNavigableComponent } from '@/pages/learner/video-watch/weekPreview';

export type LearnerNextAction = {
  title: string;
  description: string;
  href: string;
};

const excludedTypes = new Set(['live_session', 'assignment']);

/** Find the first unfinished activity, leaving sessions and assignments for their cards. */
export function learnerNextAction(
  detail: LearnerDetail | null,
  kind?: string,
  learnerId?: string,
  activeModuleIds?: Iterable<string>,
): LearnerNextAction | null {
  if (!detail || !kind || !learnerId) return null;
  const activeModules = activeModuleIds ? new Set(activeModuleIds) : null;
  const completed = completedComponentIds(detail);
  for (const module of buildLearnerJourney(detail)) {
    for (const week of module.weeks) {
      for (const component of week.components) {
        const type = (component.type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if ((activeModules && (!component.moduleId || !activeModules.has(component.moduleId)))
          || excludedTypes.has(type) || !component.componentId || isComponentComplete(component, completed)
          || !hasComponentContent(component) || !isNavigableComponent(component)) continue;
        const meta = componentTypeMeta(component.title);
        return {
          title: meta.detail || component.title,
          description: `${module.module} · ${week.week}`,
          href: componentRoute(kind, learnerId, component, module.module, week.week),
        };
      }
    }
  }
  return null;
}
