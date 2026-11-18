import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import Panel from "@/components/base/Panel";
import RagBadge from "@/components/base/RagBadge";
import FilterBar from "@/components/qms/FilterBar";
import RagTrendChart from "@/components/qms/RagTrendChart";
import OverviewKpis from "@/pages/executive/components/OverviewKpis";
import HealthOverview from "@/pages/executive/components/HealthOverview";
import CategoryRag from "@/pages/executive/components/CategoryRag";
import RegistryTable from "@/pages/executive/components/RegistryTable";
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
import styles from "./ExecutiveOverview.module.css";

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

const OVERVIEW_CACHE_FRESH_MS = 60_000;
let overviewCache: { data: LiveQmsData; at: number } | null = null;

export default function ExecutiveOverview({ attentionPanel }: { attentionPanel?: ReactNode }) {
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
    // Show the last loaded data at once and refresh it quietly in the background,
    // so returning to the overview never repeats the full wait.
    const cached = retry === 0 ? overviewCache : null;
    if (cached) {
      setData(cached.data);
      setLoading(false);
      if (Date.now() - cached.at < OVERVIEW_CACHE_FRESH_MS) return () => controller.abort();
    } else {
      setLoading(true);
    }
    setError("");
    void loadLiveQmsData(controller.signal)
      .then(value => {
        overviewCache = { data: value, at: Date.now() };
        if (!controller.signal.aborted) setData(value);
      })
      .catch(reason => { if (!controller.signal.aborted && !cached) setError(reason instanceof Error ? reason.message : "Quality data could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  const onChange = useCallback((patch: Partial<DashboardFilters>) =>
    setFilters((current) => ({ ...current, ...patch })), []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);
  const openAuditTypes = useCallback(() => setAuditTypesOpen(true), []);

  // The filter controls update immediately; the charts and panels re-render from a
  // deferred copy so a filter change never blocks the dropdown or the page.
  const appliedFilters = useDeferredValue(filters);
  const updating = appliedFilters !== filters;
  const records = useMemo(() => data ? applyFilters(data.records, appliedFilters) : [], [data, appliedFilters]);

  const scopedIds = useMemo(() => new Set(records.map((record) => record.id)), [records]);
  const actions = useMemo(
    () =>
      (data?.actions ?? []).filter(
        (action) =>
          scopedIds.has(action.recordId) ||
          (isOpenAction(action) &&
            appliedFilters.category === "All form categories" &&
            appliedFilters.formType === "All form types" &&
            appliedFilters.respondentType === "All feedback types" &&
            appliedFilters.feedbackType === "All feedback types" &&
            appliedFilters.coach === "All coaches" &&
            appliedFilters.tutor === "All tutors" &&
            appliedFilters.department === "All departments" &&
            appliedFilters.programme === "All programmes"),
      ),
    [
      data?.actions,
      scopedIds,
      appliedFilters.category,
      appliedFilters.formType,
      appliedFilters.respondentType,
      appliedFilters.feedbackType,
      appliedFilters.coach,
      appliedFilters.tutor,
      appliedFilters.department,
      appliedFilters.programme,
    ],
  );

  const trendRecords = useMemo(
    () => data ? applyFilters(data.records, { ...appliedFilters, period: "All records" }) : [],
    [data, appliedFilters],
  );
  const trend = useMemo(() => buildMonthlySeries(trendRecords), [trendRecords]);

  const forms = useMemo(
    () =>
      (data?.forms ?? []).filter(
        (form) =>
          (appliedFilters.category === "All form categories" || form.category === appliedFilters.category) &&
          (appliedFilters.formType === "All form types" || form.id === appliedFilters.formType) &&
          (appliedFilters.feedbackType === "All feedback types" || form.feedbackType === appliedFilters.feedbackType) &&
          (appliedFilters.respondentType === "All feedback types" || form.respondentType === appliedFilters.respondentType) &&
          (appliedFilters.coach === "All coaches" || records.some(record => record.formId === form.id)) &&
          (appliedFilters.tutor === "All tutors" || records.some(record => record.formId === form.id)),
      ),
    [data?.forms, appliedFilters.category, appliedFilters.formType, appliedFilters.feedbackType, appliedFilters.respondentType, appliedFilters.coach, appliedFilters.tutor, records],
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
    return <>{attentionPanel}<div className="rounded-xl border border-background-200 bg-background-50 p-8 text-sm text-foreground-600"><LoadingSkeleton label={"Loading live quality forms and saved reviews…"} /></div></>;
  }

  if (error) {
    return <>{attentionPanel}<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><p>{error}</p><button type="button" className="mt-3 rounded-md bg-primary-600 px-3 py-2 font-semibold text-background-50" onClick={() => setRetry(value => value + 1)}>Retry quality data</button></div></>;
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
    <div className={styles.overview} aria-busy={updating || undefined} style={updating ? { opacity: 0.85, transition: "opacity 120ms" } : undefined}>
      <header className={styles.hero}>
        <div className="min-w-0">
          <p className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            Quality assurance <span className={styles.liveLabel}>Live overview</span>
          </p>
          <h1 className={styles.title}>
            Executive Overview
          </h1>
          <p className={styles.subtitle}>
            A clearer view of quality, feedback and the areas that need your attention.
          </p>
        </div>

        <div className={styles.heroActions}>
          <button
            type="button"
            onClick={() => setShowPolicy((value) => !value)}
            aria-expanded={showPolicy}
            aria-controls="rag-policy-panel"
            className={styles.secondaryButton}
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
            className={styles.exportButton}
          >
            <i className="ri-download-2-line text-[14px]" aria-hidden="true" />
            Export {formatNumber(records.length)} records
          </button>
        </div>
      </header>

      <details className={styles.dataNotice}>
        <summary>
          <span><i className="ri-information-line" aria-hidden="true" /> About this data</span>
          <span className={styles.refresh}>Updated {live.lastRefresh}</span>
        </summary>
        <p>{live.notice}</p>
      </details>

      <div className={styles.filters}>
      <FilterBar
        collapsible
        filters={filters}
        onChange={onChange}
        onReset={resetFilters}
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
        resultLabel={`records · ${formatNumber(assessedInScope)} assessed · ${live.availability.actions ? `${formatNumber(openInScope)} open actions in scope` : 'action status unavailable'}`}
      />
      </div>

      <OverviewKpis records={records} actions={actions} forms={forms} availability={live.availability} onOpenAuditTypes={openAuditTypes} />

      {showPolicy || attentionPanel ? (
        <div className={`${styles.policyAttentionRow} ${showPolicy && attentionPanel ? styles.withPolicy : ""}`}>
          {showPolicy ? (
            <section
              id="rag-policy-panel"
              className={`${styles.policyPanel} animate-fade-in rounded-xl border border-primary-100 bg-primary-50/60`}
              aria-label="RAG evaluation definitions"
            >
              <h2 className="font-heading text-[13px] font-semibold text-foreground-950">
                Status definitions used in this dashboard
              </h2>
              <p className="mt-1 font-label text-[11px] leading-relaxed text-foreground-600">
                Thresholds are set per form policy — never shared across unrelated forms.
              </p>
              <ul className={styles.statusList}>
                {RAG_ORDER.map((status) => (
                  <li key={status} data-status={status} className={`${styles.statusCard} rounded-lg border`}>
                    <RagBadge status={status} size="sm" />
                    <p className="text-[11px] leading-relaxed text-foreground-700">
                      {RAG_META[status].meaning}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {attentionPanel ? <div className={styles.attentionPanel}>{attentionPanel}</div> : null}
        </div>
      ) : null}

      {auditTypesOpen ? <MeetingTypesModal records={records} onClose={() => setAuditTypesOpen(false)} onOpenType={openAuditType} /> : null}

      <QualityDonuts records={records} selectedCoach={appliedFilters.coach} selectedTutor={appliedFilters.tutor} feedbackAvailable={live.availability.feedbackScores} />

      <div className={styles.healthGrid}>
        <div>
          <HealthOverview records={records} availability={live.availability} />
        </div>
        <CategoryRag records={records} />
      </div>

      <div className={styles.trendRegistryGrid}>
      <Panel
        title="Quality trend by month"
        description="Monthly records by band. Feedback: Positive = Green, Neutral = Amber, Negative = Red. Audits: the lowest criterion rating sets the band. Month labels reflect submission dates."
        headingId="trend-heading"
        className={styles.panel}
        action={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-label text-[11px] text-foreground-600">
            <span>
              Peak month: <span className="font-semibold text-foreground-900">{peakMonth.label}</span> (
              {formatNumber(peakMonth.total)} records)
            </span>
          </div>
        }
      >
        <RagTrendChart data={trend} />
      </Panel>

      <RegistryTable forms={forms} records={records} />
      </div>

      <ConcernList themes={live.concerns} available={live.availability.concerns} />

    </div>
  );
}

