import type { TransferMapping, TransferReview } from '@/api/progressTransfer';

/** Preview approval counts, preserving the LMS's retained passed quizzes. */
export function previewComponentCounts(module: TransferReview['modules'][number], mappings: TransferMapping[]) {
  const targets = new Set(module.targets.map(target => target.componentId));
  const sources = new Set(module.sources.map(source => source.sourceActivityRef));
  const matched = new Set([
    ...module.sources.flatMap(source => source.automaticTargetId ? [source.automaticTargetId] : []),
    ...mappings.filter((mapping): mapping is Extract<TransferMapping, { targetComponentId: string }> =>
      'targetComponentId' in mapping && mapping.moduleId === module.moduleId && sources.has(mapping.sourceActivityRef))
      .map(mapping => mapping.targetComponentId),
  ].filter(id => targets.has(id)));
  // An older API response does not establish that existing completions are zero.
  const retained = new Set((module.retainedCompletedIds ?? []).filter(id => !targets.has(id)));
  const retainedWithoutMatch = mappings.filter(mapping => 'retain' in mapping && mapping.retain
    && mapping.moduleId === module.moduleId && sources.has(mapping.sourceActivityRef)).length;
  const total = targets.size + retained.size + retainedWithoutMatch;
  const completed = module.completedTargetIds === undefined ? null
    : new Set([...module.completedTargetIds.filter(id => targets.has(id)), ...matched, ...retained]).size + retainedWithoutMatch;
  return { total, matched: matched.size, completed,
    remaining: completed === null ? null : total - completed };
}
