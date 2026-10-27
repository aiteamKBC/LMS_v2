import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, CalendarDays, ChevronRight, ClipboardList, GraduationCap, Info, Lightbulb, SlidersHorizontal, ThumbsUp, TrendingUp, TriangleAlert, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
import { feedbackApi, type FeedbackDashboardFilters, type FeedbackDashboardReport, type FeedbackFormType, type FeedbackScoreClass } from '@/api/feedback';
import { Plot } from './FeedbackInsightCharts';
import { dashboardPeriod, FEEDBACK_TYPE_LABELS, negativeCategories, rankedQuestions, ukCalendarDate, weeklyClassifications } from './feedbackDashboardData';
import styles from './FeedbackDashboard.module.css';
import { NEUTRAL_SCORE_MIN, POSITIVE_SCORE_MIN, SCORE_CLASSIFICATION_TEXT } from './scoreClassification';

const kinds = [
  { key: 'positive', label: 'Positive', color: '#179b59' },
  { key: 'negative', label: 'Negative', color: '#fb4c79' },
  { key: 'neutral', label: 'Neutral', color: '#ecad3d' },
  { key: 'unscored', label: 'Unscored', color: '#a8a3bb' },
] as const;
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(value));
const weekLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const tick = { fill: '#8f86a4', fontSize: 10 };

function Panel({ title, subtitle, icon, right, children, className = '' }: { title: string; subtitle?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return <section aria-label={title} className={`${styles.card} ${className}`}><header className={styles.cardHeader}><div><div className={styles.title}>{icon}<h3>{title}</h3></div>{subtitle && <p className={styles.subtitle}>{subtitle}</p>}</div>{right}</header>{children}</section>;
}

function ChartLegend({ all = false }: { all?: boolean }) {
  return <ul className={styles.legend}>{kinds.slice(0, all ? 4 : 2).map(item => <li key={item.key}><i aria-hidden="true" style={{ background: item.color }} />{item.label}</li>)}</ul>;
}

function QuestionRanking({ report, kind }: { report: FeedbackDashboardReport; kind: 'positive' | 'negative' }) {
  const rows = rankedQuestions(report.questionMetrics, kind);
  return <Panel title={kind === 'positive' ? 'Top Positive Questions' : 'Top Negative Questions'} subtitle="Share of scored answers · each form version kept separate" icon={kind === 'positive' ? <ThumbsUp size={22} /> : <TriangleAlert size={22} />} className={kind === 'negative' ? styles.negative : ''}>
    {rows.length ? <ol className={styles.rankList}>{rows.map(({ question, rate, count, total }) => <li key={question.questionId}><div className={styles.rankTop}><span>{question.question}</span><strong>{Math.round(rate)}%</strong></div><p className={styles.rankMeta}>{question.formTitle} · v{question.version} · {question.category} · {count}/{total} scored answers</p><div className={styles.track}><div style={{ width: `${rate}%` }} /></div></li>)}</ol> : <p className={styles.empty}>No {kind} scored answers in this selection.</p>}
  </Panel>;
}

function ReviewList({ report, onViewResponse }: { report: FeedbackDashboardReport; onViewResponse: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const negatives = report.insights!.classification!.responses.filter(item => item.classification === 'negative');
  const pages = Math.max(1, Math.ceil(negatives.length / 5));
  const current = Math.min(page, pages);
  const visible = expanded ? negatives.slice((current - 1) * 5, current * 5) : negatives.slice(0, 3);
  return <Panel title="Action Needed — Feedback to Review" subtitle={`Negative scores below ${NEUTRAL_SCORE_MIN}% · review the original answers`} icon={<TriangleAlert size={25} />} className={styles.action} right={<button type="button" className={styles.link} disabled={!negatives.length} onClick={() => { setExpanded(value => !value); setPage(1); }}>{expanded ? 'Show latest' : `View all ${negatives.length}`} →</button>}>
    {visible.length ? <div className={styles.reviewRows}>{visible.map(item => <article key={item.responseId} className={styles.reviewRow}><span className={styles.negativePill}><TriangleAlert size={12} />Needs review</span><div><strong>{item.contextTitle || item.formTitle}</strong><small>{item.formTitle} · v{item.version}{item.groupName ? ` · ${item.groupName}` : ''}</small><small>{item.scoredQuestions} scored questions · {item.respondent}</small></div><time dateTime={item.submittedAt || undefined}>{item.submittedAt ? dateLabel(item.submittedAt) : 'Date unavailable'}</time><span className={styles.score}>{item.score == null ? '—' : `${Math.round(item.score)}%`}</span><button type="button" className={styles.reviewButton} aria-label={`Review response ${item.responseId}`} onClick={() => onViewResponse(item.responseId)}>Review<ChevronRight size={12} /></button></article>)}</div> : <div className={styles.empty}>No negative responses in this selection.</div>}
    {expanded && pages > 1 && <div className={styles.pager}><button type="button" className={styles.link} disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>{current} / {pages}</span><button type="button" className={styles.link} disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></div>}
  </Panel>;
}

function DashboardContent({ report, onViewResponse }: { report: FeedbackDashboardReport; onViewResponse: (id: number) => void }) {
  const counts = report.insights!.classification!;
  const scored = counts.positive + counts.neutral + counts.negative;
  const pie = kinds.map(item => ({ ...item, value: counts[item.key] }));
  const comparison = counts.byType.map(item => ({ ...item, label: FEEDBACK_TYPE_LABELS[item.formType] || item.formType }));
  const trend = weeklyClassifications(counts);
  const best = [...report.insights!.categories].filter(item => item.score != null).sort((a, b) => b.score! - a.score! || b.scoredAnswers - a.scoredAnswers)[0];
  const concern = negativeCategories(report.questionMetrics)[0];
  const most = [...counts.byType].map(item => ({ ...item, total: item.positive + item.negative + item.neutral + item.unscored })).sort((a, b) => b.total - a.total)[0];
  const kpis = [
    { label: 'Submitted feedback', value: counts.total, icon: <ClipboardList size={23} />, note: 'Completed responses in selection', tone: '' },
    { label: 'Positive responses', value: counts.positive, icon: <ThumbsUp size={23} />, note: scored ? `${Math.round(counts.positive / scored * 100)}% of scored responses` : 'No scored responses', tone: styles.green },
    { label: 'Negative responses', value: counts.negative, icon: <TriangleAlert size={23} />, note: `Scores below ${NEUTRAL_SCORE_MIN}% · needs review`, tone: styles.red },
    { label: 'Neutral responses', value: counts.neutral, icon: <SlidersHorizontal size={23} />, note: `Scores from ${NEUTRAL_SCORE_MIN}% to below ${POSITIVE_SCORE_MIN}%`, tone: styles.amber },
    { label: 'Response rate', value: report.coverage.rate == null ? '—' : `${report.coverage.rate}%`, icon: <Users size={23} />, note: `All-time · ${report.coverage.submitted} / ${report.coverage.assigned ?? 'unknown'} assigned`, tone: '' },
  ];
  return <>
    <div className={styles.kpis}>{kpis.map(item => <section aria-label={item.label} key={item.label} className={styles.kpi}><span className={`${styles.kpiIcon} ${item.tone}`}>{item.icon}</span><div><h3>{item.label}</h3><strong>{item.value}</strong><p>{item.note}</p></div></section>)}</div>
    <div className={styles.mainGrid}>
      <ReviewList report={report} onViewResponse={onViewResponse} />
      <Panel title="Feedback Response Split" right={<span className={styles.badge}>Selected feedback</span>}>
        {counts.total ? <div className={styles.split}><div className={styles.donut}><Plot label="Insights response split" height={206}><PieChart><Pie data={pie} dataKey="value" nameKey="label" innerRadius={61} outerRadius={83} paddingAngle={1} isAnimationActive={false}>{pie.map(item => <Cell key={item.key} fill={item.color} />)}</Pie><Tooltip isAnimationActive={false} /></PieChart></Plot><div className={styles.donutCenter}><strong>{counts.total}</strong><span>Submitted feedback</span></div></div><ul className={`${styles.legend} ${styles.splitLegend}`}>{pie.map(item => <li key={item.key}><i aria-hidden="true" style={{ background: item.color }} /><div><span>{item.label} responses</span><strong>{item.value} ({Math.round(item.value / counts.total * 100)}%)</strong></div></li>)}</ul></div> : <p className={styles.empty}>No submitted feedback in this selection.</p>}
      </Panel>
    </div>
    <div className={styles.charts}>
      <Panel title="Positive vs Negative by Feedback Type" subtitle="Completed responses within the current filters" icon={<BarChart3 size={21} />}>
        <div className={styles.chartLegend}><ChartLegend /></div>
        {comparison.length ? <div className={styles.chartViewport}><div style={{ minWidth: comparison.length * 95 }}><Plot label="Insights feedback type comparison" height={235}><BarChart data={comparison} margin={{ top: 12, right: 8, left: -20, bottom: 20 }} barSize={22} accessibilityLayer><CartesianGrid vertical={false} stroke="#eeeaf5" /><XAxis dataKey="label" tick={{ ...tick, fontSize: 9 }} interval={0} axisLine={false} tickLine={false} tickFormatter={value => String(value).replace(' Feedback', '').replace('Live Sessions', 'Live sessions')} /><YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} /><Tooltip isAnimationActive={false} /><Bar name="Positive" dataKey="positive" fill="#179b59" radius={[3, 3, 0, 0]} isAnimationActive={false} /><Bar name="Negative" dataKey="negative" fill="#fb4c79" radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart></Plot></div></div> : <p className={styles.empty}>No feedback type data in this selection.</p>}
        <details className={styles.details}><summary>View counts by feedback type</summary><div className={styles.tableWrap}><table><thead><tr><th>Feedback type</th>{kinds.map(item => <th key={item.key}>{item.label}</th>)}</tr></thead><tbody>{comparison.map(item => <tr key={item.formType}><td>{item.label}</td>{kinds.map(kind => <td key={kind.key}>{item[kind.key]}</td>)}</tr>)}</tbody></table></div></details>
      </Panel>
      <Panel title="Feedback Response Trend" subtitle="Weekly response counts · week starting Monday · UK time" icon={<TrendingUp size={21} />}>
        <div className={styles.chartLegend}><ChartLegend /></div>
        {trend.length ? <Plot label="Insights weekly response trend" height={235}><LineChart data={trend} margin={{ top: 12, right: 12, left: -20, bottom: 20 }} accessibilityLayer><CartesianGrid vertical={false} stroke="#eeeaf5" /><XAxis dataKey="week" tickFormatter={weekLabel} tick={tick} minTickGap={25} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} /><Tooltip labelFormatter={value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `Week of ${weekLabel(value)}` : ''} isAnimationActive={false} /><Line name="Positive" dataKey="positive" stroke="#179b59" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /><Line name="Negative" dataKey="negative" stroke="#fb4c79" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /></LineChart></Plot> : <p className={styles.empty}>No dated responses in this selection.</p>}
        <details className={styles.details}><summary>View weekly response counts</summary><div className={styles.tableWrap}><table><thead><tr><th>Week starting</th><th>Positive</th><th>Negative</th></tr></thead><tbody>{trend.map(item => <tr key={item.week}><td>{dateLabel(`${item.week}T12:00:00Z`)}</td><td>{item.positive}</td><td>{item.negative}</td></tr>)}</tbody></table></div></details>
      </Panel>
    </div>
    <div className={styles.bottom}>
      <QuestionRanking report={report} kind="positive" />
      <QuestionRanking report={report} kind="negative" />
      <Panel title="Key Insights" subtitle="Calculated from scored answers in this selection" icon={<Lightbulb size={22} />}>
        <div className={styles.keyGrid}><article className={styles.key}><GraduationCap size={24} />Highest-scoring category<strong>{best?.category || 'No scored category'}</strong>{best && <><b>{Math.round(best.score!)}%</b><small>{best.formTitle} · v{best.version}<br />{best.scoredAnswers} scored answers</small></>}</article><article className={`${styles.key} ${styles.keyNegative}`}><TriangleAlert size={24} />Highest negative answer share<strong>{concern?.label || 'No negative answers'}</strong>{concern && <><b>{Math.round(concern.rate)}%</b><small>{concern.form} · v{concern.version}<br />{concern.negative}/{concern.total} scored answers</small></>}</article><article className={`${styles.key} ${styles.keyPurple}`}><Users size={24} />Most submitted feedback<strong>{most ? FEEDBACK_TYPE_LABELS[most.formType] : 'No responses'}</strong>{most && <><b>{most.total} responses</b><small>Within the selected filters</small></>}</article></div>
      </Panel>
    </div>
    <p className={styles.note}>Classification uses question scores and importance weights: {SCORE_CLASSIFICATION_TEXT} {counts.unscored} responses have no included scored answers and remain Unscored. Text is not analysed by AI. Response rate covers all-time assignments for the selected type, group and module; date and classification filters affect the other panels only. Neutral and Unscored are shown in the split and excluded from the two-series comparison and trend.</p>
  </>;
}

export function FeedbackDashboard({ onViewResponse }: { onViewResponse: (id: number) => void }) {
  const [formType, setFormType] = useState<FeedbackFormType | 'all'>('post_lecture');
  const [weeks, setWeeks] = useState(8);
  const [classification, setClassification] = useState<FeedbackScoreClass | 'all'>('all');
  const [group, setGroup] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [today] = useState(() => ukCalendarDate(new Date()));
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; report?: FeedbackDashboardReport; error?: string } | null>(null);
  const filters: FeedbackDashboardFilters = { ...(formType !== 'all' ? { formType } : {}), ...(group ? { groupId: group } : {}), ...(moduleId ? { moduleId } : {}), ...(classification !== 'all' ? { classification } : {}), ...dashboardPeriod(today, weeks) };
  const key = JSON.stringify([filters, retry]);
  const report = result?.key === key ? result.report : undefined;
  const error = result?.key === key ? result.error : undefined;
  const groups = result?.report?.groups || [];
  const modules = result?.report?.modules || [];
  const label = formType === 'all' ? 'All Feedback Types' : FEEDBACK_TYPE_LABELS[formType];
  useEffect(() => {
    let active = true;
    const [request] = JSON.parse(key) as [FeedbackDashboardFilters, number];
    feedbackApi.insightsDashboard(request).then(({ analytics }) => {
      if (!analytics.insights?.classification) throw new Error('Score classifications are not available in this report.');
      if (active) setResult({ key, report: analytics });
    }).catch(error => {
      if (active) setResult({ key, error: error instanceof Error ? error.message : 'Could not load feedback insights.' });
    });
    return () => { active = false; };
  }, [key]);
  return <section aria-label="Feedback Insights dashboard" className={styles.root}>
    <header className={styles.hero}><span className={styles.heroIcon}><BarChart3 size={28} /></span><div><h2>Feedback Insights</h2><p>Monitor positive and negative feedback, response trends and questions that need your attention.</p></div></header>
    <div className={styles.filters}><div className={styles.filterFields}>
      <div className={styles.filter}><ClipboardList className={styles.filterIcon} size={34} /><label>Feedback type filter<select aria-label="Insights feedback type" value={formType} onChange={event => { setFormType(event.target.value as typeof formType); setGroup(''); setModuleId(''); }}><option value="all">All Feedback Types</option>{Object.entries(FEEDBACK_TYPE_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></div>
      <div className={styles.filter}><CalendarDays className={styles.filterIcon} size={34} /><label>Date range<select aria-label="Insights date range" value={weeks} onChange={event => setWeeks(Number(event.target.value))}><option value={4}>Last 4 weeks</option><option value={8}>Last 8 weeks</option><option value={12}>Last 12 weeks</option><option value={0}>All time</option></select></label></div>
      <div className={styles.filter}><SlidersHorizontal className={styles.filterIcon} size={34} /><label>Classification<select aria-label="Insights classification" value={classification} onChange={event => setClassification(event.target.value as typeof classification)}><option value="all">All classifications</option>{kinds.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
      <div className={styles.filter}><Users className={styles.filterIcon} size={34} /><label>Learner group<select aria-label="Insights learner group" value={group} disabled={!report} onChange={event => { setGroup(event.target.value); setModuleId(''); }}><option value="">All groups</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <div className={styles.filter}><GraduationCap className={styles.filterIcon} size={34} /><label>Module<select aria-label="Insights module" value={moduleId} disabled={!report || (!modules.length && !moduleId)} onChange={event => setModuleId(event.target.value)}><option value="">All modules</option>{modules.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{moduleId && !modules.some(item => item.id === moduleId) && <option value={moduleId}>Selected module (not in current list)</option>}</select></label></div>
    </div><aside className={styles.scope}><Info size={21} /><div><strong>Showing data for {label}</strong>All panels follow this selection. Group and module use the values saved with the lecture or form.</div></aside></div>
    {error ? <div role="alert" className={styles.error}>{error} <button type="button" className={styles.link} onClick={() => setRetry(value => value + 1)}>Retry insights</button></div> : report ? <DashboardContent report={report} onViewResponse={onViewResponse} /> : <div role="status" className={styles.loading}>Loading feedback insights…</div>}
  </section>;
}
