/** Display placement only. Activity dates, deadlines and meeting identities stay separate. */
export interface DeliveryWeek {
  id: string;
  module_id: string;
  start: string | null;
  end: string | null;
  month: string | null;
}

export function deliveryDateKey(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : '';
}

/** A stored session instant names a UK teaching day, independent of this browser's zone. */
export function sessionDeliveryDate(settings: { sessionDate?: unknown; sessionDateTimeUtc?: unknown; teamsStartDateTimeUtc?: unknown }): string {
  for (const value of [settings.sessionDateTimeUtc, settings.teamsStartDateTimeUtc]) {
    const raw = String(value ?? '').trim();
    if (!raw) continue;
    const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw);
    const instant = new Date(naive ? `${raw.replace(' ', 'T')}Z` : raw);
    if (!Number.isNaN(instant.getTime())) return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant);
  }
  return deliveryDateKey(settings.sessionDate);
}

export function deliveryWeekEnd(start: string): string | null {
  if (!deliveryDateKey(start)) return null;
  const end = new Date(`${start}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}
