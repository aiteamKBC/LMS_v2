import { reportedTimeMinutes } from './reportedTime';

export interface OtjhContributionInput {
  expectedOtjh?: unknown;
  fallbackExpectedOtjh?: unknown;
  reportedTime?: string | null;
  verifiedSeconds?: unknown;
  claimedSeconds?: unknown;
  timeTrackingSource?: string | null;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Detect a learner-entered Time spent value. New records carry the `:input`
 * provenance marker; older records are recognised when the claimed duration
 * is materially larger than the server-capped session duration.
 */
function manualClaimedSeconds(input: OtjhContributionInput): number | null {
  const claimed = finiteNumber(input.claimedSeconds);
  if (claimed == null || claimed < 0) return null;
  const verified = finiteNumber(input.verifiedSeconds);
  const source = String(input.timeTrackingSource || '').toLowerCase();
  const explicitlyManual = source.endsWith(':input') || source.includes('manual_input');
  const inferredLegacyManual = verified != null && claimed > verified + 2;
  return explicitlyManual || inferredLegacyManual ? claimed : null;
}

/** The value one attempt contributes, following the learner-input precedence. */
export function otjhContributionHours(input: OtjhContributionInput): number {
  const manualSeconds = manualClaimedSeconds(input);
  if (manualSeconds != null) return manualSeconds / 3600;

  const reportedText = String(input.reportedTime || '').trim();
  if (reportedText) return (reportedTimeMinutes(reportedText) || 0) / 60;

  const verified = finiteNumber(input.verifiedSeconds);
  if (verified != null && verified >= 0) return verified / 3600;

  const expected = finiteNumber(input.expectedOtjh);
  if (expected != null && expected > 0) return expected;
  const fallback = finiteNumber(input.fallbackExpectedOtjh);
  return fallback != null && fallback > 0 ? fallback : 0;
}
