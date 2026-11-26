import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Circle, CircleAlert, GitFork, GraduationCap, MapPin, Route, SkipForward, Users } from 'lucide-react';
import type { EmployerLearnerCard } from '@/api/employerPortal';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { formatReviewDate, learnerHref, learnerKey } from './employerDashboardData';
import { buildJourneyTimeline, type JourneyPin } from './employerJourneyTimelineData';
import type { EmployerLearningRecords } from './useEmployerLearningSummary';
import { useEmployerJourneyHolidays } from './useEmployerJourneyHolidays';
import { annualJourneyHolidays, journeyHolidayMarks, type JourneyHoliday } from './employerJourneyHolidays';
import styles from './EmployerJourneyTimeline.module.css';

type Props = {
  employerId: string; learners: EmployerLearnerCard[]; filtered: EmployerLearnerCard[];
  records: EmployerLearningRecords; moduleId?: string; onRetry: () => void;
  variant?: 'straight' | 'curved';
};
const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
const percent = (value: number | null) => value == null ? 'Unavailable'
  : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;
const dateRange = (start: string, end: string) => start && end ? `${formatReviewDate(start)} – ${formatReviewDate(end)}`
  : start ? `From ${formatReviewDate(start)}` : end ? `Until ${formatReviewDate(end)}` : 'Schedule unavailable';
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
// One continuous wave in canvas pixels, so changing module widths never resets
// the phase or steepness at a colour boundary. Pins use the same curve.
const curveFrequency = 2 * Math.PI / 720;
const curveY = (distance: number) => 155 - 45 * Math.sin(distance * curveFrequency);
const curveSlope = (distance: number) => -45 * curveFrequency * Math.cos(distance * curveFrequency);
// Keep the full marker inside its colour at both ends of the progress scale.
// Every percentage uses this same linear axis, including holiday positions.
const progressInset = 28;
const progressX = (percent: number, width: number) => progressInset + percent / 100 * (width - progressInset * 2);
function curvePath(offset: number, width: number) {
  let path = `M-4 ${curveY(offset - 4)}`;
  for (let start = -4; start < width + 4; start += 50) {
    const end = Math.min(start + 50, width + 4);
    const handle = (end - start) / 3;
    path += ` C${start + handle} ${curveY(offset + start) + handle * curveSlope(offset + start)} ${end - handle} ${curveY(offset + end) - handle * curveSlope(offset + end)} ${end} ${curveY(offset + end)}`;
  }
  return path;
}
type LearnerPosition = { pin: JourneyPin; learner: EmployerLearnerCard };
const sortPins = (a: LearnerPosition, b: LearnerPosition) => (a.pin.percent ?? 0) - (b.pin.percent ?? 0)
  || a.learner.name.localeCompare(b.learner.name) || learnerKey(a.learner).localeCompare(learnerKey(b.learner));
function pinLanes(pins: LearnerPosition[], width: number, offset: number, ends: number[]) {
  return pins.map(({ pin }) => {
    const anchor = progressX(pin.percent ?? 0, width);
    const center = Math.max(64, Math.min(width - 64, anchor));
    const left = offset + Math.min(center - 60, anchor - 18);
    const right = offset + Math.max(center + 60, anchor + 18);
    const available = ends.findIndex(end => end + 12 <= left);
    const lane = available < 0 ? ends.length : available;
    ends[lane] = right;
    return lane;
  });
}

function LearnerPin({ pin, learner, left, top, fieldWidth }: {
  pin: JourneyPin; learner: EmployerLearnerCard; left: number; top: number; fieldWidth: number;
}) {
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
  const hours = facts?.hoursProgress;
  return <>
    <button ref={trigger} type="button" className={styles.pin} data-state={pin.state}
      style={{ left, top, '--pin-anchor': `${left}px`, '--pin-field-width': `${fieldWidth}px` } as CSSProperties}
      aria-label={`${learner.name}, ${pin.title}, Hours progress ${percent(pin.percent)}, ${pin.label}`}
      aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={show}>
      <span className={styles.pinName}><span>{learner.name}</span></span>
      <span className={styles.pinHead}><span>{initials(learner.name) || '?'}</span></span>
      <span className={styles.pinCaption}>{pin.state === 'skipped' && <SkipForward size={10} aria-hidden="true" />}
        {pin.percent == null ? '?' : percent(pin.percent)}{pin.state === 'next' ? ' · Next' : pin.state === 'parallel' ? ' · Parallel' : ''}</span>
    </button>
    {position && createPortal(<div id={id} role="tooltip" className={styles.tooltip}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, transform: position.above ? 'translateY(-100%)' : undefined }}
      onMouseEnter={clearHide} onMouseLeave={hide}>
      <div className={styles.tooltipPerson}><span>{initials(learner.name)}</span><div><strong>{learner.name}</strong><small>{learner.programme || 'Programme not assigned'}{learner.cohort && ` · ${learner.cohort}`}</small></div></div>
      <h3>{pin.title}</h3><div className={styles.tooltipProgress}><span>Hours progress · {pin.label}</span><strong>{percent(pin.percent)}</strong></div>
      {pin.percent != null && <div className={styles.tooltipBar}><span style={{ width: `${pin.percent}%` }} /></div>}
      <p>{dateRange(pin.start, pin.end)}</p>
      <dl>
        <div><dt>Activities</dt><dd>{facts ? `${facts.activities.completed} / ${facts.activities.total}` : 'Unavailable'}</dd></div>
        <div><dt>OTJ hours</dt><dd>{hours?.actual != null ? `${number(hours.actual)} / ${hours.planned == null ? '—' : number(hours.planned)}` : 'Unavailable'}</dd></div>
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

function HolidayMarker({ holidays, year, left, top }: { holidays: JourneyHoliday[]; year: number; left: number; top: number }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean; maxHeight: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const show = () => {
    clearHide();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(316, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom;
    const above = below < 180 && rect.top > below;
    setPosition({ left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
      top: above ? rect.top - 8 : rect.bottom + 8, above, maxHeight: Math.max(80, (above ? rect.top : below) - 20) });
  };
  const hide = () => { clearHide(); hideTimer.current = setTimeout(() => setPosition(null), 150); };
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && tooltip.current?.contains(event.target)) return;
      setPosition(null);
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)) dismiss(event);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPosition(null); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss);
      window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape);
    };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className={styles.holidayMarker} style={{ left, top }}
      aria-label={holidays.map(holiday => `${holiday.label}, ${dateRange(holiday.start, holiday.end)}, ${holiday.learners.join(', ')}`).join('; ')}
      aria-describedby={position ? id : undefined}
      onPointerEnter={event => { if (event.pointerType !== 'touch') show(); }} onPointerLeave={event => { if (event.pointerType !== 'touch') hide(); }}
      onFocus={() => requestAnimationFrame(() => { if (document.activeElement === trigger.current) show(); })} onBlur={hide}
      onClick={() => requestAnimationFrame(show)}>
      <span aria-hidden="true" />
    </button>
    {position && createPortal(<div ref={tooltip} id={id} role="tooltip" className={`${styles.tooltip} ${styles.holidayTooltip}`}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, transform: position.above ? 'translateY(-100%)' : undefined }}
      onPointerEnter={event => { if (event.pointerType !== 'touch') clearHide(); }} onPointerLeave={event => { if (event.pointerType !== 'touch') hide(); }}>
      <strong className={styles.holidayTooltipTitle}><CalendarDays size={16} aria-hidden="true" />{holidays.length === 1 ? holidays[0].label : `${holidays.length} holidays`}</strong>
      <p>Jan–Dec {year} holiday calendar</p>
      {holidays.map(holiday => <div key={holiday.key} className={styles.holidayDetails}>
        {holidays.length > 1 && <strong>{holiday.label}</strong>}<p>{dateRange(holiday.start, holiday.end)}</p><p>{holiday.learners.join(' · ')}</p>
      </div>)}
    </div>, document.body)}
  </>;
}

function JourneyPinField({ title, pins, width, lanes, laneOffset, layoutKey, parallel = false, curved = false, holidays = [], year }: {
  title: string; pins: LearnerPosition[]; width: number; lanes: number[]; laneOffset: number; layoutKey: string; parallel?: boolean; curved?: boolean;
  holidays?: JourneyHoliday[]; year: number;
}) {
  const field = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width, offset: 0, canvasWidth: width, canvasInset: 0 });
  useLayoutEffect(() => {
    const element = field.current;
    const canvas = element?.parentElement?.parentElement;
    if (!element || !canvas) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      const canvasStyle = getComputedStyle(canvas);
      const canvasInset = parseFloat(canvasStyle.paddingLeft) || 0;
      const canvasWidth = canvasBounds.width - canvasInset - (parseFloat(canvasStyle.paddingRight) || 0);
      const offset = bounds.left - canvasBounds.left;
      setGeometry(current => current.width === bounds.width && current.offset === offset && current.canvasWidth === canvasWidth && current.canvasInset === canvasInset
        ? current : { width: bounds.width, offset, canvasWidth, canvasInset });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [curved, width, layoutKey]);
  const xAt = (percent: number) => progressX(percent, geometry.width);
  const yAt = (percent: number) => curveY(geometry.offset + xAt(percent)) + laneOffset;
  return <div ref={field} className={styles.pinField} style={{ '--pin-lane-offset': `${laneOffset}px`, '--progress-inset': `${progressInset}px` } as CSSProperties}
    role="group" aria-label={`${title} ${parallel ? 'parallel learner' : 'learner'} pins`}>
    {curved ? <svg className={styles.curvedRail} viewBox={`0 0 ${geometry.width} 340`} preserveAspectRatio="none" aria-hidden="true">
      <path className={styles.road} d={curvePath(geometry.offset, geometry.width)} vectorEffect="non-scaling-stroke" />
      <path className={styles.roadDashes} d={curvePath(geometry.offset, geometry.width)} vectorEffect="non-scaling-stroke" />
    </svg> : <div className={styles.sharedRail} aria-hidden="true" />}
    <div className={styles.scale} aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
    {pins.map(({ pin, learner }, index) => {
      const value = pin.percent ?? 0;
      const left = xAt(value);
      const top = (curved ? yAt(value) - 55 : 30 + laneOffset) - lanes[index] * (curved ? 176 : 128);
      return <LearnerPin key={learnerKey(learner)} pin={pin} learner={learner} left={left} top={top} fieldWidth={geometry.width} />;
    })}
    {journeyHolidayMarks(holidays, geometry).map(mark => <HolidayMarker key={JSON.stringify(mark.holidays.map(holiday => holiday.key))}
      holidays={mark.holidays} year={year} left={mark.left}
      top={(curved ? curveY(geometry.offset + mark.left) + laneOffset : 75 + laneOffset) - 18} />)}
    {parallel && !pins.length && <p className={styles.noPins}>No parallel learners here</p>}
  </div>;
}

/** One main route with extra pins for skips and a second route for parallel study. */
export function EmployerJourneyTimeline({ employerId, learners, filtered, records, moduleId, onRetry, variant = 'curved' }: Props) {
  const curved = variant === 'curved';
  const titleId = useId();
  const scrollId = useId();
  const yearId = useId();
  const currentYear = Number(new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'Europe/London' }).format(new Date()));
  const [year, setYear] = useState(currentYear);
  const viewport = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const schedules = useEmployerJourneyHolidays(employerId, learners);
  const model = buildJourneyTimeline(learners, filtered, records);
  const modules = model.modules.filter(module => !moduleId || module.id === moduleId);
  const loading = model.rows.some(row => row.status === 'loading');
  const failed = model.rows.filter(row => row.status === 'error').length;
  const holidaysFailed = filtered.filter(learner => {
    const record = schedules.records[learnerKey(learner)];
    return record && !record.data?.holidayCalendar?.available;
  }).length;
  const holidaysLoading = filtered.some(learner => !schedules.records[learnerKey(learner)]);
  const holidayDates = filtered.flatMap(learner => {
    const schedule = schedules.records[learnerKey(learner)]?.data;
    return schedule ? [schedule.programmeStartDate, schedule.programmeEndDate,
      ...schedule.modules.flatMap(module => [module.start_date, module.end_date, module.effectiveEndDate])] : [];
  });
  const knownYears = [currentYear, year, ...holidayDates.filter(Boolean).map(date => Number(date!.slice(0, 4))).filter(value => Number.isInteger(value) && value > 0)];
  const firstYear = Math.min(...knownYears), lastYear = Math.max(...knownYears);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  const holidays = annualJourneyHolidays(filtered, schedules.records, `${year}-01-01`, `${year}-12-31`);
  const programmes = [...new Set(filtered.map(learner => learner.programme).filter(Boolean))];
  const skipped = model.rows.filter(row => row.pins.some(pin => pin.state === 'skipped' && (!moduleId || pin.id === moduleId))).length;
  const laneEnds: number[] = [];
  const parallelLaneEnds: number[] = [];
  let moduleOffset = 0;
  const segments = modules.map(module => {
    const pins = model.rows.flatMap(row => row.pins.filter(pin => pin.id === module.id).map(pin => ({ pin, learner: row.learner })))
      .sort(sortPins);
    const parallelPins = model.rows.flatMap(row => row.parallelPins.filter(pin => pin.id === module.id).map(pin => ({ pin, learner: row.learner })))
      .sort(sortPins);
    const width = Math.max(270, Math.max(pins.length, parallelPins.length) * 96 + 48);
    const lanes = pinLanes(pins, width, moduleOffset, laneEnds);
    const parallelLanes = pinLanes(parallelPins, width, moduleOffset, parallelLaneEnds);
    moduleOffset += width + 4;
    return { module, pins, parallelPins, width,
      lanes, parallelLanes };
  });
  const laneOffset = Math.max(0, ...segments.flatMap(segment => [...segment.lanes, ...segment.parallelLanes])) * (curved ? 176 : 128);
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
  return <section className={styles.section} data-variant={variant} aria-labelledby={titleId}>
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.headingIcon}><GraduationCap size={30} aria-hidden="true" /></span>
        <div><span className={styles.eyebrow}>{programmes.length === 1 ? `${programmes[0]} curriculum` : 'THE LEARNING CURRICULUM'}</span><h2 id={titleId}>All modules timeline</h2><p>A {modules.length}-module learning journey{modules.length > 1 ? ` from ${modules[0].title} to ${modules.at(-1)!.title}` : ''}.</p></div></div>
      <div className={styles.controls}><span><BookOpen size={16} />{modules.length} modules</span><span><Users size={16} />{filtered.length} learner{filtered.length === 1 ? '' : 's'}</span>
        <label className={styles.holidayYear} htmlFor={yearId}>Holiday year <select id={yearId} value={year} onChange={event => setYear(Number(event.target.value))}>
          {years.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <div className={styles.arrows}><button type="button" aria-label="Earlier timeline modules" aria-controls={scrollId} disabled={!scroll.previous} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Later timeline modules" aria-controls={scrollId} disabled={!scroll.next} onClick={() => move(1)}><ChevronRight size={18} /></button></div></div>
    </header>
    <div className={styles.intro}><p><MapPin size={15} aria-hidden="true" />Hover, focus or tap a learner pin for their progress and module details.</p>
      {skipped > 0 && <span className={styles.skipCount}><SkipForward size={14} />{skipped} learner{skipped === 1 ? '' : 's'} progressed ahead</span>}</div>
    {failed > 0 && <div className={styles.notice} role="alert"><CircleAlert size={17} /><p>{failed} learner record{failed === 1 ? '' : 's'} unavailable. Available progress is shown.</p><button type="button" onClick={onRetry}>Retry</button></div>}
    {holidaysFailed > 0 && <div className={styles.notice} role="alert"><CalendarDays size={17} /><p>Complete holiday calendars unavailable for {holidaysFailed} learner{holidaysFailed === 1 ? '' : 's'}. Available holidays are shown.</p><button type="button" onClick={schedules.retry}>Retry holidays</button></div>}
    <p className={styles.legend}><span className={styles.holidayKey} aria-hidden="true" />{holidaysLoading ? 'Loading holiday schedules…'
      : `${holidays.length} recorded holidays · Gold marks run from Jan to Dec ${year} across the road. Hover, focus or tap for details. Learner pins show hours progress, matching My Learning.`}</p>
    {loading && <LoadingSkeleton label="Loading learner journey timeline" />}
    {modules.length > 0 ? <div ref={viewport} id={scrollId} className={styles.viewport} onScroll={measure} role="region" aria-label={curved ? 'Curved modules learner journey' : 'All modules learner journey'} tabIndex={0}>
      <div className={styles.canvas} style={{ gridTemplateColumns: segments.map(segment => `minmax(${segment.width}px, 1fr)`).join(' '), minWidth: `${segments.reduce((sum, segment) => sum + segment.width, 0) + Math.max(0, segments.length - 1) * 4 + 40}px` }}>
          {segments.map(({ module, pins, width, lanes }, index) => {
            const known = module.entries.filter(entry => entry.percent != null);
            const average = known.length ? known.reduce((sum, entry) => sum + entry.percent!, 0) / known.length : null;
            const complete = known.length === module.entries.length && known.every(entry => entry.percent === 100);
            const started = known.some(entry => (entry.percent ?? 0) > 0);
            return <article key={module.id} className={styles.moduleSegment} style={{ '--module-hue': module.hue } as CSSProperties} aria-label={`${module.title} journey segment`}>
              <div className={styles.moduleHeader}>
              <div className={styles.moduleMeta}><span>MODULE {String(index + 1).padStart(2, '0')}</span><span><Users size={12} />{module.entries.length}</span></div>
              <h3 title={module.title}>{module.title}</h3><p className={styles.programmes} title={[...module.programmes].join(' · ')}>{[...module.programmes].join(' · ') || 'Programme not assigned'}</p>
              <p className={styles.dates}>{dateRange(module.start, module.end)}</p>
              <div className={styles.moduleStats}><span><strong>{percent(average)}</strong> Hours average{known.length !== module.entries.length && ` (${known.length}/${module.entries.length})`}</span><span>{complete || started ? <Check size={14} /> : <Circle size={13} />}{complete ? 'Complete' : started ? 'In progress' : known.length !== module.entries.length ? 'Progress unavailable' : 'Not started'}</span></div>
              </div>
              <JourneyPinField title={module.title} pins={pins} width={width} lanes={lanes} laneOffset={laneOffset} layoutKey={moduleIds} curved={curved} holidays={holidays} year={year} />
            </article>;
          })}
          {hasParallel && <>
            <div className={styles.parallelHeading}><GitFork size={18} aria-hidden="true" /><div><h3>Parallel study timeline</h3><p>Overlapping modules in progress · Each module keeps its own progress</p></div></div>
            {segments.map(({ module, parallelPins, width, parallelLanes }) => <article key={`parallel:${module.id}`} className={styles.moduleSegment}
              style={{ '--module-hue': module.hue } as CSSProperties} aria-label={`${module.title} parallel journey segment`}>
              <div className={styles.parallelModuleHeader}><h4 title={module.title}>{module.title}</h4><span>{parallelPins.length} learner{parallelPins.length === 1 ? '' : 's'}</span></div>
              <JourneyPinField title={module.title} pins={parallelPins} width={width} lanes={parallelLanes} laneOffset={laneOffset} layoutKey={moduleIds} parallel curved={curved} year={year} />
            </article>)}
          </>}
      </div>
    </div> : !loading && <div className={styles.empty}><Route size={32} /><h3>{failed ? 'Journey data unavailable' : 'No modules to show'}</h3><p>{failed ? 'Retry to load learner journeys.' : 'Assigned modules will appear here. Try clearing your filters.'}</p></div>}
    {unplacedLearners.length > 0 && <div className={styles.unplacedLearners} aria-label="Learners awaiting journey data">{unplacedLearners.map(({ learner, status }) =>
      <Link key={learnerKey(learner)} to={learnerHref(employerId, learner, 'plan')} state={location.state}><strong>{learner.name}</strong><span>{status === 'error' ? 'Progress unavailable' : status === 'loading' ? 'Loading progress…' : 'No assigned modules'}</span></Link>)}</div>}
  </section>;
}
