export type HoursValue =
  | { state: 'value'; value: number }
  | { state: 'null' | 'missing' | 'invalid' };

function readHours(value: unknown, key: string): HoursValue {
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return { state: 'missing' };
  const raw = (value as Record<string, unknown>)[key];
  if (raw === undefined) return { state: 'missing' };
  if (raw === null) return { state: 'null' };
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? { state: 'value', value: raw } : { state: 'invalid' };
}

/** Active Progress only. No aliases, coercion, pacing or fallback totals. */
export function officialHoursPresentation(data: unknown, loading: boolean, error: unknown) {
  const request = error ? 'error' : loading ? 'pending' : 'loaded';
  const otjh = data && typeof data === 'object' ? (data as Record<string, unknown>).otjh : undefined;
  const planned = readHours(otjh, 'planned');
  const actual = readHours(otjh, 'actual');
  const comparable = request === 'loaded' && planned.state === 'value' && planned.value > 0 && actual.state === 'value';
  return { request, planned, actual, comparable } as const;
}

export type OfficialHoursPresentation = ReturnType<typeof officialHoursPresentation>;

export function hoursText(hours: OfficialHoursPresentation, field: 'planned' | 'actual', format: (value: number) => string): string {
  if (hours.request === 'pending') return 'Loading';
  if (hours.request === 'error') return 'Unavailable';
  const operand = hours[field];
  if (operand.state === 'value') return format(operand.value);
  return operand.state === 'null' && field === 'planned' ? 'Not set' : 'Unavailable';
}

export function hoursAvailability(hours: OfficialHoursPresentation): string {
  if (hours.request === 'error') return 'Hours could not be loaded. Please retry.';
  if (hours.request === 'pending') return 'Loading hours';
  if (hours.planned.state === 'missing' || hours.actual.state === 'missing') return 'Required hours data was not returned.';
  return hours.comparable ? 'Official programme planned hours' : 'Programme completion and hours status: Unavailable';
}
