export function durationParts(value: number) {
  const totalSeconds = Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 3600));
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}


export function durationHours(hours: number, minutes: number, seconds: number) {
  return Math.round((hours + minutes / 60 + seconds / 3600) * 10_000) / 10_000;
}


export function formatHoursDuration(value: number | null | undefined) {
  if (value == null) return "—";
  const parts = durationParts(value);
  return `${parts.hours}h ${String(parts.minutes).padStart(2, "0")}m ${String(parts.seconds).padStart(2, "0")}s`;
}
