import type { WeekTemplate } from '../week-builder/weekTemplateData';
import { copyComponentToWeek, createEmptyWeek, makeAuthoringId, type ModuleCatalogueItem } from './moduleAuthoringData';

/** Append independent weeks; the normal module save persists the whole batch. */
export function appendWeekTemplateCopies(module: ModuleCatalogueItem, template: WeekTemplate, count: number): ModuleCatalogueItem {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Enter a whole number of weeks, starting from 1.');
  const weeks = Array.from({ length: count }, (_, index) => {
    // Deep-copy settings/outcomes too: editing one copy must not change another.
    const source = structuredClone(template);
    const shell = createEmptyWeek(module.id, module.weekStructure.length + index + 1);
    return {
      ...shell,
      title: source.title || shell.title,
      summary: source.summary || '',
      learningOutcomes: source.learningOutcomes || [],
      ksbMappings: (source.ksbMappings || []).map(mapping => ({ ...mapping, id: makeAuthoringId('ksb') })),
      components: (source.components || []).map(component => copyComponentToWeek(component, shell.id, module.id)),
    };
  });
  return { ...module, weekStructure: [...module.weekStructure, ...weeks] };
}
