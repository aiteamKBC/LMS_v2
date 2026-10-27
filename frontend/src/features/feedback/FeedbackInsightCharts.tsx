import { useId, type ReactElement, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList,
  PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { FeedbackReportInsights } from '@/api/feedback';
import styles from './feedbackCharts.module.css';

const scoreLabel = (score: number | null) => score == null ? 'No data' : `${Math.round(score)}%`;
const monthLabel = (month: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
const tick = { fill: '#64748b', fontSize: 12 };
const chartColor = '#7c3aed';

export function Plot({ label, height, children }: { label: string; height: number; children: ReactElement }) {
  return <div role="group" aria-label={label} className={styles.plot} style={{ height }}>
    <div className={styles.canvas}>
      <ResponsiveContainer width="100%" height={height} minWidth={0} minHeight={0} debounce={80}>
        {children}
      </ResponsiveContainer>
    </div>
  </div>;
}

type TooltipItem = { label?: string; context?: string; count?: number; share?: number; score?: number | null; scoredAnswers?: number };
function InsightTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: TooltipItem }[] }) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;
  return <div className="max-w-64 break-words rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-lg">
    <p className="font-semibold text-slate-900">{item.label}</p>
    {item.context && <p className="mt-1 text-slate-500">{item.context}</p>}
    {item.count != null && <p className="mt-2 font-semibold text-slate-700">{item.count} answers · {item.share}%</p>}
    {item.score != null && <p className="mt-2 font-semibold text-violet-700">{scoreLabel(item.score)} · {item.scoredAnswers} scored answers</p>}
  </div>;
}

const Details = ({ children, label }: { children: ReactNode; label: string }) => <details className="mt-4 border-t border-slate-100 pt-3 text-xs"><summary className="cursor-pointer font-semibold text-primary-700 outline-offset-4">{label}</summary><div className="mt-3 max-h-64 overflow-auto">{children}</div></details>;

export function StarDistribution({ stars }: { stars: FeedbackReportInsights['stars'] }) {
  const data = stars.distribution.map(item => ({ ...item, label: `${item.stars} ${item.stars === 1 ? 'star' : 'stars'}`, share: stars.answers ? Math.round(item.count / stars.answers * 100) : 0 }));
  if (!stars.answers) return <EmptyChart text="No star answers in this selection." />;
  return <>
    <Plot label="Star rating chart" height={224}>
        <BarChart data={data} margin={{ top: 24, right: 8, left: -18, bottom: 0 }} barSize={40} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="3 3" />
          <XAxis dataKey="stars" axisLine={false} tickLine={false} tick={tick} tickMargin={10} tickFormatter={value => `${value} ★`} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={tick} width={42} />
          <Tooltip content={<InsightTooltip />} cursor={{ fill: '#f8fafc', radius: 8 }} isAnimationActive={false} />
          <Bar dataKey="count" name="Answers" fill={chartColor} radius={[7, 7, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="count" position="top" fill="#475569" fontSize={12} />
          </Bar>
        </BarChart>
    </Plot>
    <Details label="Rating counts and percentages"><table className="w-full text-left"><thead className="text-slate-500"><tr><th className="p-2">Rating</th><th className="p-2">Answers</th><th className="p-2">Share</th></tr></thead><tbody>{data.map(item => <tr key={item.stars} className="border-t border-slate-100"><td className="p-2">{item.label}</td><td className="p-2">{item.count}</td><td className="p-2">{item.share}%</td></tr>)}</tbody></table></Details>
  </>;
}

export function ScoreTrend({ insights }: { insights: FeedbackReportInsights }) {
  const gradient = `feedback-trend-${useId().replace(/:/g, '')}`;
  const scored = insights.trend.filter(item => item.score != null);
  const data = insights.trend.map(item => ({ ...item, timestamp: Date.parse(`${item.month}-01T00:00:00Z`), label: monthLabel(item.month) }));
  const only = scored.length === 1 ? scored[0] : null;
  return <>
    {!scored.length ? <EmptyChart text="No dated scored answers in this selection." /> : only ?
      <div className="flex min-h-56 flex-wrap items-center justify-center gap-4 rounded-xl bg-violet-50/50 px-3 py-4 sm:flex-nowrap sm:justify-start">
        <div role="group" aria-label="Single month feedback score" className="relative h-40 w-40 shrink-0">
          <Plot label="Monthly score ring" height={160}>
            <RadialBarChart data={[only]} innerRadius="78%" outerRadius="100%" barSize={12} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="score" fill="#7c3aed" background={{ fill: '#ede9fe' }} cornerRadius={8} isAnimationActive={false} />
            </RadialBarChart>
          </Plot>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-3xl tracking-tight text-primary-900">{scoreLabel(only.score)}</strong><span className="mt-1 text-[11px] text-slate-500">Weighted score</span></div>
        </div>
        <div className="max-w-56 text-center sm:text-left"><p className="text-base font-bold text-slate-900">{monthLabel(only.month)}</p><p className="mt-1 text-xs text-slate-600">{only.scoredAnswers} scored answers</p><p className="mt-3 text-xs leading-5 text-slate-500">One month available. A trend appears when more months have scored answers.</p></div>
      </div> :
      <Plot label="Monthly feedback scores" height={224}>
          <AreaChart data={data} margin={{ top: 14, right: 18, left: -10, bottom: 0 }} accessibilityLayer>
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.22} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.01} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="timestamp" domain={['dataMin', 'dataMax']} ticks={data.length <= 6 ? data.map(item => item.timestamp) : undefined} scale="time" axisLine={false} tickLine={false} tick={tick} minTickGap={36} tickMargin={10} tickFormatter={value => new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(value))} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => `${value}%`} axisLine={false} tickLine={false} tick={tick} width={48} />
            <Tooltip content={<InsightTooltip />} cursor={{ stroke: '#c4b5fd', strokeDasharray: '4 4' }} isAnimationActive={false} />
            <Area dataKey="score" name="Weighted score" type="linear" stroke="#7c3aed" strokeWidth={3} fill={`url(#${gradient})`} dot={{ r: 4, fill: '#fff', stroke: '#7c3aed', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 3 }} connectNulls={false} isAnimationActive={false} />
          </AreaChart>
      </Plot>}
    {scored.length > 0 && <Details label="Monthly scores and answer counts"><table className="w-full text-left"><thead className="text-slate-500"><tr><th className="p-2">Month</th><th className="p-2">Score</th><th className="p-2">Scored answers</th></tr></thead><tbody>{insights.trend.map(item => <tr key={item.month} className="border-t border-slate-100"><td className="p-2">{monthLabel(item.month)}</td><td className="p-2">{scoreLabel(item.score)}</td><td className="p-2">{item.scoredAnswers}</td></tr>)}</tbody></table></Details>}
    {insights.undatedScoredAnswers > 0 && <p className="mt-3 text-xs text-amber-800">{insights.undatedScoredAnswers} scored answers have no submission date and are excluded from this chart.</p>}
  </>;
}

export function CategoryScores({ categories }: { categories: FeedbackReportInsights['categories'] }) {
  const scored = categories.filter(item => item.score != null).map((item, index) => ({ ...item, key: index, label: item.category, context: `${item.formTitle} · v${item.version}` }));
  return <>
    {scored.length ? <div className={styles.categoryViewport}><Plot label="Scored categories chart" height={Math.max(168, scored.length * 48)}>
        <BarChart data={scored} layout="vertical" margin={{ top: 6, right: 40, left: 0, bottom: 6 }} barSize={14} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="#edf0f5" strokeDasharray="3 3" />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={value => `${value}%`} tick={tick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="key" width={100} axisLine={false} tickLine={false} tick={tick} tickFormatter={value => { const label = scored[Number(value)]?.label || ''; return label.length > 15 ? `${label.slice(0, 14)}…` : label; }} />
          <Tooltip content={<InsightTooltip />} cursor={{ fill: '#f8fafc' }} isAnimationActive={false} />
          <Bar dataKey="score" name="Weighted score" fill={chartColor} radius={[0, 5, 5, 0]} isAnimationActive={false}>
            <LabelList dataKey="score" position="right" fill="#475569" fontSize={12} formatter={value => `${Math.round(Number(value))}%`} />
          </Bar>
        </BarChart>
    </Plot></div> : <EmptyChart text={categories.length ? 'No scored category answers yet.' : 'No categories in this selection.'} />}
    {categories.length > 0 && <Details label={`All categories and versions (${categories.length})`}><table className="w-full min-w-[360px] text-left"><thead className="text-slate-500"><tr><th className="p-2">Category / form</th><th className="p-2">Score</th><th className="p-2">Answers</th></tr></thead><tbody>{categories.map(item => <tr key={`${item.formId}:${item.version}:${item.category}`} className="border-t border-slate-100"><td className="p-2"><p className="font-semibold">{item.category}</p><p className="mt-1 text-[11px] text-slate-500">{item.formTitle} · v{item.version} · {item.scoredAnswers} scored answers</p></td><td className="p-2 whitespace-nowrap">{scoreLabel(item.score)}</td><td className="p-2">{item.scoredAnswers}</td></tr>)}</tbody></table></Details>}
  </>;
}

function EmptyChart({ text }: { text: string }) {
  return <div className="flex min-h-40 items-center justify-center rounded-xl bg-slate-50 px-5 text-center text-xs leading-5 text-slate-500">{text}</div>;
}
