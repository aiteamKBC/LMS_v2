import { useId, useState } from 'react';
import { ChevronDown, FileText, Search } from 'lucide-react';
import type { FeedbackAnalyticsData, FeedbackQuestionMetric } from '@/api/feedback';
import { NEUTRAL_SCORE_MIN, POSITIVE_SCORE_MIN } from './scoreClassification';

const STATUS = {
  good: { label: 'Good', tone: 'bg-emerald-50 text-emerald-800' },
  watch: { label: 'Watch', tone: 'bg-amber-50 text-amber-800' },
  needs_attention: { label: 'Needs attention', tone: 'bg-rose-50 text-rose-800' },
  no_data: { label: 'No data', tone: 'bg-slate-100 text-slate-600' },
  not_scored: { label: 'Not scored', tone: 'bg-slate-100 text-slate-600' },
};

export function QuestionAnalytics({ questions, overall }: {
  questions: FeedbackQuestionMetric[]; overall?: FeedbackAnalyticsData['overallScore'];
}) {
  const grouped = new Map<string, { formTitle: string; version: number; questions: FeedbackQuestionMetric[] }>();
  for (const question of questions) {
    const key = `${question.formId}:${question.version}`;
    const group = grouped.get(key) || { formTitle: question.formTitle, version: question.version, questions: [] };
    group.questions.push(question);
    grouped.set(key, group);
  }
  return <section aria-label="Question analytics" className="mt-5 overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4">
      <div className="max-w-2xl"><h3 className="font-heading text-sm font-bold text-foreground-900">Question scores and answer rates</h3><p className="mt-1 text-[11px] leading-5 text-foreground-500">Submitted feedback only. Answer rate compares answered questions with their assigned recipients, not everyone in the bank. Draft answers do not count. Versions are reported separately.</p></div>
      {overall && <div className="rounded-xl bg-primary-50 px-4 py-3"><p className="text-[11px] font-semibold text-primary-800">Weighted Overall Score</p><p className="mt-1 text-xl font-bold text-primary-900">{overall.score == null ? 'No data' : `${Math.round(overall.score)}%`}</p><p className="mt-1 text-[10px] text-foreground-500">{overall.scoredQuestions} of {overall.includedQuestions} included questions have scored responses.</p></div>}
    </div>
    <p className="px-5 py-3 text-[11px] text-foreground-500">Good: {POSITIVE_SCORE_MIN}% or above. Watch: {NEUTRAL_SCORE_MIN}% to below {POSITIVE_SCORE_MIN}%. Needs attention: below {NEUTRAL_SCORE_MIN}%. Unanswered and unscored questions never count as zero in the overall score.</p>
    {questions.length ? <div className="space-y-3 px-4 pb-5 sm:px-5">
      <p className="pb-1 text-xs text-slate-500">{grouped.size} form versions · {questions.length} questions. Open a group to browse 10 questions at a time. Search and pages do not change the Overall Score.</p>
      {[...grouped.entries()].map(([key, group]) => <QuestionGroup key={key} {...group} />)}
    </div> : <p className="p-6 text-center text-xs text-foreground-500">No questions in this selection yet.</p>}
    <p className="border-t border-foreground-100 px-5 py-3 text-[10px] leading-5 text-foreground-400">Submitted historical responses remain included after an invitation is revoked. Coverage is unavailable if a legacy bank delivery has not selected its questions yet. Importance affects reporting only, never random selection or availability.</p>
  </section>;
}

function QuestionGroup({ formTitle, version, questions }: { formTitle: string; version: number; questions: FeedbackQuestionMetric[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const panelId = useId();
  const label = `${formTitle} — version ${version}`;
  const term = search.trim().toLowerCase();
  const filtered = questions.filter(question => !term || `${question.question} ${question.category}`.toLowerCase().includes(term));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, pages);
  const start = (current - 1) * 10;
  const visible = filtered.slice(start, start + 10);
  return <section aria-label={label} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <h4><button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-violet-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><FileText size={18} /></span>
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="break-words text-sm font-bold text-slate-900">{formTitle}</span><span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">Version {version}</span></span><span className="mt-1 block text-xs font-normal text-slate-500">{questions.length} questions</span></span>
      <span className="hidden text-xs font-semibold text-primary-700 sm:block">{open ? 'Hide questions' : 'View questions'}</span><ChevronDown aria-hidden="true" size={18} className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button></h4>
    {open && <div id={panelId} className="border-t border-slate-100">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-slate-50/60 px-4 py-3">
        <label className="block w-full text-xs font-semibold text-slate-600 sm:max-w-sm">Search questions<span className="relative mt-1.5 block"><Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label={`Search questions in ${label}`} type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Question text or category" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-normal outline-offset-2 focus:outline-primary-500" /></span></label>
        {search && <button type="button" onClick={() => { setSearch(''); setPage(1); }} className="py-2 text-xs font-semibold text-primary-700">Clear search</button>}
      </div>
      {visible.length ? <QuestionTable questions={visible} label={label} /> : <p className="p-6 text-center text-xs text-slate-500">No questions match this search.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <p role="status" className="text-xs text-slate-500">Showing {filtered.length ? start + 1 : 0}–{Math.min(start + 10, filtered.length)} of {filtered.length} questions{term ? ` (${questions.length} total)` : ''}</p>
        <nav aria-label={`Question pages for ${label}`} className="flex items-center gap-3 text-xs">
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
          <span className="whitespace-nowrap text-slate-500">Page {current} of {pages}</span>
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
        </nav>
      </div>
    </div>}
  </section>;
}

function QuestionTable({ questions, label }: { questions: FeedbackQuestionMetric[]; label: string }) {
  return <div className="max-w-full overflow-x-auto"><table aria-label={`${label} questions`} className="w-full min-w-[880px] text-left text-xs"><thead className="bg-background-100 text-[10px] uppercase tracking-wide text-foreground-500"><tr><th className="px-5 py-3">Question</th><th className="px-4 py-3">Importance</th><th className="px-4 py-3">Answer rate</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Answers</th></tr></thead><tbody className="divide-y divide-foreground-100">
      {questions.map(question => {
      const status = STATUS[question.status];
      const classification = question.classification;
      const classified = classification ? classification.positive + classification.neutral + classification.negative : 0;
      return <tr key={question.questionId}>
        <td className="max-w-sm !text-left px-5 py-4"><p className="font-semibold text-foreground-800">{question.question}</p><p className="mt-1 text-[10px] text-foreground-500">{question.formTitle} · v{question.version} · {question.category}</p>{question.averageRating != null && <p className="mt-1 text-[11px] text-amber-700">{question.averageRating}/{question.scaleMax} rating average</p>}</td>
        <td className="px-4 py-4"><span className="capitalize">{question.importance}</span><p className="mt-1 text-[10px] text-foreground-400">Weight {question.weight}{question.includedInOverall ? '' : ' · excluded from overall'}</p></td>
        <td className="px-4 py-4"><strong>{question.answerRate == null ? 'Not available' : `${question.answerRate}%`}</strong><p className="mt-1 text-[10px] text-foreground-500">{question.answeredCount} answered{question.assignedCount == null ? ' · assignment coverage unknown' : ` / ${question.assignedCount} assigned`}</p></td>
        <td className="px-4 py-4"><strong>{question.score == null ? '—' : `${Math.round(question.score)}%`}</strong>{question.score != null && <p className="mt-1 text-[10px] text-foreground-500">{question.scoredResponses} scored responses</p>}</td>
        <td className="px-4 py-4"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${status.tone}`}>{status.label}</span></td>
        <td className="px-4 py-4">{classification && <details className="mb-2"><summary className="cursor-pointer text-[11px] font-semibold text-slate-700">{classified ? `Positive ${Math.round(classification.positive / classified * 100)}% · Negative ${Math.round(classification.negative / classified * 100)}%` : 'No scored answers'}</summary><ul className="mt-2 space-y-1 text-[11px]">{(['positive', 'neutral', 'negative'] as const).map(kind => <li key={kind} className="capitalize">{kind}: {classification[kind]}{classified ? ` (${Math.round(classification[kind] / classified * 100)}%)` : ''}</li>)}<li>Unscored answered questions: {classification.unscored}</li></ul></details>}{question.distribution.length ? <details><summary className="cursor-pointer font-semibold text-primary-700">Answer distribution</summary><ul className="mt-2 space-y-1">{question.distribution.map(item => <li key={item.label} className="flex justify-between gap-4"><span>{item.label}</span><strong>{item.count}</strong></li>)}</ul></details> : <span className="text-[11px] text-foreground-500">{['short_text', 'long_text'].includes(question.type) ? 'Qualitative feedback — see Responses' : 'No distribution'}</span>}</td>
      </tr>;
    })}</tbody></table></div>;
}
