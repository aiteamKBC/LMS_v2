// ============================================================================
// Hour and minute columns for picking a session time.
//
// Shared because the same control now appears in two places: the learner
// booking their own first session, and an enrolment officer moving it from the
// learner's record. One copy so the two cannot drift about which hours the
// college works or what format the backend is handed.
// ============================================================================

/** The hours a session may start, in UK wall clock. Mirrors
 *  COLLEGE_DAY_START / COLLEGE_LAST_SLOT_START in
 *  learner_api/coach_availability.py: an hour-long session starting at 16:00
 *  finishes as the college closes.
 *
 *  Bounded rather than a full 24-hour clock because the meeting happens in
 *  Kent. A case owner whose Outlook is set to another country would otherwise
 *  be offered their own early morning, which books an hour nobody is working. */
export const SESSION_HOURS = Array.from({ length: 8 }, (_, i) => i + 9);
export const SESSION_MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** A time as people read it — "9:00 AM" over the 24-hour value that is booked,
 *  so an afternoon slot can never be mistaken for a morning one. */
export function slotLabel(slot: string): string {
  const [hour, minute] = slot.split(':').map(Number);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/**
 * Hour and minute in two scrolling columns.
 *
 * Deliberately not `input type="time"`: that draws the browser's locale
 * control, which shows an empty `--:-- --` box and reads as AM/PM on a field
 * the backend treats as UK 24-hour wall clock.
 */
export function SessionTimeColumns({
  value,
  onChange,
  labelledBy,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  labelledBy?: string;
  disabled?: boolean;
}) {
  const [hour, minute] = value ? value.split(':').map(Number) : [null, null];
  const set = (h: number | null, m: number | null) => {
    // A time is only meaningful once both halves are known. Picking an hour
    // first defaults the minutes to o'clock rather than writing a half value
    // the backend would reject.
    if (h === null) return;
    onChange(`${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`);
  };
  const cell = (selected: boolean) =>
    `w-full px-3 py-1 text-[12px] tabular-nums text-left transition-smooth cursor-pointer ${
      selected
        ? 'bg-primary-500 text-white font-semibold'
        : 'text-foreground-600 hover:bg-background-200'
    }`;
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="inline-flex rounded-lg border border-foreground-200 bg-background-50 overflow-hidden divide-x divide-foreground-100"
    >
      <ul className="max-h-40 w-16 overflow-y-auto" aria-label="Hour">
        {SESSION_HOURS.map((h) => (
          <li key={h}>
            <button
              type="button"
              aria-pressed={hour === h}
              disabled={disabled}
              onClick={() => set(h, minute)}
              className={`${cell(hour === h)} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {String(h).padStart(2, '0')}
            </button>
          </li>
        ))}
      </ul>
      <ul className="max-h-40 w-16 overflow-y-auto" aria-label="Minute">
        {SESSION_MINUTES.map((m) => (
          <li key={m}>
            <button
              type="button"
              aria-pressed={minute === m}
              // Minutes mean nothing on their own; until an hour is chosen
              // there is no time to attach them to.
              disabled={disabled || hour === null}
              onClick={() => set(hour, m)}
              className={`${cell(minute === m)} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
            >
              {String(m).padStart(2, '0')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
