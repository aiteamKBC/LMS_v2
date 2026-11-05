import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_NOTE_MAX_LENGTH,
  type LearnerHighlight,
  type LearnerHighlights,
} from "./highlights";

interface HighlightPickerProps {
  learnerName: string;
  highlight?: LearnerHighlight;
  onChange: (next: LearnerHighlight | null) => void;
}

/** Colour swatches, remove button and reason field for one learner. */
export function HighlightPicker({ learnerName, highlight, onChange }: HighlightPickerProps) {
  return (
    <>
      <div className="flex items-center gap-1.5" role="group" aria-label={"Highlight colour for " + learnerName}>
        {HIGHLIGHT_COLORS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-label={item.label}
            aria-pressed={highlight?.color === item.key}
            title={`${item.colorName} – ${item.label}`}
            onClick={() => onChange({
              color: item.key,
              note: highlight?.note ?? "",
              updatedAt: new Date().toISOString(),
            })}
            className={"h-6 w-6 cursor-pointer rounded-full " + item.swatch
              + (highlight?.color === item.key ? " ring-2 ring-foreground-900 ring-offset-2" : "")}
          />
        ))}
        <button
          type="button"
          aria-label={"Remove highlight for " + learnerName}
          title="Remove highlight"
          disabled={!highlight}
          onClick={() => onChange(null)}
          className="ml-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-background-300 text-foreground-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <i className="ri-close-line" />
        </button>
      </div>
      <input
        type="text"
        value={highlight?.note ?? ""}
        maxLength={HIGHLIGHT_NOTE_MAX_LENGTH}
        disabled={!highlight}
        placeholder={highlight ? "Reason (optional)" : "Pick a colour to add a reason"}
        aria-label={"Highlight reason for " + learnerName}
        onChange={(event) => highlight && onChange({
          ...highlight,
          note: event.target.value,
          updatedAt: new Date().toISOString(),
        })}
        className="w-full rounded-md border border-background-300 bg-background-50 px-2 py-1.5 text-sm disabled:opacity-60 md:w-72"
      />
    </>
  );
}

interface HighlightLegendProps {
  highlights: LearnerHighlights;
  /** Highlight keys of the learners currently shown, for per-colour counts. */
  learnerKeys: string[];
}

/** Small key of the highlight colours with how many shown learners use each. */
export function HighlightLegend({ highlights, learnerKeys }: HighlightLegendProps) {
  const counts = Object.fromEntries(HIGHLIGHT_COLORS.map((item) => [
    item.key,
    learnerKeys.filter((key) => highlights[key]?.color === item.key).length,
  ]));
  return (
    <div role="group" aria-label="Highlight colours" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-600">
      <span className="font-label uppercase tracking-wide text-foreground-500">Highlights</span>
      {HIGHLIGHT_COLORS.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={"h-2.5 w-2.5 rounded-full " + item.swatch} />
          {item.colorName} – {item.label} ({counts[item.key]})
        </span>
      ))}
    </div>
  );
}
