// Calculated actual hours for the Learner Journal's Activity log rows.
//
// reading+quiz = 29 min + an offset from -15/-10/-5/0/+5/+10/+15, snapped to the
// nearest 5 minutes; video/audio = the activity's own media runtime, exactly.
// Every run uses varied offsets per row, derived from each row's identity — the
// same row always gets the same offset, so a re-run reproduces the month exactly
// and no value is a number nobody can explain twice. The page carries no auditor
// identity, so runs are attributed to the workspace itself. A row carrying a
// genuine HH:MM:SS-HH:MM:SS range keeps that elapsed time and is never shifted.
// Everything is stored as a PENDING proposal. The row's own Actual hours only change when
// someone presses Approve, and the approver has to be a different auditor than
// whoever calculated (enforced server-side and by a database constraint).
//
// Attendance and assignment rows are never calculated: attendance carries the
// register's hours and assignment hours come from Aptem.
const BASE = "/audit_api/last-audit/journal-hours";

export type JournalHoursProposal = {
  revision_id: number;
  row_id: number;
  category: string;
  previous_actual_hours: string | null;
  proposed_actual_hours: string;
  previous_planned_hours: string | null;
  proposed_planned_hours: string | null;
  planned_basis: string | null;
  proposed_seconds: number;
  basis: "reading_quiz_reference" | "media_duration" | "timestamp_elapsed";
  offset_minutes: number;
  offset_mode: "spread" | "fixed";
  proposed_by: string;
  proposed_at: string | null;
};

export type JournalHoursSummary = {
  aptem_id: number;
  month: string;
  permitted_offsets_minutes: number[];
  offset_modes: string[];
  reading_quiz_reference_minutes: number;
  pending: JournalHoursProposal[];
  history: Array<{
    revision_id: number;
    row_id: number;
    status: string;
    previous_actual_hours: string | null;
    proposed_actual_hours: string;
    basis: string;
    proposed_by: string;
    decided_by: string | null;
    decided_at: string | null;
  }>;
};

export type CalculationField = "both" | "actual" | "planned";

export type CalculateSummary = {
  fields: CalculationField;
  actual_set: number;
  lms_planned_hours: string;
  lms_components: number;
  lms_component_names: Array<{ name: string; planned_hours: string; due_date: string }>;
  reading_only_rows: number;
  planned_each: string | null;
  planned_set: number;
  planned_note: string;
  offset_mode: "spread" | "fixed";
  offset_minutes: number | null;
  offsets_used: Record<string, number>;
  rows_in_month: number;
  eligible: number;
  proposals_created: number;
  already_pending: number;
  already_matching: number;
  skipped: number;
  skipped_reasons: Record<string, number>;
  excluded_categories: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as { error?: string } | null;
    throw new Error(error?.error ?? `Journal hours request failed (${response.status})`);
  }
  return payload as T;
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export async function getJournalHours(aptemId: number, month: string): Promise<JournalHoursSummary> {
  const query = new URLSearchParams({ aptem_id: String(aptemId), month });
  return readJson<JournalHoursSummary>(await fetch(`${BASE}/summary?${query.toString()}`));
}

export async function calculateJournalHours(
  aptemId: number, month: string, fields: CalculationField = "both",
) {
  const response = await fetch(`${BASE}/calculate`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ aptem_id: aptemId, month, offset_mode: "spread", fields }),
  });
  return readJson<{ ok: boolean; actor: string; summary: CalculateSummary }>(response);
}

export async function decideJournalHours(
  decision: "approve" | "reject",
  input: { aptemId: number; month: string; revisionIds?: number[]; comment?: string },
) {
  const response = await fetch(`${BASE}/${decision}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      aptem_id: input.aptemId,
      month: input.month,
      revision_ids: input.revisionIds ?? null,
      comment: input.comment ?? null,
    }),
  });
  return readJson<{ ok: boolean; decided: number; skipped_own_proposals: number; status: string }>(response);
}

/** "0h 29m 00s" — matches the Activity log's own duration format. */
export function formatJournalHours(hours: string | number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  const total = Math.round(Number(hours) * 3600);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export const BASIS_LABEL: Record<string, string> = {
  reading_quiz_reference: "29-minute reference",
  media_duration: "the activity's runtime",
  timestamp_elapsed: "genuine elapsed time",
};

/** "+5 min" / "no offset" — how a row's offset reads in the UI. */
export function offsetLabel(minutes: number): string {
  return minutes === 0 ? "no offset" : `${minutes > 0 ? "+" : ""}${minutes} min`;
}

/** "varied (-15…+15)" / "+5 min on every row" — how a RUN reads. */
export function runOffsetLabel(mode: "spread" | "fixed", minutes: number | null): string {
  if (mode === "spread") return "varied offsets (-15…+15 min)";
  return `${offsetLabel(minutes ?? 0)} on every row`;
}
