export type ActivityTimeChoice = 'correct' | 'add' | 'retry';
export const ACTIVITY_TIME_LIMIT = 8 * 3600;
export interface ActivityTimeRecord {
  submittedAt?: string; passed?: boolean | null; claimedSeconds?: number | null; verifiedSeconds?: number | null;
  reportedTime?: string | null; timeTaken?: string | null; timeTrackingSource?: string | null;
  retakeTimeChoice?: ActivityTimeChoice | 'keep' | 'new';
}
export function activityTimeSeconds(row: ActivityTimeRecord): number {
  const claimed = row.claimedSeconds, verified = row.verifiedSeconds;
  const source = (row.timeTrackingSource || '').toLowerCase();
  if (claimed != null && Number.isFinite(claimed) && (source.endsWith(':input') || source.includes('manual_input')
    || (!source.includes('import') && (source.endsWith(':timer') || (verified != null && claimed > verified + 2))))) return Math.max(0, claimed);
  const text = (row.reportedTime || '').trim().toLowerCase();
  if (text) {
    // Match the server's legacy reported-time units for the previous total.
    if (text.includes(':')) {
      const [minutes, seconds] = text.split(':').map(Number);
      return Number.isFinite(minutes + seconds) ? Math.max(0, minutes * 60 + seconds) : 0;
    }
    const hours = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/g)];
    const minutes = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/g)];
    if (hours.length || minutes.length) return hours.reduce((sum, match) => sum + Number(match[1]) * 3600, 0)
      + minutes.reduce((sum, match) => sum + Number(match[1]) * 60, 0);
    const bare = text.match(/\d+(?:\.\d+)?/);
    return bare ? Number(bare[0]) * (Number(bare[0]) > 24 ? 60 : 3600) : 0;
  }
  if (verified != null) return Math.max(0, verified);
  const clock = (row.timeTaken || '').split(':').map(Number);
  if (clock.length === 3) return clock[0] * 3600 + clock[1] * 60 + clock[2];
  return clock.length === 2 ? clock[0] * 60 + clock[1] : 0;
}
export function applyActivityTime(previous: number, current: number, choice?: ActivityTimeChoice): number {
  return choice === 'add' ? previous + current : choice === 'retry' ? Math.max(previous, current) : current;
}
export function countedActivityTime(rows: ActivityTimeRecord[]): number {
  let seconds = 0, selected = false;
  const ordered = rows.filter(item => item.passed !== false).map((item, index) => ({ ...item, index }))
    .sort((a, b) => Date.parse(a.submittedAt || '') - Date.parse(b.submittedAt || '') || a.index - b.index);
  const firstDecision = ordered.findIndex(row => ['correct', 'add', 'retry'].includes(row.retakeTimeChoice || ''));
  let fallback: ActivityTimeChoice = ordered.slice(0, firstDecision < 0 ? ordered.length : firstDecision)
    .some(row => ['keep', 'new'].includes(row.retakeTimeChoice || '')) ? 'correct' : 'retry';
  for (const row of ordered) {
    if (row.retakeTimeChoice === 'keep' && selected) continue;
    if (['correct', 'add', 'retry'].includes(row.retakeTimeChoice || '')) fallback = 'retry';
    seconds = applyActivityTime(seconds, activityTimeSeconds(row), (row.retakeTimeChoice || fallback) as ActivityTimeChoice);
    selected = true;
  }
  return seconds;
}
export function activityTimeIssue(previous: number, current: number, choice?: ActivityTimeChoice): string {
  const total = applyActivityTime(previous, current, choice);
  if (total <= ACTIVITY_TIME_LIMIT) return '';
  return choice === 'add'
    ? `You already have ${Number((previous / 3600).toFixed(2))} hours recorded. Adding ${Number((current / 3600).toFixed(2))} hours would make ${Number((total / 3600).toFixed(2))} hours, above the 8-hour limit for this activity. Enter a smaller additional time and try again. Your answers are kept.`
    : 'The recorded time for one activity cannot exceed 8 hours. Check the hours and minutes, enter a shorter time and try again. Your answers are kept.';
}
