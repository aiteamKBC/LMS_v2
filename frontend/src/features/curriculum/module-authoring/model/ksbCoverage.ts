import {
  type ModuleCatalogueItem,
  type KsbMapping,
  weekExpectedOtjhTotal,
} from '@/pages/curriculum/module-builder/moduleAuthoringData';
import {
  type KsbSourceOption,
  conciseKsbSourceLabel,
  ksbSourceLabel,
  cleanKsbSourceId,
} from '@/features/curriculum/module-authoring/model/ksbSources';
import { ksbMappingIdentity, ksbWeightClassLabel } from '@/features/curriculum/module-authoring/model/ksbWeights';
import {
  readableComponentTitle,
  normaliseDeepLinkValue,
} from '@/features/curriculum/module-authoring/model/draftTransforms';


/** The heatmap's first column: mappings made against the module as a whole. */
export const MODULE_KSB_COLUMN = 'module';


export function moduleKsbWeekColumnKey(index: number) {
  return `week:${index}`;
}


export function moduleKsbMapRows(module: ModuleCatalogueItem, sourceLabels: Record<string, string>, source?: KsbSourceOption | null, allowSelectedSourceCodeFallback = false): ModuleKsbMapRow[] {
  const rows = new Map<string, ModuleKsbMapRow>();
  const fallbackSourceFull = source ? (sourceLabels[source.id] || source.label) : '';
  const fallbackSource = conciseKsbSourceLabel(fallbackSourceFull);
  const sourceCodes = new Set<string>();
  source?.options.forEach(option => {
    const code = String(option.code || '').trim().toUpperCase();
    if (!code) return;
    sourceCodes.add(code);
    const sourceId = String(option.sourceId || source.id || '').trim();
    const key = ksbMappingIdentity({ code, sourceType: option.sourceType || (sourceId.startsWith('standard:') ? 'standard' : 'framework'), sourceId });
    rows.set(key, {
      code,
      description: option.description || option.title || '',
      source: fallbackSource,
      sourceFull: fallbackSourceFull,
      weight: 0,
      locations: [],
      placements: [],
      applied: false,
      classificationLabels: [],
    });
  });
  const addMapping = (mapping: KsbMapping, placement: ModuleKsbPlacement) => {
    const location = placement.label;
    const code = String(mapping.code || '').trim().toUpperCase();
    if (!code) return;
    if (isLegacyModuleLevelKsbFallback(mapping, location)) return;
    const sourceFull = ksbSourceLabel(mapping, sourceLabels);
    const sourceLabel = conciseKsbSourceLabel(sourceFull);
    const mappingSourceId = cleanKsbSourceId(mapping.sourceId);
    const selectedSourceId = cleanKsbSourceId(source?.id);
    const mappingKey = ksbMappingIdentity(mapping);
    const selectedSourceKey = selectedSourceId
      ? ksbMappingIdentity({
        code,
        sourceType: selectedSourceId.startsWith('standard:') ? 'standard' : 'framework',
        sourceId: selectedSourceId,
      })
      : '';
    const canUseSelectedSourceByCode = Boolean(allowSelectedSourceCodeFallback && selectedSourceId && sourceCodes.has(code));
    if (selectedSourceId && mappingSourceId && mappingSourceId !== selectedSourceId && !canUseSelectedSourceByCode) return;
    const rowKey = selectedSourceKey && canUseSelectedSourceByCode && rows.has(selectedSourceKey)
      ? selectedSourceKey
      : rows.has(mappingKey)
        ? mappingKey
        : (selectedSourceKey && rows.has(selectedSourceKey) ? selectedSourceKey : mappingKey);
    const current = rows.get(rowKey) || {
      code,
      description: mapping.description || '',
      source: canUseSelectedSourceByCode ? fallbackSource : sourceLabel || fallbackSource,
      sourceFull: canUseSelectedSourceByCode ? fallbackSourceFull : sourceFull || fallbackSourceFull,
      weight: 0,
      locations: [],
      placements: [],
      applied: false,
      classificationLabels: [],
    };
    current.weight += Number(mapping.weight || 0);
    current.applied = true;
    const classification = ksbWeightClassLabel(mapping.weightClass || mapping.weight_class);
    if (classification && !current.classificationLabels.includes(classification)) current.classificationLabels.push(classification);
    if (!current.description && mapping.description) current.description = mapping.description;
    if (!current.locations.includes(location)) current.locations.push(location);
    if (!current.placements.some(item => item.label === placement.label && item.scope === placement.scope)) current.placements.push(placement);
    rows.set(rowKey, current);
  };

  const modulePlacement = {
    label: 'Module',
    scope: 'Module' as const,
    otjh: Number(module.declaredTotalOtjh ?? module.totalOtjh ?? 0) || 0,
    points: module.weekStructure.reduce((total, week) => total + week.components.reduce((weekTotal, component) => weekTotal + Number(component.points || 0), 0), 0),
    columnKey: MODULE_KSB_COLUMN,
  };
  module.moduleKsbMappings.forEach(mapping => addMapping(mapping, modulePlacement));
  module.weekStructure.forEach((week, index) => {
    const weekLabel = week.title || `Week ${week.weekNumber}`;
    const columnKey = moduleKsbWeekColumnKey(index);
    const weekPlacement = {
      label: weekLabel,
      scope: 'Week' as const,
      otjh: weekExpectedOtjhTotal(week),
      points: week.components.reduce((total, component) => total + Number(component.points || 0), 0),
      columnKey,
    };
    week.ksbMappings.forEach(mapping => addMapping(mapping, weekPlacement));
    week.components.forEach(component => {
      const componentTitle = readableComponentTitle(component.title) || 'Component';
      const location = `${weekLabel} / ${componentTitle}`;
      const componentPlacement = {
        label: location,
        scope: 'Component' as const,
        otjh: Number(component.expectedOtjh || 0),
        points: Number(component.points || 0),
        columnKey,
        detail: componentTitle,
      };
      component.ksbMappings.forEach(mapping => addMapping(mapping, componentPlacement));
    });
  });

  return Array.from(rows.values()).filter(row => row.applied).sort((a, b) => {
    const codeSort = a.code.localeCompare(b.code, undefined, { numeric: true });
    if (codeSort) return codeSort;
    return a.source.localeCompare(b.source);
  });
}


export function programmeKsbMapRows(modules: ModuleCatalogueItem[], sourceLabels: Record<string, string>, programmeName = ''): ModuleKsbMapRow[] {
  const rows = new Map<string, ModuleKsbMapRow>();
  const addMapping = (mapping: KsbMapping, placement: ModuleKsbPlacement) => {
    const location = placement.label;
    const code = String(mapping.code || '').trim().toUpperCase();
    if (!code) return;
    if (isLegacyModuleLevelKsbFallback(mapping, location)) return;
    const sourceFull = ksbSourceLabel(mapping, sourceLabels, programmeName);
    const source = conciseKsbSourceLabel(sourceFull);
    const key = `${code}::${normaliseDeepLinkValue(sourceFull) || normaliseDeepLinkValue(mapping.description) || 'source'}`;
    const current = rows.get(key) || {
      code,
      description: mapping.description || '',
      source,
      sourceFull,
      weight: 0,
      locations: [],
      placements: [],
      applied: true,
      classificationLabels: [],
    };
    current.weight += Number(mapping.weight || 0);
    const classification = ksbWeightClassLabel(mapping.weightClass || mapping.weight_class);
    if (classification && !current.classificationLabels.includes(classification)) current.classificationLabels.push(classification);
    if (!current.description && mapping.description) current.description = mapping.description;
    if (!current.locations.includes(location)) current.locations.push(location);
    if (!current.placements.some(item => item.label === placement.label && item.scope === placement.scope)) current.placements.push(placement);
    rows.set(key, current);
  };

  modules.forEach(module => {
    const moduleLabel = module.title || module.programmeName || 'Module';
    const modulePlacement = {
      label: `${moduleLabel} / Module`,
      scope: 'Module' as const,
      otjh: Number(module.declaredTotalOtjh ?? module.totalOtjh ?? 0) || 0,
      points: module.weekStructure.reduce((total, week) => total + week.components.reduce((weekTotal, component) => weekTotal + Number(component.points || 0), 0), 0),
    };
    module.moduleKsbMappings.forEach(mapping => addMapping(mapping, modulePlacement));
    module.weekStructure.forEach(week => {
      const weekLabel = week.title || `Week ${week.weekNumber}`;
      const weekPlacement = {
        label: `${moduleLabel} / ${weekLabel}`,
        scope: 'Week' as const,
        otjh: weekExpectedOtjhTotal(week),
        points: week.components.reduce((total, component) => total + Number(component.points || 0), 0),
      };
      week.ksbMappings.forEach(mapping => addMapping(mapping, weekPlacement));
      week.components.forEach(component => {
        const componentLabel = readableComponentTitle(component.title) || 'Component';
        const componentPlacement = {
          label: `${moduleLabel} / ${weekLabel} / ${componentLabel}`,
          scope: 'Component' as const,
          otjh: Number(component.expectedOtjh || 0),
          points: Number(component.points || 0),
        };
        component.ksbMappings.forEach(mapping => addMapping(mapping, componentPlacement));
      });
    });
  });

  return Array.from(rows.values()).filter(hasReadableKsbSource).sort((a, b) => {
    const codeSort = a.code.localeCompare(b.code, undefined, { numeric: true });
    if (codeSort) return codeSort;
    return a.source.localeCompare(b.source);
  });
}


export function isLegacyModuleLevelKsbFallback(mapping: KsbMapping, location: string) {
  return (
    /\/ Module$/i.test(location) &&
    /^Mapped KSB\s+/i.test(String(mapping.description || '').trim())
  );
}


export function hasReadableKsbSource(row: Pick<ModuleKsbMapRow, 'source' | 'sourceFull'>) {
  const source = String(row.source || '').trim().toLowerCase();
  const sourceFull = String(row.sourceFull || '').trim().toLowerCase();
  if (!source || source === 'no source' || !sourceFull || sourceFull === 'no source') return false;
  return !/^profile\s*-\s*ksbp-/i.test(row.source) && !/^ksb profile:\s*ksbp-/i.test(row.sourceFull);
}


export function uniquePlacementOtjh(rows: ModuleKsbMapRow[]) {
  const placements = new Map<string, number>();
  rows.forEach(row => {
    row.placements.forEach(placement => {
      const key = `${placement.scope}:${placement.label}`;
      if (!placements.has(key)) placements.set(key, Number(placement.otjh || 0));
    });
  });
  return Array.from(placements.values()).reduce((total, value) => total + value, 0);
}


export function formatKsbOtjh(value: number) {
  const amount = Number(value || 0);
  return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}h`;
}


export function formatKsbWeight(value: number) {
  const amount = Number(value || 0);
  return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}%`;
}


export type ModuleKsbMapRow = {
  code: string;
  description: string;
  source: string;
  sourceFull: string;
  weight: number;
  locations: string[];
  placements: ModuleKsbPlacement[];
  applied: boolean;
  classificationLabels: string[];
};


export type ModuleKsbPlacement = {
  label: string;
  scope: 'Module' | 'Week' | 'Component';
  otjh: number;
  points: number;
  /**
   * Which column of the heatmap this placement belongs in: 'module' for a
   * module-level mapping, `week:<index>` for anything inside a week. Set by
   * `moduleKsbMapRows` from the week structure itself rather than parsed back
   * out of the label, so a week titled "Week 3 / Intro" cannot be misread.
   */
  columnKey?: string;
  /** The component's own title, when the placement is a component. */
  detail?: string;
};
