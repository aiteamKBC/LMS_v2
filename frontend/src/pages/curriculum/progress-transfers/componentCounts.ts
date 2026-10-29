import type { TransferMapping, TransferReview } from '@/api/progressTransfer';

/** Preview approval counts, preserving the LMS's retained passed quizzes. */
export function previewComponentCounts(module: TransferReview['modules'][number], mappings: TransferMapping[]) {
  const targets = new Set(module.targets.map(target => target.componentId));
  const sources = new Set(module.sources.filter(source => !source.automaticTargetId).map(source => source.sourceActivityRef));
  const matched = new Set([
    ...module.sources.flatMap(source => source.automaticTargetId ? [source.automaticTargetId] : []),
    ...mappings.filter(mapping => mapping.moduleId === module.moduleId && sources.has(mapping.sourceActivityRef))
      .map(mapping => mapping.targetComponentId),
  ].filter(id => targets.has(id)));
  // An older API response does not establish that existing completions are zero.
  const retained = new Set((module.retainedCompletedIds ?? []).filter(id => !targets.has(id)));
  const total = targets.size + retained.size;
  const completed = module.completedTargetIds === undefined ? null
    : new Set([...module.completedTargetIds.filter(id => targets.has(id)), ...matched, ...retained]).size;
  return { total, matched: matched.size, completed,
    remaining: completed === null ? null : total - completed };
}
