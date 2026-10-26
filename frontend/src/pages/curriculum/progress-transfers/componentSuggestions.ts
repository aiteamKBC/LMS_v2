import type { TransferReview } from '@/api/progressTransfer';

type ModuleReview = TransferReview['modules'][number];

/** Server content scores are advisory; never select mappings automatically. */
export function componentSuggestions(
  source: ModuleReview['sources'][number],
  targets: ModuleReview['targets'],
  used: ReadonlySet<string>,
) {
  const scores = new Map(source.contentScores?.map(row => [row.componentId, row.score]));
  const ranked = targets.filter(target => source.type !== 'unknown' && target.type === source.type)
    .map(target => ({ target, score: scores.get(target.componentId) ?? -1, used: used.has(target.componentId) }))
    .sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
  const available = ranked.filter(row => !row.used);
  const best = available[0];
  // Do not label weak or ambiguous similarities as a single recommendation.
  const suggestedId = source.contentAvailable && best && best.score >= 0.6 && best.score - (available[1]?.score ?? 0) >= 0.1
    ? best.target.componentId : null;
  return { candidates: ranked.map(row => row.target), suggestedId };
}
