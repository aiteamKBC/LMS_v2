import { useCallback, useState } from "react";
import type { Learner } from "@/types/bulkAttendance";

export type HighlightColor = "pink" | "green" | "blue";

export interface LearnerHighlight {
  color: HighlightColor;
  note: string;
  updatedAt: string;
}

export type LearnerHighlights = Record<string, LearnerHighlight>;

// Highlights are a personal marker kept only in this browser; they are never
// sent to the server and do not change any attendance record.
export const HIGHLIGHTS_STORAGE_KEY = "lms.bulkAttendance.highlights.v1";
export const HIGHLIGHT_NOTE_MAX_LENGTH = 200;

// The team's three highlight categories, matching their attendance sheet.
// Highlights saved earlier with a colour no longer listed here are dropped.
export const HIGHLIGHT_COLORS: { key: HighlightColor; colorName: string; label: string; swatch: string; row: string }[] = [
  { key: "pink", colorName: "Pink", label: "Recorded Sessions", swatch: "bg-pink-400", row: "border-l-pink-400 bg-pink-100" },
  { key: "green", colorName: "Green", label: "On Break", swatch: "bg-green-500", row: "border-l-green-500 bg-green-100" },
  { key: "blue", colorName: "Blue", label: "Withdraw", swatch: "bg-blue-500", row: "border-l-blue-500 bg-blue-100" },
];

export function highlightColor(highlight?: LearnerHighlight) {
  return HIGHLIGHT_COLORS.find((item) => item.key === highlight?.color);
}

export function highlightKey(learner: Pick<Learner, "id" | "kbcId">): string {
  return learner.kbcId || learner.id;
}

function isHighlight(value: unknown): value is LearnerHighlight {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return HIGHLIGHT_COLORS.some((color) => color.key === item.color) && typeof item.note === "string";
}

function readHighlights(): LearnerHighlights {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HIGHLIGHTS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isHighlight(value))) as LearnerHighlights;
  } catch {
    return {};
  }
}

function writeHighlights(highlights: LearnerHighlights) {
  try {
    window.localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify(highlights));
  } catch {
    /* Storage unavailable: highlights stay for this page visit only. */
  }
}

/** Shared by the Daily table and the Highlights tab; saves on every change. */
export function useLearnerHighlights() {
  const [highlights, setHighlights] = useState<LearnerHighlights>(readHighlights);
  const setHighlight = useCallback((key: string, next: LearnerHighlight | null) => {
    setHighlights((current) => {
      const updated = { ...current };
      if (next) updated[key] = next;
      else delete updated[key];
      writeHighlights(updated);
      return updated;
    });
  }, []);
  return { highlights, setHighlight };
}
