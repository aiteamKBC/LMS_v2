// State for the Learner Journal's calculated actual hours: the pending values
// per row, and the calculate / approve / discard actions. Kept out of the
// component file so the module exports one thing each.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BASIS_LABEL,
  calculateJournalHours,
  decideJournalHours,
  formatJournalHours,
  getJournalHours,
  offsetLabel,
  runOffsetLabel,
  type CalculationField,
  type JournalHoursSummary,
} from "@/features/audit/learner-log-pro-copy/lib/journalHoursApi";

export type JournalHoursState = {
  referenceMinutes: number;
  pendingCount: number;
  message: string;
  error: string;
  isCalculating: boolean;
  calculatingField: CalculationField | null;
  isDeciding: boolean;
  calculate: (fields?: CalculationField) => void;
  decide: (decision: "approve" | "reject") => void;
  proposalFor: (rowId: number | null | undefined) =>
    { proposed: string; basis: string; plannedProposed: string | null } | null;
};

export function useJournalHours(aptemId: number | null, month: string): JournalHoursState {
  const queryClient = useQueryClient();
  // No identity box and no offset picker on this page: every run uses varied
  // offsets per row and is attributed to the workspace itself.
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const scoped = Boolean(aptemId && month);

  const summary = useQuery<JournalHoursSummary>({
    queryKey: ["journal-hours", aptemId, month],
    queryFn: () => getJournalHours(aptemId!, month),
    enabled: scoped,
    retry: false,
    staleTime: 30_000,
  });

  const byRow = useMemo(() => {
    const map = new Map<number, { proposed: string; basis: string; plannedProposed: string | null }>();
    for (const item of summary.data?.pending ?? []) {
      const basis = BASIS_LABEL[item.basis] ?? item.basis;
      map.set(item.row_id, {
        proposed: formatJournalHours(item.proposed_actual_hours),
        basis: item.basis === "timestamp_elapsed" || !item.offset_minutes
          ? basis
          : `${basis} ${offsetLabel(item.offset_minutes)}`,
        plannedProposed: item.proposed_planned_hours === null
          ? null
          : formatJournalHours(item.proposed_planned_hours),
      });
    }
    return map;
  }, [summary.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["journal-hours", aptemId, month] });
    void queryClient.invalidateQueries({ queryKey: ["manual-rows", aptemId, month] });
    void queryClient.invalidateQueries({ queryKey: ["manual-summary", aptemId] });
  };

  const calculate = useMutation({
    mutationFn: (fields: CalculationField) => calculateJournalHours(aptemId!, month, fields),
    onSuccess: (result) => {
      setError("");
      const { proposals_created, already_pending, already_matching, skipped, excluded_categories,
              planned_set, planned_each, lms_planned_hours, lms_components, planned_note } = result.summary;
      const actualPart = result.summary.fields === "planned"
        ? ""
        : ` ${proposals_created} row(s) updated, ${already_pending} already pending, `
          + `${already_matching} already correct, ${skipped} skipped, `
          + `${excluded_categories} attendance/assignment row(s) left alone.`;
      const plannedPart = planned_set
        ? ` Planned: ${lms_planned_hours}h from ${lms_components} Aptem LMS component(s) `
          + `shared across ${planned_set} reading-only row(s) (~${planned_each}h each).`
        : planned_note ? ` Planned: ${planned_note}` : "";
      const lead = result.summary.fields === "planned"
        ? "Planned hours"
        : `Actual hours (${runOffsetLabel(result.summary.offset_mode, result.summary.offset_minutes)})`;
      setMessage(`${lead}:${actualPart}${plannedPart}`);
      invalidate();
    },
    onError: (requestError: unknown) => {
      setMessage("");
      setError(requestError instanceof Error ? requestError.message : "The calculation failed.");
    },
  });

  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      decideJournalHours(decision, { aptemId: aptemId!, month }),
    onSuccess: (result) => {
      setError("");
      setMessage(result.status === "approved"
        ? `${result.decided} value(s) approved and written to the report.`
        : `${result.decided} value(s) rejected — the report is unchanged.`);
      invalidate();
    },
    onError: (requestError: unknown) => {
      setMessage("");
      setError(requestError instanceof Error ? requestError.message : "The decision failed.");
    },
  });

  return {
    referenceMinutes: summary.data?.reading_quiz_reference_minutes ?? 29,
    pendingCount: summary.data?.pending.length ?? 0,
    message,
    error,
    isCalculating: calculate.isPending,
    calculatingField: calculate.isPending ? calculate.variables ?? null : null,
    isDeciding: decide.isPending,
    calculate: (fields: CalculationField = "both") => calculate.mutate(fields),
    decide: (decision) => decide.mutate(decision),
    proposalFor: (rowId) => (rowId === null || rowId === undefined ? null : byRow.get(rowId) ?? null),
  };
}

