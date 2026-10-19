import { EMPTY_VALUE } from '@/lib/format';

/** Decimal hours -> an OTJH clock, "HH:MM:SS". The Activity Log records
 * seconds, so they are kept; hours grow past two digits for programme totals.
 * 1.3756 -> "01:22:32", 23 / 3600 -> "00:00:23", 1400 -> "1400:00:00". */
export function formatHoursClock(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EMPTY_VALUE;
  const totalSeconds = Math.round(value * 3600);
  const sign = totalSeconds < 0 ? '-' : '';
  const seconds = Math.abs(totalSeconds);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${sign}${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}
