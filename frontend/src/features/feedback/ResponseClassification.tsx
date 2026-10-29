import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { FeedbackClassificationReport, FeedbackFormType, FeedbackQuestionMetric, FeedbackScoreClass } from '@/api/feedback';
import { Plot } from './FeedbackInsightCharts';
import styles from './feedbackCharts.module.css';
import { SCORE_CLASSIFICATION_TEXT } from './scoreClassification';

const classes: { key: FeedbackScoreClass; label: string; color: string; tone: string }[] = [
  { key: 'positive', label: 'Positive', color: '#10b981', tone: 'bg-emerald-50 text-emerald-800' },
  { key: 'neutral', label: 'Neutral', color: '#f59e0b', tone: 'bg-amber-50 text-amber-800' },
  { key: 'negative', label: 'Negative', color: '#f43f5e', tone: 'bg-rose-50 text-rose-800' },
  { key: 'unscored', label: 'Unscored', color: '#94a3b8', tone: 'bg-slate-100 text-slate-700' },
];
const typeLabels: Record<FeedbackFormType, string> = { general: 'General', post_lecture: 'Live Sessions Feedback', post_event: 'Events', event_rsvp: 'Event RSVP', post_mcm_review: 'MCM', post_progress_review: 'Progress review', mid_module: 'Mid-module', end_module: 'End-module' };
const month = (value: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(value)) : 'Date unavailable';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h3 className="mb-4 text-sm font-bold text-slate-900">{title}</h3>{children}</section>;
}

function Legend() {
  return <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">{classes.map(item => <span key={item.key} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>)}</div>;
}

function TopQuestions({ questions, kind }: { questions: FeedbackQuestionMetric[]; kind: 'positive' | 'negative' }) {
  const data = questions.flatMap(question => {
    const counts = question.classification;
    if (!counts) return [];
    const scored = counts.positive + counts.neutral + counts.negative;
    return scored && counts[kind] ? [{ question, count: counts[kind], scored, rate: counts[kind] / scored * 100 }] : [];
  }).sort((a, b) => b.rate - a.rate || b.count - a.count || a.question.questionId - b.question.questionId).slice(0, 5);
  return <Card title={kind === 'positive' ? 'Top positive questions' : 'Top negative questions'}>
    <p className="mb-3 text-xs leading-5 text-slate-500">Share of scored answers for each question. Unscored answers are separate.</p>
    {data.length ? <ol className="space-y-4">{data.map(({ question, count, scored, rate }) => <li key={question.questionId}><div className="flex justify-between gap-3 text-xs"><p className="min-w-0 break-words font-semibold leading-5 text-slate-800">{question.question}</p><strong className="shrink-0">{Math.round(rate)}%</strong></div><p className="mt-1 text-[11px] leading-5 text-slate-500">{question.formTitle} · v{question.version} · {question.category} · {count}/{scored} scored answers{question.includedInOverall ? '' : ' · excluded from overall'}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${rate}%`, background: kind === 'positive' ? '#10b981' : '#f43f5e' }} /></div></li>)}</ol> : <p className="py-8 text-center text-xs text-slate-500">No {kind} answers in this selection.</p>}
  </Card>;
}

export function ResponseClassification({ report, questions, onViewResponse }: { report: FeedbackClassificationReport; questions: FeedbackQuestionMetric[]; onViewResponse?: (id: number) => void }) {
  const [filter, setFilter] = useState<FeedbackScoreClass | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const records = report.responses.filter(item => (filter === 'all' || item.classification === filter) && `${item.respondent} ${item.formTitle}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(records.length / 10));
  const current = Math.min(page, pages);
  const byType = report.byType.map(item => ({ ...item, label: typeLabels[item.formType] || item.formType }));
  const pie = classes.map(item => ({ ...item, value: report[item.key] }));
  return <section aria-label="Score-based response classification" className="mt-5 space-y-4">
    <div><h2 className="text-base font-bold text-slate-900">Positive, neutral and negative feedback</h2><p className="mt-1 text-xs leading-5 text-slate-500">Scores only, without AI text analysis. Completed responses use the weighted average of their included scored questions: {SCORE_CLASSIFICATION_TEXT} Responses with no scored answers remain Unscored.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div className="rounded-xl border border-violet-100 bg-white p-4"><p className="text-xs text-slate-500">Completed responses in report</p><p className="mt-2 text-2xl font-bold text-violet-900">{report.total}</p></div>
      {classes.map(item => <div key={item.key} className={`rounded-xl p-4 ${item.tone}`}><p className="text-xs font-semibold">{item.label} responses</p><p className="mt-2 text-2xl font-bold">{report[item.key]}</p></div>)}
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card title="Response classification split">
        {report.total ? <div className="relative"><Plot label="Response classification chart" height={224}><PieChart><Pie data={pie} dataKey="value" nameKey="label" innerRadius={64} outerRadius={88} paddingAngle={2} isAnimationActive={false}>{pie.map(item => <Cell key={item.key} fill={item.color} />)}</Pie><Tooltip isAnimationActive={false} formatter={(value, name) => [value, String(name)]} /></PieChart></Plot><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-2xl text-slate-900">{report.total}</strong><span className="text-[11px] text-slate-500">Completed</span></div></div> : <p className="py-12 text-center text-xs text-slate-500">No completed responses in this selection.</p>}
        <ul className="mt-3 grid grid-cols-2 gap-3 text-xs">{classes.map(item => <li key={item.key} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span><strong>{report[item.key]} ({report.total ? Math.round(report[item.key] / report.total * 100) : 0}%)</strong></li>)}</ul>
      </Card>
      <Card title="Response classification by feedback type">
        {byType.length ? <div className={styles.categoryViewport}><Plot label="Response classification by type chart" height={Math.max(224, byType.length * 44)}><BarChart data={byType} layout="vertical" barSize={18} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer><CartesianGrid horizontal={false} stroke="#edf0f5" strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis dataKey="label" type="category" width={156} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip isAnimationActive={false} />{classes.map(item => <Bar key={item.key} dataKey={item.key} name={item.label} stackId="classification" fill={item.color} isAnimationActive={false} />)}</BarChart></Plot></div> : <p className="py-12 text-center text-xs text-slate-500">No response classifications yet.</p>}
        <Legend />
      </Card>
      <Card title="Response classification over time">
        {report.trend.length ? <><Plot label="Response classification timeline" height={224}><LineChart data={report.trend} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} accessibilityLayer><CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="3 3" /><XAxis dataKey="month" tickFormatter={month} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={25} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={label => typeof label === 'string' && /^\d{4}-\d{2}$/.test(label) ? month(label) : ''} isAnimationActive={false} />{classes.map(item => <Line key={item.key} type="linear" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />)}</LineChart></Plot><Legend /></> : <p className="py-12 text-center text-xs text-slate-500">No dated completed responses yet.</p>}
        <p className="mt-3 text-[11px] text-slate-500">Response counts by submission month (UK time). No text sentiment is inferred.</p>
        {report.trend.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold text-violet-700">Classification counts by month</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Month</th>{classes.map(item => <th key={item.key} className="p-2">{item.label}</th>)}</tr></thead><tbody>{report.trend.map(item => <tr key={item.month}><td className="p-2">{month(item.month)}</td>{classes.map(kind => <td key={kind.key} className="p-2">{item[kind.key]}</td>)}</tr>)}</tbody></table></div></details>}
      </Card>
      <div className="space-y-4"><TopQuestions questions={questions} kind="positive" /><TopQuestions questions={questions} kind="negative" /></div>
    </div>
    <Card title="Classified responses">
      <p className="mb-3 text-xs text-slate-500">Search and classification filters below affect this list only. Anonymous responses remain anonymous.</p>
      <div className="mb-4 flex flex-wrap gap-3"><label className="text-xs font-semibold">Classification<select aria-label="Response classification filter" value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setPage(1); }} className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">All classifications</option>{classes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="min-w-0 flex-1 text-xs font-semibold">Search responses<input aria-label="Search classified responses" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Name or form" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" /></label></div>
      {records.length ? <div className="overflow-x-auto"><table aria-label="Classified response records" className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Respondent', 'Form / version', 'Score', 'Classification', 'Scored questions', 'Submitted (UK)', ...(onViewResponse ? ['Answers'] : [])].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.slice((current - 1) * 10, current * 10).map(item => <tr key={item.responseId}><td className="px-3 py-3">{item.respondent || `Response #${item.responseId}`}</td><td className="px-3 py-3">{item.formTitle} · v{item.version}</td><td className="px-3 py-3 font-semibold">{item.score == null ? '—' : `${Math.round(item.score)}%`}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 font-semibold ${classes.find(kind => kind.key === item.classification)!.tone}`}>{classes.find(kind => kind.key === item.classification)!.label}</span></td><td className="px-3 py-3">{item.scoredQuestions}</td><td className="px-3 py-3">{date(item.submittedAt)}</td>{onViewResponse && <td className="px-3 py-3"><button type="button" onClick={() => onViewResponse(item.responseId)} className="font-semibold text-violet-700">View answers</button></td>}</tr>)}</tbody></table></div> : <p className="py-8 text-center text-xs text-slate-500">No responses match these filters.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span>{records.length} responses · Page {current} of {pages}</span><div className="flex gap-2"><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous responses</button><button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next responses</button></div></div>
    </Card>
  </section>;
}
