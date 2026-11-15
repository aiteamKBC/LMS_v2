import { useEffect, useMemo, useState } from "react";
import { FEEDBACK_CRITERIA, FORMS_CRITERIA, REVIEWER_NAME } from "@/pages/dashboard/constants";
import type { AuditEntry, CheckStatus, CriterionState, Review } from "@/pages/dashboard/types";
import { fmtDate, nowLabel } from "@/pages/dashboard/utils";
import StatusBadge, { FormStatusPill } from "@/pages/dashboard/components/StatusBadge";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const STATE_STYLES: Record<CriterionState, string> = {
  Pass: "bg-emerald-600 text-white",
  Fail: "bg-red-600 text-white",
  "Needs Improvement": "bg-orange-500 text-white",
  "Not Checked": "text-foreground-500 hover:bg-background-100",
};

const STATE_LABEL: Record<string, string> = {
  Pass: "Pass",
  Fail: "Fail",
  "Needs Improvement": "Needs imp.",
  "Not Checked": "Not checked",
};

function CriteriaList({
  title,
  description,
  criteria,
  states,
  onChange,
}: {
  title: string;
  description: string;
  criteria: { id: string; label: string }[];
  states: CriterionState[];
  onChange: (index: number, state: CriterionState) => void;
}) {
  const passed = states.filter((s) => s === "Pass").length;
  const checked = states.filter((s) => s !== "Not Checked").length;
  return (
    <div className="rounded-lg border border-background-200 bg-background-50">
      <div className="flex items-start justify-between gap-3 border-b border-background-200 px-3 py-2.5">
        <div>
          <h3 className="font-heading text-[12px] font-semibold text-foreground-950">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{description}</p>
        </div>
        <span className="whitespace-nowrap rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-semibold text-foreground-600">
          {passed}/{criteria.length} pass
          {checked < criteria.length ? ` · ${criteria.length - checked} open` : ""}
        </span>
      </div>
      <ul className="divide-y divide-background-100 px-3">
        {criteria.map((criterion, index) => {
          const state = states[index] ?? "Not Checked";
          return (
            <li key={criterion.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground-800">{criterion.label}</p>
              <div className="inline-flex flex-none items-center gap-0.5 rounded-md bg-background-100 p-0.5">
                {(["Pass", "Fail", "Needs Improvement"] as CriterionState[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={state === option}
                    onClick={() => onChange(index, state === option ? "Not Checked" : option)}
                    className={cn(
                      "whitespace-nowrap rounded px-1.5 py-1 text-[10px] font-semibold transition-colors",
                      state === option ? STATE_STYLES[option] : STATE_STYLES["Not Checked"],
                    )}
                  >
                    {STATE_LABEL[option]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Props = {
  review: Review;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Review>, entry: AuditEntry) => void;
  onPreview: () => void;
  onDownload: () => void;
  onOpenRecord: () => void;
};

export default function ReviewDrawer({ review, onClose, onUpdate, onPreview, onDownload, onOpenRecord }: Props) {
  const [formsStates, setFormsStates] = useState<CriterionState[]>(review.formsChecks);
  const [feedbackStates, setFeedbackStates] = useState<CriterionState[]>(review.feedbackChecks);
  const [comment, setComment] = useState(review.comments);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openForms = useMemo(() => formsStates.filter((s) => s === "Not Checked").length, [formsStates]);

  const setFormState = (index: number, state: CriterionState) =>
    setFormsStates((prev) => prev.map((value, i) => (i === index ? state : value)));
  const setFeedbackState = (index: number, state: CriterionState) =>
    setFeedbackStates((prev) => prev.map((value, i) => (i === index ? state : value)));

  const decide = (status: CheckStatus) => {
    onUpdate(
      review.id,
      {
        formCheck: status,
        feedbackCheck: status,
        formsChecks: formsStates,
        feedbackChecks: feedbackStates,
        comments: comment,
        reviewer: REVIEWER_NAME,
        decidedAt: nowLabel(),
      },
      { id: `a-${review.id}-${Date.now()}`, action: `Quality decision: ${status}`, reviewer: REVIEWER_NAME, date: nowLabel(), comment: comment.trim() || undefined },
    );
  };

  const saveDraft = () => {
    onUpdate(
      review.id,
      {
        formCheck: review.formCheck === "Pending" ? "In Review" : review.formCheck,
        feedbackCheck: review.feedbackCheck === "Pending" ? "In Review" : review.feedbackCheck,
        formsChecks: formsStates,
        feedbackChecks: feedbackStates,
        comments: comment,
        reviewer: REVIEWER_NAME,
      },
      { id: `a-${review.id}-${Date.now()}`, action: "Quality check saved as draft", reviewer: REVIEWER_NAME, date: nowLabel(), comment: comment.trim() || undefined },
    );
  };

  const info: { label: string; value: string }[] = [
    { label: "Learner", value: `${review.learner} · ${review.learnerId}` },
    { label: "Coach", value: review.coach },
    { label: "Programme", value: `${review.programme} · ${review.cohort}` },
    { label: "Module", value: review.module },
    { label: "Form type", value: review.formType },
    { label: "Meeting date", value: fmtDate(review.meetingDate) },
    { label: "Submission date", value: fmtDate(review.submissionDate) },
    { label: "Saved by", value: review.savedBy },
    { label: "PDF version", value: review.version },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print">
      <div className="qa-fade absolute inset-0 bg-foreground-950/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={`Review ${review.learner}`} className="qa-drawer relative flex h-full w-full max-w-[600px] flex-col border-l border-background-200 bg-background-50">
        <header className="flex-none border-b border-background-200 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{review.id}</p>
                <FormStatusPill status={review.formStatus} />
              </div>
              <h2 className="mt-0.5 truncate font-heading text-[16px] font-semibold text-foreground-950">{review.learner}</h2>
              <p className="truncate text-[12px] text-foreground-500">
                {review.formType} · {review.version}
              </p>
            </div>
            <button type="button" onClick={onClose} className="grid size-8 flex-none place-items-center rounded-md border border-background-200 text-foreground-500 hover:bg-background-100" aria-label="Close review panel">
              <i className="ri-close-line text-[18px]" aria-hidden />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Forms</span>
            <StatusBadge status={review.formCheck} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Feedback</span>
            <StatusBadge status={review.feedbackCheck} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-background-100 pt-2.5">
            <span className="mr-auto inline-flex items-center gap-1 text-[10.5px] font-medium text-foreground-500">
              <i className="ri-file-pdf-2-line text-[12px] text-foreground-400" aria-hidden />
              Saved PDF – version {review.version}
            </span>
            <button
              type="button"
              onClick={onPreview}
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-background-300 bg-background-50 px-2.5 text-[11px] font-semibold text-foreground-800 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
            >
              <i className="ri-eye-line text-[13px]" aria-hidden />
              Preview PDF
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary-500 px-2.5 text-[11px] font-semibold text-background-50 transition-colors hover:bg-primary-600"
            >
              <i className="ri-download-2-line text-[13px]" aria-hidden />
              Download PDF
            </button>
            <button
              type="button"
              onClick={onOpenRecord}
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary-400 bg-background-50 px-2.5 text-[11px] font-semibold text-primary-700 transition-colors hover:bg-primary-100"
            >
              <i className="ri-clipboard-line text-[13px]" aria-hidden />
              Open review
            </button>
          </div>
        </header>

        <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Review information</h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border border-background-200 bg-background-100/60 p-3 sm:grid-cols-2">
              {info.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-wide text-foreground-400">{row.label}</dt>
                  <dd className="truncate text-[12px] font-medium text-foreground-900" title={row.value}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">Coach feedback summary</p>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground-800">{review.feedbackSummary || "No feedback summary was recorded on this submission."}</p>
            </div>
          </section>

          <div className="mt-4 flex flex-col gap-3">
            <CriteriaList
              title="Forms Quality Check"
              description="Completeness, accuracy and compliance of the submitted form."
              criteria={FORMS_CRITERIA}
              states={formsStates}
              onChange={setFormState}
            />
            <CriteriaList
              title="Feedback Quality Check"
              description="Quality, clarity and actionability of the coach's written feedback."
              criteria={FEEDBACK_CRITERIA}
              states={feedbackStates}
              onChange={setFeedbackState}
            />
          </div>

          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Quality decision</h3>
              <span className="text-[10px] text-foreground-400">
                {openForms > 0 ? `${openForms} forms criteria still open` : "All forms criteria reviewed"}
              </span>
            </div>
            <div className="rounded-lg border border-background-200 bg-background-50 p-3">
              <label htmlFor="qa-comments" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-500">
                Reviewer comments
              </label>
              <textarea
                id="qa-comments"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                rows={3}
                maxLength={500}
                placeholder="Add the reason for this decision so the coach knows exactly what to change."
                className="w-full resize-none rounded-md border border-background-300 bg-background-50 px-2.5 py-2 text-[12px] leading-relaxed text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
              <div className="mt-1 flex items-center justify-between text-[10px] text-foreground-400">
                <span>Visible to the coach and stored in the audit record.</span>
                <span className="tabular-nums">{comment.length}/500</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md bg-background-100 px-2.5 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-[10px] font-semibold text-background-50">AR</span>
                <div className="leading-tight">
                  <p className="text-[11px] font-semibold text-foreground-900">{REVIEWER_NAME}</p>
                  <p className="text-[10px] text-foreground-500">{review.decidedAt ? `Last decision ${review.decidedAt}` : "No decision recorded yet"}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Audit history</h3>
            <ol className="relative ml-1 border-l border-background-200 pl-3">
              {review.audit.map((entry) => (
                <li key={entry.id} className="relative pb-3 last:pb-0">
                  <span className="absolute -left-[17px] top-1 size-2 rounded-full border-2 border-background-50 bg-primary-400" aria-hidden />
                  <p className="text-[12px] font-medium leading-snug text-foreground-900">{entry.action}</p>
                  <p className="text-[10px] text-foreground-500">
                    {entry.reviewer} · {entry.date}
                  </p>
                  {entry.comment ? <p className="mt-1 rounded bg-background-100 px-2 py-1 text-[11px] italic leading-snug text-foreground-600">“{entry.comment}”</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="flex-none border-t border-background-200 bg-background-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => decide("Approved")}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 text-[12px] font-semibold text-background-50 hover:bg-primary-600"
            >
              <i className="ri-check-double-line text-[15px]" aria-hidden />
              Approve
            </button>
            <button
              type="button"
              onClick={() => decide("Rejected")}
              className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-3 text-[12px] font-semibold text-red-700 hover:bg-red-100"
            >
              <i className="ri-close-circle-line text-[15px]" aria-hidden />
              Reject
            </button>
            <button
              type="button"
              onClick={() => decide("Needs Correction")}
              className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-orange-300 bg-orange-50 px-3 text-[12px] font-semibold text-orange-700 hover:bg-orange-100"
            >
              <i className="ri-loop-right-line text-[15px]" aria-hidden />
              Request correction
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 text-[12px] font-semibold text-foreground-700 hover:bg-background-100"
            >
              <i className="ri-save-3-line text-[15px]" aria-hidden />
              Save draft
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
