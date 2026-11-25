import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Check, ChevronLeft, ChevronRight, CircleAlert, GitFork, MapPin, Route, SkipForward, Users } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { formatReviewDate, learnerHref, learnerKey } from './employerDashboardData';
import { buildJourneyTimeline, type JourneyPin } from './employerJourneyTimelineData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import styles from './EmployerJourneyTimeline.module.css';

type Props = {
  employerId: string; learners: EmployerLearnerCard[]; filtered: EmployerLearnerCard[];
  records: EmployerLearningRecords; moduleId?: string; onRetry: () => void;
};
const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
const percent = (value: number | null) => value == null ? 'Unavailable' : `${number(value)}%`;
const dateRange = (start: string, end: string) => start && end ? `${formatReviewDate(start)} – ${formatReviewDate(end)}`
  : start ? `From ${formatReviewDate(start)}` : end ? `Until ${formatReviewDate(end)}` : 'Schedule unavailable';
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
type LearnerPosition = { pin: JourneyPin; learner: EmployerLearnerCard };
const sortPins = (a: LearnerPosition, b: LearnerPosition) => (a.pin.percent ?? 0) - (b.pin.percent ?? 0)
  || a.learner.name.localeCompare(b.learner.name) || learnerKey(a.learner).localeCompare(learnerKey(b.learner));
function pinPositions(pins: LearnerPosition[], width: number) {
  const positions = pins.map(({ pin }, index) => Math.max(48 + (pin.percent ?? 0) / 100 * (width - 96), 48 + index * 96));
  for (let index = positions.length - 1; index >= 0; index--) {
    positions[index] = Math.min(positions[index], width - 48 - (positions.length - 1 - index) * 96);
    if (index < positions.length - 1) positions[index] = Math.min(positions[index], positions[index + 1] - 96);
  }
  return positions;
}

function LearnerPin({ pin, learner, left }: { pin: JourneyPin; learner: EmployerLearnerCard; left: number }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean; maxHeight: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const show = () => {
    clearHide();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(316, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom;
    const above = below < 360 && rect.top > below;
    setPosition({ left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
      top: above ? rect.top - 10 : rect.bottom + 10, above, maxHeight: Math.max(80, (above ? rect.top : below) - 22) });
  };
  const hide = () => { clearHide(); hideTimer.current = setTimeout(() => setPosition(null), 150); };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest('[role="tooltip"]')) return;
      setPosition(null);
    };
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node)) dismiss(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss);
      window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape);
    };
  }, [position]);
  const facts = pin.facts;
  return <>
    <button ref={trigger} type="button" className={styles.pin} data-state={pin.state}
      style={{ left: `${left}%` }}
      aria-label={`${learner.name}, ${pin.title}, ${percent(pin.percent)}, ${pin.label}`}
      aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show}>
      <span className={styles.pinHead}><span>{initials(learner.name) || '?'}</span></span>
      <span className={styles.pinCaption}>{pin.state === 'skipped' && <SkipForward size={10} aria-hidden="true" />}
        {pin.percent == null ? '?' : `${number(pin.percent)}%`}{pin.state === 'skipped' ? ' · Skipped' : pin.state === 'next' ? ' · Next' : pin.state === 'parallel' ? ' · Parallel' : ''}</span>
      <span className={styles.pinName}>{learner.name}</span>
    </button>
    {position && createPortal(<div id={id} role="tooltip" className={styles.tooltip}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, transform: position.above ? 'translateY(-100%)' : undefined }}
      onMouseEnter={clearHide} onMouseLeave={hide}>
      <div className={styles.tooltipPerson}><span>{initials(learner.name)}</span><div><strong>{learner.name}</strong><small>{learner.programme || 'Programme not assigned'}{learner.cohort && ` · ${learner.cohort}`}</small></div></div>
      <h3>{pin.title}</h3><div className={styles.tooltipProgress}><span>{pin.label}</span><strong>{percent(pin.percent)}</strong></div>
      {pin.percent != null && <div className={styles.tooltipBar}><span style={{ width: `${pin.percent}%` }} /></div>}
      <p>{dateRange(pin.start, pin.end)}</p>
      <dl>
        <div><dt>Activities</dt><dd>{facts ? `${facts.activities.completed} / ${facts.activities.total}` : 'Unavailable'}</dd></div>
        <div><dt>OTJ hours</dt><dd>{facts?.hours.actual != null ? `${number(facts.hours.actual)} / ${facts.hours.planned == null ? '—' : number(facts.hours.planned)}` : 'Unavailable'}</dd></div>
        <div><dt>Attendance</dt><dd>{facts?.attendance ? `${facts.attendance.attended} / ${facts.attendance.total}` : 'Unavailable'}</dd></div>
        <div><dt>KSBs</dt><dd>{facts?.ksb ? `${facts.ksb.completed} / ${facts.ksb.total}` : 'Unavailable'}</dd></div>
      </dl>
      {pin.ahead && <p className={styles.skipNote}><SkipForward size={14} />This module is unfinished; progress is recorded in {pin.ahead}. A pause or skip event has not been recorded.</p>}
      {!pin.start && <p className={styles.skipNote}>No start date is available to place this module in the learner’s sequence.</p>}
      {pin.state === 'next' && <p className={styles.skipNote}>Previous module completed. This is the next scheduled module; its recorded progress is shown above.</p>}
      {!!pin.parallelWith?.length && <div className={styles.parallelDetails}><strong><GitFork size={13} />Studying alongside</strong>
        <ul>{pin.parallelWith.map(module => <li key={module.id}><span>{module.title}</span><b>{percent(module.percent)}</b></li>)}</ul>
        <p>Each module has its own recorded progress. These percentages are not combined.</p></div>}
    </div>, document.body)}
  </>;
}

function JourneyPinField({ title, pins, width, positions, parallel = false }: {
  title: string; pins: LearnerPosition[]; width: number; positions: number[]; parallel?: boolean;
}) {
  return <div className={styles.pinField} role="group" aria-label={`${title} ${parallel ? 'parallel learner' : 'learner'} pins`}>
    <div className={styles.sharedRail} aria-hidden="true" />
    <div className={styles.scale} aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
    <svg className={styles.connectors} aria-hidden="true" width="100%" height="100%">
      {pins.map(({ pin, learner }, index) => <line key={learnerKey(learner)}
        x1={`${positions[index] / width * 100}%`} y1="58" x2={`${(48 + (pin.percent ?? 0) / 100 * (width - 96)) / width * 100}%`} y2="75" />)}
    </svg>
    {pins.map(({ pin, learner }, index) => <LearnerPin key={learnerKey(learner)} pin={pin} learner={learner} left={positions[index] / width * 100} />)}
    {!pins.length && <p className={styles.noPins}>{parallel ? 'No parallel learners here' : 'No learners positioned here'}</p>}
  </div>;
}

/** One main route with extra pins for skips and a second route for parallel study. */
export function EmployerJourneyTimeline({ employerId, learners, filtered, records, moduleId, onRetry }: Props) {
  const titleId = useId();
  const scrollId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const model = buildJourneyTimeline(learners, filtered, records);
  const modules = model.modules.filter(module => !moduleId || module.id === moduleId);
  const loading = model.rows.some(row => row.status === 'loading');
  const failed = model.rows.filter(row => row.status === 'error').length;
  const skipped = model.rows.filter(row => row.pins.some(pin => pin.state === 'skipped' && (!moduleId || pin.id === moduleId))).length;
  const segments = modules.map(module => {
    const pins = model.rows.flatMap(row => row.pins.filter(pin => pin.id === module.id).map(pin => ({ pin, learner: row.learner })))
      .sort(sortPins);
    const parallelPins = model.rows.flatMap(row => row.parallelPins.filter(pin => pin.id === module.id).map(pin => ({ pin, learner: row.learner })))
      .sort(sortPins);
    const width = Math.max(300, Math.max(pins.length, parallelPins.length) * 96 + 48);
    // Keep everyone side by side. Short connectors preserve the exact progress
    // position when equal/nearby percentages need more room for their names.
    return { module, pins, parallelPins, width, positions: pinPositions(pins, width), parallelPositions: pinPositions(parallelPins, width) };
  });
  const hasParallel = segments.some(segment => segment.parallelPins.length);
  const unplacedLearners = model.rows.filter(row => row.status !== 'ready' || !row.entries.length);
  const [scroll, setScroll] = useState({ previous: false, next: false });
  const measure = () => {
    const element = viewport.current;
    if (!element) return;
    const next = { previous: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 };
    setScroll(current => current.previous === next.previous && current.next === next.next ? current : next);
  };
  const moduleIds = JSON.stringify(segments.map(({ module, width }) => [module.id, width]));
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollLeft = 0;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [moduleIds]);
  const move = (direction: number) => viewport.current?.scrollBy({ left: direction * 300,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  return <section className={styles.section} aria-labelledby={titleId}>
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.headingIcon}><Route size={24} aria-hidden="true" /></span>
        <div><span className={styles.eyebrow}>THE LEARNING JOURNEY</span><h2 id={titleId}>All modules timeline</h2><p>One route. Every learner. Every step forward.</p></div></div>
      <div className={styles.controls}><span><BookOpen size={14} />{modules.length} modules</span><span><Users size={14} />{filtered.length} learners</span>
        <div className={styles.arrows}><button type="button" aria-label="Earlier timeline modules" aria-controls={scrollId} disabled={!scroll.previous} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Later timeline modules" aria-controls={scrollId} disabled={!scroll.next} onClick={() => move(1)}><ChevronRight size={18} /></button></div></div>
    </header>
    <div className={styles.intro}><p><MapPin size={15} aria-hidden="true" />Hover, focus or tap a learner pin for their progress and module details.</p>
      {skipped > 0 && <span className={styles.skipCount}><SkipForward size={14} />{skipped} learner{skipped === 1 ? '' : 's'} progressed ahead</span>}</div>
    {failed > 0 && <div className={styles.notice} role="alert"><CircleAlert size={17} /><p>{failed} learner record{failed === 1 ? '' : 's'} unavailable. Available progress is shown.</p><button type="button" onClick={onRetry}>Retry</button></div>}
    {loading && <LoadingSkeleton label="Loading learner journey timeline" />}
    {modules.length > 0 ? <div ref={viewport} id={scrollId} className={styles.viewport} onScroll={measure} role="region" aria-label="All modules learner journey" tabIndex={0}>
      <div className={styles.canvas} style={{ gridTemplateColumns: segments.map(segment => `minmax(${segment.width}px, 1fr)`).join(' '), minWidth: `${segments.reduce((sum, segment) => sum + segment.width, 0)}px` }}>
          {segments.map(({ module, pins, width, positions }, index) => {
            const known = module.entries.filter(entry => entry.percent != null);
            const average = known.length ? known.reduce((sum, entry) => sum + entry.percent!, 0) / known.length : null;
            return <article key={module.id} className={styles.moduleSegment} style={{ '--module-hue': module.hue } as CSSProperties} aria-label={`${module.title} journey segment`}>
              <div className={styles.moduleHeader}>
              <div className={styles.moduleMeta}><span>MODULE {String(index + 1).padStart(2, '0')}</span><span><Users size={12} />{module.entries.length}</span></div>
              <h3 title={module.title}>{module.title}</h3><p className={styles.programmes} title={[...module.programmes].join(' · ')}>{[...module.programmes].join(' · ') || 'Programme not assigned'}</p>
              <p className={styles.dates}>{dateRange(module.start, module.end)}</p>
              <div className={styles.moduleStats}><span><strong>{percent(average)}</strong> average{known.length !== module.entries.length && ` (${known.length}/${module.entries.length})`}</span><span><Check size={12} />{module.entries.filter(entry => entry.percent === 100).length} complete</span></div>
              </div>
              <JourneyPinField title={module.title} pins={pins} width={width} positions={positions} />
            </article>;
          })}
          {hasParallel && <>
            <div className={styles.parallelHeading}><GitFork size={18} aria-hidden="true" /><div><h3>Parallel study timeline</h3><p>Overlapping modules in progress · Each module keeps its own progress</p></div></div>
            {segments.map(({ module, parallelPins, width, parallelPositions }) => <article key={`parallel:${module.id}`} className={styles.moduleSegment}
              style={{ '--module-hue': module.hue } as CSSProperties} aria-label={`${module.title} parallel journey segment`}>
              <div className={styles.parallelModuleHeader}><h4 title={module.title}>{module.title}</h4><span>{parallelPins.length} learner{parallelPins.length === 1 ? '' : 's'}</span></div>
              <JourneyPinField title={module.title} pins={parallelPins} width={width} positions={parallelPositions} parallel />
            </article>)}
          </>}
      </div>
    </div> : !loading && <div className={styles.empty}><Route size={32} /><h3>{failed ? 'Journey data unavailable' : 'No modules to show'}</h3><p>{failed ? 'Retry to load learner journeys.' : 'Assigned modules will appear here. Try clearing your filters.'}</p></div>}
    {unplacedLearners.length > 0 && <div className={styles.unplacedLearners} aria-label="Learners awaiting journey data">{unplacedLearners.map(({ learner, status }) =>
      <Link key={learnerKey(learner)} to={learnerHref(employerId, learner, 'plan')} state={location.state}><strong>{learner.name}</strong><span>{status === 'error' ? 'Progress unavailable' : status === 'loading' ? 'Loading progress…' : 'No assigned modules'}</span></Link>)}</div>}
    <footer className={styles.footer}><div className={styles.legend}><span><MapPin size={16} />One main position per learner</span><span><SkipForward size={15} />Skipped modules</span><span><GitFork size={15} />Parallel study below</span></div>
      <p>Pins sit side by side; connectors point to recorded progress. Overlapping unfinished modules with progress appear on the parallel route with independent percentages. Earlier unfinished modules with later progress show as skipped. Undated modules do not imply either.</p></footer>
  </section>;
}
