/** Field reservations contain identities and paths only, never content values. */
import { DERIVED_MODULE_FIELDS, DERIVED_WEEK_FIELDS } from '../shared/entities/mergeModuleStructure';
import { recalculateModule, TEAMS_MEETING_SETTING_KEYS, type ModuleCatalogueItem } from './moduleAuthoringData';

export type EditKind = 'module' | 'week' | 'component';
export type Lease = { key: string; editorId: string; name: string; expiresAt: number };
export type Member = { editorId: string; name: string };
type RecordValue = Record<string, unknown>;
export const fieldKey = (kind: EditKind, id: string, field: string) => JSON.stringify([kind, id, field]);
const ignored = new Set(['id', 'moduleId', 'weekId', 'catalogueId', 'components', 'weekStructure', 'itemFingerprints', 'qualityChecklist', 'deliveryWeeks', 'deliveryStatus', 'deliveryMetadata']);
const planned = new Set(['sessionDate', 'sessionDay', 'sessionTime', 'durationMinutes', 'sessionDateTimeUtc', 'teamsStartDateTimeUtc', ...TEAMS_MEETING_SETTING_KEYS]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function overlaps(a: string, b: string): boolean {
  const [ak, ai, af] = JSON.parse(a) as string[];
  const [bk, bi, bf] = JSON.parse(b) as string[];
  return ak === bk && ai === bi && (['$record', '$delete', 'type'].includes(af) || ['$record', '$delete', 'type'].includes(bf)
    || af === bf || af.startsWith(`${bf}.`) || bf.startsWith(`${af}.`));
}
export function editValues(module: ModuleCatalogueItem): Map<string, unknown> {
  const values = new Map<string, unknown>();
  function record(kind: EditKind, id: string, source: RecordValue) {
    const derived = kind === 'module' ? DERIVED_MODULE_FIELDS : kind === 'week' ? DERIVED_WEEK_FIELDS : new Set<string>();
    function walk(value: unknown, path: string) {
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
        Object.entries(value).forEach(([key, child]) => {
          if (kind === 'component' && path === 'settings' && planned.has(key)) return;
          walk(child, path ? `${path}.${key}` : key);
        });
      } else if (/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*){0,4}$/.test(path)) values.set(fieldKey(kind, id, path), value);
    }
    Object.entries(source).forEach(([key, value]) => { if (!ignored.has(key) && !derived.has(key)) walk(value, key); });
  }
  record('module', module.catalogueId, module as unknown as RecordValue);
  module.weekStructure.forEach(week => {
    record('week', week.id, week as unknown as RecordValue);
    week.components.forEach(component => record('component', component.id, component as unknown as RecordValue));
  });
  return values;
}
export function dirtyFields(base: ModuleCatalogueItem, draft: ModuleCatalogueItem): string[] {
  const before = editValues(base), after = editValues(draft);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(key => !equal(before.get(key), after.get(key)));
  const present = (module: ModuleCatalogueItem) => new Set(module.weekStructure.flatMap(week => [fieldKey('week', week.id, '$delete'), ...week.components.map(c => fieldKey('component', c.id, '$delete'))]));
  const remaining = present(draft);
  if (!equal(base.weekStructure.map(w => w.id), draft.weekStructure.map(w => w.id))) changed.push(fieldKey('module', draft.catalogueId, '$order'));
  draft.weekStructure.forEach(week => {
    const original = base.weekStructure.find(w => w.id === week.id);
    if (original && !equal(original.components.map(c => c.id), week.components.map(c => c.id))) changed.push(fieldKey('week', week.id, '$order'));
  });
  return [...new Set([...changed, ...[...present(base)].filter(key => !remaining.has(key))])];
}
function records(module: ModuleCatalogueItem, kind: string): RecordValue[] {
  if (kind === 'module') return [module as unknown as RecordValue];
  return (kind === 'week' ? module.weekStructure : module.weekStructure.flatMap(w => w.components)) as unknown as RecordValue[];
}
/** Exclude only unavailable fields from the request; never mutate the draft. */
export function projectAvailable(base: ModuleCatalogueItem, draft: ModuleCatalogueItem, blocked: string[]): ModuleCatalogueItem {
  if (!blocked.length) return draft;
  const result = structuredClone(draft);
  for (const key of blocked) {
    const [kind, id, path] = JSON.parse(key) as string[];
    const old = records(base, kind).find(r => String(kind === 'module' ? r.catalogueId : r.id) === id);
    const current = records(result, kind).find(r => String(kind === 'module' ? r.catalogueId : r.id) === id);
    if (path === '$order') {
      if (kind === 'module') {
        const order = base.weekStructure.map(w => w.id);
        result.weekStructure.sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : order.length) - (order.includes(b.id) ? order.indexOf(b.id) : order.length));
      } else if (kind === 'week') {
        const order = base.weekStructure.find(w => w.id === id)?.components.map(c => c.id) || [];
        result.weekStructure.find(w => w.id === id)?.components.sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : order.length) - (order.includes(b.id) ? order.indexOf(b.id) : order.length));
      }
      continue;
    }
    if (path === '$delete' || path === '$record' || !current || !old) {
      if (kind === 'week') {
        result.weekStructure = result.weekStructure.filter(w => w.id !== id);
        const original = base.weekStructure.find(w => w.id === id);
        if (original) result.weekStructure.splice(Math.min(base.weekStructure.indexOf(original), result.weekStructure.length), 0, structuredClone(original));
      } else if (kind === 'component') {
        result.weekStructure.forEach(w => { w.components = w.components.filter(c => c.id !== id); });
        const parent = base.weekStructure.find(w => w.components.some(c => c.id === id));
        const target = result.weekStructure.find(w => w.id === parent?.id);
        const original = parent?.components.find(c => c.id === id);
        if (original && target && parent) target.components.splice(Math.min(parent.components.indexOf(original), target.components.length), 0, structuredClone(original));
      }
      continue;
    }
    const steps = path.split('.');
    let dest = current, source: unknown = old;
    steps.slice(0, -1).forEach(step => {
      source = source && typeof source === 'object' ? (source as RecordValue)[step] : undefined;
      if (!dest[step] || typeof dest[step] !== 'object') dest[step] = {};
      dest = dest[step] as RecordValue;
    });
    const leaf = steps[steps.length - 1];
    const value = source && typeof source === 'object' ? (source as RecordValue)[leaf] : undefined;
    if (value === undefined) delete dest[leaf]; else dest[leaf] = structuredClone(value);
  }
  return recalculateModule(result);
}
