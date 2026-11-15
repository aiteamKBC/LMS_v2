import type { Criterion, CriterionState } from "@/pages/dashboard/types";
import { pct } from "@/pages/dashboard/utils";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const OPTIONS: CriterionState[] = ["Pass", "Fail", "Needs Improvement"];

const ACTIVE_STYLE: Record<string, string> = {
  Pass: "bg-emerald-600 text-white",
  Fail: "bg-red-600 text-white",
  "Needs Improvement": "bg-orange-500 text-white",
};

const SHORT_LABEL: Record<string, string> = {
  Pass: "Pass",
  Fail: "Fail",
  "Needs Improvement": "Needs imp.",
};

type Props = {
  criteria: Criterion[];
  states: CriterionState[];
  onChange: (index: number, state: CriterionState) => void;
  comment: string;
  onComment: (value: string) => void;
  error: string;
};

export default function SessionQualityCheck({ criteria, states, onChange, comment, onComment, error }: Props) {
  const checked = states.filter((state) => state !== "Not Checked").length;
  const passed = states.filter((state) => state === "Pass").length;
  const progress = pct(checked, criteria.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex items-center justify-between gap-3 border-b border-background-200 px-3 py-2.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Review progress</p>
            <p className="mt-0.5 font-heading text-[14px] font-semibold text-foreground-950">
              {checked} of {criteria.length} criteria reviewed
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading text-[18px] font-semibold leading-none tabular-nums text-foreground-900">{progress}%</p>
            <p className="mt-0.5 text-[10px] text-foreground-500">{passed} passing</p>
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-200">
            <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${progress}%` }} aria-hidden />
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-background-200 bg-background-50">
        <div className="flex items-start justify-between gap-3 border-b border-background-200 px-3 py-2.5">
          <div>
            <h3 className="font-heading text-[12.5px] font-semibold text-foreground-950">Forms quality check</h3>
            <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">Completeness, accuracy and compliance of the submitted session form.</p>
          </div>
          <span className="hidden whitespace-nowrap rounded-full border border-background-200 px-2 py-0.5 text-[10px] font-semibold text-foreground-500 sm:inline">
            Pass · Fail · Needs imp.
          </span>
        </div>

        <ul className="divide-y divide-background-100 px-3">
          {criteria.map((criterion, index) => {
            const state = states[index] ?? "Not Checked";
            return (
              <li key={criterion.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={cn(
                      "flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-semibold",
                      state === "Pass" && "bg-emerald-100 text-emerald-700",
                      state === "Fail" && "bg-red-100 text-red-700",
                      state === "Needs Improvement" && "bg-orange-100 text-orange-700",
                      state === "Not Checked" && "bg-background-200 text-foreground-500",
                    )}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <p className="min-w-0 text-[12px] leading-snug text-foreground-800">{criterion.label}</p>
                </div>
                <div className="inline-flex flex-none items-center gap-0.5 rounded-md bg-background-100 p-0.5">
                  {OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={state === option}
                      onClick={() => onChange(index, state === option ? "Not Checked" : option)}
                      className={cn(
                        "cursor-pointer whitespace-nowrap rounded px-1.5 py-1 text-[10px] font-semibold transition-colors",
                        state === option ? ACTIVE_STYLE[option] : "text-foreground-500 hover:bg-background-200 hover:text-foreground-800",
                      )}
                    >
                      {SHORT_LABEL[option]}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-background-200 bg-background-50 p-3">
        <label htmlFor="session-check-comment" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-500">
          Reviewer comments
        </label>
        <textarea
          id="session-check-comment"
          value={comment}
          onChange={(event) => onComment(event.target.value.slice(0, 500))}
          rows={4}
          maxLength={500}
          placeholder="Explain the decision so the coach knows exactly what to keep or change."
          className="w-full resize-none rounded-md border border-background-300 bg-background-50 px-2.5 py-2 text-[12px] leading-relaxed text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-foreground-400">
          <span>Stored in the session audit trail and visible to the coach.</span>
          <span className="tabular-nums">{comment.length}/500</span>
        </div>
      </section>

      {error ? (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium leading-snug text-amber-800">
          <i className="ri-error-warning-line mt-px text-[13px]" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
