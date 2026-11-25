import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Users } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { overviewModulesForDisplay } from '@/pages/workspace/learner/overviewFacts';
import { formatReviewDate, learnerHref, learnerKey } from './employerDashboardData';
import styles from './EmployerPortalPage.module.css';

type Props = { employerId: string; learners: EmployerLearnerCard[]; filtered: EmployerLearnerCard[]; records: EmployerLearningRecords; onRetry: () => void; moduleId?: string };
const percentLabel = (value: number) => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;
const moduleDate = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
};

function ModuleLearners({ employerId, title, learners }: {
  employerId: string;
  title: string;
  learners: { learner: EmployerLearnerCard; percent: number | null }[];
}) {
  const location = useLocation();
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return <div className={styles.moduleLearners}>
    <button type="button" className={styles.moduleLearnersToggle} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <span>View learners ({learners.length})</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    <div id={panelId} className={styles.moduleLearnerPanel} data-open={open} aria-hidden={!open} inert={!open}>
      <div className={styles.moduleLearnerPanelInner}>
        <ul aria-label={`${title} learners`}>{learners.map(({ learner, percent }) => <li key={learnerKey(learner)}>
          <Link to={learnerHref(employerId, learner, 'plan')} state={location.state}>
            <span className={styles.moduleLearnerAvatar} aria-hidden="true">{learner.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
            <span>{learner.name}</span>
          </Link>
          <span className={styles.moduleLearnerProgress}>{percent == null ? 'Unavailable' : percentLabel(percent)}</span>
        </li>)}</ul>
      </div>
    </div>
  </div>;
}

/** Uses the learner's canonical module percentages, including historical modules. */
export function EmployerModuleOverview({ employerId, learners, filtered, records, onRetry, moduleId }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const carouselId = useId();
  const [scroll, setScroll] = useState({ previous: false, next: false, overflowing: false });
  const loading = filtered.some(learner => !records[learnerKey(learner)]);
  const failed = filtered.filter(learner => records[learnerKey(learner)]?.status === 'error').length;
  const modules = new Map<string, { id: string; title: string; start: string; end: string; programmes: Set<string>; learners: { learner: EmployerLearnerCard; percent: number | null }[] }>();
  for (const learner of filtered) {
    const data = records[learnerKey(learner)]?.data;
    const dates = new Map(overviewModulesForDisplay(data?.modules || []).map(module => [module.id, module]));
    const seen = new Set<string>();
    for (const row of data?.programme || []) {
      if ((moduleId && row.id !== moduleId) || seen.has(row.id)) continue;
      seen.add(row.id);
      const group = modules.get(row.id) || { id: row.id, title: row.title, start: '', end: '', programmes: new Set<string>(), learners: [] };
      const start = moduleDate(dates.get(row.id)?.start);
      const end = moduleDate(dates.get(row.id)?.end);
      // Shared cards cover the dates of the currently filtered learners only.
      if (start && (!group.start || start < group.start)) group.start = start;
      if (end && (!group.end || end > group.end)) group.end = end;
      if (learner.programme) group.programmes.add(learner.programme);
      group.learners.push({ learner, percent: row.percent != null && Number.isFinite(row.percent) ? Math.max(0, Math.min(100, row.percent)) : null });
      modules.set(row.id, group);
    }
  }

  const sortedModules = [...modules.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const moduleIds = JSON.stringify(sortedModules.map(module => module.id));
  const measureScroll = () => {
    const element = track.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    const next = { previous: element.scrollLeft > 2, next: element.scrollLeft < max - 2, overflowing: max > 2 };
    setScroll(current => current.previous === next.previous && current.next === next.next && current.overflowing === next.overflowing ? current : next);
  };
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    // Filtering starts at the first matching module; resizing keeps the position.
    element.scrollLeft = 0;
    measureScroll();
    const observer = new ResizeObserver(measureScroll);
    observer.observe(element);
    return () => observer.disconnect();
  }, [moduleIds]);
  const move = (direction: number) => {
    const element = track.current;
    const card = element?.firstElementChild as HTMLElement | null;
    if (!element || !card) return;
    const step = card.getBoundingClientRect().width + parseFloat(getComputedStyle(element).columnGap || '0');
    element.scrollBy({ left: direction * step * Math.max(1, Math.floor(element.clientWidth / step)),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  return <section className={styles.moduleSection} aria-labelledby="employer-modules">
    <header className={styles.moduleSectionHeader}><div><h2 id="employer-modules"><span className={styles.moduleHeadingIcon}><BookOpen size={23} /></span>Modules</h2><p>Learners and their average module progress</p></div><div className={styles.moduleControls}><span className={styles.moduleCount}>{modules.size} module{modules.size === 1 ? '' : 's'}</span>{scroll.overflowing && <div className={styles.moduleArrows} aria-label="Module navigation"><button type="button" aria-label="Previous modules" aria-controls={carouselId} disabled={!scroll.previous} onClick={() => move(-1)}><ChevronLeft size={19} /></button><button type="button" aria-label="Next modules" aria-controls={carouselId} disabled={!scroll.next} onClick={() => move(1)}><ChevronRight size={19} /></button></div>}</div></header>
    {failed > 0 && <div className={styles.dataNotice} role="alert"><CircleAlert size={18} /><p>Module progress could not be loaded for {failed} learner{failed === 1 ? '' : 's'}. Counts and averages include available records only.</p><button type="button" onClick={onRetry}>Retry modules</button></div>}
    {loading && <LoadingSkeleton label="Loading modules" variant="cards" />}
    <div ref={track} id={carouselId} className={styles.moduleGrid} role="region" aria-label="Module cards" aria-roledescription="carousel" tabIndex={scroll.overflowing ? 0 : undefined} onScroll={measureScroll}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); event.currentTarget.scrollTo({ left: event.key === 'Home' ? 0 : event.currentTarget.scrollWidth, behavior: 'instant' }); }
      }}>{sortedModules.map((module, index) => {
      const available = module.learners.flatMap(row => row.percent == null ? [] : [row.percent]);
      const average = available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
      return <article key={module.id} className={styles.moduleCard} aria-label={module.title}>
        <div className={styles.moduleCardTop}><span className={styles.moduleSequence}>MODULE {String(index + 1).padStart(2, '0')}</span><span className={styles.moduleLearnerCount}><Users size={14} />{module.learners.length} learner{module.learners.length === 1 ? '' : 's'}</span></div>
        <div className={styles.moduleCardHeading}><span className={styles.moduleIcon}><BookOpen size={22} /></span><div><p>{[...module.programmes].join(' · ') || 'Programme not assigned'}</p><h3>{module.title}</h3></div></div>
        <dl className={styles.moduleDates} aria-label="Module dates" title={module.learners.length > 1 ? 'Earliest start and latest end across the selected learners' : undefined}>
          <div><dt>Start date</dt><dd>{module.start ? <time dateTime={module.start}>{formatReviewDate(module.start)}</time> : 'Not recorded'}</dd></div>
          <div><dt>End date</dt><dd>{module.end ? <time dateTime={module.end}>{formatReviewDate(module.end)}</time> : 'Not recorded'}</dd></div>
        </dl>
        <div className={styles.moduleProgress}>
          <div className={styles.moduleStats}><span>Average progress</span><strong className={average == null ? styles.moduleUnavailable : undefined}>{average == null ? 'Unavailable' : percentLabel(average)}</strong></div>
          {average != null && <div className={styles.progressTrack} role="progressbar" aria-label={`${module.title} average module progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={average}><span style={{ width: `${average}%` }} /></div>}
          <p className={styles.moduleCoverage}>{loading || failed ? 'Available records · ' : ''}{available.length} of {module.learners.length} learners have progress data</p>
        </div>
        <ModuleLearners employerId={employerId} title={module.title} learners={module.learners} />
      </article>;
    })}</div>
    {!loading && !modules.size && <div className={styles.emptyState}><BookOpen size={30} /><h3>{failed ? 'Module progress unavailable' : !learners.length ? 'No learners linked yet' : !filtered.length ? 'No matching learners' : 'No modules to show'}</h3><p>{failed ? 'Retry to load module progress.' : !filtered.length && learners.length ? 'Try another search or clear your filters.' : 'Assigned modules and learner progress will appear here.'}</p></div>}
  </section>;
}
