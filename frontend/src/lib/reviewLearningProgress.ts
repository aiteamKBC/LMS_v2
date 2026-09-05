import type {
  LearnerComponentEntry,
  LearnerComponentProgress,
  LearnerQuizAttempt,
  LearnerVideoProgress,
} from '@/api/learnerDetail';

export type LearningProgressRecord = LearnerQuizAttempt | LearnerVideoProgress | LearnerComponentProgress;

function recordKey(record: LearningProgressRecord, index: number): string {
  // The same activity may genuinely be completed on different dates. Only
  // collapse duplicate copies of the same saved completion.
  if ('quizId' in record) return `quiz:${record.quizId}:${record.submittedAt}`;
  if (record.componentId) return `component:${record.componentId}:${record.submittedAt}`;
  return `entry:${index}`;
}

export function uniqueLearningProgress(records: LearningProgressRecord[]): LearningProgressRecord[] {
  const seen = new Set<string>();
  return records.filter((record, index) => {
    const key = recordKey(record, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacyReportedMinutes(value?: string | null): number {
  if (!value) return 0;
  const text = value.trim().toLowerCase();
  const hours = [...text.matchAll(/([\d.]+)\s*(?:hours?|hrs?|h)\b/gi)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
  const minutes = [...text.matchAll(/([\d.]+)\s*(?:minutes?|mins?|m)\b/gi)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
  if (hours || minutes) return (hours * 60) + minutes;
  const numeric = Number.parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] || '0');
  if (!Number.isFinite(numeric)) return 0;
  // Legacy convention: 1..24 are hours; larger bare values are minutes.
  // Therefore "60" is one hour, not sixty hours.
  return numeric > 24 ? numeric : numeric * 60;
}

function componentForRecord(record: LearningProgressRecord, components: LearnerComponentEntry[]) {
  if ('quizId' in record) {
    return components.find((component) => component.quizMeta?.quizId === record.quizId);
  }
  return components.find((component) => component.componentId === record.componentId);
}

/** Actual tracked time, then the backend-compatible fallback for legacy rows. */
export function learningMinutesForRecord(
  record: LearningProgressRecord,
  components: LearnerComponentEntry[],
): number {
  if (record.verifiedSeconds != null && Number.isFinite(Number(record.verifiedSeconds))) {
    return Math.max(Number(record.verifiedSeconds), 0) / 60;
  }
  if (record.expectedOtjh != null && Number.isFinite(Number(record.expectedOtjh))) {
    return Math.max(Number(record.expectedOtjh), 0) * 60;
  }
  const expectedOtjh = componentForRecord(record, components)?.expectedOtjh;
  if (expectedOtjh != null && Number.isFinite(Number(expectedOtjh))) {
    return Math.max(Number(expectedOtjh), 0) * 60;
  }
  return legacyReportedMinutes(record.reportedTime);
}

export function learningKsbCodes(records: LearningProgressRecord[], components: LearnerComponentEntry[]): string[] {
  const codes = new Set<string>();
  records.forEach((record) => {
    const savedCodes = record.ksbs || [];
    const fallbackCodes = savedCodes.length
      ? []
      : (componentForRecord(record, components)?.ksbMappings || []).map((mapping) => mapping.code);
    [...savedCodes, ...fallbackCodes].forEach((code) => {
      const normalized = code.trim().toUpperCase();
      if (normalized) codes.add(normalized);
    });
  });
  return [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function activityTimeLabel(minutes: number): string {
  const roundedMinutes = Math.round(minutes);
  if (roundedMinutes < 60) return `${roundedMinutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}
