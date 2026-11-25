import {
  type ModuleCatalogueItem,
  type KsbOption,
  type KsbWeightClass,
  type KsbMapping,
  makeAuthoringId,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import {
  defaultKsbWeight,
  DEFAULT_KSB_WEIGHT_CLASS,
  ksbMappingIdentity,
  DEFAULT_KSB_MAPPING_TYPE,
  clampKsbWeight,
  normaliseKsbWeightClass,
} from '@/features/curriculum/module-authoring/model/ksbWeights';


export type KsbTarget =
  | { scope: 'module' }
  | { scope: 'week'; weekId: string }
  | { scope: 'component'; weekId: string; componentId: string };


export function mappingsForTarget(module: ModuleCatalogueItem, target: KsbTarget) {
  if (target.scope === 'module') return module.moduleKsbMappings;
  const week = module.weekStructure.find(item => item.id === target.weekId);
  if (!week) return [];
  if (target.scope === 'week') return week.ksbMappings;
  return week.components.find(component => component.id === target.componentId)?.ksbMappings || [];
}


export function addKsbMapping(module: ModuleCatalogueItem, target: KsbTarget, option: KsbOption, weight = defaultKsbWeight(), weightClass: KsbWeightClass = DEFAULT_KSB_WEIGHT_CLASS): ModuleCatalogueItem {
  const nextIdentity = ksbMappingIdentity(option);
  if (mappingsForTarget(module, target).some(mapping => ksbMappingIdentity(mapping) === nextIdentity)) return module;
  const mapping: KsbMapping = {
    id: makeAuthoringId('KSBMAP'),
    ksbId: option.id,
    code: option.code,
    description: option.description,
    sourceType: option.sourceType,
    sourceId: option.sourceId,
    type: DEFAULT_KSB_MAPPING_TYPE,
    classification: DEFAULT_KSB_MAPPING_TYPE,
    weight: clampKsbWeight(weight),
    weightClass: normaliseKsbWeightClass(weightClass),
    weight_class: normaliseKsbWeightClass(weightClass),
  };
  if (target.scope === 'module') return { ...module, moduleKsbMappings: [...module.moduleKsbMappings, mapping] };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: [...week.ksbMappings, mapping] };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: [...component.ksbMappings, mapping] } : component) };
    }),
  };
}


export function updateKsbMappingWeight(module: ModuleCatalogueItem, target: KsbTarget, mappingId: string, weight: number): ModuleCatalogueItem {
  const updateMappings = (mappings: KsbMapping[]) => mappings.map(mapping => (
    mapping.id === mappingId ? { ...mapping, weight: clampKsbWeight(weight) } : mapping
  ));
  if (target.scope === 'module') return { ...module, moduleKsbMappings: updateMappings(module.moduleKsbMappings) };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: updateMappings(week.ksbMappings) };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: updateMappings(component.ksbMappings) } : component) };
    }),
  };
}


export function updateKsbMappingWeightClass(module: ModuleCatalogueItem, target: KsbTarget, mappingId: string, weightClass: KsbWeightClass): ModuleCatalogueItem {
  const nextWeightClass = normaliseKsbWeightClass(weightClass);
  const updateMappings = (mappings: KsbMapping[]) => mappings.map(mapping => (
    mapping.id === mappingId
      ? {
          ...mapping,
          weight: defaultKsbWeight(nextWeightClass),
          weightClass: nextWeightClass,
          weight_class: nextWeightClass,
        }
      : mapping
  ));
  if (target.scope === 'module') return { ...module, moduleKsbMappings: updateMappings(module.moduleKsbMappings) };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: updateMappings(week.ksbMappings) };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: updateMappings(component.ksbMappings) } : component) };
    }),
  };
}


export function removeKsbMapping(module: ModuleCatalogueItem, target: KsbTarget, mappingId: string): ModuleCatalogueItem {
  if (target.scope === 'module') return { ...module, moduleKsbMappings: module.moduleKsbMappings.filter(mapping => mapping.id !== mappingId) };
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => {
      if (week.id !== target.weekId) return week;
      if (target.scope === 'week') return { ...week, ksbMappings: week.ksbMappings.filter(mapping => mapping.id !== mappingId) };
      return { ...week, components: week.components.map(component => component.id === target.componentId ? { ...component, ksbMappings: component.ksbMappings.filter(mapping => mapping.id !== mappingId) } : component) };
    }),
  };
}


export function uniqueMappings(mappings: KsbMapping[]) {
  const seen = new Set<string>();
  return mappings.filter(mapping => {
    const key = ksbMappingIdentity(mapping);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
