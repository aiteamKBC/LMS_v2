import { ALL_FORM_TYPES, CHECK_STATUSES, COHORTS, DATE_RANGES, FORM_TYPES, PREVIOUS_PORTFOLIO_FORMS, PROGRAMMES } from "@/pages/dashboard/constants";
import type { Filters } from "@/pages/dashboard/types";

const FIELD =
  "h-9 w-full min-w-0 rounded-md border border-background-300 bg-background-50 px-2.5 text-[12px] text-foreground-800 outline-none transition-colors placeholder:text-foreground-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100";
const LABEL = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-500";

type Props = {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  onExport: () => void;
  resultCount: number;
  totalCount: number;
  dirty: boolean;
};

export default function FilterBar({ filters, onChange, onReset, onExport, resultCount, totalCount, dirty }: Props) {
  const search = (key: "learner" | "coach", label: string, placeholder: string) => (
    <div className="min-w-0">
      <label className={LABEL} htmlFor={`flt-${key}`}>
        {label}
      </label>
      <div className="relative">
        <i className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-400" aria-hidden />
        <input
          id={`flt-${key}`}
          value={filters[key]}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<Filters>)}
          placeholder={placeholder}
          className={`${FIELD} pl-8`}
        />
      </div>
    </div>
  );

  const select = (key: keyof Filters, label: string, options: { value: string; label: string }[], allLabel: string) => (
    <div className="min-w-0">
      <label className={LABEL} htmlFor={`flt-${key}`}>
        {label}
      </label>
      <select id={`flt-${key}`} value={filters[key]} onChange={(e) => onChange({ [key]: e.target.value })} className={FIELD}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  const statusOptions = CHECK_STATUSES.map((status) => ({ value: status, label: status }));

  return (
    <div className="rounded-lg border border-background-200 bg-background-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-background-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-background-100 text-foreground-600">
            <i className="ri-filter-3-line text-[14px]" aria-hidden />
          </span>
          <h3 className="font-heading text-[13px] font-semibold text-foreground-950">Filters</h3>
          <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-medium text-foreground-600">
            {resultCount} of {totalCount} reviews
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={!dirty}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-2.5 text-[11px] font-semibold text-foreground-700 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <i className="ri-refresh-line text-[13px]" aria-hidden />
            Reset filters
          </button>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-2.5 text-[11px] font-semibold text-background-50 transition-colors hover:bg-primary-600"
          >
            <i className="ri-download-2-line text-[13px]" aria-hidden />
            Export report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {search("learner", "Search learner", "Learner name")}
        {search("coach", "Search coach", "Coach name")}

        <div className="min-w-0">
          <label className={LABEL} htmlFor="flt-formType">
            Form type
          </label>
          <select id="flt-formType" value={filters.formType} onChange={(e) => onChange({ formType: e.target.value })} className={FIELD}>
            <option value="">All forms ({ALL_FORM_TYPES.length})</option>
            <optgroup label="Standard feedback forms">
              {FORM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </optgroup>
            <optgroup label="Previous portfolio reviews">
              {PREVIOUS_PORTFOLIO_FORMS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {select("programme", "Programme", PROGRAMMES.map((p) => ({ value: p, label: p })), "All programmes")}
        {select("cohort", "Cohort", COHORTS.map((c) => ({ value: c, label: c })), "All cohorts")}
        {select("dateRange", "Date range", DATE_RANGES.filter((d) => d.value !== "all").map((d) => ({ value: d.value, label: d.label })), "All time")}
        {select("formStatus", "Form completion", [{ value: "Completed", label: "Completed" }, { value: "Draft", label: "Draft" }], "Any form status")}
        {select("formCheck", "Forms check", statusOptions, "Any quality status")}
        {select("feedbackCheck", "Feedback check", statusOptions, "Any feedback status")}
        {select(
          "rag",
          "Issue rating",
          [
            { value: "Green", label: "Green — clean" },
            { value: "Amber", label: "Amber — correction" },
            { value: "Red", label: "Red — rejected" },
          ],
          "Any RAG rating",
        )}

        <div className="flex min-w-0 items-end">
          <p className="w-full rounded-md border border-dashed border-background-300 px-2.5 py-2 text-[11px] leading-snug text-foreground-500">
            Form completion and quality approval are tracked separately.
          </p>
        </div>
      </div>
    </div>
  );
}
