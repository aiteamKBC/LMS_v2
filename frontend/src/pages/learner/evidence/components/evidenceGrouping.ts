import type { EvidenceItem } from './EvidenceBody';

export function evidenceMonth(value?: string | null) {
  const month = value?.slice(0, 7) || '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '';
}

type ComponentGroup = { key: string; label: string; context?: string; items: EvidenceItem[] };
type MonthGroup = { key: string; label: string; year: string; short: string; items: EvidenceItem[]; components: ComponentGroup[] };

export function groupEvidence(items: EvidenceItem[]): MonthGroup[] {
  const months = new Map<string, Map<string, ComponentGroup>>();
  for (const item of items) {
    const month = evidenceMonth(item.month);
    if (!months.has(month)) months.set(month, new Map());
    const components = months.get(month)!;
    if (!components.has(item.componentKey)) components.set(item.componentKey, { key: item.componentKey, label: item.componentLabel, context: item.componentContext, items: [] });
    components.get(item.componentKey)!.items.push(item);
  }
  return [...months.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, values]) => {
    const date = key ? new Date(`${key}-01T12:00:00Z`) : null;
    const components = [...values.values()].sort((a, b) => a.label.localeCompare(b.label));
    for (const component of components) component.items.sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0) || a.title.localeCompare(b.title));
    return { key, label: date ? date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Date not recorded',
      year: key.slice(0, 4), short: date ? date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : '—',
      components, items: components.flatMap(component => component.items) };
  });
}

