import { clean, uniqueCleanValues } from '@/features/curriculum/programme-detail/model/presentation';
import { type Module, type Programme } from '@/features/curriculum/programme-detail/model/types';
import { namedCurriculumWorkspacePath } from '@/pages/curriculum/shared/entities/model';

export function isCanonicalModuleBuilderId(value: unknown) {
  return /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(clean(value));
}

export function moduleBuilderIdentifier(module: Pick<Module, 'id' | 'sourceId' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'structureId'>) {
  const candidates = uniqueCleanValues([
    module.moduleCatalogueId,
    module.catalogueId,
    module.structureId,
    module.moduleId,
    module.id,
    module.sourceId,
  ]);
  return candidates.find(isCanonicalModuleBuilderId) || candidates[0] || '';
}

export function moduleBuilderUrl(
  module: Pick<Module, 'id' | 'sourceId' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'structureId' | 'name'>,
  programme?: Pick<Programme, 'id' | 'sourceId' | 'name'>,
  /** Deep-links straight past the module's landing view into one week or
   *  component's own editor — the same `week`/`component` params Module
   *  Builder's own deep-link handler (`moduleBuilderDeepLinkTarget`) already
   *  reads on load, so this is landing on a door it already opens for itself. */
  target?: { weekId?: string; componentId?: string },
) {
  const params = new URLSearchParams();
  const moduleId = moduleBuilderIdentifier(module);
  if (moduleId) params.set('module', moduleId);
  // A label, not a second lookup key. Module Builder opens the module the id
  // names and nothing else; if that id matches nothing, this is the name it
  // reports as missing. Resolving by title instead used to open a namesake from
  // another programme -- same name, different weeks, different OTJH.
  const moduleName = clean(module.name);
  if (moduleName) params.set('moduleTitle', moduleName);
  const programmeId = clean(programme?.sourceId || programme?.id || programme?.name);
  if (programmeId) params.set('programme', programmeId);
  const programmeName = clean(programme?.name);
  if (programmeName) params.set('programmeName', programmeName);
  const weekId = clean(target?.weekId);
  if (weekId) params.set('week', weekId);
  const componentId = clean(target?.componentId);
  if (componentId) params.set('component', componentId);
  const query = params.toString();
  return `/curriculum/module-builder${query ? `?${query}` : ''}`;
}

/**
 * The module's own workspace — its schedule, components, KSB weights, Teams
 * series and sessions. The identity precedence matches `moduleIdentity` in the
 * shared model, which is what that page resolves the route param with.
 */
export function moduleWorkspaceUrl(module: Pick<Module, 'id' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId' | 'name'>) {
  const identity = clean(module.moduleCatalogueId)
    || clean(module.catalogueId)
    || clean(module.moduleId)
    || clean(module.id);
  return identity ? namedCurriculumWorkspacePath('modules', identity, module.name) : '';
}

/** The identifier the scope endpoints resolve a module by. */
export function moduleWorkspaceIdentity(module: Pick<Module, 'id' | 'moduleId' | 'moduleCatalogueId' | 'catalogueId'>) {
  return clean(module.moduleCatalogueId) || clean(module.catalogueId) || clean(module.moduleId) || clean(module.id);
}
