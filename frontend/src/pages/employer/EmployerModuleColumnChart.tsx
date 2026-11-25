import { BarChart3 } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { learnerKey } from './employerDashboardData';
import { modulePerformance } from './employerPerformanceData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import styles from './EmployerPerformance.module.css';

type Props = { learners: EmployerLearnerCard[]; records: EmployerLearningRecords; moduleId?: string };
const percent = (value: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value)}%`;
const labels = ['Off-the-job hours', 'KSBs', 'Assignment submission', 'Attendance'];

/** Every assigned module has four columns using the existing learner-average rules. */
export function EmployerModuleColumnChart({ learners, records, moduleId }: Props) {
  const modules = [...new Map(learners.flatMap(learner => records[learnerKey(learner)]?.data?.programme || [])
    .map(module => [module.id, module])).values()].filter(module => !moduleId || module.id === moduleId)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const loading = learners.some(learner => !records[learnerKey(learner)] || records[learnerKey(learner)].status === 'loading');
  const failed = learners.some(learner => records[learnerKey(learner)]?.status === 'error');
  return <section className={styles.chartPanel} aria-labelledby="module-performance-title">
    <header className={styles.chartHeader}><div><h2 id="module-performance-title"><BarChart3 size={21} aria-hidden="true" />Module performance</h2>
      <p>{moduleId ? 'Selected module' : 'All modules'} · Average learner progress</p></div>
      <ul className={styles.columnLegend} aria-label="Performance measures">{labels.map((label, index) => <li key={label} data-series={index}><span />{label}</li>)}</ul>
    </header>
    <p className={styles.chartNote}>Progress against each target (0–100%). N/A means data unavailable. Counts below each bar show learners with data.</p>
    {modules.length > 0 ? <div className={styles.columnCanvas} role="group" aria-label="Module performance column chart">
      <div className={styles.columnAxis} aria-hidden="true">{[0, 25, 50, 75, 100].map(value => <span key={value} style={{ bottom: `${value}%` }}>{value}%</span>)}</div>
      <div className={styles.columnScroll} role="region" aria-label={moduleId ? 'Selected module chart' : 'All modules chart'} tabIndex={0}>
        <div className={styles.columnPlot} style={{ minWidth: `${modules.length * 260}px` }}>
          <div className={styles.columnGuides} aria-hidden="true" />
          <div className={styles.columnGroups} style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }}>
            {modules.map(module => {
              const result = modulePerformance(learners, records, module.id);
              const assigned = learners.filter(learner => records[learnerKey(learner)]?.data?.programme.some(row => row.id === module.id)).length;
              return <section key={module.id} className={styles.columnModule} role="group" aria-label={module.title}>
                <div className={styles.columns}>{result.measures.map((measure, index) => {
                  const missing = measure.value == null;
                  const state = missing ? loading ? 'Loading…' : 'Unavailable' : percent(measure.value!);
                  // Leave short/zero bars at their true height and keep their labels readable.
                  const inside = measure.value != null && measure.value >= 20;
                  return <div className={styles.columnSeries} data-series={index} key={measure.label}>
                    <div className={styles.columnWell} role={missing ? 'img' : 'meter'} aria-label={missing ? `${measure.label}: ${state}` : measure.label}
                      aria-valuemin={missing ? undefined : 0} aria-valuemax={missing ? undefined : 100}
                      aria-valuenow={measure.value ?? undefined} aria-valuetext={missing ? undefined : `${state}; ${measure.available} of ${assigned} learners have data`}>
                      {missing ? <span className={styles.columnMissing} title={state}>{loading ? 'Loading…' : 'N/A'}</span> : <>
                        {!inside && <span className={styles.columnOutsideValue} style={{ bottom: `calc(${measure.value}% + 8px)` }} aria-hidden="true">{state}</span>}
                        <span className={measure.value === 0 ? styles.columnZero : styles.columnBar} style={measure.value === 0 ? undefined : { height: `${measure.value}%` }}>
                          {inside && <span className={styles.columnValue} aria-hidden="true">{state}</span>}
                        </span>
                      </>}
                    </div>
                    <small className={styles.columnCoverage}>{measure.available} of {assigned}</small>
                  </div>;
                })}</div>
                <h3 className={styles.columnModuleTitle}>{module.title}</h3>
              </section>;
            })}
          </div>
        </div>
      </div>
    </div> : <p className={styles.chartNote} role={loading ? 'status' : undefined} aria-label={loading ? 'Loading module chart' : undefined}>
      {loading ? 'Loading modules…' : failed ? 'Module data unavailable. Retry modules above.' : 'No modules to show for the selected learners.'}
    </p>}
  </section>;
}
