import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckCircle2, LocateFixed, Maximize2, Minimize2 } from 'lucide-react';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { Modal } from '@/pages/users/components/Modal';
import { barPosition, reviewDate, timelineYears, type TimelineModule } from './model';
import { dateLabel, moduleStatus, monthLabel } from './presentation';
import { TimelineInspector } from './TimelineInspector';
import styles from './trainingPlan.module.css';
import layout from './ModuleTimeline.module.css';

const monthNames = Array.from({ length: 12 }, (_, i) => new Date(2024, i, 1).toLocaleDateString('en-GB', { month: 'short' }));
type Props = {
  data: TrainingPlanDashboard; modules: TimelineModule[]; kind: string; learnerId: string;
  today: string; selectedMonth: string; selectedId?: string;
  onMonthChange: (month: string) => void; onModuleSelect: (module: TimelineModule) => void;
};

export function ModuleTimeline({ data, modules, kind, learnerId, today, selectedMonth, selectedId, onMonthChange, onModuleSelect }: Props) {
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
  const year = Number(selectedMonth.slice(0, 4));
  const sourceDates = [...Object.keys(data.months), ...data.actual.map(row => row.month), ...data.reviews.map(reviewDate), ...modules.flatMap(m => [m.start, m.end])];
  const years = timelineYears(sourceDates.map(date => date.length === 7 ? `${date}-01` : date), Number(today.slice(0, 4)), year);
  const activeModules = modules.filter(module => !module.start || (module.start < `${year + 1}-01-01` && module.end >= `${year}-01-01`));
  const currentModules = modules.filter(module => module.start && module.start <= today && module.end >= today && moduleStatus(module) !== 'Completed');
  const current = currentModules.find(module => module.id === selectedId) || currentModules[0];
  const inspected = modules.find(module => module.id === inspectedId);
  const inspectorOpen = !!inspected;
  const reviews = data.reviews.filter(review => review.source !== 'student-support' && review.status !== 'cancelled')
    .sort((a, b) => reviewDate(a).localeCompare(reviewDate(b)));
  const reviewDays = [...new Set(reviews.map(reviewDate).filter(date => date.startsWith(String(year))))]
    .map(date => ({ date, items: reviews.filter(review => reviewDate(review) === date) }));
  const subjectHref = (id: string) => `/learner/modules/${kind}/${learnerId}?subject=${encodeURIComponent(id)}`;
  const calendarHref = (event: string) => `/learner/calendar?kind=${encodeURIComponent(kind)}&learner=${encodeURIComponent(learnerId)}&event=${encodeURIComponent(event)}`;
  const reviewStatus = (review: typeof reviews[number]) => ({ completed: 'Completed', scheduled: review.invited === false ? 'Booking pending' : 'Booked', 'not-scheduled': reviewDate(review) < today ? 'Overdue' : 'Not booked', 'awaiting-signature': 'Awaiting signatures', 'in-progress': 'In progress' }[review.status] || 'Not booked');
  const saveScroll = () => {
    if (plot.current && getComputedStyle(plot.current).display !== 'none') {
      scroll.current = { top: plot.current.scrollTop, left: plot.current.scrollLeft };
    }
  };
  const toggleFullscreen = () => { saveScroll(); placeholderHeight.current = root.current?.getBoundingClientRect().height || 640; setFullscreen(value => !value); };
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
      const todayPosition = barPosition(today, today, year)?.left || 0;
      chart.scrollLeft = Math.max(0, track.offsetLeft + track.offsetWidth * todayPosition / 100 - chart.clientWidth * .7);
    }
    setJumpId('');
  }, [jumpId, year, today, inspectorOpen, fullscreen]);

  const timeline = <section ref={root} id="module-timeline" className={`${styles.root} ${layout.root} ${fullscreen ? layout.expanded : ''}`} aria-label="Module timeline"
    onKeyDown={event => { if (event.key === 'Escape' && inspected) { event.stopPropagation(); closeInspector(); } }}>
    <header className={layout.toolbar}>
      <div className={layout.title}><h2>Module timeline</h2><span>{activeModules.length} modules · {year}</span></div>
      <div className={layout.actions}>
        <label>Year<select aria-label="Timeline year" value={year} onChange={event => selectMonth(`${event.target.value}-${selectedMonth.slice(5)}`)}>{years.map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" onClick={goToday}>Today</button>
        <button type="button" onClick={goCurrent}><LocateFixed size={15} />Current module</button>
        <button ref={fullButton} type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{fullscreen ? 'Exit full screen' : 'Full screen'}</span></button>
      </div>
    </header>
    {notice && <p role="status" className={layout.notice}>{notice}</p>}
    <div className={layout.caption}><div className={layout.legend}><span><i className={layout.inProgress} />In progress</span><span><i className={layout.completed} />Completed</span><span><i className={layout.notStarted} />Not started</span><span><i className={layout.todayKey} />Today</span></div><p>Select a bar to view module details.</p></div>
    <div className={`${layout.body} ${inspected ? layout.withInspector : ''}`}>
      <div ref={plot} className={layout.plot} tabIndex={0} aria-label="Scroll module timeline">
        <div className={layout.grid}>
          <div className={layout.chartHeader} data-timeline-header><div className={layout.moduleHeading}>Modules<span>Progress</span></div><div className={layout.months}>{monthNames.map((name, index) => {
            const key = `${year}-${String(index + 1).padStart(2, '0')}`;
            return <button type="button" key={key} className={key === selectedMonth ? layout.selectedMonth : ''} onClick={() => selectMonth(key)}
              aria-label={`${monthLabel(key)}${data.months[key]?.topics[0] ? ` — ${data.months[key].topics[0]}` : ''}`} aria-pressed={key === selectedMonth} title={data.months[key]?.topics.join(' · ')}><strong>{name}</strong><span>{data.months[key]?.topics[0] || ''}</span></button>;
          })}</div></div>
          {activeModules.map(module => {
            const position = barPosition(module.start, module.end, year);
            const status = moduleStatus(module);
            const tone = status === 'Completed' ? layout.completed : status === 'In progress' ? layout.inProgress : layout.notStarted;
            return <div key={module.id} data-module-id={module.id} className={`${layout.row} ${selectedId === module.id ? layout.selectedRow : ''}`}>
              <div className={layout.moduleLabel}><Link to={subjectHref(module.id)} title={module.title}>{module.title}</Link><span role="progressbar" aria-label={`${module.title} activity progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={module.progress}>{module.progress}%</span></div>
              <div className={layout.track} data-timeline-track>
                {monthNames.map((_, index) => <span key={index} className={`${layout.monthCell} ${selectedMonth === `${year}-${String(index + 1).padStart(2, '0')}` ? layout.selectedCell : ''}`} />)}
                {position ? <button type="button" className={`${layout.bar} ${tone}`} style={{ left: `${position.left}%`, width: `${position.width}%` }}
                  onClick={event => inspect(module, event.currentTarget)} aria-label={`Show ${module.title} overview`} aria-pressed={module.id === inspectedId} data-inspected={module.id === selectedId}
                  title={`${module.title} · ${dateLabel(module.start)} – ${dateLabel(module.end)} · ${status} · ${module.progress}% completed`}>
                  <span className={layout.barFill} style={{ width: `${module.progress}%` }} /><span className={layout.barCaption}>{dateLabel(module.start)} – {dateLabel(module.end)}</span>{status === 'Completed' && <CheckCircle2 size={12} />}
                </button> : <button type="button" className={layout.noDates} onClick={event => inspect(module, event.currentTarget)} aria-label={`Show ${module.title} overview`} data-inspected={module.id === selectedId}>Dates to be confirmed<ArrowRight size={12} /></button>}
                {Number(today.slice(0, 4)) === year && <span className={layout.todayLine} style={{ left: `${barPosition(today, today, year)?.left || 0}%` }} />}
              </div>
            </div>;
          })}
          {!activeModules.length && <p className={layout.empty}>No modules are scheduled for this year.</p>}
          {!!reviewDays.length && <div className={layout.reviewRow}><div className={layout.reviewLabel}><CalendarDays size={15} /><strong>Coaching reviews</strong><span>{reviewDays.reduce((sum, day) => sum + day.items.length, 0)}</span></div><div className={layout.track}>
            {monthNames.map((_, index) => <span key={index} className={layout.monthCell} />)}
            {reviewDays.map(day => <Link key={day.date} className={layout.reviewMarker} to={calendarHref(day.items[0].eventKey)} style={{ left: `clamp(14px, ${barPosition(day.date, day.date, year)?.left || 0}%, calc(100% - 14px))` }}
              aria-label={`${day.items.map(review => review.title).join(', ')} on ${dateLabel(day.date)}`} title={`${dateLabel(day.date)} · ${day.items.map(review => `${review.title}: ${reviewStatus(review)}`).join(' · ')}`}><CalendarDays size={13} />{day.items.length > 1 && <small>{day.items.length}</small>}</Link>)}
          </div></div>}
        </div>
      </div>
      {inspected && <TimelineInspector module={inspected} coach={data.coach.name} href={subjectHref(inspected.id)} onClose={closeInspector} />}
    </div>
  </section>;
  return fullscreen ? <><div aria-hidden="true" style={{ height: placeholderHeight.current }} /><Modal title="Programme timeline" size="max-w-none" className={layout.fullscreen} onClose={() => { saveScroll(); setFullscreen(false); }} returnFocusRef={fullButton}>
    <div className={`dashboard-theme ${layout.fullscreenTheme}`} data-workspace-role="learner">{timeline}</div>
  </Modal></> : timeline;
}
