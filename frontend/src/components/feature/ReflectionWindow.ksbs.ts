import type { ComponentKsbMapping, LearnerKsbItem } from '@/api/learnerDetail';

export interface ReflectionKsbOption extends ComponentKsbMapping {
  mapped: boolean;
  savedOnly: boolean;
}

/** Programme definitions supply the wording; activity mappings supply weights.
 * Keep already-selected codes visible if the current programme list changes. */
export function reflectionKsbOptions(
  programmeKsbs: LearnerKsbItem[],
  activityKsbs: ComponentKsbMapping[],
  selectedCodes: string[],
  savedWeights: Record<string, number>,
  accepted: boolean,
): ReflectionKsbOption[] {
  const mappings = new Map(activityKsbs.map(item => [item.code, item]));
  // Preserve the existing mapped-only flow when there is no programme catalogue.
  const catalogue = programmeKsbs.length ? programmeKsbs : activityKsbs;
  const options = new Map<string, ReflectionKsbOption>();
  for (const item of catalogue) {
    const mapping = mappings.get(item.code);
    options.set(item.code, {
      code: item.code,
      description: item.description?.trim() || mapping?.description?.trim() || null,
      weight: accepted && savedWeights[item.code] != null
        ? savedWeights[item.code] : mapping?.weight ?? 0,
      classification: mapping?.classification ?? 'possible',
      mapped: Boolean(mapping),
      savedOnly: false,
    });
  }
  for (const code of selectedCodes) {
    if (options.has(code)) continue;
    const mapping = mappings.get(code);
    options.set(code, {
      code,
      description: mapping?.description?.trim() || null,
      weight: savedWeights[code] ?? mapping?.weight ?? 0,
      classification: mapping?.classification ?? null,
      mapped: Boolean(mapping),
      savedOnly: true,
    });
  }
  return [...options.values()];
}
