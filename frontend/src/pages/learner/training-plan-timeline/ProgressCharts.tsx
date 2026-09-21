import { useId, useState, type CSSProperties } from 'react';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { percent, type TimelineModule } from './model';
import { moduleProgress } from './progress';
import { monthlyHours, type MonthlyHours } from './monthlyHours';
import styles from './ProgressCharts.module.css';

type Props = {
  modules: TimelineModule[];
  selected?: TimelineModule;
  data: TrainingPlanDashboard;
  onModuleSelect: (module: TimelineModule) => void;
  programmeStartMonth?: string;
  programmeEndMonth?: string;
  programmeSnapshot?: ProgrammeProgressSnapshot;
};
export type ProgrammeProgressSnapshot = {
  overall: number | null;
  otjhActual: number | null;
  otjhTarget: number | null;
  ksb: number | null;
  attendancePresent: number | null;
  attendanceTotal: number | null;
};
const colors = ['#6c50a5', '#315c85', '#398171', '#a97824', '#9b5981', '#5e6f91'];
const percentage = (value: number | null) => value == null ? 'N/A' : `${value}%`;
const hourNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });


function ratio(value: number | null, target: number | null) {
  return value == null || target == null || target <= 0 ? null : Math.round(value / target * 100);
}

function reportingMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }).slice(0, 7);
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${hourNumber.format(value)}`;
}

function scaleFor(rows: MonthlyHours[]) {
  const maximum = Math.max(0, ...rows.flatMap(row => [row.target || 0, row.submitted || 0, row.completed || 0]));
  if (!maximum) return { maximum: 10, step: 2.5 };
  const rough = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = nice * magnitude;
  return { maximum: step * 4, step };
}

function MonthTooltip({ row, id }: { row: MonthlyHours; id: string }) {
  const targetRatio = row.target == null ? null : 100;
  const submittedRatio = ratio(row.submitted, row.target);
  const completedRatio = ratio(row.completed, row.target);
  const variance = row.target == null || row.completed == null ? null : row.completed - row.target;
  return <div id={id} role="tooltip" className={styles.monthlyTooltip}>
    <strong>{row.label}</strong>
    <dl>
      <div><dt><i className={styles.targetKey} />Target:</dt><dd>{targetRatio == null ? 'N/A' : `${targetRatio}% (${hourNumber.format(row.target!)} hours)`}</dd></div>
      <div><dt><i className={styles.submittedKey} />Submitted:</dt><dd>{submittedRatio == null ? 'N/A' : `${submittedRatio}% (${hourNumber.format(row.submitted!)} hours)`}</dd></div>
      <div><dt><i className={styles.completedKey} />Completed:</dt><dd>{completedRatio == null ? 'N/A' : `${completedRatio}% (${hourNumber.format(row.completed!)} hours)`}</dd></div>
      <div><dt>Total completed or pending:</dt><dd>{row.submitted == null || row.completed == null ? 'N/A' : `${hourNumber.format(row.submitted + row.completed)} hours`}</dd></div>
      <div className={styles.variance}><dt>Variance:</dt><dd>{variance == null || completedRatio == null ? 'N/A' : `${completedRatio - 100 > 0 ? '+' : ''}${completedRatio - 100}% (${signed(variance)} hours)`}</dd></div>
    </dl>
  </div>;
}

export function ProgressCharts({ modules, selected, data, onModuleSelect, programmeStartMonth, programmeEndMonth, programmeSnapshot }: Props) {
  const chartId = useId();
  const tooltipId = `${chartId}-monthly-tooltip`;
  const [activeMonth, setActiveMonth] = useState('');
  const selectedProgress = selected ? moduleProgress(selected, data) : null;
  const rows = [...modules].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.title.localeCompare(b.title));
  const months = monthlyHours(data, programmeStartMonth, programmeEndMonth);
  const active = months.find(row => row.key === activeMonth);
  const activeIndex = Math.max(0, months.findIndex(row => row.key === activeMonth));
  const scale = scaleFor(months);
  const ticks = Array.from({ length: 5 }, (_, index) => scale.step * (4 - index));
  const moduleTargets = modules.map(module => module.detail?.total_otjh)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  // The chart is programme-wide: when module OTJH is authored, its overall
  // target must include every such module (and ignore modules with no target).
  const totalTarget = moduleTargets.length ? moduleTargets.reduce((sum, value) => sum + value, 0)
    : data.requiredOtjh ?? (months.every(row => row.target != null) ? months.reduce((sum, row) => sum + row.target!, 0) : null);
  const totalSubmitted = months.every(row => row.submitted != null) ? months.reduce((sum, row) => sum + row.submitted!, 0) : null;
  const totalCompleted = months.every(row => row.completed != null) ? months.reduce((sum, row) => sum + row.completed!, 0) : null;
  const targetToDate = months.filter(row => row.key <= reportingMonth());
  const expectedTarget = targetToDate.length && targetToDate.every(row => row.target != null)
    ? targetToDate.reduce((sum, row) => sum + row.target!, 0) : null;
  const overallPercent = ratio(totalCompleted, totalTarget);
  const expectedPercent = ratio(expectedTarget, totalTarget);
  const overallVariance = expectedTarget == null || totalCompleted == null ? null : totalCompleted - expectedTarget;
  const variancePercent = ratio(overallVariance, totalTarget);
  const programmeReviews = [...new Map(data.reviews.filter(review => review.source !== 'student-support' && review.status !== 'cancelled')
    .map(review => [review.eventKey, review])).values()];
  const activityDone = modules.reduce((sum, module) => sum + module.done, 0);
  const activityTotal = modules.reduce((sum, module) => sum + module.activityCount, 0);
  const wholeProgrammeProgress = programmeSnapshot ? {
    value: programmeSnapshot.overall,
    available: 6,
    measures: [
      { label: 'Overall', value: programmeSnapshot.overall, detail: percentage(programmeSnapshot.overall) },
      { label: 'Attendance', value: programmeSnapshot.attendancePresent == null || programmeSnapshot.attendanceTotal == null
        ? null : percent(programmeSnapshot.attendancePresent, programmeSnapshot.attendanceTotal),
        detail: programmeSnapshot.attendancePresent == null || programmeSnapshot.attendanceTotal == null
          ? 'Attendance unavailable' : `${programmeSnapshot.attendancePresent} / ${programmeSnapshot.attendanceTotal} sessions attended` },
      { label: 'Activities', value: activityTotal ? percent(activityDone, activityTotal) : null,
        detail: activityTotal ? `${activityDone} / ${activityTotal} completed across all modules` : 'No activities assigned' },
      { label: 'Hours', value: programmeSnapshot.otjhActual == null || programmeSnapshot.otjhTarget == null
        ? null : percent(programmeSnapshot.otjhActual, programmeSnapshot.otjhTarget),
        detail: programmeSnapshot.otjhActual == null || programmeSnapshot.otjhTarget == null
          ? 'Recorded hours unavailable' : `${hourNumber.format(programmeSnapshot.otjhActual)} / ${hourNumber.format(programmeSnapshot.otjhTarget)} hours` },
      { label: 'KSBs', value: programmeSnapshot.ksb, detail: percentage(programmeSnapshot.ksb) },
      { label: 'Reviews', value: programmeReviews.length
        ? percent(programmeReviews.filter(review => review.status === 'completed').length, programmeReviews.length) : null,
        detail: programmeReviews.length
          ? `${programmeReviews.filter(review => review.status === 'completed').length} / ${programmeReviews.length} completed across the programme`
          : 'No programme reviews' },
    ],
  } : null;
  const chartProgress = wholeProgrammeProgress || selectedProgress;
  const chartWidth = chartProgress?.measures.length === 6 ? 470 : 400;
  return <div className={styles.charts}>
    <section className={styles.card} aria-label={programmeSnapshot ? 'Whole programme progress' : 'Module progress'}>
      <header><div><p className={styles.eyebrow}>{programmeSnapshot ? 'Whole programme' : 'Selected module'}</p><h2>{programmeSnapshot ? 'Whole programme progress' : 'Module progress'}</h2><p className={styles.subtitle}>{programmeSnapshot ? 'Summary metrics for this learner across every module' : selected?.title || 'Choose a module in the timeline'}</p></div>
        {chartProgress && <strong className={styles.total}>{percentage(chartProgress.value)}<small>{programmeSnapshot ? 'Overall' : 'Average'}</small></strong>}
      </header>
      {chartProgress ? <>
        <svg className={styles.chart} viewBox={`0 0 ${chartWidth} 235`} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
          <title id={`${chartId}-title`}>{programmeSnapshot ? 'Whole programme' : selected?.title} progress by measure</title>
          <desc id={`${chartId}-description`}>{chartProgress.measures.map(measure => `${measure.label}: ${percentage(measure.value)}, ${measure.detail}`).join('. ')}</desc>
          {[0, 25, 50, 75, 100].map(value => <g key={value}><line x1="34" x2={chartWidth - 7} y1={185 - value * 1.5} y2={185 - value * 1.5} className={styles.gridLine} /><text x="27" y={189 - value * 1.5} textAnchor="end" className={styles.axis}>{value}</text></g>)}
          {chartProgress.measures.map((measure, index) => {
            const x = 46 + index * 71;
            return <g key={measure.label}>
              <rect x={x} y="35" width="36" height="150" rx="5" className={styles.track} />
              {measure.value != null && measure.value > 0 && <rect x={x} y={185 - measure.value * 1.5} width="36" height={measure.value * 1.5} rx="5" fill={colors[index]} />}
              <text x={x + 18} y="23" textAnchor="middle" className={styles.barValue}>{percentage(measure.value)}</text>
              <text x={x + 18} y="207" textAnchor="middle" className={styles.axis}>{measure.label}</text>
            </g>;
          })}
        </svg>
        <dl className={styles.measures}>{chartProgress.measures.map((measure, index) => <div key={measure.label}>
          <dt><i style={{ background: colors[index] }} />{measure.label}</dt><dd>{measure.detail}</dd>
        </div>)}</dl>
        <p className={styles.note}>{programmeSnapshot
          ? 'Overall, OTJH, KSB and attendance match the case-file cards. Activities and reviews are aggregated across all learner modules.'
          : `Equal average of ${chartProgress.available} of 5 available measures. Each measure is capped at 100%.`}</p>
      </> : <p className={styles.empty}>Select a module to see attendance, activities, hours, KSBs and reviews.</p>}
    </section>
    <section className={styles.card} aria-label="Programme module progress">
      <header><div><p className={styles.eyebrow}>Whole programme</p><h2>Programme progress</h2><p className={styles.subtitle}>Compare progress across your modules</p></div><span className={styles.moduleCount}>{modules.length} modules</span></header>
      <div className={styles.programmeAxis} aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
      <div className={styles.programmeRows}>{rows.length ? rows.map(module => {
        const progress = moduleProgress(module, data);
        return <button type="button" key={module.id} className={styles.module} aria-pressed={selected?.id === module.id}
          onClick={() => onModuleSelect(module)} aria-label={`${module.title}: ${percentage(progress.value)} overall progress`}>
          <span className={styles.rowHeading}><strong>{module.title}</strong><b>{percentage(progress.value)}</b></span>
          <span className={styles.moduleTrack}><span style={{ width: `${progress.value || 0}%` }} /></span>
          <span className={styles.coverage}>{progress.available} of 5 measures available</span>
        </button>;
      }) : <p className={styles.empty}>Your modules will appear here once assigned.</p>}</div>
      <p className={styles.note}>Attendance, activities, hours, KSBs and reviews carry equal weight. Select a module to explore its details.</p>
    </section>
    <section className={`${styles.card} ${styles.monthlyCard}`} aria-label="Off-the-job hours by month">
      <header><div><p className={styles.eyebrow}>Whole programme</p><h2>Off-The-Job Hours</h2><p className={styles.subtitle}>Target, submitted and completed hours for every month</p></div></header>
      <div className={styles.monthlyLegend} aria-label="Chart legend">
        <span><i className={styles.targetKey} />Target</span>
        <span><i className={styles.submittedKey} />Submitted</span>
        <span><i className={styles.completedKey} />Completed</span>
      </div>
      {active && <div className={styles.tooltipPosition} style={{ '--tooltip-left': `${(activeIndex + .5) / months.length * 100}%` } as CSSProperties}>
        <MonthTooltip row={active} id={tooltipId} />
      </div>}
      {months.length ? <div className={styles.monthlyScroll} role="region" tabIndex={0}
        aria-label="Monthly off-the-job hours chart. Scroll horizontally to view more months.">
        <div className={styles.monthlyPlot} style={{ minWidth: `${Math.max(36, months.length * 4.25)}rem` }}>
          <div className={styles.yAxis} aria-hidden="true">{ticks.map(value => <span key={value} style={{ bottom: `${value / scale.maximum * 100}%` }}>{hourNumber.format(value)}</span>)}</div>
          <div className={styles.grid} aria-hidden="true">{ticks.map(value => <i key={value} style={{ bottom: `${value / scale.maximum * 100}%` }} />)}</div>
          <div className={styles.monthBars} style={{ '--month-count': months.length } as CSSProperties}>{months.map(row => {
            const targetHeight = row.target == null ? null : row.target / scale.maximum * 100;
            const submittedHeight = row.submitted == null ? 0 : row.submitted / scale.maximum * 100;
            const completedHeight = row.completed == null ? 0 : row.completed / scale.maximum * 100;
            return <button key={row.key} type="button" className={styles.monthColumn}
              aria-label={`${row.label}: target ${row.target == null ? 'unavailable' : `${hourNumber.format(row.target)} hours`}, submitted ${row.submitted == null ? 'unavailable' : `${hourNumber.format(row.submitted)} hours`}, completed ${row.completed == null ? 'unavailable' : `${hourNumber.format(row.completed)} hours`}`}
              aria-describedby={activeMonth === row.key ? tooltipId : undefined}
              onMouseEnter={() => setActiveMonth(row.key)} onMouseLeave={() => setActiveMonth(current => current === row.key ? '' : current)}
              onFocus={() => setActiveMonth(row.key)} onBlur={() => setActiveMonth(current => current === row.key ? '' : current)}>
              <span className={styles.barArea}>
                <i className={styles.submittedBar} style={{ bottom: `${completedHeight}%`, height: `${submittedHeight}%` }} />
                <i className={styles.completedBar} style={{ height: `${completedHeight}%` }} />
                {targetHeight != null && <i className={styles.targetLine} style={{ bottom: `${targetHeight}%` }} />}
              </span>
              <span className={styles.monthLabel}>{new Date(`${row.key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}<small>{row.key.slice(0, 4)}</small></span>
            </button>;
          })}</div>
        </div>
      </div> : <p className={styles.empty}>Monthly hour targets will appear here once the training plan is available.</p>}
      {months.length > 0 && <div className={styles.overall}>
        <div><strong>Overall progress</strong><span>{totalCompleted == null ? 'Recorded hours unavailable' : `${hourNumber.format(totalCompleted)}h completed${totalSubmitted != null && totalSubmitted > 0 ? ` · ${hourNumber.format(totalSubmitted)}h submitted` : ''}`}</span></div>
        <div className={styles.overallTrack} role="progressbar" aria-label="Overall off-the-job hours progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallPercent == null ? undefined : Math.min(100, overallPercent)}>
          {totalSubmitted != null && totalTarget != null && <i className={styles.submittedOverall} style={{ left: `${Math.min(100, overallPercent || 0)}%`, width: `${Math.min(100, ratio(totalSubmitted, totalTarget) || 0)}%` }} />}
          <i className={styles.completedOverall} style={{ width: `${Math.min(100, overallPercent || 0)}%` }} />
          {expectedPercent != null && <b style={{ left: `${Math.min(100, expectedPercent)}%` }} />}
        </div>
        <strong className={overallVariance != null && overallVariance < 0 ? styles.behind : styles.ahead}>
          {variancePercent == null || overallVariance == null ? 'N/A' : `${variancePercent > 0 ? '+' : ''}${variancePercent}% (${signed(overallVariance)}h)`}
        </strong>
      </div>}
    </section>
  </div>;
}
