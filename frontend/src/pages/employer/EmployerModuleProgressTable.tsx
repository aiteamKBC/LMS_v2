import { useId, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Search } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { learnerHref, learnerKey } from './employerDashboardData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import styles from './EmployerModuleProgressTable.module.css';

type Props = {
  employerId: string;
  learners: EmployerLearnerCard[];
  records: EmployerLearningRecords;
  moduleId?: string;
  onRetry: () => void;
};
const percentLabel = (value: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;

/** Rows and columns share the canonical programme percentages used by the module cards. */
export function EmployerModuleProgressTable({ employerId, learners, records, moduleId, onRetry }: Props) {
  const location = useLocation();
  const headingId = useId();
  const helpId = useId();
  const [query, setQuery] = useState('');
  const modules = new Map<string, { id: string; title: string }>();
  const rows = learners.map(learner => {
    const resource = records[learnerKey(learner)];
    const progress = new Map<string, number | null>();
    if (resource?.status === 'ready') {
      for (const module of resource.data?.programme || []) {
        if ((moduleId && module.id !== moduleId) || progress.has(module.id)) continue;
        modules.set(module.id, { id: module.id, title: module.title });
        progress.set(module.id, module.percent != null && Number.isFinite(module.percent)
          ? Math.max(0, Math.min(100, module.percent)) : null);
      }
    }
    return { learner, resource, progress };
  });
  const columns = [...modules.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const search = query.trim().toLocaleLowerCase();
  const visible = rows.filter(({ learner }) => !search || `${learner.name} ${learner.email}`.toLocaleLowerCase().includes(search));
  const loading = rows.some(({ resource }) => !resource || resource.status === 'loading');
  const failed = rows.filter(({ resource }) => resource?.status === 'error').length;

  return <section id="employer-module-progress" className={styles.panel} aria-labelledby={headingId}>
    <header className={styles.header}>
      <div className={styles.identity}><h2 id={headingId}>Learner-by-module progress</h2>
        <div className={styles.counts}><span>{learners.length} learner{learners.length === 1 ? '' : 's'}</span>
          <span aria-hidden="true">·</span><span>{columns.length} module{columns.length === 1 ? '' : 's'}</span></div></div>
      <label className={styles.search} data-search-field><Search size={16} aria-hidden="true" /><span className="sr-only">Filter progress learners</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or email…" /></label>
    </header>
    {failed > 0 && <div className={styles.notice} role="alert"><p>Module progress unavailable for {failed} learner{failed === 1 ? '' : 's'}.</p><button type="button" onClick={onRetry}>Retry progress</button></div>}
    {loading && <p className={styles.status} role="status">Loading learner module progress…</p>}
    {learners.length === 0 ? <p className={styles.empty}>No learners to show. Linked learners appear here when they match the overview filters.</p>
      : visible.length === 0 ? <div className={styles.empty}><p>No learners match your search.</p><button type="button" onClick={() => setQuery('')}>Clear learner search</button></div>
      : <div className={styles.scroll} role="region" aria-label="Learner module progress table" aria-describedby={helpId} tabIndex={0}>
        <table className={styles.table}>
          <caption className="sr-only">Module progress for {visible.length} learners. Percentages use the same progress data as the module cards.</caption>
          <thead><tr><th scope="col">Learner</th>{columns.length ? columns.map(module => <th scope="col" key={module.id} title={module.title}>{module.title}</th>) : <th scope="col">Module progress</th>}</tr></thead>
          <tbody>{visible.map(({ learner, resource, progress }) => {
            const pending = !resource || resource.status === 'loading';
            const unavailable = resource?.status === 'error' || (resource?.status === 'ready' && !resource.data);
            return <tr key={learnerKey(learner)}>
              <th scope="row"><div className={styles.learnerIdentity}><div>
                <Link to={learnerHref(employerId, learner)} state={location.state}>{learner.name}</Link>{' '}<small>{learner.programme || 'Programme not assigned'}</small>
              </div></div></th>
              {pending || unavailable || !columns.length ? <td className={styles.rowStatus} colSpan={Math.max(1, columns.length)}>{pending ? 'Loading…' : unavailable ? 'Unavailable' : 'No assigned modules'}</td>
                : columns.map(module => {
                  const enrolled = progress.has(module.id);
                  const percent = progress.get(module.id);
                  const label = `${learner.name} · ${module.title}`;
                  if (!enrolled) return <td key={module.id} title={`${label}: not enrolled`}><span className={styles.notEnrolled} aria-hidden="true">—</span><span className="sr-only">Not enrolled</span></td>;
                  if (percent == null) return <td key={module.id}><span className={styles.missing} title={`${label}: progress unavailable`}><span aria-hidden="true">N/A</span><span className="sr-only">Progress unavailable</span></span></td>;
                  // Discrete shades keep the text contrast readable across the full scale.
                  const tone = percent === 100 ? 'complete' : percent >= 80 ? 'high' : percent >= 50 ? 'medium' : percent >= 20 ? 'low' : 'start';
                  return <td key={module.id}><Link className={styles.cell} data-tone={tone} to={learnerHref(employerId, learner, 'plan')} state={location.state}
                    aria-label={`${label}: ${percentLabel(percent)}. Open training plan`} title={`${label}: ${percentLabel(percent)}`}>
                    <span className={styles.value}>{percent === 100 && <Check size={14} aria-hidden="true" />}{percentLabel(percent)}</span>
                  </Link></td>;
                })}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    <footer className={styles.footer} id={helpId}>
      <p className="sr-only">Select a percentage to open the learner’s training plan.</p>
      <div className={styles.scale} aria-label="Progress colour scale from 0 to 100 percent"><span>0%</span><span className={styles.swatches} aria-hidden="true"><i title="0–19%" /><i title="20–49%" /><i title="50–79%" /><i title="80–99%" /><i title="100% complete" /></span><span>100%</span></div>
      <p><span>—</span> Not enrolled <span className={styles.footerDivider}>·</span> N/A Progress unavailable</p>
    </footer>
  </section>;
}
