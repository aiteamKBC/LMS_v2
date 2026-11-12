import type { ModuleComponent } from '../../module-builder/moduleAuthoringData';
import { sessionActivityGroups } from '@/utils/sessionActivityGroups';

export function authoredSessionGroups(components: readonly ModuleComponent[], moduleId?: string) {
  return sessionActivityGroups(components, component => ({
    componentId: component.id, type: component.type,
    moduleId: moduleId || component.moduleId, weekId: component.weekId,
    linkedSessionComponentId: String(component.settings.linkedLiveSessionComponentId || ''),
    linkedSessionModuleId: String(component.settings.linkedLiveSessionModuleId || ''),
  }));
}
