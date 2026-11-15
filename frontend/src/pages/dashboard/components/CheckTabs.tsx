import { useMemo, useState } from "react";
import { FEEDBACK_CRITERIA, FORM_TYPES, FORMS_CRITERIA, PREVIOUS_PORTFOLIO_FORMS } from "@/pages/dashboard/constants";
import type { Review } from "@/pages/dashboard/types";
import { pct } from "@/pages/dashboard/utils";

const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Tab = "forms" | "feedback";

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  reviews: Review[];
  formType: string;
  onFormType: (value: string) => void;
};

export default function CheckTabs({ tab, onTab, reviews, formType, onFormType }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const criteria = tab === "forms" ? FORMS_CRITERIA : FEEDBACK_CRITERIA;

  const rows = useMemo(
    () =>
      criteria.map((criterion, index) => {
        let pass = 0;
        let fail = 0;
        let improve = 0;
        reviews.forEach((review) => {
          const state = (tab === "forms" ? review.formsChecks : review.feedbackChecks)[index];
          if (state === "Pass") pass += 1;
          else if (state === "Fail") fail += 1;
          else if (state === "Needs Improvement") improve += 1;
        });
        const checked = pass + fail + improve;
        return { ...criterion, pass, fail, improve, checked, rate: pct(pass, checked) };
      }),
    [criteria, reviews, tab],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    reviews.forEach((review) => map.set(review.formType, (map.get(review.formType) ?? 0) + 1));
    return map;
  }, [reviews]);

  const filterList = (list: string[]) =>
    list.filter((type) => !query.trim() || type.toLowerCase().includes(query.trim().toLowerCase()));

  const overall = pct(
    rows.reduce((sum, r) => sum + r.pass, 0),
    rows.reduce((sum, r) => sum + r.checked, 0),
  );

  const typeRow = (type: string) => {
    const count = counts.get(type) ?? 0;
    const isActive = formType === type;
    return (
      <li key={type}>
        <button
          type="button"
          onClick={() => {
            onFormType(isActive ? "" : type);
            setOpen(false);
            setQuery("");
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
            isActive ? "bg-primary-100 font-semibold text-primary-800" : "text-foreground-700 hover:bg-background-100",
          )}
        >
          <span className="flex h-4 w-4 flex-none items-center justify-center">
            <i className={isActive ? "ri-checkbox-circle-fill text-[13px] text-primary-600" : "ri-file-text-line text-[13px] text-foreground-400"} aria-hidden />
          </span>
          <span className="flex-1 truncate">{type}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", isActive ? "bg-primary-200 text-primary-800" : "bg-background-200 text-foreground-600")}>{count}</span>
        </button>
      </li>
    );
  };

  return (
    <section id="checks" className="scroll-mt-20 rounded-lg border border-background-200 bg-background-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
        <div className="inline-flex items-center gap-1 rounded-full bg-background-100 p-1" role="tablist" aria-label="Quality check type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "forms"}
            onClick={() => onTab("forms")}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
              tab === "forms" ? "bg-primary-500 text-background-50" : "text-foreground-600 hover:text-foreground-900",
            )}
          >
            <i className="ri-file-list-3-line text-[15px]" aria-hidden />
            Forms Check
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "feedback"}
            onClick={() => onTab("feedback")}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
              tab === "feedback" ? "bg-primary-500 text-background-50" : "text-foreground-600 hover:text-foreground-900",
            )}
          >
            <i className="ri-chat-check-line text-[15px]" aria-hidden />
            Feedback Check
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-foreground-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            {overall}% criteria passing
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{reviews.length} reviews in view</span>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1.55fr_1fr]">
        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-heading text-[13px] font-semibold text-foreground-950">
                {tab === "forms" ? "Form completeness and compliance" : "Written feedback quality"}
              </h3>
              <p className="mt-0.5 text-[12px] text-foreground-500">
                {tab === "forms"
                  ? "Verify required fields, learner and coach details, meeting information and attached evidence."
                  : "Score completeness, clarity, relevance to progress, constructive actions and documented follow-ups."}
              </p>
            </div>
            <span className="hidden whitespace-nowrap rounded-full border border-background-200 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-500 md:inline">
              Pass · Fail · Needs imp.
            </span>
          </div>

          <ul className="flex flex-col divide-y divide-background-100 border-y border-background-100">
            {rows.map((row) => (
              <li key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 py-2.5">
                <p className="truncate text-[12px] font-medium text-foreground-800">{row.label}</p>
                <p className="whitespace-nowrap text-[11px] tabular-nums text-foreground-500">
                  <span className="font-semibold text-emerald-600">{row.pass}</span> pass · <span className="font-semibold text-red-600">{row.fail}</span> fail ·{" "}
                  <span className="font-semibold text-orange-600">{row.improve}</span> imp.
                </p>
                <div className="col-span-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background-200">
                    <div className={cn("h-full rounded-full", row.rate >= 85 ? "bg-emerald-500" : row.rate >= 60 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${row.rate}%` }} />
                  </div>
                  <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-foreground-600">{row.rate}%</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-background-200 bg-background-100/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Form types</p>
            <span className="text-[10px] text-foreground-400">{FORM_TYPES.length + PREVIOUS_PORTFOLIO_FORMS.length} available</span>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-background-300 bg-background-50 px-2.5 text-left text-[12px] font-medium text-foreground-800 hover:border-primary-300"
            >
              <i className="ri-search-line flex-none text-[14px] text-foreground-400" aria-hidden />
              <span className="flex-1 truncate">{formType || "Search all form types"}</span>
              <i className={cn("ri-arrow-down-s-line text-[16px] text-foreground-400 transition-transform", open && "rotate-180")} aria-hidden />
            </button>

            {open ? (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
                <div className="qa-rise absolute inset-x-0 z-30 mt-1 overflow-hidden rounded-lg border border-background-200 bg-background-50">
                  <div className="border-b border-background-200 p-1.5">
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter form types…"
                      className="h-8 w-full rounded-md border border-background-200 bg-background-50 px-2 text-[12px] text-foreground-900 outline-none placeholder:text-foreground-400 focus:border-primary-400"
                    />
                  </div>
                  <div className="scroll-slim max-h-64 overflow-y-auto p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onFormType("");
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
                        formType === "" ? "bg-primary-100 font-semibold text-primary-800" : "text-foreground-700 hover:bg-background-100",
                      )}
                    >
                      <i className="ri-list-check text-[13px] text-foreground-400" aria-hidden />
                      All form types
                      <span className="ml-auto rounded bg-background-200 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-600">{reviews.length}</span>
                    </button>

                    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Standard forms</p>
                    <ul className="flex flex-col">{filterList(FORM_TYPES).map(typeRow)}</ul>

                    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Previous portfolio reviews</p>
                    <ul className="flex flex-col">{filterList(PREVIOUS_PORTFOLIO_FORMS).map(typeRow)}</ul>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="mt-3 space-y-1.5">
            {PREVIOUS_PORTFOLIO_FORMS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onFormType(formType === type ? "" : type)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors",
                  formType === type ? "border-primary-300 bg-primary-100 text-primary-800" : "border-background-200 bg-background-50 text-foreground-600 hover:border-primary-300",
                )}
              >
                <i className="ri-archive-2-line text-[13px]" aria-hidden />
                <span className="flex-1 truncate">{type}</span>
                <span className="font-semibold tabular-nums">{counts.get(type) ?? 0}</span>
              </button>
            ))}
          </div>

          <p className="mt-3 leading-snug text-[11px] text-foreground-500">
            Selecting a form type filters the table, KPIs and charts together.
          </p>
        </div>
      </div>
    </section>
  );
}
