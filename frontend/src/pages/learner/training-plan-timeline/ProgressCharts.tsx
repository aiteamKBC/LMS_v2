import { useId } from 'react';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { TimelineModule } from './model';
import { moduleProgress } from './progress';
import styles from './ProgressCharts.module.css';

type Props = { modules: TimelineModule[]; selected?: TimelineModule; data: TrainingPlanDashboard; onModuleSelect: (module: TimelineModule) => void };
const colors = ['#6c50a5', '#315c85', '#398171', '#a97824', '#9b5981'];
const percentage = (value: number | null) => value == null ? 'N/A' : `${value}%`;

export function ProgressCharts({ modules, selected, data, onModuleSelect }: Props) {
  const chartId = useId();
  const selectedProgress = selected ? moduleProgress(selected, data) : null;
  const rows = [...modules].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.title.localeCompare(b.title));
  return <div className={styles.charts}>
    <section className={styles.card} aria-label="Module progress">
      <header><div><p className={styles.eyebrow}>Selected module</p><h2>Module progress</h2><p className={styles.subtitle}>{selected?.title || 'Choose a module in the timeline'}</p></div>
        {selectedProgress && <strong className={styles.total}>{percentage(selectedProgress.value)}<small>Average</small></strong>}
      </header>
      {selectedProgress ? <>
        <svg className={styles.chart} viewBox="0 0 400 235" role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
          <title id={`${chartId}-title`}>{selected?.title} progress by measure</title>
          <desc id={`${chartId}-description`}>{selectedProgress.measures.map(measure => `${measure.label}: ${percentage(measure.value)}, ${measure.detail}`).join('. ')}</desc>
          {[0, 25, 50, 75, 100].map(value => <g key={value}><line x1="34" x2="393" y1={185 - value * 1.5} y2={185 - value * 1.5} className={styles.gridLine} /><text x="27" y={189 - value * 1.5} textAnchor="end" className={styles.axis}>{value}</text></g>)}
          {selectedProgress.measures.map((measure, index) => {
            const x = 46 + index * 71;
            return <g key={measure.label}>
              <rect x={x} y="35" width="36" height="150" rx="5" className={styles.track} />
              {measure.value != null && measure.value > 0 && <rect x={x} y={185 - measure.value * 1.5} width="36" height={measure.value * 1.5} rx="5" fill={colors[index]} />}
              <text x={x + 18} y="23" textAnchor="middle" className={styles.barValue}>{percentage(measure.value)}</text>
              <text x={x + 18} y="207" textAnchor="middle" className={styles.axis}>{measure.label}</text>
            </g>;
          })}
        </svg>
        <dl className={styles.measures}>{selectedProgress.measures.map((measure, index) => <div key={measure.label}>
          <dt><i style={{ background: colors[index] }} />{measure.label}</dt><dd>{measure.detail}</dd>
        </div>)}</dl>
        <p className={styles.note}>Equal average of {selectedProgress.available} of 5 available measures. Each measure is capped at 100%.</p>
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
  </div>;
}
