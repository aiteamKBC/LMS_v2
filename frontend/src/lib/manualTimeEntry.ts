const WARNING_SECONDS = 8 * 3600;

/** Display-only warning; never interpret a unitless value or change saved time. */
export function exceedsManualTimeWarning(duration: number | string): boolean {
  if (typeof duration === 'number') return Number.isFinite(duration) && duration > WARNING_SECONDS;
  const units = /(\d+(?:\.\d+)?|\.\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi;
  const parts = [...duration.matchAll(units)];
  if (!parts.length || duration.replace(units, '').replace(/\band\b|[\s,]/gi, '')) return false;
  const seconds = parts.reduce((sum, match) => sum + Number(match[1]) *
    (/^h/i.test(match[2]) ? 3600 : /^m/i.test(match[2]) ? 60 : 1), 0);
  return Number.isFinite(seconds) && seconds > WARNING_SECONDS;
}
