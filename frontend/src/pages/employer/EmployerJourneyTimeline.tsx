import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleAlert, Flag, MapPin, Route, SkipForward, Users } from 'lucide-react';
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

function LearnerPin({ pin, learner }: { pin: JourneyPin; learner: EmployerLearnerCard }) {
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
      data-edge={(pin.percent ?? 0) < 15 ? 'start' : (pin.percent ?? 0) > 85 ? 'end' : undefined}
      style={{ left: `${8 + (pin.percent ?? 0) * .84}%` }}
      aria-label={`${learner.name}, ${pin.title}, ${percent(pin.percent)}, ${pin.label}`}
      aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show}>
      <span className={styles.pinHead}><span>{initials(learner.name) || '?'}</span></span>
      <span className={styles.pinCaption}>{pin.state === 'skipped' && <SkipForward size={10} aria-hidden="true" />}
        {pin.percent == null ? '?' : `${number(pin.percent)}%`}{pin.state === 'skipped' ? ' · Skip' : pin.state === 'next' ? ' · Next' : ''}</span>
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
    </div>, document.body)}
  </>;
}

/** A shared module route with a separate lane for each learner to keep pins readable. */
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
  const [scroll, setScroll] = useState({ previous: false, next: false });
  const measure = () => {
    const element = viewport.current;
    if (!element) return;
    const next = { previous: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 };
    setScroll(current => current.previous === next.previous && current.next === next.next ? current : next);
  };
  const moduleIds = JSON.stringify(modules.map(module => module.id));
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
      <div className={styles.canvas} style={{ '--module-count': modules.length, minWidth: `${204 + modules.length * 264}px` } as CSSProperties}>
        <div className={styles.moduleHeaders}>
          <div className={styles.corner}><span>LEARNERS / MODULES</span><strong>Follow their journey <ArrowRight size={15} /></strong><small>Each segment runs from 0–100%</small></div>
          {modules.map((module, index) => {
            const known = module.entries.filter(entry => entry.percent != null);
            const average = known.length ? known.reduce((sum, entry) => sum + entry.percent!, 0) / known.length : null;
            return <div key={module.id} className={styles.moduleHeader} style={{ '--module-hue': module.hue } as CSSProperties}>
              <div className={styles.moduleMeta}><span>MODULE {String(index + 1).padStart(2, '0')}</span><span><Users size={12} />{module.entries.length}</span></div>
              <h3 title={module.title}>{module.title}</h3><p className={styles.programmes} title={[...module.programmes].join(' · ')}>{[...module.programmes].join(' · ') || 'Programme not assigned'}</p>
              <p className={styles.dates}>{dateRange(module.start, module.end)}</p>
              <div className={styles.moduleStats}><span><strong>{percent(average)}</strong> average{known.length !== module.entries.length && ` (${known.length}/${module.entries.length})`}</span><span><Check size={12} />{module.entries.filter(entry => entry.percent === 100).length} complete</span></div>
              <div className={styles.moduleRail}><span>{String(index + 1).padStart(2, '0')}</span></div>
              <div className={styles.scale}><span>0%</span><span>50%</span><span>100%</span></div>
            </div>;
          })}
        </div>
        {model.rows.map(({ learner, status, entries, pins }) => <div key={learnerKey(learner)} className={styles.learnerRow}>
          <div className={styles.learner}><Link to={learnerHref(employerId, learner, 'plan')} state={location.state}>
            <span className={styles.avatar}>{initials(learner.name)}</span><span><strong>{learner.name}</strong><small>{learner.cohort || learner.programme || 'Learner'}</small></span></Link>
            {status === 'error' ? <small className={styles.rowStatus}>Progress unavailable</small> : status === 'loading' ? <small className={styles.rowStatus}>Loading progress…</small> : !entries.length ? <small className={styles.rowStatus}>No assigned modules</small> : null}</div>
          {modules.map(module => {
            const entry = entries.find(entry => entry.id === module.id);
            const pin = pins.find(pin => pin.id === module.id);
            return <div key={module.id} className={styles.cell} style={{ '--module-hue': module.hue } as CSSProperties} data-assigned={!!entry}
              aria-label={`${learner.name}, ${module.title}: ${entry ? percent(entry.percent) : status === 'ready' ? 'Not assigned' : 'Progress unavailable'}`}>
              {entry ? <><div className={styles.laneRail}><span style={{ width: `${entry.percent ?? 0}%` }} /></div>
                {pin ? <LearnerPin pin={pin} learner={learner} /> : entry.percent === 100 ? <span className={styles.completed}><Check size={13} />Completed</span>
                  : <span className={styles.waiting}>{entry.percent == null ? 'Progress unavailable' : entry.percent === 0 ? 'Not started' : percent(entry.percent)}</span>}</>
                : <span className={styles.unassigned}>{status === 'ready' ? '—' : status === 'error' ? 'Unavailable' : 'Loading…'}</span>}
            </div>;
          })}
        </div>)}
      </div>
    </div> : !loading && <div className={styles.empty}><Route size={32} /><h3>{failed ? 'Journey data unavailable' : 'No modules to show'}</h3><p>{failed ? 'Retry to load learner journeys.' : 'Assigned modules will appear here. Try clearing your filters.'}</p></div>}
    <footer className={styles.footer}><div className={styles.legend}><span><MapPin size={16} />Current / next module</span><span><SkipForward size={15} />Skipped ahead</span><span><Flag size={14} />Completed history stays visible</span></div>
      <p>Position shows recorded module progress, not time. Skipped ahead means an earlier scheduled module is unfinished while a later one has progress. Overlapping or undated modules do not imply a skip.</p></footer>
  </section>;
}
