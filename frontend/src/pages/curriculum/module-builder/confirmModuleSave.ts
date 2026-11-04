import { DERIVED_MODULE_FIELDS, DERIVED_WEEK_FIELDS } from '../shared/entities/mergeModuleStructure';
import { recalculateModule, type ModuleCatalogueItem } from './moduleAuthoringData';

const READBACK_LIMIT_MS = 10_000;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Compare authored content, including identities, order and all video settings. */
function authored(module: ModuleCatalogueItem): unknown {
  const { weekStructure, ...fields } = recalculateModule(module);
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([key]) => !DERIVED_MODULE_FIELDS.has(key)
      && !['itemFingerprints', 'qualityChecklist', 'deliveryWeeks', 'deliveryStatus', 'deliveryMetadata'].includes(key))),
    weekStructure: weekStructure.map(({ components, ...week }) => ({
      ...Object.fromEntries(Object.entries(week).filter(([key]) => !DERIVED_WEEK_FIELDS.has(key))),
      components,
    })),
  };
}

export function sameAuthoredModule(sent: ModuleCatalogueItem, stored: ModuleCatalogueItem): boolean {
  return sent.catalogueId === stored.catalogueId && stable(authored(sent)) === stable(authored(stored));
}

/** A lost response is not a failed write. Only a fresh, matching read confirms it. */
export async function confirmModuleSave(
  sent: ModuleCatalogueItem,
  read: () => Promise<ModuleCatalogueItem | null>,
): Promise<ModuleCatalogueItem | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The read has no editor side effects. A late result cannot restore a draft,
    // and an unavailable server cannot leave Save spinning for another 90s.
    const stored = await Promise.race([
      read().catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), READBACK_LIMIT_MS); }),
    ]);
    if (!stored || !stored.structureRevision || stored.catalogueId !== sent.catalogueId
      || !Array.isArray(stored.weekStructure)) return null;
    return sameAuthoredModule(sent, stored) ? stored : null;
  } finally {
    clearTimeout(timer);
  }
}
