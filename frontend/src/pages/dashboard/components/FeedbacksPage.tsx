import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { feedbackApi, type FeedbackDashboardReport, type FeedbackFormType, type FeedbackResponse, type FeedbackScoreClass } from "@/api/feedback";
import { FormRenderer } from "@/features/feedback/FormRenderer";
import { dashboardPeriod, FEEDBACK_TYPE_LABELS } from "@/features/feedback/feedbackDashboardData";
import { TIME_ZONE_LABEL, todayIso } from "@/pages/curriculum/recordings/utils";

const classes: Record<FeedbackScoreClass, { label: string; action: string; tone: string }> = {
  negative: { label: "Critical", action: "Review required", tone: "bg-red-50 text-red-700 ring-red-200" },
  neutral: { label: "Needs review", action: "Check the response", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  positive: { label: "Positive", action: "No action needed", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  unscored: { label: "Unscored", action: "No scored answers", tone: "bg-background-100 text-foreground-600 ring-background-300" },
};

const selectClass = "w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-[12px] text-foreground-900 focus:border-primary-400";
const dateLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TIME_ZONE_LABEL }).format(new Date(value))
  : "Date not recorded";

export default function FeedbacksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formType, setFormType] = useState<FeedbackFormType | "all">("all");
  const [weeks, setWeeks] = useState(0);
  const [classification, setClassification] = useState<FeedbackScoreClass | "all">(() => {
    const requested = searchParams.get("classification");
    return requested && requested in classes ? requested as FeedbackScoreClass : "all";
  });
  const [group, setGroup] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; report?: FeedbackDashboardReport; error?: string } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FeedbackResponse | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);

  const filters = {
    ...(formType !== "all" ? { formType } : {}),
    ...(classification !== "all" ? { classification } : {}),
    ...(group ? { groupId: group } : {}),
    ...(moduleId ? { moduleId } : {}),
    ...dashboardPeriod(todayIso(TIME_ZONE_LABEL), weeks),
  };
  const key = JSON.stringify([filters, retry]);
  const report = result?.key === key ? result.report : undefined;
  const error = result?.key === key ? result.error : undefined;

  useEffect(() => {
    let active = true;
    const [request] = JSON.parse(key) as [typeof filters, number];
    void feedbackApi.insightsDashboard(request)
      .then(({ analytics }) => {
        if (!analytics.insights?.classification) throw new Error("Feedback classifications are unavailable.");
        if (active) setResult({ key, report: analytics });
      })
      .catch(reason => {
        if (active) setResult({ key, error: reason instanceof Error ? reason.message : "Feedback could not be loaded." });
      });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); setDetailError(""); return; }
    let active = true;
    setDetail(null);
    setDetailError("");
    void feedbackApi.response(selectedId)
      .then(({ response }) => { if (active) setDetail(response); })
      .catch(reason => { if (active) setDetailError(reason instanceof Error ? reason.message : "Response could not be loaded."); });
    return () => { active = false; };
  }, [selectedId, detailRetry]);

  const counts = report?.insights?.classification;
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return [...(counts?.responses ?? [])]
      .filter(row => !text || [row.formTitle, row.contextTitle, row.respondent, row.groupName].some(value => value?.toLowerCase().includes(text)))
      .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  }, [counts, query]);

  return <section aria-label="Quality feedback" className="space-y-4">
    <header>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-400">Voice of the customer</p>
      <h2 className="mt-1 font-heading text-[19px] font-semibold text-foreground-950">Feedbacks</h2>
      <p className="mt-1 text-[12px] text-foreground-600">Submitted feedback from Engagement. Critical and Needs review are score based follow-up labels, not approved QMS assessments.</p>
    </header>

    <div className="grid gap-3 rounded-lg border border-background-200 bg-background-50 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="text-[11px] font-semibold text-foreground-600">Feedback type
        <select aria-label="Quality feedback type" className={`mt-1 ${selectClass}`} value={formType} onChange={event => { setFormType(event.target.value as typeof formType); setGroup(""); setModuleId(""); }}>
          <option value="all">All feedback types</option>
          {Object.entries(FEEDBACK_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-semibold text-foreground-600">Date range
        <select aria-label="Quality feedback date range" className={`mt-1 ${selectClass}`} value={weeks} onChange={event => setWeeks(Number(event.target.value))}>
          <option value={0}>All time</option><option value={4}>Last 4 weeks</option><option value={8}>Last 8 weeks</option><option value={12}>Last 12 weeks</option>
        </select>
      </label>
      <label className="text-[11px] font-semibold text-foreground-600">Classification
        <select aria-label="Quality feedback classification" className={`mt-1 ${selectClass}`} value={classification} onChange={event => {
          const selected = event.target.value as typeof classification;
          setClassification(selected);
          setSearchParams(current => {
            const next = new URLSearchParams(current);
            if (selected === "all") next.delete("classification");
            else next.set("classification", selected);
            return next;
          }, { replace: true });
        }}>
          <option value="all">All classifications</option>
          <option value="negative">Critical (Negative)</option><option value="neutral">Needs review (Neutral)</option>
          <option value="positive">Positive</option><option value="unscored">Unscored</option>
        </select>
      </label>
      <label className="text-[11px] font-semibold text-foreground-600">Learner group
        <select aria-label="Quality feedback group" className={`mt-1 ${selectClass}`} value={group} disabled={!report} onChange={event => { setGroup(event.target.value); setModuleId(""); }}>
          <option value="">All groups</option>
          {report?.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-semibold text-foreground-600">Module
        <select aria-label="Quality feedback module" className={`mt-1 ${selectClass}`} value={moduleId} disabled={!report || !report.modules?.length} onChange={event => setModuleId(event.target.value)}>
          <option value="">All modules</option>
          {report?.modules?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-semibold text-foreground-600">Search responses
        <input type="search" aria-label="Search quality feedback" className={`mt-1 ${selectClass}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Form, activity or respondent" />
      </label>
    </div>

    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-[12px] text-red-800">{error} <button type="button" className="font-semibold underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : null}
    {!report && !error ? <div role="status" className="rounded-lg border border-background-200 bg-background-50 p-6 text-[12px] text-foreground-600">Loading feedback…</div> : null}
    {counts ? <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Responses", value: counts.total, tone: "text-foreground-950" },
          { label: "Critical", value: counts.negative, tone: "text-red-700" },
          { label: "Needs review", value: counts.neutral, tone: "text-amber-800" },
          { label: "Positive", value: counts.positive, tone: "text-emerald-700" },
        ].map(card => <article key={card.label} className="rounded-lg border border-background-200 bg-background-50 p-4"><p className="text-[11px] text-foreground-600">{card.label}</p><strong className={`mt-1 block text-[24px] ${card.tone}`}>{card.value}</strong></article>)}
      </div>
      <p className="text-[11px] text-foreground-600">{rows.length} of {counts.total} responses shown{counts.unscored ? ` · ${counts.unscored} unscored` : ""}. Positive feedback needs no follow-up.</p>
      <ul className="divide-y divide-background-200 rounded-lg border border-background-200 bg-background-50">
        {rows.map(row => {
          const triage = classes[row.classification];
          const currentDetail = detail?.id === row.responseId ? detail : null;
          return <li key={row.responseId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-[13px] text-foreground-950">{row.contextTitle || row.formTitle}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${triage.tone}`}>{triage.label}</span></div>
                <p className="mt-1 text-[11px] text-foreground-600">{row.formTitle} · v{row.version}{row.groupName ? ` · ${row.groupName}` : ""} · {row.respondent}</p>
                <p className="mt-1 text-[11px] text-foreground-500">{triage.action} · {dateLabel(row.submittedAt)}{row.score === null ? "" : ` · ${Math.round(row.score)}%`}</p>
              </div>
              <button type="button" className="rounded-md border border-background-300 px-3 py-1.5 text-[11px] font-semibold text-primary-700 hover:bg-background-100" aria-expanded={selectedId === row.responseId} onClick={() => setSelectedId(selectedId === row.responseId ? null : row.responseId)}>{selectedId === row.responseId ? "Close answers" : "View answers"}</button>
            </div>
            {selectedId === row.responseId ? <div className="mt-4 border-t border-background-200 pt-4">
              {detailError ? <p role="alert" className="text-[12px] text-red-700">{detailError} <button type="button" className="font-semibold underline" onClick={() => setDetailRetry(value => value + 1)}>Retry</button></p> : null}
              {!currentDetail && !detailError ? <p role="status" className="text-[12px] text-foreground-600">Loading answers…</p> : null}
              {currentDetail ? <FormRenderer sections={currentDetail.sections || []} answers={Object.fromEntries((currentDetail.sections || []).flatMap(section => section.questions.map(question => [String(question.id), question.answer ?? null])))} readOnly /> : null}
            </div> : null}
          </li>;
        })}
        {!rows.length ? <li className="p-8 text-center text-[12px] text-foreground-600">No responses match these filters.</li> : null}
      </ul>
    </> : null}
  </section>;
}
