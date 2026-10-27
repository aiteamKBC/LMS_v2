import { useEffect, useMemo, useState } from 'react';
import { feedbackApi, type FeedbackAnalyticsData, type FeedbackAnalyticsFilters, type FeedbackQuestionReport } from '@/api/feedback';
import { QuestionAnalytics } from './QuestionAnalytics';
import { lectureAnalyticsLabel } from './lectureAnalyticsLabels';
import { FeedbackInsights } from './FeedbackInsights';
import { ResponseClassification } from './ResponseClassification';

const field = 'mt-1.5 w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-xs outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100';

export function LectureQuestionAnalytics({ data, scope, showLectures = true, onViewResponse }: { data: FeedbackAnalyticsData; scope: FeedbackAnalyticsFilters; showLectures?: boolean; onViewResponse?: (id: number) => void }) {
  const { formId, formType } = scope;
  const [moduleId, setModuleId] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; report?: FeedbackQuestionReport; error?: string } | null>(null);
  const key = JSON.stringify([formId, formType, moduleId, deliveryId, retry]);
  const filtered = Boolean(moduleId || deliveryId);
  const loading = filtered && result?.key !== key;
  const error = result?.key === key ? result.error : undefined;
  const lectures = useMemo(() => data.lectures || [], [data.lectures]);
  const modules = useMemo(() => [...new Map(lectures.map(lecture => [lecture.moduleId, lecture.moduleName || lecture.moduleId])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1])), [lectures]);
  const visibleLectures = lectures.filter(lecture => (!moduleId || lecture.moduleId === moduleId)
    && (String(lecture.deliveryId) === deliveryId || !search || `${lecture.moduleName} ${lectureAnalyticsLabel(lecture)}`.toLowerCase().includes(search.toLowerCase().trim())));
  const selectedLecture = lectures.find(lecture => String(lecture.deliveryId) === deliveryId);
  const label = selectedLecture ? `${selectedLecture.moduleName || selectedLecture.moduleId} — ${lectureAnalyticsLabel(selectedLecture)}`
    : moduleId ? `All lectures in ${modules.find(([id]) => id === moduleId)?.[1] || moduleId}` : 'All feedback in the selected type / form';

  useEffect(() => {
    if (!moduleId && !deliveryId) return;
    let active = true;
    feedbackApi.questionAnalytics({
      ...(formId ? { formId } : {}), ...(formType ? { formType } : {}),
      ...(moduleId ? { moduleId } : {}), ...(deliveryId ? { deliveryId: Number(deliveryId) } : {}),
    }).then(({ analytics }) => {
      if (active) setResult({ key, report: analytics });
    }).catch(error => {
      if (active) setResult({ key, error: error instanceof Error ? error.message : 'Could not load question analytics.' });
    });
    return () => { active = false; };
  }, [deliveryId, key, moduleId, formId, formType]);

  const report = filtered ? result?.key === key ? result.report : undefined
    : { questionMetrics: data.questionMetrics || [], overallScore: data.overallScore, insights: data.insights };
  return <section aria-label={showLectures ? 'Lecture question report' : 'Feedback question report'} className="mt-5">
    {showLectures && <div className="rounded-2xl border border-primary-100 bg-primary-50/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-foreground-900">Find a lecture</h3><p className="mt-1 text-xs text-foreground-600">These filters affect the questions, their Overall Score and the insights below. Completion counters and the existing completion and rating charts still follow Feedback type and Feedback form.</p></div>{(moduleId || deliveryId) && <button type="button" onClick={() => { setModuleId(''); setDeliveryId(''); setSearch(''); }} className="rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700">Clear lecture filters</button>}</div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_2fr]">
        <label className="text-xs font-semibold text-foreground-700">Module<select aria-label="Question report module" className={field} value={moduleId} onChange={event => { setModuleId(event.target.value); setDeliveryId(''); setSearch(''); }}><option value="">All modules</option>{modules.map(([id, title]) => <option key={id} value={id}>{title} ({id})</option>)}</select></label>
        <label className="text-xs font-semibold text-foreground-700">Search lectures<input aria-label="Search lectures" type="search" className={field} value={search} onChange={event => setSearch(event.target.value)} placeholder="Lecture, group or date" /></label>
        <label className="min-w-0 text-xs font-semibold text-foreground-700">Lecture <span className="font-normal text-foreground-400">(UK time)</span><select aria-label="Question report lecture" className={field} value={deliveryId} onChange={event => setDeliveryId(event.target.value)}><option value="">{moduleId ? 'All lectures in this module' : 'All feedback — choose a lecture to separate its results'}</option>{visibleLectures.map(lecture => <option key={lecture.deliveryId} value={lecture.deliveryId}>{lectureAnalyticsLabel(lecture)}</option>)}</select></label>
      </div>
      {!lectures.length && <p className="mt-3 text-xs text-foreground-500">No saved lecture deliveries in the selected type / form. Other feedback remains listed below.</p>}
      {search && !visibleLectures.length && <p role="status" className="mt-3 text-xs text-foreground-500">No lectures match your search.</p>}
      <p className="mt-4 break-words rounded-lg bg-white p-3 text-xs font-semibold text-primary-800">Question report: {label}</p>
    </div>}
    {loading && <p role="status" className="p-5 text-sm text-foreground-500">{showLectures ? 'Loading lecture question results…' : 'Loading question results…'}</p>}
    {error && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 font-bold underline">{showLectures ? 'Retry lecture results' : 'Retry question results'}</button></div>}
    {report && !error && <>
      {report.selectionPending && <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-xs text-amber-800">This legacy lecture has no saved question selection yet. Analytics does not draw questions or change its availability.</p>}
      {report.insights?.classification && <ResponseClassification report={report.insights.classification} questions={report.questionMetrics} onViewResponse={onViewResponse} />}
      {report.insights && <FeedbackInsights insights={report.insights} questions={report.questionMetrics} />}
      <QuestionAnalytics questions={report.questionMetrics} overall={report.overallScore} />
    </>}
  </section>;
}
