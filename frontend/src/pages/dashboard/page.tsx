import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { REVIEWS } from "@/mocks/reviews";
import { EMPTY_FILTERS, REVIEWER_NAME } from "@/pages/dashboard/constants";
import type { AuditEntry, CheckStatus, Filters, RagLevel, Review, SortKey, SortState } from "@/pages/dashboard/types";
import { nowLabel, reviewRag } from "@/pages/dashboard/utils";
import { Sidebar as LmsSidebar } from "@/components/feature/Sidebar";
import Topbar from "@/pages/dashboard/components/Topbar";
import KpiCards from "@/pages/dashboard/components/KpiCards";
import CheckTabs from "@/pages/dashboard/components/CheckTabs";
import FilterBar from "@/pages/dashboard/components/FilterBar";
import ReviewsTable from "@/pages/dashboard/components/ReviewsTable";
import ReviewDrawer from "@/pages/dashboard/components/ReviewDrawer";
import PdfPreviewModal from "@/pages/dashboard/components/PdfPreviewModal";
import AnalyticsPanel from "@/pages/dashboard/components/AnalyticsPanel";
import GeneralDashboard from "@/pages/dashboard/components/GeneralDashboard";
import QualityTeamPage from "@/pages/dashboard/components/QualityTeamPage";
import FeedbacksPage from "@/pages/dashboard/components/FeedbacksPage";
import FormRegistryPage from "@/pages/dashboard/components/FormRegistryPage";
import QualityReviewsPage from "@/pages/coaching-recordings/QualityReviewsPage";

const STATUS_RANK: Record<string, number> = { Pending: 0, "In Review": 1, "Needs Correction": 2, Approved: 3, Rejected: 4 };

const VIEW_META: Record<string, { title: string; section: string }> = {
  overview: { title: "Dashboard", section: "Analytics" },
  checks: { title: "Quality Checks", section: "Quality Assurance" },
  "checks-feedback": { title: "Feedback Check", section: "Quality Assurance" },
  reviews: { title: "Reviews", section: "Quality Assurance" },
  forms: { title: "Forms & quality categories", section: "Quality configuration" },
  analytics: { title: "Analytics", section: "Quality Assurance" },
  "quality-team": { title: "Quality Team", section: "Management" },
  feedbacks: { title: "Feedbacks", section: "Voice of the customer" },
};

const QUALITY_VIEW_NAV = [
  { id: "overview", label: "Dashboard", icon: "ri-dashboard-3-line" },
  { id: "checks", label: "Sessions", icon: "ri-calendar-2-line" },
  { id: "checks-feedback", label: "Feedback Check", icon: "ri-chat-check-line" },
  { id: "reviews", label: "Reviews", icon: "ri-table-line" },
  { id: "forms", label: "Forms & registry", icon: "ri-file-list-3-line" },
  { id: "analytics", label: "Analytics", icon: "ri-pie-chart-2-line" },
  { id: "quality-team", label: "Quality Team", icon: "ri-team-line" },
  { id: "feedbacks", label: "Feedbacks", icon: "ri-chat-smile-2-line" },
] as const;

const QUALITY_SIDEBAR_NAV = [
  {
    id: "quality-demo-overview",
    label: "Dashboard",
    icon: "ri-dashboard-3-line",
    href: "/curriculum/quality-demo?view=overview",
  },
  {
    id: "quality-demo-checks",
    label: "Quality Checks",
    icon: "ri-checkbox-circle-line",
    href: "/curriculum/quality-demo?view=checks",
  },
];

export default function QualityAssurancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reviews, setReviews] = useState<Review[]>(REVIEWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [active, setActive] = useState(() => searchParams.get("view") || "overview");
  const [tab, setTab] = useState<"forms" | "feedback">("forms");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [sort, setSort] = useState<SortState>({ key: "meetingDate", dir: "desc" });
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "info" } | null>(null);

  const runLoad = () => {
    setLoading(true);
    setError(false);
    window.setTimeout(() => setLoading(false), 600);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const requestedView = searchParams.get("view");

  useEffect(() => {
    if (!requestedView || !QUALITY_VIEW_NAV.some((item) => item.id === requestedView) || requestedView === active) return;
    setActive(requestedView);
    if (requestedView === "checks") setTab("forms");
    if (requestedView === "checks-feedback") setTab("feedback");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [active, requestedView]);

  const filtered = useMemo(() => {
    const learnerQuery = filters.learner.trim().toLowerCase();
    const coachQuery = filters.coach.trim().toLowerCase();
    const dayLimit = filters.dateRange === "all" ? null : Number(filters.dateRange);
    const today = new Date().getTime();

    return reviews.filter((review) => {
      if (learnerQuery && !review.learner.toLowerCase().includes(learnerQuery)) return false;
      if (coachQuery && !review.coach.toLowerCase().includes(coachQuery)) return false;
      if (filters.formType && review.formType !== filters.formType) return false;
      if (filters.programme && review.programme !== filters.programme) return false;
      if (filters.cohort && review.cohort !== filters.cohort) return false;
      if (filters.formStatus && review.formStatus !== filters.formStatus) return false;
      if (filters.formCheck && review.formCheck !== filters.formCheck) return false;
      if (filters.feedbackCheck && review.feedbackCheck !== filters.feedbackCheck) return false;
      if (filters.rag && reviewRag(review) !== filters.rag) return false;
      if (dayLimit !== null) {
        const diff = (today - new Date(review.meetingDate).getTime()) / 86_400_000;
        if (diff > dayLimit) return false;
      }
      return true;
    });
  }, [reviews, filters]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let result = 0;
      if (sort.key === "meetingDate") {
        result = new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime();
      } else if (sort.key === "followUps") {
        result = a.followUps - b.followUps;
      } else if (sort.key === "formCheck" || sort.key === "feedbackCheck") {
        result = (STATUS_RANK[a[sort.key]] ?? 9) - (STATUS_RANK[b[sort.key]] ?? 9);
      } else {
        result = String(a[sort.key]).localeCompare(String(b[sort.key]));
      }
      return sort.dir === "asc" ? result : -result;
    });
    return list;
  }, [filtered, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const stats = useMemo(() => {
    const awaiting = (status: CheckStatus) => status === "Pending" || status === "In Review";
    const approved = filtered.filter((review) => review.formCheck === "Approved" && review.feedbackCheck === "Approved").length;
    const rejected = filtered.filter((review) => review.formCheck === "Rejected" || review.feedbackCheck === "Rejected").length;
    const correction = filtered.filter(
      (review) => (review.formCheck === "Needs Correction" || review.feedbackCheck === "Needs Correction") && review.formCheck !== "Rejected" && review.feedbackCheck !== "Rejected",
    ).length;
    const decided = approved + rejected + correction;
    return {
      total: filtered.length,
      pending: filtered.filter((review) => awaiting(review.formCheck) || awaiting(review.feedbackCheck)).length,
      approved,
      rejected,
      correction,
      compliance: decided === 0 ? 0 : Math.round((approved / decided) * 100),
    };
  }, [filtered]);

  const dirty = useMemo(() => JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS), [filters]);

  const activeReview = reviews.find((review) => review.id === activeId) ?? null;
  const pdfReview = reviews.find((review) => review.id === pdfId) ?? null;

  const updateReview = (id: string, patch: Partial<Review>, entry: AuditEntry) => {
    setReviews((prev) => prev.map((review) => (review.id === id ? { ...review, ...patch, audit: [entry, ...review.audit] } : review)));
    setToast({ text: `${id} updated · ${patch.formCheck ?? "saved"}`, tone: "success" });
  };

  const bulkUpdate = (status: CheckStatus) => {
    if (selected.length === 0) return;
    const stamp = nowLabel();
    setReviews((prev) =>
      prev.map((review) =>
        selected.includes(review.id)
          ? {
              ...review,
              formCheck: status,
              feedbackCheck: status,
              reviewer: REVIEWER_NAME,
              decidedAt: stamp,
              audit: [{ id: `a-${review.id}-${Date.now()}`, action: `Bulk quality decision: ${status}`, reviewer: REVIEWER_NAME, date: stamp }, ...review.audit],
            }
          : review,
      ),
    );
    setToast({ text: `${selected.length} reviews marked ${status}`, tone: "success" });
    setSelected([]);
  };

  const exportReport = () => {
    const header = ["Reference", "Learner", "Coach", "Form type", "Programme", "Cohort", "Meeting date", "Form status", "Forms check", "Feedback check", "Version", "Follow-ups"];
    const rows = sorted.map((review) => [
      review.id,
      review.learner,
      review.coach,
      review.formType,
      review.programme,
      review.cohort,
      review.meetingDate,
      review.formStatus,
      review.formCheck,
      review.feedbackCheck,
      review.version,
      String(review.followUps),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "quality-assurance-report.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setToast({ text: `Report exported · ${sorted.length} reviews`, tone: "info" });
  };

  const onSort = (key: SortKey) => {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  };

  const navigate = (id: string) => {
    setSidebarOpen(false);
    setSearchParams({ view: id }, { replace: true });
    const meta = VIEW_META[id];
    const isStandaloneView = id === "overview" || id === "quality-team" || id === "feedbacks" || id === "forms";

    if (isStandaloneView) {
      setActive(id);
      if (meta) document.title = `${meta.title} · Kent Business College LMS`;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (id === "learners" || id === "coaches" || id === "reports") {
      setActive((prev) => prev);
      setToast({ text: `${id.charAt(0).toUpperCase()}${id.slice(1)} is part of the full product, not this prototype.`, tone: "info" });
      return;
    }

    const wasStandalone = active === "overview" || active === "quality-team" || active === "feedbacks" || active === "forms";
    setActive(id);
    if (id === "checks") setTab("forms");
    if (id === "checks-feedback") setTab("feedback");
    const target = id === "checks-feedback" ? "checks" : id;
    const scrollToTarget = () => {
      const element = document.getElementById(target);
      if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    if (wasStandalone) window.setTimeout(scrollToTarget, 90);
    else scrollToTarget();
  };

  const onResetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSelected([]);
  };

  const openRecordInQueue = (review: Review) => {
    setActiveId(null);
    setFocusId(review.id);
    setSelected((prev) => (prev.includes(review.id) ? prev : [...prev, review.id]));
    window.setTimeout(() => {
      const element = document.getElementById("reviews");
      if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    setToast({ text: `${review.id} opened in the review queue`, tone: "info" });
  };

  const notify = (text: string) => setToast({ text, tone: "success" });

  /** Dashboard donut drill-down: jump to the review queue filtered by a RAG level. */
  const drillIntoRag = (level: RagLevel) => {
    const count = reviews.filter((review) => reviewRag(review) === level).length;
    setFilters({ ...EMPTY_FILTERS, rag: level });
    setSelected([]);
    setFocusId(null);
    setSidebarOpen(false);
    setActive("reviews");
    setSearchParams({ view: "reviews" }, { replace: true });
    document.title = `${VIEW_META.reviews.title} · Kent Business College LMS`;
    window.setTimeout(() => {
      const element = document.getElementById("reviews");
      if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 90);
    setToast({
      text: count > 0 ? `Showing ${count} ${level.toLowerCase()} review${count === 1 ? "" : "s"} in the queue` : `No ${level.toLowerCase()} reviews in this prototype`,
      tone: "info",
    });
  };

  const isOverview = active === "overview";
  const isTeamView = active === "quality-team";
  const isFeedbacksView = active === "feedbacks";
  const isCalendarView = active === "checks";
  const isRegistryView = active === "forms";
  const showWorkspace = !isOverview && !isTeamView && !isFeedbacksView && !isCalendarView && !isRegistryView;
  const topMeta = VIEW_META[active] ?? VIEW_META.overview;

  return (
    <div className="quality-demo min-h-screen bg-background-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-primary-500 focus:px-3 focus:py-2 focus:text-[12px] focus:font-semibold focus:text-background-50"
      >
        Skip to main content
      </a>

      <LmsSidebar
        role="curriculum"
        appearance="curriculum"
        roleLabel="Curriculum Designer"
        navItems={QUALITY_SIDEBAR_NAV}
        userName={REVIEWER_NAME}
        userRole={"Quality Assurance"}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className="lg:pl-[240px]">
        <Topbar onMenu={() => setSidebarOpen(true)} title={topMeta.title} section={topMeta.section} />

        {isCalendarView ? <QualityReviewsPage embedded /> : <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1560px] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
          {isOverview ? <GeneralDashboard onSelectRag={drillIntoRag} /> : null}
          {isTeamView ? <QualityTeamPage onToast={notify} /> : null}
          {isFeedbacksView ? <FeedbacksPage onToast={notify} /> : null}
          {isRegistryView ? <FormRegistryPage /> : null}

          {showWorkspace ? (
            <>
              <KpiCards stats={stats} loading={loading} />

              <CheckTabs tab={tab} onTab={setTab} reviews={filtered} formType={filters.formType} onFormType={(value) => setFilters((prev) => ({ ...prev, formType: value }))} />

              <FilterBar
                filters={filters}
                onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
                onReset={onResetFilters}
                onExport={exportReport}
                resultCount={filtered.length}
                totalCount={reviews.length}
                dirty={dirty}
              />

              <ReviewsTable
                rows={pageRows}
                total={sorted.length}
                loading={loading}
                error={error}
                onRetry={() => {
                  setError(false);
                  runLoad();
                }}
                selected={selected}
                onToggleRow={(id) => setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))}
                onTogglePage={(checked) => {
                  const ids = pageRows.map((review) => review.id);
                  setSelected((prev) => (checked ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id))));
                }}
                sort={sort}
                onSort={onSort}
                page={currentPage}
                pages={pages}
                pageSize={pageSize}
                onPage={(next) => setPage(Math.min(Math.max(1, next), pages))}
                onPageSize={setPageSize}
                onView={(review) => setActiveId(review.id)}
                onPreview={(review) => setPdfId(review.id)}
                onDownload={(review) => setPdfId(review.id)}
                onBulk={bulkUpdate}
                onReset={onResetFilters}
                focusId={focusId}
              />

              <AnalyticsPanel reviews={filtered} />
            </>
          ) : null}

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-background-200 py-3 text-[11px] text-foreground-500">
            <p className="flex items-center gap-1.5">
              <i className="ri-shield-check-line text-[13px] text-primary-500" aria-hidden />
              Kent Business College LMS · Quality Assurance
            </p>
            <p className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              Form submission and quality approval are tracked separately
            </p>
          </footer>
        </main>}
      </div>

      {activeReview ? (
        <ReviewDrawer
          key={activeReview.id}
          review={activeReview}
          onClose={() => setActiveId(null)}
          onUpdate={updateReview}
          onPreview={() => setPdfId(activeReview.id)}
          onDownload={() => setPdfId(activeReview.id)}
          onOpenRecord={() => openRecordInQueue(activeReview)}
        />
      ) : null}

      {pdfReview ? <PdfPreviewModal review={pdfReview} onClose={() => setPdfId(null)} /> : null}

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[70] no-print">
          <div className="qa-rise flex items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 shadow-sm">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full ${toast.tone === "success" ? "bg-emerald-100 text-emerald-700" : "bg-primary-100 text-primary-700"}`}>
              <i className={toast.tone === "success" ? "ri-check-line text-[13px]" : "ri-information-line text-[13px]"} aria-hidden />
            </span>
            <p className="max-w-[280px] text-[11.5px] font-medium text-foreground-800">{toast.text}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
