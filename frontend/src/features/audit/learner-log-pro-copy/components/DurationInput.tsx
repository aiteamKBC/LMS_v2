type DurationInputProps = {
  value: number;
  onChange: (hours: number) => void;
  disabled?: boolean;
  maxHours?: number;
  compact?: boolean;
  ariaLabel: string;
};

function durationParts(value: number) {
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

export function DurationInput({ value, onChange, disabled = false, maxHours = 50, compact = false, ariaLabel }: DurationInputProps) {
  const parts = durationParts(value);
  const update = (part: "hours" | "minutes" | "seconds", raw: string) => {
    const parsed = Math.max(0, Number.parseInt(raw || "0", 10) || 0);
    const next = { ...parts, [part]: part === "hours" ? Math.min(parsed, maxHours) : Math.min(parsed, 59) };
    onChange(Math.min(durationHours(next.hours, next.minutes, next.seconds), maxHours));
  };
  const inputClass = compact
    ? "h-8 w-11 rounded-md border border-border bg-card px-1 text-center font-mono text-xs outline-none focus:border-primary disabled:opacity-60"
    : "h-9 w-14 rounded-md border border-border bg-card px-1.5 text-center font-mono text-sm outline-none focus:border-primary disabled:opacity-60";

  return (
    <div className="flex items-center justify-end gap-1" aria-label={ariaLabel}>
      <label className="flex items-center gap-0.5"><input type="number" min="0" max={maxHours} step="1" value={parts.hours} disabled={disabled} onChange={(event) => update("hours", event.target.value)} className={inputClass} aria-label={`${ariaLabel} hours`} /><span className="text-[10px] text-muted-foreground">h</span></label>
      <label className="flex items-center gap-0.5"><input type="number" min="0" max="59" step="1" value={parts.minutes} disabled={disabled} onChange={(event) => update("minutes", event.target.value)} className={inputClass} aria-label={`${ariaLabel} minutes`} /><span className="text-[10px] text-muted-foreground">m</span></label>
      <label className="flex items-center gap-0.5"><input type="number" min="0" max="59" step="1" value={parts.seconds} disabled={disabled} onChange={(event) => update("seconds", event.target.value)} className={inputClass} aria-label={`${ariaLabel} seconds`} /><span className="text-[10px] text-muted-foreground">s</span></label>
    </div>
  );
}
