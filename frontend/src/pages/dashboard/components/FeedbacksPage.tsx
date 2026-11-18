import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { feedbackApi, type FeedbackDashboardReport, type FeedbackFormType, type FeedbackResponse, type FeedbackScoreClass } from "@/api/feedback";
import { FormRenderer } from "@/features/feedback/FormRenderer";
import { qualityDashboardFeedbackTypeEntries } from "@/features/feedback/feedbackDashboardData";
import { TIME_ZONE_LABEL } from "@/pages/curriculum/recordings/utils";
import { isQualityDashboardHiddenFormName } from "@/lib/qualityDashboardFeedback";

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
  const requestedClassification = searchParams.get("classification");
  const classification = requestedClassification && requestedClassification in classes ? requestedClassification as FeedbackScoreClass : null;
  const [formType, setFormType] = useState<FeedbackFormType | "all">("all");
  const [formId, setFormId] = useState("");
  const [availableForms, setAvailableForms] = useState<NonNullable<FeedbackDashboardReport["forms"]>>([]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; report?: FeedbackDashboardReport; error?: string } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FeedbackResponse | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);

  const filters = {
    includeForms: true,
    ...(formType !== "all" ? { formType } : {}),
    ...(formId ? { formId: Number(formId) } : {}),
    ...(classification ? { classification } : {}),
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
        if (active) { setAvailableForms(analytics.forms ?? []); setResult({ key, report: analytics }); }
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
  const rows = [...(counts?.responses ?? [])].sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  return <section aria-label="Quality feedback" className="space-y-4">
    <header>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-400">Voice of the customer</p>
      <h2 className="mt-1 font-heading text-[19px] font-semibold text-foreground-950">Feedbacks</h2>
      <p className="mt-1 text-[12px] text-foreground-600">Submitted feedback from Engagement. Critical and Needs review are score based follow-up labels, not approved QMS assessments.</p>
    </header>

    <div className="grid gap-3 rounded-lg border border-background-200 bg-background-50 p-4 sm:grid-cols-2">
      <label className="text-[11px] font-semibold text-foreground-600">Feedback type
        <select aria-label="Quality feedback type" className={`mt-1 ${selectClass}`} value={formType} onChange={event => { setFormType(event.target.value as typeof formType); setFormId(""); }}>
          <option value="all">All feedback types</option>
          {qualityDashboardFeedbackTypeEntries().map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-[11px] font-semibold text-foreground-600">Feedback form
        <select aria-label="Quality feedback form" className={`mt-1 ${selectClass}`} value={formId} onChange={event => setFormId(event.target.value)}>
          <option value="">All forms</option>
          {availableForms.filter(form => !isQualityDashboardHiddenFormName(form.title) && (formType === "all" || form.formType === formType)).map(form =>
            <option key={form.id} value={form.id}>{form.title}</option>)}
        </select>
      </label>
    </div>

    {classification ? <p className="text-[11px] text-foreground-600">Showing {classification} responses from the overview. <button type="button" className="font-semibold underline" onClick={() => setSearchParams(current => { const next = new URLSearchParams(current); next.delete("classification"); return next; }, { replace: true })}>Show all responses</button></p> : null}
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-[12px] text-red-800">{error} <button type="button" className="font-semibold underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : null}
    {!report && !error ? <div role="status" className="rounded-lg border border-background-200 bg-background-50 p-6 text-[12px] text-foreground-600">Loading feedback…</div> : null}
    {counts ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Completed responses in report", value: counts.total, tone: "border-violet-100 bg-white text-violet-900" },
          { label: "Positive responses", value: counts.positive, tone: "border-emerald-50 bg-emerald-50 text-emerald-800" },
          { label: "Neutral responses", value: counts.neutral, tone: "border-amber-50 bg-amber-50 text-amber-800" },
          { label: "Negative responses", value: counts.negative, tone: "border-rose-50 bg-rose-50 text-rose-800" },
        ].map(card => <article key={card.label} className={`rounded-2xl border p-4 sm:p-5 ${card.tone}`}><p className="text-xs font-semibold">{card.label}</p><strong className="mt-2 block text-2xl">{card.value}</strong></article>)}
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
