import { useId, useState } from "react";
import { PERIODS, RAG_META, RAG_ORDER, formatNumber } from "@/lib/qms";
import type { DashboardFilters } from "@/types/qms";
import { SelectMenu, type SelectMenuProps } from "@/components/feature/SelectField";
import styles from "./FilterBar.module.css";

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
  collapsible?: boolean;
}

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

function FilterSelect(props: Pick<SelectMenuProps, "id" | "ariaLabel" | "value" | "onChange" | "options">) {
  return (
    <SelectMenu
      {...props}
      size="sm"
      triggerClassName={styles.selectTrigger}
      menuClassName={styles.selectMenu}
      menuMinWidth={220}
    />
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
  collapsible = false,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
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
      className="flex flex-col rounded-xl border border-background-200 bg-background-50 p-3 sm:p-4"
    >
      <div className={`flex flex-wrap items-center gap-3 text-[12px] text-foreground-600 ${collapsible ? "" : "order-last mt-3 border-t border-background-200 pt-2.5"}`}>
        {collapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded(value => !value)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 font-label text-[12.5px] font-semibold text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            <i className="ri-filter-3-line text-[16px]" aria-hidden="true" />
            Filters
            <i className={expanded ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} aria-hidden="true" />
          </button>
        ) : null}
        <p className={collapsible ? "order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0" : "min-w-0 flex-1 basis-full sm:basis-0"}>
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

      <div
        id={panelId}
        data-filter-fields
        hidden={collapsible && !expanded}
        className={`${collapsible && !expanded ? "hidden" : "grid"} grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 ${collapsible ? "mt-3 border-t border-background-200 pt-3" : ""}`}
      >
        {fields.includes("period") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-period">Reporting period</Label>
            <FilterSelect
              id="filter-period"
              ariaLabel="Reporting period"
              value={filters.period}
              onChange={(period) => onChange({ period: period as DashboardFilters["period"] })}
              options={PERIODS.map((period) => ({ value: period, label: period }))}
            />
          </div>
        ) : null}

        {fields.includes("department") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-department">Department</Label>
            <FilterSelect
              id="filter-department"
              ariaLabel="Department"
              value={filters.department}
              onChange={(department) => onChange({ department, programme: "All programmes" })}
              options={["All departments", ...departments].map((department) => ({ value: department, label: department }))}
            />
          </div>
        ) : null}

        {fields.includes("programme") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-programme">Programme</Label>
            <FilterSelect
              id="filter-programme"
              ariaLabel="Programme"
              value={filters.programme}
              onChange={(programme) => onChange({ programme })}
              options={["All programmes", ...programmes].map((programme) => ({ value: programme, label: programme }))}
            />
          </div>
        ) : null}

        {fields.includes("category") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-category">Form category</Label>
            <FilterSelect
              id="filter-category"
              ariaLabel="Form category"
              value={filters.category}
              onChange={(category) => onChange({ category })}
              options={["All form categories", ...categories].map((category) => ({ value: category, label: category }))}
            />
          </div>
        ) : null}

        {fields.includes("formType") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-form-type">Form type</Label>
            <FilterSelect
              id="filter-form-type"
              ariaLabel="Form type"
              value={filters.formType}
              onChange={(formType) => onChange({ formType })}
              options={[
                { value: "All form types", label: "All form types" },
                ...formTypes.map((form) => ({ value: form.id, label: form.name })),
              ]}
            />
          </div>
        ) : null}

        {fields.includes("respondentType") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-respondent-type">Respondent</Label>
            <FilterSelect
              id="filter-respondent-type"
              ariaLabel="Respondent"
              value={filters.respondentType}
              onChange={(respondentType) => onChange({ respondentType })}
              options={[{ value: "All feedback types", label: "All respondents" }, ...respondentTypes.map((type) => ({ value: type, label: type }))]}
            />
          </div>
        ) : null}

        {fields.includes("feedbackType") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-feedback-type">Feedback type</Label>
            <FilterSelect
              id="filter-feedback-type"
              ariaLabel="Feedback type"
              value={filters.feedbackType}
              onChange={(feedbackType) => onChange({ feedbackType })}
              options={[
                { value: "All feedback types", label: "All feedback types" },
                ...feedbackTypes.map((type) => ({ value: type.id, label: type.name })),
              ]}
            />
          </div>
        ) : null}

        {fields.includes("coach") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-coach">Coach</Label>
            <FilterSelect
              id="filter-coach"
              ariaLabel="Coach"
              value={filters.coach}
              onChange={(coach) => onChange({ coach })}
              options={["All coaches", ...coaches].map((coach) => ({ value: coach, label: coach }))}
            />
          </div>
        ) : null}

        {fields.includes("tutor") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-tutor">Tutor</Label>
            <FilterSelect
              id="filter-tutor"
              ariaLabel="Tutor"
              value={filters.tutor}
              onChange={(tutor) => onChange({ tutor })}
              options={["All tutors", ...tutors].map((tutor) => ({ value: tutor, label: tutor }))}
            />
          </div>
        ) : null}

        {fields.includes("rag") ? (
          <div className="min-w-0">
            <Label htmlFor="filter-rag">Quality status</Label>
            <FilterSelect
              id="filter-rag"
              ariaLabel="Quality status"
              value={filters.rag}
              onChange={(rag) => onChange({ rag })}
              options={[
                { value: "All statuses", label: "All statuses" },
                ...RAG_ORDER.map((status) => ({
                  value: RAG_META[status].label,
                  label: `${RAG_META[status].label} — ${RAG_META[status].meaning}`,
                })),
              ]}
            />
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
                className={`${styles.searchInput} box-border w-full rounded-md py-2 pl-8 pr-3 font-label text-[12.5px] text-foreground-900 placeholder:text-foreground-500`}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

