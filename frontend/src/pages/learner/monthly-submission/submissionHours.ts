/** Saved input is decimal hours; older submissions can contain MM:SS or HH:MM:SS. */
export function formatSubmissionHours(value: string | number | null | undefined): string {
  if (value == null || String(value).trim() === '') return 'Not recorded';
  const text = String(value).trim();
  let seconds: number;
  if (text.includes(':')) {
    if (!/^\d+:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(text)) return 'Not recorded';
    const parts = text.split(':').map(Number);
    seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else {
    seconds = Number(text) * 3600;
  }
  if (!Number.isFinite(seconds) || seconds < 0) return 'Not recorded';
  const total = Math.round(seconds);
  const units: [number, string][] = [[Math.floor(total / 3600), 'hour'], [Math.floor(total % 3600 / 60), 'minute'], [total % 60, 'second']];
  return units.filter(([amount]) => amount > 0).map(([amount, unit]) => `${amount} ${unit}${amount === 1 ? '' : 's'}`).join(' ') || '0 hours';
}
