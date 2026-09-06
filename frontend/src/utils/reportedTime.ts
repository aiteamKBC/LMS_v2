/**
 * Parse the learner-entered OTJ time using the same convention as the backend:
 * bare values up to 24 are hours, while larger bare values are minutes.
 */
export function reportedTimeMinutes(value?: string | null): number | null {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;

  if (text.includes(':')) {
    const [minutes, seconds] = text.split(':').map(Number);
    if (Number.isFinite(minutes)) {
      return minutes + (Number.isFinite(seconds) ? seconds / 60 : 0);
    }
    return null;
  }

  const hours = Array.from(text.matchAll(/([\d.]+)\s*(?:hours?|hrs?|h)\b/g))
    .reduce((total, match) => total + Number(match[1]), 0);
  const minutes = Array.from(text.matchAll(/([\d.]+)\s*(?:minutes?|mins?|m)\b/g))
    .reduce((total, match) => total + Number(match[1]), 0);
  if (hours || minutes) return (hours * 60) + minutes;

  const bare = Number(text.match(/[\d.]+/)?.[0]);
  if (!Number.isFinite(bare)) return null;
  return bare > 24 ? bare : bare * 60;
}

export function formatReportedTime(value?: string | null): string {
  const totalMinutes = reportedTimeMinutes(value);
  if (totalMinutes == null) return String(value || '').trim();

  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ''}` : `${minutes}m`;
}
