import { useEffect } from "react";
import { FEEDBACK_CRITERIA, FORMS_CRITERIA } from "@/pages/dashboard/constants";
import type { Review } from "@/pages/dashboard/types";
import { fmtDate } from "@/pages/dashboard/utils";

const STATE_TEXT: Record<string, string> = {
  Pass: "Pass",
  Fail: "Fail",
  "Needs Improvement": "Needs improvement",
  "Not Checked": "Not checked",
};

export default function PdfPreviewModal({ review, onClose }: { review: Review; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: { label: string; value: string }[] = [
    { label: "Learner", value: `${review.learner} (${review.learnerId})` },
    { label: "Coach", value: review.coach },
    { label: "Programme / cohort", value: `${review.programme} · ${review.cohort}` },
    { label: "Module", value: review.module },
    { label: "Form type", value: review.formType },
    { label: "Meeting date", value: fmtDate(review.meetingDate) },
    { label: "Submission date", value: fmtDate(review.submissionDate) },
    { label: "Saved by / version", value: `${review.savedBy} · ${review.version}` },
    { label: "Form status", value: review.formStatus },
    { label: "Forms check", value: review.formCheck },
    { label: "Feedback check", value: review.feedbackCheck },
    { label: "Follow-up actions", value: String(review.followUps) },
  ];

  const criteriaTable = (title: string, criteria: { id: string; label: string }[], states: string[]) => (
    <div className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <table className="mt-1 w-full border-collapse text-[11px]">
        <tbody>
          {criteria.map((criterion, index) => (
            <tr key={criterion.id} className="border-b border-neutral-200">
              <td className="py-1.5 pr-3 text-neutral-800">{criterion.label}</td>
              <td className="w-28 py-1.5 text-right font-semibold text-neutral-900">{STATE_TEXT[states[index] ?? "Not Checked"]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 no-print md:p-6">
      <div className="qa-fade absolute inset-0 bg-foreground-950/45 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div className="qa-rise relative flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-lg border border-background-200 bg-background-100">
        <div className="flex flex-none items-center justify-between gap-3 border-b border-background-200 bg-background-50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-red-50 text-red-600">
              <i className="ri-file-pdf-2-line text-[15px]" aria-hidden />
            </span>
            <div className="leading-tight">
              <p className="text-[12px] font-semibold text-foreground-950">PDF preview</p>
              <p className="text-[10px] text-foreground-500">
                {review.learner} · {review.formType} · {review.version}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-2.5 text-[11px] font-semibold text-background-50 hover:bg-primary-600"
            >
              <i className="ri-printer-line text-[13px]" aria-hidden />
              Print / Save PDF
            </button>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md border border-background-300 text-foreground-600 hover:bg-background-100" aria-label="Close preview">
              <i className="ri-close-line text-[16px]" aria-hidden />
            </button>
          </div>
        </div>

        <div className="scroll-slim flex-1 overflow-y-auto bg-background-200/70 p-3 md:p-5">
          <article className="print-doc mx-auto w-full max-w-[720px] bg-white p-6 text-neutral-900 md:p-9">
            <div className="flex items-start justify-between border-b-2 border-neutral-900 pb-3">
              <div>
                <p className="font-heading text-[15px] font-semibold">LearnQA · Learner Review Record</p>
                <p className="text-[11px] text-neutral-500">Quality assured submission — {review.version}</p>
              </div>
              <div className="text-right text-[10px] text-neutral-500">
                <p>Ref {review.id}</p>
                <p>{fmtDate(review.submissionDate)}</p>
              </div>
            </div>

            <table className="mt-4 w-full border-collapse text-[11px]">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-neutral-200">
                    <td className="w-44 py-1.5 pr-3 align-top text-neutral-500">{row.label}</td>
                    <td className="py-1.5 font-medium text-neutral-900">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Coach feedback</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-800">{review.feedbackSummary || "No feedback summary was recorded on this submission."}</p>
            </div>

            {criteriaTable("Forms quality check", FORMS_CRITERIA, review.formsChecks)}
            {criteriaTable("Feedback quality check", FEEDBACK_CRITERIA, review.feedbackChecks)}

            <div className="mt-5 border-t border-neutral-200 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Quality reviewer comments</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-800">{review.comments || "No reviewer comments recorded."}</p>
              <div className="mt-4 flex items-end justify-between gap-4 text-[10.5px] text-neutral-600">
                <div>
                  <p>Reviewed by: {review.reviewer || "—"}</p>
                  <p>Decision date: {review.decidedAt || "Pending"}</p>
                </div>
                <div className="w-40 border-t border-neutral-400 pt-1 text-center">Authorised signature</div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
