import { useMemo, useState } from "react";
import { avatarClass, getInitials } from "@/utils/bulkAttendance";
import type { AttendanceRow } from "./AttendanceTable";
import { HighlightLegend, HighlightPicker } from "./HighlightControls";
import {
  HIGHLIGHT_COLORS,
  highlightColor,
  highlightKey,
  type HighlightColor,
  type LearnerHighlight,
  type LearnerHighlights,
} from "./highlights";

type HighlightFilter = "all" | "highlighted" | HighlightColor;

interface HighlightsTabProps {
  rows: AttendanceRow[];
  loading: boolean;
  highlights: LearnerHighlights;
  onHighlightChange: (key: string, next: LearnerHighlight | null) => void;
}

export default function HighlightsTab({ rows, loading, highlights, onHighlightChange }: HighlightsTabProps) {
  const [filter, setFilter] = useState<HighlightFilter>("all");

  const learnerKeys = rows.map((row) => highlightKey(row.learner));
  const highlightedCount = learnerKeys.filter((key) => highlights[key]).length;
  const visibleRows = useMemo(() => {
    const isHighlighted = (row: AttendanceRow) => Boolean(highlights[highlightKey(row.learner)]);
    const list = filter === "all"
      ? rows
      : filter === "highlighted"
      ? rows.filter(isHighlighted)
      : rows.filter((row) => highlights[highlightKey(row.learner)]?.color === filter);
    // Highlighted learners first, otherwise keep the register's order.
    return [...list].sort((left, right) => Number(isHighlighted(right)) - Number(isHighlighted(left)));
  }, [filter, highlights, rows]);

  return (
    <section className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground-950">Highlighted learners</h3>
          <p className="mt-0.5 text-xs text-foreground-500">
            {highlightedCount} of {rows.length} learners highlighted · Saved automatically in this browser only
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-foreground-700">
          Show
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as HighlightFilter)}
            className="rounded-md border border-background-300 bg-background-50 px-2 py-1.5 text-sm"
          >
            <option value="all">All learners</option>
            <option value="highlighted">All highlighted</option>
            {HIGHLIGHT_COLORS.map((item) => (
              <option key={item.key} value={item.key}>{item.colorName} – {item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <HighlightLegend highlights={highlights} learnerKeys={learnerKeys} />

      <div className="overflow-hidden rounded-lg border border-background-300 bg-background-50">
        {loading ? (
          <p role="status" className="p-6 text-sm text-foreground-600">Loading learners…</p>
        ) : visibleRows.length === 0 ? (
          <p className="p-6 text-center text-sm text-foreground-500">
            {filter === "all" ? "No learners match these filters." : "No highlighted learners match these filters."}
          </p>
        ) : visibleRows.map((row) => {
          const key = highlightKey(row.learner);
          const highlight = highlights[key];
          const color = highlightColor(highlight);
          return (
            <div
              key={row.learner.id}
              className={"flex flex-col gap-3 border-l-4 border-t border-t-background-200 px-4 py-3 first:border-t-0 md:flex-row md:items-center "
                + (color ? color.row : "border-l-transparent")}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold " + avatarClass(row.index)}>
                  {getInitials(row.learner.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground-950">{row.learner.name}</span>
                  <span className="block truncate text-xs text-foreground-500">{row.learner.email} · {row.groupName}</span>
                </span>
              </div>
              <HighlightPicker
                learnerName={row.learner.name}
                highlight={highlight}
                onChange={(next) => onHighlightChange(key, next)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
