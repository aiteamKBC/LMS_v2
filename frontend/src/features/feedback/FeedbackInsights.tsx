import type { ReactNode } from 'react';
import { ArrowDownRight, BarChart3, CircleAlert, Layers3, MessageSquareText, Star, TrendingUp } from 'lucide-react';
import type { FeedbackQuestionMetric, FeedbackReportInsights } from '@/api/feedback';
import { CategoryScores, ScoreTrend, StarDistribution } from './FeedbackInsightCharts';
import { NEUTRAL_SCORE_MIN } from './scoreClassification';

const scoreLabel = (score: number | null) => score == null ? 'No data' : `${Math.round(score)}%`;

function Card({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return <section aria-label={title} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
    <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">{icon}</span><div><h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p></div></div>
    <div className="p-4 sm:p-5">{children}</div>
  </section>;
}

export function FeedbackInsights({ insights, questions }: { insights: FeedbackReportInsights; questions: FeedbackQuestionMetric[] }) {
  const lowest = questions.filter(question => question.includedInOverall && question.score != null)
    .sort((left, right) => left.score! - right.score! || left.questionId - right.questionId).slice(0, 5);
  const needsAttention = questions.filter(question => question.includedInOverall && question.status === 'needs_attention').length;
  const stats = [
    { label: 'Average stars', value: insights.stars.average == null ? 'No data' : `${insights.stars.average.toFixed(2)} / 5`, help: 'Raw star ratings', icon: <Star size={19} />, tone: 'bg-amber-50 text-amber-600' },
    { label: 'Star answers', value: String(insights.stars.answers), help: 'Answered star questions', icon: <MessageSquareText size={19} />, tone: 'bg-violet-50 text-violet-600' },
    { label: 'Questions needing attention', value: String(needsAttention), help: `Included questions scoring below ${NEUTRAL_SCORE_MIN}%`, icon: <CircleAlert size={19} />, tone: 'bg-rose-50 text-rose-600' },
  ];
  return <section aria-label="Feedback insights" className="mt-5 space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      {stats.map(item => <div key={item.label} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div><p className="text-xs font-semibold text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{item.value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.help}</p></div><span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.tone}`}>{item.icon}</span></div>)}
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card title="Rating distribution" subtitle="How answers are spread across the five stars." icon={<BarChart3 size={18} />}>
        <StarDistribution stars={insights.stars} />
      </Card>
      <Card title="Score over time" subtitle="Monthly weighted score · submitted feedback · UK time" icon={<TrendingUp size={18} />}>
        <ScoreTrend insights={insights} />
      </Card>
      <Card title="Category scores" subtitle="Compare scored categories. Form and version details are kept separate." icon={<Layers3 size={18} />}>
        <CategoryScores categories={insights.categories} />
      </Card>
      <Card title="Lowest-scoring questions" subtitle="Five questions to review first, with their answer counts." icon={<ArrowDownRight size={18} />}>
        {lowest.length ? <ol className="divide-y divide-slate-100">{lowest.map((question, index) => <li key={question.questionId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold leading-5 text-slate-800">{question.question}</p><p className="mt-1 text-xs leading-5 text-slate-500">{question.formTitle} · v{question.version} · {question.category}<br />{question.scoredResponses} scored answers</p></div><strong className={`shrink-0 rounded-lg px-2 py-1 text-sm ${question.status === 'needs_attention' ? 'bg-rose-50 text-rose-700' : question.status === 'watch' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{scoreLabel(question.score)}</strong></li>)}</ol> : <p className="py-8 text-center text-xs text-slate-500">No scored questions in this selection.</p>}
      </Card>
    </div>
    <details className="rounded-xl border border-slate-200/70 bg-slate-50 px-4 py-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium text-slate-600">About these numbers</summary><p className="mt-2 leading-5">Stars count answers, not people or forms. Weighted scores use question importance and exclude unanswered or excluded questions. Months without data have no score; the mix of questions can change between months. Category results retain each form and version.</p></details>
  </section>;
}
