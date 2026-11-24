import type { ModuleCatalogueItem } from '@/pages/curriculum/module-builder/moduleAuthoringData';


export function componentDisplayTitle(title: string) {
  return title.replace(/\s*(?:-|—)\s*Week\s*\d+\s*$/i, '').trim();
}


export function readableComponentTitle(title: string) {
  const cleaned = componentDisplayTitle(title);
  if (!cleaned || /\s/.test(cleaned)) return cleaned;
  return cleaned
    .replace(/([A-Za-z])of([A-Z])/g, '$1 of $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}


export function normaliseComponentTitles(module: ModuleCatalogueItem): ModuleCatalogueItem {
  return {
    ...module,
    weekStructure: module.weekStructure.map(week => ({
      ...week,
      components: week.components.map(component => ({
        ...component,
        title: readableComponentTitle(component.title) || component.title,
      })),
    })),
  };
}


export function moveById<T extends { id: string }>(items: T[], sourceId: string, targetId: string): T[] {
  const sourceIndex = items.findIndex(item => item.id === sourceId);
  const targetIndex = items.findIndex(item => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}


export function normaliseDeepLinkValue(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
