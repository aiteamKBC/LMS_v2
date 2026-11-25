export function clean(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function normalise(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Curriculum treats 'Unassigned' as a sentinel rather than a real staff name, so
// every staffing read goes through here instead of comparing strings ad hoc.
export const UNASSIGNED_STAFF = 'Unassigned';

export function isStaffAssigned(value?: string) {
  const name = clean(value);
  return Boolean(name) && normalise(name) !== normalise(UNASSIGNED_STAFF);
}

export function uniqueCleanValues(values: unknown[]) {
  const seen = new Set<string>();
  return values.map(value => clean(value)).filter(value => {
    const key = normalise(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatHours(value: number | string) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
}

export function slugify(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
