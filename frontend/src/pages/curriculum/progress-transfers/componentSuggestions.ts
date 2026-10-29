import type { TransferMapping, TransferReview } from '@/api/progressTransfer';

type ModuleReview = TransferReview['modules'][number];

function normalizedTitle(title: string) {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/^(?:(?:p\d+|pptx?|pdf|docx?)\b[\s\p{P}]*|\d+\s*[.)\-:]\s*)+/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function bigrams(value: string) {
  const result = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const pair = value.slice(i, i + 2);
    result.set(pair, (result.get(pair) ?? 0) + 1);
  }
  return result;
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = bigrams(left), b = bigrams(right);
  const overlap = [...a].reduce((sum, [pair, count]) => sum + Math.min(count, b.get(pair) ?? 0), 0);
  return 2 * overlap / Math.max(1, left.length + right.length - 2);
}

/** Compare names only. Numbered parts remain distinct after removing export prefixes. */
export function nameSimilarity(left: string, right: string) {
  const a = normalizedTitle(left), b = normalizedTitle(right);
  if ((a.match(/\d+/g) ?? []).join(',') !== (b.match(/\d+/g) ?? []).join(',')) return 0;
  return Math.max(similarity(a, b), similarity(a.split(' ').sort().join(' '), b.split(' ').sort().join(' ')));
}

/** Suggestions become explicit review decisions; they never award progress themselves. */
export function componentSuggestions(
  source: ModuleReview['sources'][number],
  targets: ModuleReview['targets'],
  used: ReadonlySet<string>,
) {
  const ranked = targets.filter(target => source.type !== 'unknown' && target.type === source.type)
    .map(target => ({ target, score: nameSimilarity(source.title, target.title), used: used.has(target.componentId) }))
    .sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
  const available = ranked.filter(row => !row.used);
  const best = available[0];
  // Do not label weak or ambiguous similarities as a single recommendation.
  const suggestedId = best && best.score >= 0.84 && best.score - (available[1]?.score ?? 0) >= 0.1
    ? best.target.componentId : null;
  return { candidates: ranked.map(row => row.target), suggestedId };
}

export function suggestedMappings(review: TransferReview): TransferMapping[] {
  return review.modules.flatMap(module => {
    const used = new Set(module.sources.flatMap(source => source.automaticTargetId ? [source.automaticTargetId] : []));
    const saved = module.sources.filter(source => !source.automaticTargetId && source.savedTargetId && source.type !== 'unknown'
      && !used.has(source.savedTargetId) && module.targets.some(target => target.componentId === source.savedTargetId && target.type === source.type))
      .map(source => ({ moduleId: module.moduleId, sourceActivityRef: source.sourceActivityRef, targetComponentId: source.savedTargetId! }));
    const uniqueSaved = saved.filter(row => saved.filter(other => other.targetComponentId === row.targetComponentId).length === 1);
    uniqueSaved.forEach(row => used.add(row.targetComponentId));
    const proposals = module.sources.filter(source => !source.automaticTargetId && !uniqueSaved.some(row => row.sourceActivityRef === source.sourceActivityRef)).flatMap(source => {
      const { suggestedId } = componentSuggestions(source, module.targets, used);
      return suggestedId ? [{ moduleId: module.moduleId, sourceActivityRef: source.sourceActivityRef, targetComponentId: suggestedId }] : [];
    });
    // Competing old components need a human decision, regardless of source order.
    return [...uniqueSaved, ...proposals.filter(proposal => proposals.filter(row => row.targetComponentId === proposal.targetComponentId).length === 1)];
  });
}

export function byWeek<T extends { week: string }>(items: T[]): [string, T[]][] {
  const weeks = new Map<string, T[]>();
  for (const item of items) {
    const week = item.week.trim();
    weeks.set(week, [...(weeks.get(week) ?? []), item]);
  }
  return [...weeks].sort(([a], [b]) => Number(!a) - Number(!b) || a.localeCompare(b, 'en', { numeric: true }));
}
