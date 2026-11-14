/** Saved API instants without an offset are UTC, never the browser's zone. */
export function activityTimestamp(value?: string | null): number {
  if (!value) return 0;
  const instant = value.includes('T') && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value;
  const timestamp = Date.parse(instant);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function latestActivityAt(values: (string | null | undefined)[]): string | undefined {
  return values.reduce<string | undefined>((latest, value) =>
    activityTimestamp(value) > activityTimestamp(latest) ? value || undefined : latest, undefined);
}

export function savedProgressAt(record: { startedAt?: string | null; submittedAt?: string | null; timeTrackingSource?: string | null }): string | undefined {
  // Attendance projections can complete a lecture without a learner opening it.
  if (!record.startedAt && ['verified_teams_attendance', 'manual_attendance'].includes(record.timeTrackingSource || '')) return undefined;
  return latestActivityAt([record.startedAt, record.submittedAt]);
}
