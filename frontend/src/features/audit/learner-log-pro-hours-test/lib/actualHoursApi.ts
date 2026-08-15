// Actual Hours review — HOURS-TEST only.
//
// Every call is scoped to ONE learner (aptem_id) and ONE month (YYYY-MM); the
// server rejects a request that omits either, so this module never offers an
// unscoped variant. The acting auditor is named in the X-Audit-Actor header,
// never in the body, and the server is the authority on who may act.
const BASE = "/hours_test_api/last-audit/actual-hours";

export type ActualHoursFinding = {
  code: string;
  severity: "informational" | "warning" | "blocking";
  message: string;
  related_ref: string | null;
};

export type ActualHoursRevision = {
  revision_id: number;
  proposed_actual_hours: string;
  proposed_seconds: number;
  calculation_type: string;
  proposed_by: string;
  proposed_at: string | null;
};

export type ActualHoursRow = {
  learner_id: number;
  kind: string;
  ref: string;
  title: string | null;
  month: string | null;
  activity_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timestamp_label: string | null;
  reporting_method: string | null;
  source_category: "timestamped" | "input" | "other" | "attendance";
  active_actual_hours: string | null;
  observed_seconds: number | null;
  media_duration_seconds: number | null;
  band: string;
  normal_min_seconds: number | null;
  normal_max_seconds: number | null;
  maximum_seconds: number | null;
  permitted_offsets_minutes: number[];
  findings: ActualHoursFinding[];
  blocking: boolean;
  pending_revision: ActualHoursRevision | null;
  history: Array<{
    revision_id: number;
    status: string;
    proposed_actual_hours: string;
    previous_actual_hours: string | null;
    calculation_type: string;
    proposed_by: string;
    decided_by: string | null;
    proposed_at: string | null;
    decided_at: string | null;
  }>;
};

export type AnalyticsBlock = {
  source: {
    eligible: number; timestamped: number; input: number; other: number;
    expected_timestamped: number; expected_input: number;
    exception_count: number; exception_rate: string | null;
    threshold: string; status: string;
  };
  long_tail: {
    eligible: number; classifiable: number; long_tail: number; unclassifiable: number;
    rate: string | null; threshold: string; status: string;
  };
};

export type ActualHoursSummary = {
  aptem_id: number;
  month: string;
  rule_version: string;
  timestamp_semantics_confirmed: boolean;
  timezone: string;
  rows: ActualHoursRow[];
  counts: {
    records_scanned: number; timestamped: number; input: number; other: number;
    input_needing_entry: number; pending_proposals: number;
    blocking: number; warnings: number; duplicates_and_overlaps: number;
    long_tail: number; unclassifiable: number;
  };
  analytics: {
    scope: AnalyticsBlock;
    global: AnalyticsBlock;
    global_rows_without_learner_scope: number;
  };
  calendar_years_covered: number[];
};

export type ScanSummary = {
  records_scanned: number;
  proposals_created: number;
  proposals_skipped_blocked: number;
  findings_resolved: number;
  blocking: number;
  warnings: number;
  duplicates: number;
  overlaps: number;
};

function actorHeaders(actor: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-Audit-Actor": actor };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as { error?: string; code?: string } | null;
    throw new Error(error?.error ?? `Actual Hours request failed (${response.status})`);
  }
  return payload as T;
}

export async function getActualHoursSummary(aptemId: number, month: string): Promise<ActualHoursSummary> {
  const query = new URLSearchParams({ aptem_id: String(aptemId), month });
  return readJson<ActualHoursSummary>(await fetch(`${BASE}/summary?${query.toString()}`));
}

export async function runActualHoursValidation(aptemId: number, month: string, actor: string) {
  const response = await fetch(`${BASE}/validate`, {
    method: "POST",
    headers: actorHeaders(actor),
    body: JSON.stringify({ aptem_id: aptemId, month }),
  });
  return readJson<{ ok: boolean; actor: string; summary: ScanSummary }>(response);
}

export async function proposeActualHours(input: {
  aptemId: number; month: string; learnerId: number; kind: string; ref: string;
  seconds: number; actor: string; comment?: string;
}) {
  const response = await fetch(`${BASE}/propose`, {
    method: "POST",
    headers: actorHeaders(input.actor),
    body: JSON.stringify({
      aptem_id: input.aptemId, month: input.month, learner_id: input.learnerId,
      kind: input.kind, ref: input.ref, proposed_seconds: input.seconds,
      comment: input.comment ?? null,
    }),
  });
  return readJson<{ ok: boolean; proposed_actual_hours: string }>(response);
}

export async function decideActualHours(
  decision: "approve" | "reject",
  input: { revisionId: number; actor: string; comment?: string },
) {
  const response = await fetch(`${BASE}/${decision}`, {
    method: "POST",
    headers: actorHeaders(input.actor),
    body: JSON.stringify({ revision_id: input.revisionId, comment: input.comment ?? null }),
  });
  return readJson<{ ok: boolean; revision_id: number; status: string }>(response);
}

/** "00:27:22" for 1642 — the journal shows durations, not decimal hours. */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const sign = seconds < 0 ? "-" : "";
  const total = Math.abs(Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatRate(rate: string | null): string {
  if (rate === null) return "—";
  return `${(Number(rate) * 100).toFixed(2)}%`;
}
