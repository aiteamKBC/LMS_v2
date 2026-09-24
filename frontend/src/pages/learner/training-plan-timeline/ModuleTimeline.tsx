import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, LocateFixed, Maximize2, Minimize2 } from 'lucide-react';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { Modal } from '@/pages/users/components/Modal';
import { barPosition, dateKey, moduleVisualEnd, reviewDate, timelineMonthKeys, timelinePeriodYear, timelineYears, type TimelineModule } from './model';
import { dateLabel, moduleStatus, monthLabel } from './presentation';
import { TimelineInspector } from './TimelineInspector';
import styles from './trainingPlan.module.css';
import layout from './ModuleTimeline.module.css';

type Props = {
  data: TrainingPlanDashboard; modules: TimelineModule[]; kind: string; learnerId: string;
  today: string; selectedMonth: string; selectedId?: string; canOpenActivities?: boolean;
  /** Review markers link to the learner's calendar; off for viewers who cannot open it. */
  canOpenCalendar?: boolean;
  detailsMode?: 'inspector' | 'overview';
  programmeStartDate?: string | null;
  onMonthChange: (month: string) => void; onModuleSelect: (module: TimelineModule) => void;
};

export function ModuleTimeline({ data, modules, kind, learnerId, today, selectedMonth, selectedId, onMonthChange, onModuleSelect, canOpenActivities = true, canOpenCalendar = true, detailsMode = 'inspector', programmeStartDate }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const [inspectedId, setInspectedId] = useState('');
  const [jumpId, setJumpId] = useState('');
  const [notice, setNotice] = useState('');
  const plot = useRef<HTMLDivElement>(null);
  const fullButton = useRef<HTMLButtonElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const scroll = useRef({ top: 0, left: 0 });
  const placeholderHeight = useRef(640);
  const root = useRef<HTMLElement>(null);
  const programmeStart = dateKey(programmeStartDate);
  const startMonth = programmeStart ? Number(programmeStart.slice(5, 7)) - 1 : 0;
  const year = Math.max(programmeStart ? Number(programmeStart.slice(0, 4)) : 0, timelinePeriodYear(selectedMonth, startMonth));
  const months = timelineMonthKeys(year, startMonth);
  const periodLabel = startMonth ? `${monthLabel(months[0])} – ${monthLabel(months[11])}` : String(year);
  const positionFor = (start: string, end: string) => barPosition(start, end, year, startMonth);
  const sourceDates = [...Object.keys(data.months), ...data.actual.map(row => row.month), ...data.reviews.map(reviewDate), ...modules.flatMap(m => [m.start, moduleVisualEnd(m)])];
  const years = timelineYears(sourceDates.filter(date => dateKey(date.length === 7 ? `${date}-01` : date))
    .map(date => `${timelinePeriodYear(date, startMonth)}-01-01`), timelinePeriodYear(today, startMonth), year)
    .filter(value => !programmeStart || value >= Number(programmeStart.slice(0, 4)));
  const scheduledInYear = modules.filter(module => positionFor(module.start, moduleVisualEnd(module)));
  // "Current" means still being delivered, so it reads the same range the bar is
  // drawn to: a closure that moved the last session past the stored end date keeps
  // the module in progress until that session is taught. Same helper as the bar --
  // one decision about where a module ends, not two that can disagree.
  const currentModules = modules.filter(module => module.start && module.start <= today && moduleVisualEnd(module) >= today && moduleStatus(module) !== 'Completed');
  const current = currentModules.find(module => module.id === selectedId) || currentModules[0];
  const inspected = detailsMode === 'inspector' || fullscreen ? modules.find(module => module.id === inspectedId) : undefined;
  const inspectorOpen = !!inspected;
  const reviews = data.reviews.filter(review => review.source !== 'student-support' && review.status !== 'cancelled')
    .sort((a, b) => reviewDate(a).localeCompare(reviewDate(b)));
  const reviewDays = [...new Set(reviews.map(reviewDate).filter(date => positionFor(date, date)))]
    .map(date => ({ date, items: reviews.filter(review => reviewDate(review) === date) }));
  const chartHeight = 64 + (modules.length ? modules.length * 52 : 80) + (reviewDays.length ? 50 : 0) + 2;
  const subjectHref = (id: string) => `/learner/modules/${kind}/${learnerId}?subject=${encodeURIComponent(id)}`;
  const calendarHref = (event: string) => `/learner/calendar?kind=${encodeURIComponent(kind)}&learner=${encodeURIComponent(learnerId)}&event=${encodeURIComponent(event)}`;
  const reviewStatus = (review: typeof reviews[number]) => ({ completed: 'Completed', scheduled: review.invited === false ? 'Booking pending' : 'Booked', 'not-scheduled': reviewDate(review) < today ? 'Overdue' : 'Not booked', 'awaiting-signature': 'Awaiting signatures', 'in-progress': 'In progress' }[review.status] || 'Not booked');
  const saveScroll = () => {
    if (plot.current && getComputedStyle(plot.current).display !== 'none') {
      scroll.current = { top: plot.current.scrollTop, left: plot.current.scrollLeft };
    }
  };
  const toggleFullscreen = () => {
    saveScroll(); placeholderHeight.current = root.current?.getBoundingClientRect().height || 640;
    if (!fullscreen && detailsMode === 'overview') setInspectedId(selectedId || '');
    setFullscreen(value => !value);
  };
  const closeInspector = () => {
    saveScroll();
    setInspectedId('');
    requestAnimationFrame(() => {
      const trigger = lastTrigger.current?.isConnected ? lastTrigger.current : root.current?.querySelector<HTMLButtonElement>('[data-inspected="true"]');
      trigger?.focus({ preventScroll: true });
    });
  };
  const inspect = (module: TimelineModule, trigger?: HTMLButtonElement) => {
    saveScroll();
    lastTrigger.current = trigger || null;
    setInspectedId(module.id); onModuleSelect(module); setNotice('');
  };
  const selectMonth = (month: string) => { saveScroll(); setInspectedId(''); setJumpId(''); setNotice(''); onMonthChange(month); };
  const goToday = () => { selectMonth(today.slice(0, 7)); setJumpId('today'); };
  const goCurrent = () => {
    if (!current) { setNotice('No unfinished module is scheduled for today.'); return; }
    onMonthChange(today.slice(0, 7)); inspect(current); setJumpId(current.id);
  };

  // Expanding uses the existing accessible modal. Restore the same chart position
  // after moving it into or out of the modal; keep selection in this component.
  useLayoutEffect(() => {
    if (plot.current) { plot.current.scrollTop = scroll.current.top; plot.current.scrollLeft = scroll.current.left; }
  }, [fullscreen, inspectorOpen]);
  useLayoutEffect(() => {
    // On narrow screens the inspector temporarily covers the chart. Complete
    // the jump when it is visible again so closing details reveals this row.
    if (!jumpId || !plot.current?.clientWidth) return;
    const chart = plot.current;
    const header = chart.querySelector<HTMLElement>('[data-timeline-header]');
    if (jumpId !== 'today') {
      const row = [...chart.querySelectorAll<HTMLElement>('[data-module-id]')].find(node => node.dataset.moduleId === jumpId);
      if (row) chart.scrollTop = Math.max(0, row.offsetTop - (header?.offsetHeight || 64) - 12);
    }
    const track = chart.querySelector<HTMLElement>('[data-timeline-track]');
    if (track && chart.scrollWidth > chart.clientWidth) {
      const todayPosition = barPosition(today, today, year, startMonth)?.left || 0;
      chart.scrollLeft = Math.max(0, track.offsetLeft + track.offsetWidth * todayPosition / 100 - chart.clientWidth * .7);
    }
    setJumpId('');
  }, [jumpId, year, startMonth, today, inspectorOpen, fullscreen]);

  const timeline = <section ref={root} id="module-timeline" className={`${styles.root} ${layout.root} ${fullscreen ? layout.expanded : ''}`} aria-label="Module timeline"
    onKeyDown={event => { if (event.key === 'Escape' && inspected) { event.stopPropagation(); closeInspector(); } }}>
    <header className={layout.toolbar}>
      <div className={layout.title}><h2>Module timeline</h2><span>{modules.length} assigned modules · {scheduledInYear.length} scheduled in {periodLabel}</span></div>
      <div className={layout.actions}>
        {canOpenActivities && <Link to={`/learner/modules/${kind}/${learnerId}`}>View all modules<ArrowRight size={15} /></Link>}
        <label>{startMonth ? 'Period' : 'Year'}<select aria-label="Timeline year" value={year} onChange={event => selectMonth(`${event.target.value}-${String(startMonth + 1).padStart(2, '0')}`)}>{years.map(value => <option key={value} value={value}>{startMonth ? `${value}–${value + 1}` : value}</option>)}</select></label>
        <button type="button" onClick={goToday}>Today</button>
        <button type="button" onClick={goCurrent}><LocateFixed size={15} />Current module</button>
        <button ref={fullButton} type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{fullscreen ? 'Exit full screen' : 'Full screen'}</span></button>
      </div>
    </header>
    {notice && <p role="status" className={layout.notice}>{notice}</p>}
    <div className={layout.caption}><div className={layout.legend}><span><i className={layout.inProgress} />In progress</span><span><i className={layout.completed} />Completed</span><span><i className={layout.notStarted} />Not started</span><span><i className={layout.todayKey} />Today</span></div><p>Select a bar to view module details.</p></div>
    <div className={`${layout.body} ${inspected ? layout.withInspector : ''}`} style={{ '--timeline-content-height': `${chartHeight}px` } as CSSProperties}>
      <div ref={plot} className={layout.plot} tabIndex={0} aria-label="Scroll module timeline">
        <div className={layout.grid}>
          <div className={layout.chartHeader} data-timeline-header><div className={layout.moduleHeading}>Modules<span>Progress</span></div><div className={layout.months}>{months.map(key => {
            const name = new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
            return <button type="button" key={key} className={key === selectedMonth ? layout.selectedMonth : ''} onClick={() => selectMonth(key)}
              aria-label={`${monthLabel(key)}${data.months[key]?.topics[0] ? ` — ${data.months[key].topics[0]}` : ''}`} aria-pressed={key === selectedMonth} title={data.months[key]?.topics.join(' · ')}><strong>{name}</strong>{startMonth > 0 && <small>{key.slice(0, 4)}</small>}<span>{data.months[key]?.topics[0] || ''}</span></button>;
          })}</div></div>
          {modules.map(module => {
            // The bar spans the delivery, not the authoring: a holiday closure can
            // move the last session past the stored end date, and a bar that stops
            // at the stored date reads as a module that ended before it finished
            // teaching. Nothing is written back -- `module.end` stays the stored one.
            const visualEnd = moduleVisualEnd(module);
            const position = positionFor(module.start, visualEnd);
            const status = moduleStatus(module);
            const tone = status === 'Completed' ? layout.completed : status === 'In progress' ? layout.inProgress : layout.notStarted;
            return <div key={module.id} data-module-id={module.id} className={`${layout.row} ${selectedId === module.id ? layout.selectedRow : ''}`}>
              <div className={layout.moduleLabel}>{detailsMode === 'overview'
                ? <button type="button" onClick={event => inspect(module, event.currentTarget)} aria-pressed={module.id === selectedId} title={module.title}>{module.title}</button>
                : canOpenActivities ? <Link to={subjectHref(module.id)} title={module.title}>{module.title}</Link> : <span title={module.title}>{module.title}</span>}<span role="progressbar" aria-label={`${module.title} activity progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={module.progress}>{module.progress}%</span></div>
              <div className={layout.track} data-timeline-track>
                {months.map(key => <span key={key} className={`${layout.monthCell} ${selectedMonth === key ? layout.selectedCell : ''}`} />)}
                {position ? <button type="button" className={`${layout.bar} ${tone}`} style={{ left: `${position.left}%`, width: `${position.width}%` }}
                  onClick={event => inspect(module, event.currentTarget)} aria-label={`Show ${module.title} overview`} aria-pressed={module.id === selectedId} data-inspected={module.id === selectedId}
                  title={`${module.title} · ${dateLabel(module.start)} – ${dateLabel(visualEnd)} · ${status} · ${module.progress}% completed`}>
                  <span className={layout.barFill} style={{ width: `${module.progress}%` }} /><span className={layout.barCaption}>{dateLabel(module.start)} – {dateLabel(visualEnd)}</span>{status === 'Completed' && <CheckCircle2 size={12} />}
                </button> : module.start && visualEnd ? <button type="button" className={layout.noDates}
                  onClick={event => { onMonthChange(module.start.slice(0, 7)); inspect(module, event.currentTarget); }}
                  aria-label={`Show ${module.title} schedule in ${module.start.slice(0, 4)}`}>
                  {dateLabel(module.start)} – {dateLabel(visualEnd)} · View {module.start.slice(0, 4)}<ArrowRight size={12} />
                </button> : <button type="button" className={layout.noDates} onClick={event => inspect(module, event.currentTarget)} aria-label={`Show ${module.title} overview`} data-inspected={module.id === selectedId}>Dates to be confirmed<ArrowRight size={12} /></button>}
                {positionFor(today, today) && <span className={layout.todayLine} style={{ left: `${positionFor(today, today)?.left || 0}%` }} />}
              </div>
            </div>;
          })}
          {!modules.length && <p className={layout.empty}>Your modules will appear here when they are assigned.</p>}
          {!!reviewDays.length && <div className={layout.reviewRow}><div className={layout.reviewLabel}><CalendarDays size={15} /><strong>Coaching reviews</strong><span>{reviewDays.reduce((sum, day) => sum + day.items.length, 0)}</span></div><div className={layout.track}>
            {months.map(key => <span key={key} className={layout.monthCell} />)}
            {reviewDays.map(day => {
              const marker = { className: layout.reviewMarker, style: { left: `clamp(14px, ${positionFor(day.date, day.date)?.left || 0}%, calc(100% - 14px))` },
                'aria-label': `${day.items.map(review => review.title).join(', ')} on ${dateLabel(day.date)}`,
                title: `${dateLabel(day.date)} · ${day.items.map(review => `${review.title}: ${reviewStatus(review)}`).join(' · ')}` };
              const content = <><CalendarDays size={13} />{day.items.length > 1 && <small>{day.items.length}</small>}</>;
              return canOpenCalendar
                ? <Link key={day.date} to={calendarHref(day.items[0].eventKey)} {...marker}>{content}</Link>
                : <span key={day.date} role="img" {...marker}>{content}</span>;
            })}
          </div></div>}
        </div>
      </div>
      {inspected && <TimelineInspector module={inspected} coach={data.coach.name} href={canOpenActivities ? subjectHref(inspected.id) : undefined} onClose={closeInspector} />}
    </div>
  </section>;
  return fullscreen ? <><div aria-hidden="true" style={{ height: placeholderHeight.current }} /><Modal title="Programme timeline" size="max-w-none" className={layout.fullscreen} onClose={() => { saveScroll(); setFullscreen(false); }} returnFocusRef={fullButton}>
    <div className={`dashboard-theme ${layout.fullscreenTheme}`} data-workspace-role="learner">{timeline}</div>
  </Modal></> : timeline;
}
