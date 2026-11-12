import { useEffect, useState } from "react";
import { FORMS_CRITERIA, REVIEWER_NAME, REVIEWER_ROLE, SESSION_STATUS_STYLES } from "@/pages/dashboard/constants";
import type { CoachSession, CriterionState, SessionStatus } from "@/pages/dashboard/types";
import { fmtDate, initials } from "@/pages/dashboard/utils";
import SessionQualityCheck from "@/pages/dashboard/components/SessionQualityCheck";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const FILE_ICON: Record<string, string> = {
  pdf: "ri-file-pdf-2-line",
  doc: "ri-file-excel-2-line",
  image: "ri-image-line",
};

const STATE_TONE: Record<string, string> = {
  Pass: "bg-emerald-100 text-emerald-700",
  Fail: "bg-red-100 text-red-700",
  "Needs Improvement": "bg-orange-100 text-orange-700",
  "Not Checked": "bg-background-200 text-foreground-600",
};

type Props = {
  session: CoachSession;
  onClose: () => void;
  onDecision: (status: SessionStatus, criteria: CriterionState[], comment: string) => void;
  onToast: (text: string) => void;
};

const endTime = (start: string, duration: number) => {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + duration;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

export default function SessionDrawer({ session, onClose, onDecision, onToast }: Props) {
  const [mode, setMode] = useState<"details" | "check">("details");
  const [states, setStates] = useState<CriterionState[]>(session.criteria);
  const [comment, setComment] = useState(session.comment);
  const [error, setError] = useState("");
  const [decided, setDecided] = useState<SessionStatus | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const style = SESSION_STATUS_STYLES[session.status];
  const hasDecision = session.status === "Approved" || session.status === "Needs correction" || session.status === "Rejected";
  const canRunCheck = session.status !== "Scheduled";
  const checkedCount = states.filter((state) => state !== "Not Checked").length;
  const ready = checkedCount === FORMS_CRITERIA.length;

  const setState = (index: number, state: CriterionState) => {
    setStates((prev) => prev.map((value, i) => (i === index ? state : value)));
    setError("");
  };

  const submit = (status: SessionStatus) => {
    if (!ready) {
      setError(`Review all ${FORMS_CRITERIA.length} criteria before submitting a decision. ${FORMS_CRITERIA.length - checkedCount} still open.`);
      return;
    }
    onDecision(status, states, comment);
    setDecided(status);
    setError("");
  };

  const info: { label: string; value: string }[] = [
    { label: "Learner", value: `${session.learner} · ${session.learnerId}` },
    { label: "Programme", value: session.programme },
    { label: "Cohort", value: session.cohort },
    { label: "Module", value: session.module },
    { label: "Form type", value: session.formType },
    { label: "Session date", value: fmtDate(session.date) },
    { label: "Time", value: `${session.start} – ${endTime(session.start, session.duration)} (${session.duration} min)` },
    { label: "Delivery", value: `${session.mode} · ${session.location}` },
    { label: "Submitted", value: session.submittedAt || "Not submitted yet" },
    { label: "Form version", value: session.version },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print">
      <div className="qa-fade absolute inset-0 bg-foreground-950/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Coach session ${session.id}`}
        className="qa-drawer relative flex h-full w-full max-w-[560px] flex-col border-l border-background-200 bg-background-50"
      >
        <header className="flex-none border-b border-background-200 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{session.id}</p>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", style.chip)}>
                  <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
                  {session.status}
                </span>
                {mode === "check" ? (
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-800">Quality check</span>
                ) : null}
              </div>
              <h2 className="mt-0.5 truncate font-heading text-[16px] font-semibold text-foreground-950">{session.learner}</h2>
              <p className="truncate text-[12px] text-foreground-500">
                {session.formType} · {session.version}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 flex-none cursor-pointer place-items-center rounded-md border border-background-200 text-foreground-500 hover:bg-background-100"
              aria-label="Close session panel"
            >
              <i className="ri-close-line text-[18px]" aria-hidden />
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-2 rounded-md bg-background-100 px-2.5 py-2">
            <span className="grid size-7 flex-none place-items-center rounded-full bg-primary-500 text-[10px] font-semibold text-background-50">{initials(session.coach)}</span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold leading-tight text-foreground-900">{session.coach}</p>
              <p className="truncate text-[10.5px] text-foreground-500">{session.coachRole}</p>
            </div>
            <span className="ml-auto hidden whitespace-nowrap text-[10.5px] text-foreground-500 sm:inline">
              {fmtDate(session.date)} · {session.start}
            </span>
          </div>
        </header>

        <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
          {decided ? (
            <div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
              <span className={cn("grid size-12 place-items-center rounded-full ring-1", SESSION_STATUS_STYLES[decided].chip)}>
                <i className="ri-check-double-line text-[22px]" aria-hidden />
              </span>
              <div>
                <h3 className="font-heading text-[15px] font-semibold text-foreground-950">Quality check submitted</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-foreground-600">
                  {session.id} is now marked <span className="font-semibold text-foreground-900">{decided.toLowerCase()}</span>. The coach has been notified and the decision is stored in the audit
                  trail.
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDecided(null);
                    setMode("details");
                  }}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 text-[11.5px] font-semibold text-foreground-800 hover:bg-background-100"
                >
                  <i className="ri-file-list-3-line text-[14px]" aria-hidden />
                  View session details
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 text-[11.5px] font-semibold text-background-50 hover:bg-primary-600"
                >
                  <i className="ri-calendar-2-line text-[14px]" aria-hidden />
                  Back to calendar
                </button>
              </div>
            </div>
          ) : mode === "check" ? (
            <SessionQualityCheck
              criteria={FORMS_CRITERIA}
              states={states}
              onChange={setState}
              comment={comment}
              onComment={setComment}
              error={error}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Session information</h3>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border border-background-200 bg-background-100/60 p-3 sm:grid-cols-2">
                  {info.map((row) => (
                    <div key={row.label} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wide text-foreground-400">{row.label}</dt>
                      <dd className="text-[12px] font-medium leading-snug text-foreground-900">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">Coach session summary</p>
                <p className="mt-1 text-[12px] leading-relaxed text-foreground-800">
                  {session.summary || "This session has not taken place yet, so no summary or form has been submitted."}
                </p>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Submitted files</h3>
                  <span className="text-[10px] text-foreground-400">{session.files.length} attached</span>
                </div>
                {session.files.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {session.files.map((file) => (
                      <li key={file.name} className="flex items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-2.5 py-2">
                        <span className="grid size-7 flex-none place-items-center rounded-md bg-background-100 text-foreground-600">
                          <i className={cn(FILE_ICON[file.kind], "text-[14px]")} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11.5px] font-medium text-foreground-900">{file.name}</p>
                          <p className="text-[10px] text-foreground-500">{file.size}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToast(`${file.name} opened in preview`)}
                          className="grid size-7 flex-none cursor-pointer place-items-center rounded-md border border-background-200 text-foreground-600 hover:bg-background-100"
                          aria-label={`Open ${file.name}`}
                        >
                          <i className="ri-eye-line text-[14px]" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-background-300 bg-background-100/60 px-3 py-4 text-center text-[11.5px] text-foreground-500">
                    No files submitted yet — the coach uploads evidence when the session form is completed.
                  </p>
                )}
              </section>

              {hasDecision || session.status === "In review" ? (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Quality check record</h3>
                    <span className="text-[10px] text-foreground-400">{session.decidedAt ? `Decided ${session.decidedAt}` : "In progress"}</span>
                  </div>
                  <div className="rounded-lg border border-background-200 bg-background-50 p-3">
                    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {FORMS_CRITERIA.map((criterion, index) => (
                        <li key={criterion.id} className="flex items-center gap-1.5">
                          <span className={cn("flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px]", STATE_TONE[session.criteria[index] ?? "Not Checked"])}>
                            <i
                              className={cn(
                                session.criteria[index] === "Pass" && "ri-check-line",
                                session.criteria[index] === "Fail" && "ri-close-line",
                                session.criteria[index] === "Needs Improvement" && "ri-arrow-up-line",
                                session.criteria[index] === "Not Checked" && "ri-subtract-line",
                              )}
                              aria-hidden
                            />
                          </span>
                          <span className="truncate text-[11px] text-foreground-700">{criterion.label}</span>
                        </li>
                      ))}
                    </ul>
                    {session.comment ? <p className="mt-2 rounded bg-background-100 px-2 py-1.5 text-[11px] italic leading-snug text-foreground-700">“{session.comment}”</p> : null}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>

        {!decided ? (
          <footer className="flex-none border-t border-background-200 bg-background-50 px-4 py-3">
            {mode === "check" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("details");
                      setError("");
                    }}
                    className="inline-flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-semibold text-foreground-600 hover:bg-background-100"
                  >
                    <i className="ri-arrow-left-line text-[13px]" aria-hidden />
                    Session details
                  </button>
                  <span className={cn("text-[10.5px] font-medium", ready ? "text-emerald-600" : "text-foreground-500")}>
                    {ready ? "All criteria reviewed" : `${checkedCount}/${FORMS_CRITERIA.length} reviewed`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => submit("Approved")}
                    disabled={!ready}
                    className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 text-[12px] font-semibold text-background-50 transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <i className="ri-check-double-line text-[15px]" aria-hidden />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => submit("Needs correction")}
                    disabled={!ready}
                    className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-orange-300 bg-orange-50 px-3 text-[12px] font-semibold text-orange-700 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <i className="ri-loop-right-line text-[15px]" aria-hidden />
                    Correction
                  </button>
                  <button
                    type="button"
                    onClick={() => submit("Rejected")}
                    disabled={!ready}
                    className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-3 text-[12px] font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <i className="ri-close-circle-line text-[15px]" aria-hidden />
                    Reject
                  </button>
                </div>
              </div>
            ) : canRunCheck ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto text-[10.5px] leading-snug text-foreground-500">
                  {hasDecision ? `Last decision by ${REVIEWER_NAME} · ${session.decidedAt}` : `Reopens the check for ${REVIEWER_ROLE.toLowerCase()} review.`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStates(session.criteria);
                    setComment(session.comment);
                    setMode("check");
                  }}
                  className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3.5 text-[12px] font-semibold text-background-50 transition-colors hover:bg-primary-600"
                >
                  <i className="ri-clipboard-line text-[15px]" aria-hidden />
                  {hasDecision ? "Re-run quality check" : "Run quality check"}
                </button>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-foreground-500">
                <i className="ri-lock-line text-[13px] text-foreground-400" aria-hidden />
                Quality check unlocks once the coach submits the session form.
              </p>
            )}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
