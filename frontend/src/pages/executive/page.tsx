import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Panel from "@/components/base/Panel";
import RagBadge from "@/components/base/RagBadge";
import FilterBar from "@/components/qms/FilterBar";
import RagTrendChart from "@/components/qms/RagTrendChart";
import OverviewKpis from "@/pages/executive/components/OverviewKpis";
import HealthOverview from "@/pages/executive/components/HealthOverview";
import CategoryRag from "@/pages/executive/components/CategoryRag";
import RegistryTable from "@/pages/executive/components/RegistryTable";
import ActionsList from "@/pages/executive/components/ActionsList";
import ConcernList from "@/pages/executive/components/ConcernList";
import QualityDonuts from "@/pages/executive/components/QualityDonuts";
import MeetingTypesModal from "@/pages/executive/components/MeetingTypesModal";
import { addDays, TIME_ZONE_LABEL, todayIso } from "@/pages/curriculum/recordings/utils";
import {
  RAG_META,
  RAG_ORDER,
  applyFilters,
  buildMonthlySeries,
  exportRecordsCsv,
  formatNumber,
  formatPct,
  isOpenAction,
} from "@/lib/qms";
import type { DashboardFilters } from "@/types/qms";
import { loadLiveQmsData, type LiveQmsData } from "./qualityData";

const DEFAULT_FILTERS: DashboardFilters = {
  period: "Last 12 months",
  department: "All departments",
  programme: "All programmes",
  category: "All form categories",
  formType: "All form types",
  respondentType: "All feedback types",
  feedbackType: "All feedback types",
  coach: "All coaches",
  tutor: "All tutors",
  rag: "All statuses",
  query: "",
};

export default function ExecutiveOverview() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [showPolicy, setShowPolicy] = useState(false);
  const [data, setData] = useState<LiveQmsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [auditTypesOpen, setAuditTypesOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void loadLiveQmsData(controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Quality data could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  const onChange = (patch: Partial<DashboardFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  const records = useMemo(() => data ? applyFilters(data.records, filters) : [], [data, filters]);

  const scopedIds = useMemo(() => new Set(records.map((record) => record.id)), [records]);
  const actions = useMemo(
    () =>
      (data?.actions ?? []).filter(
        (action) =>
          scopedIds.has(action.recordId) ||
          (isOpenAction(action) &&
            filters.category === "All form categories" &&
            filters.formType === "All form types" &&
            filters.respondentType === "All feedback types" &&
            filters.feedbackType === "All feedback types" &&
            filters.coach === "All coaches" &&
            filters.tutor === "All tutors" &&
            filters.department === "All departments" &&
            filters.programme === "All programmes"),
      ),
    [
      data?.actions,
      scopedIds,
      filters.category,
      filters.formType,
      filters.respondentType,
      filters.feedbackType,
      filters.coach,
      filters.tutor,
      filters.department,
      filters.programme,
    ],
  );

  const trendRecords = useMemo(
    () => data ? applyFilters(data.records, { ...filters, period: "All records" }) : [],
    [data, filters],
  );
  const trend = useMemo(() => buildMonthlySeries(trendRecords, 12), [trendRecords]);

  const forms = useMemo(
    () =>
      (data?.forms ?? []).filter(
        (form) =>
          (filters.category === "All form categories" || form.category === filters.category) &&
          (filters.formType === "All form types" || form.id === filters.formType) &&
          (filters.feedbackType === "All feedback types" || form.feedbackType === filters.feedbackType) &&
          (filters.respondentType === "All feedback types" || form.respondentType === filters.respondentType) &&
          (filters.coach === "All coaches" || records.some(record => record.formId === form.id)) &&
          (filters.tutor === "All tutors" || records.some(record => record.formId === form.id)),
      ),
    [data?.forms, filters.category, filters.formType, filters.feedbackType, filters.respondentType, filters.coach, filters.tutor, records],
  );

  const assessedInScope = records.filter((record) => !["unrated", "na"].includes(record.rag)).length;
  const openInScope = actions.filter(isOpenAction).length;
  const peakMonth = trend.reduce(
    (top, point) => (point.total > top.total ? point : top),
    trend[0] ?? { label: "—", total: 0 },
  );
  const auditDateRange = useMemo(() => {
    const dates = records
      .filter((record) => record.category === "Quality Audit")
      .map((record) => record.assessedOn)
      .sort();
    const end = todayIso(TIME_ZONE_LABEL);
    return { from: dates[0] ?? addDays(end, -30), to: dates.at(-1) ?? end };
  }, [records]);
  const openAuditType = (formId: string) => {
    const params = new URLSearchParams({
      view: "checks",
      type: formId,
      from: auditDateRange.from,
      to: auditDateRange.to,
      zone: TIME_ZONE_LABEL,
      status: "all",
    });
    setAuditTypesOpen(false);
    navigate(`/curriculum/quality-demo?${params.toString()}`);
  };

  if (loading) {
    return <div role="status" className="rounded-xl border border-background-200 bg-background-50 p-8 text-sm text-foreground-600">Loading live quality forms and saved reviews…</div>;
  }

  if (error) {
    return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><p>{error}</p><button type="button" className="mt-3 rounded-md bg-primary-600 px-3 py-2 font-semibold text-background-50" onClick={() => setRetry(value => value + 1)}>Retry quality data</button></div>;
  }

  const live = data!;
  const categories = Array.from(new Set([
    ...live.records.map(record => record.category),
    ...live.forms.map(form => form.category),
  ]));
  const departments = Array.from(new Set(live.records.map(record => record.department)));
  const programmes = Array.from(new Set(live.records.map(record => record.programme)));
  const formTypes = live.forms.map(form => ({ id: form.id, name: form.shortName }));
  const respondentTypes = Array.from(new Set(live.records.map(record => record.respondentType)));
  const coaches = Array.from(new Set(live.records.map(record => record.coachName).filter((name): name is string => Boolean(name))));
  const tutors = Array.from(new Set(live.records.map(record => record.tutorName).filter((name): name is string => Boolean(name))));

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.14em] text-primary-700">
            Quality overview · live LMS data
          </p>
          <h1 className="mt-1 font-heading text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground-950 md:text-[30px]">
            Executive Overview
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-foreground-600">
            Every quality audit, learner and employer feedback form in one view — separated by form type,
            policy version and the entity being evaluated.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => setShowPolicy((value) => !value)}
            aria-expanded={showPolicy}
            aria-controls="rag-policy-panel"
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 font-label text-[12.5px] font-medium text-foreground-800 transition-colors hover:bg-background-100"
          >
            <i className="ri-information-line text-[14px]" aria-hidden="true" />
            How RAG is calculated
            <i
              className={`text-[13px] ${showPolicy ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}`}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            onClick={() => exportRecordsCsv(records)}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary-600 px-3.5 py-2 font-label text-[12.5px] font-semibold text-background-50 transition-colors hover:bg-primary-700"
          >
            <i className="ri-download-2-line text-[14px]" aria-hidden="true" />
            Export {formatNumber(records.length)} records
          </button>
        </div>
      </header>

      {showPolicy ? (
        <section
          id="rag-policy-panel"
          className="animate-fade-in rounded-xl border border-primary-100 bg-primary-50/60 p-4"
          aria-label="RAG evaluation definitions"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-heading text-[14px] font-semibold text-foreground-950">
              Status definitions used in this dashboard
            </h2>
            <p className="font-label text-[11px] text-foreground-600">
              Thresholds are set per form policy — never shared across unrelated forms.
            </p>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {RAG_ORDER.map((status) => (
              <li key={status} className="rounded-lg border border-background-200 bg-background-50 p-3">
                <RagBadge status={status} />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-700">
                  {RAG_META[status].meaning}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3 text-[12px] leading-relaxed text-foreground-700">
        {live.notice}
      </div>

      <FilterBar
        filters={filters}
        onChange={onChange}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        resultCount={records.length}
        categories={categories}
        formTypes={formTypes}
        feedbackTypes={live.feedbackTypes}
        departments={departments}
        programmes={programmes}
        respondentTypes={respondentTypes}
        coaches={coaches}
        tutors={tutors}
        fields={["period", "category", "formType", "feedbackType", "respondentType", "coach", "tutor", "rag", "query"]}
        resultLabel={`records · ${formatNumber(assessedInScope)} assessed · ${formatNumber(openInScope)} open actions in scope`}
      />

      <OverviewKpis records={records} actions={actions} forms={forms} onOpenAuditTypes={() => setAuditTypesOpen(true)} />

      {auditTypesOpen ? <MeetingTypesModal records={records} onClose={() => setAuditTypesOpen(false)} onOpenType={openAuditType} /> : null}

      <QualityDonuts records={records} selectedCoach={filters.coach} selectedTutor={filters.tutor} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HealthOverview records={records} actions={actions} />
        </div>
        <CategoryRag records={records} />
      </div>

      <Panel
        title="Quality trend by month"
        description="Smoothed monthly record volume by status. Month labels reflect submission dates, not review dates."
        headingId="trend-heading"
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-label text-[11px] text-foreground-600">
            <span>
              Peak month: <span className="font-semibold text-foreground-900">{peakMonth.label}</span> (
              {formatNumber(peakMonth.total)} records)
            </span>
            <span className="hidden sm:inline">
              Assessed share:{" "}
              <span className="font-semibold text-foreground-900">
                {records.length ? formatPct((assessedInScope / records.length) * 100) : "0%"}
              </span>
            </span>
          </div>
        }
      >
        <RagTrendChart data={trend} />
      </Panel>

      <RegistryTable forms={forms} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActionsList actions={actions} />
        </div>
      <ConcernList themes={live.concerns} />
      </div>

      <footer className="rounded-xl border border-background-300/70 bg-background-200/40 px-4 py-3.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-700">
              <i className="ri-file-info-line text-[13px]" aria-hidden="true" />
              KPI definitions & data notes
            </p>
            <p className="max-w-3xl text-[11.5px] leading-relaxed text-foreground-600">
              Reporting period {live.periodLabel}. Counts are records with a session date inside the
              selected period. “Assessed” excludes records with no approved policy. Critical issues are red
              outcomes with a flagged compliance concern. Actions count open items linked to in-scope records.
            </p>
          </div>
          <div className="shrink-0 space-y-1 lg:text-right">
            <p className="text-[11px] text-foreground-600">
              Last refresh <span className="font-medium text-foreground-900">{live.lastRefresh}</span>
            </p>
            <p className="max-w-sm text-[11px] text-foreground-500">Analysis is based on the saved Quality Forms and Reviews API.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

