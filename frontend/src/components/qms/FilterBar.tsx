import { PERIODS, RAG_META, RAG_ORDER, formatNumber } from "@/lib/qms";
import type { DashboardFilters } from "@/types/qms";

type FieldKey =
  | "period"
  | "department"
  | "programme"
  | "category"
  | "formType"
  | "feedbackType"
  | "respondentType"
  | "coach"
  | "tutor"
  | "rag"
  | "query";

interface FormTypeOption {
  id: string;
  name: string;
}

interface FilterBarProps {
  filters: DashboardFilters;
  onChange: (patch: Partial<DashboardFilters>) => void;
  onReset: () => void;
  resultCount: number;
  resultLabel?: string;
  fields?: FieldKey[];
  categories?: string[];
  formTypes?: FormTypeOption[];
  feedbackTypes?: FormTypeOption[];
  departments?: string[];
  programmes?: string[];
  respondentTypes?: string[];
  coaches?: string[];
  tutors?: string[];
  searchLabel?: string;
  searchPlaceholder?: string;
}

const selectClass =
  "box-border w-full appearance-none rounded-md border border-background-300 bg-background-50 py-2 pl-3 pr-8 font-label text-[12.5px] text-foreground-900 hover:border-background-400 focus:border-primary-500";

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block font-label text-[10.5px] font-semibold uppercase tracking-[0.09em] text-foreground-600"
    >
      {children}
    </label>
  );
}

function SelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <i
        className="ri-arrow-down-s-line pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-foreground-500"
        aria-hidden="true"
      />
    </div>
  );
}

export default function FilterBar({
  filters,
  onChange,
  onReset,
  resultCount,
  resultLabel = "records in scope",
  fields = ["period", "department", "programme", "category", "rag", "query"],
  categories = [],
  formTypes = [],
  feedbackTypes = [],
  departments = [],
  programmes = [],
  respondentTypes = [],
  coaches = [],
  tutors = [],
  searchLabel = "Search",
  searchPlaceholder = "Coach, learner, form or record reference",
}: FilterBarProps) {
  const activeCount = [
    filters.period !== "Last 12 months",
    filters.department !== "All departments",
    filters.programme !== "All programmes",
    filters.category !== "All form categories",
    filters.formType !== "All form types",
    filters.feedbackType !== "All feedback types",
    filters.respondentType !== "All feedback types",
    filters.coach !== "All coaches",
    filters.tutor !== "All tutors",
    filters.rag !== "All statuses",
    filters.query.trim().length > 0,
  ].filter(Boolean).length;

  return (
    <section
      aria-label="Global filters"
      className="rounded-xl border border-background-200 bg-background-50 p-3 sm:p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {fields.includes("period") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-period">Reporting period</Label>
            <SelectWrap>
              <select
                id="filter-period"
                className={selectClass}
                value={filters.period}
                onChange={(event) => onChange({ period: event.target.value as DashboardFilters["period"] })}
              >
                {PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("department") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-department">Department</Label>
            <SelectWrap>
              <select
                id="filter-department"
                className={selectClass}
                value={filters.department}
                onChange={(event) => onChange({ department: event.target.value, programme: "All programmes" })}
              >
                <option>All departments</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("programme") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-programme">Programme</Label>
            <SelectWrap>
              <select
                id="filter-programme"
                className={selectClass}
                value={filters.programme}
                onChange={(event) => onChange({ programme: event.target.value })}
              >
                <option>All programmes</option>
                {programmes.map((programme) => (
                  <option key={programme} value={programme}>
                    {programme}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("category") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-category">Form category</Label>
            <SelectWrap>
              <select
                id="filter-category"
                className={selectClass}
                value={filters.category}
                onChange={(event) => onChange({ category: event.target.value })}
              >
                <option>All form categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("formType") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-form-type">Form type</Label>
            <SelectWrap>
              <select
                id="filter-form-type"
                className={selectClass}
                value={filters.formType}
                onChange={(event) => onChange({ formType: event.target.value })}
              >
                <option>All form types</option>
                {formTypes.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("respondentType") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-respondent-type">Feedback type</Label>
            <SelectWrap>
              <select
                id="filter-respondent-type"
                className={selectClass}
                value={filters.respondentType}
                onChange={(event) => onChange({ respondentType: event.target.value })}
              >
                <option>All feedback types</option>
                {respondentTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("feedbackType") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-feedback-type">Feedback type</Label>
            <SelectWrap>
              <select
                id="filter-feedback-type"
                className={selectClass}
                value={filters.feedbackType}
                onChange={(event) => onChange({ feedbackType: event.target.value })}
              >
                <option>All feedback types</option>
                {feedbackTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("coach") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-coach">Coach</Label>
            <SelectWrap>
              <select
                id="filter-coach"
                className={selectClass}
                value={filters.coach}
                onChange={(event) => onChange({ coach: event.target.value })}
              >
                <option>All coaches</option>
                {coaches.map((coach) => (
                  <option key={coach} value={coach}>
                    {coach}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("tutor") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-tutor">Tutor</Label>
            <SelectWrap>
              <select
                id="filter-tutor"
                className={selectClass}
                value={filters.tutor}
                onChange={(event) => onChange({ tutor: event.target.value })}
              >
                <option>All tutors</option>
                {tutors.map((tutor) => (
                  <option key={tutor} value={tutor}>
                    {tutor}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("rag") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-rag">Quality status</Label>
            <SelectWrap>
              <select
                id="filter-rag"
                className={selectClass}
                value={filters.rag}
                onChange={(event) => onChange({ rag: event.target.value })}
              >
                <option>All statuses</option>
                {RAG_ORDER.map((status) => (
                  <option key={status} value={RAG_META[status].label}>
                    {RAG_META[status].label} — {RAG_META[status].meaning}
                  </option>
                ))}
              </select>
            </SelectWrap>
          </div>
        ) : null}

        {fields.includes("query") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-query">{searchLabel}</Label>
            <div className="relative">
              <i
                className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-foreground-500"
                aria-hidden="true"
              />
              <input
                id="filter-query"
                type="search"
                value={filters.query}
                placeholder={searchPlaceholder}
                onChange={(event) => onChange({ query: event.target.value })}
                className="box-border w-full rounded-md border border-background-300 bg-background-50 py-2 pl-8 pr-3 font-label text-[12.5px] text-foreground-900 placeholder:text-foreground-500 hover:border-background-400 focus:border-primary-500"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-background-200 pt-2.5 text-[12px] text-foreground-600 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold text-foreground-900">{formatNumber(resultCount)}</span>{" "}
          {resultLabel}
          {activeCount > 0 ? (
            <span className="ml-2 text-foreground-500">
              · {activeCount} filter{activeCount > 1 ? "s" : ""} applied
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onReset}
          disabled={activeCount === 0}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-background-300 px-2.5 py-1 font-label text-[11.5px] font-medium text-foreground-700 transition-colors hover:bg-background-50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <i className="ri-refresh-line text-[13px]" aria-hidden="true" />
          Reset filters
        </button>
      </div>
    </section>
  );
}

