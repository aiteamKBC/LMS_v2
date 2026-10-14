import { useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, Maximize2, Minimize2, MessageSquareText } from 'lucide-react';
import { Modal } from '@/pages/users/components/Modal';
import type { LearningPlanProjection } from '@/features/coach/case-file/hooks/useCaseFileLearningPlan';
import { barPosition, weeklyPosition, timelineMonthKeys, timelineWeekKeys, timelinePeriodYear, timelineYears } from '@/pages/learner/training-plan-timeline/model';
import { dateLabel, monthLabel } from '@/pages/learner/training-plan-timeline/presentation';
import layout from '@/pages/learner/training-plan-timeline/ModuleTimeline.module.css';

/** Same timeline geometry/styles, with compact facts and read-only selection. */
export function CaseFileTimeline({ timeline, selectedId, onSelect }: { timeline: LearningPlanProjection['timeline']; selectedId: string; onSelect: (id: string) => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<'month' | 'week'>('month');
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const startMonth = timeline.periodStart ? Number(timeline.periodStart.slice(5, 7)) - 1 : 0;
  const year = Math.max(Number(timeline.periodStart?.slice(0, 4)) || 0, timelinePeriodYear(month, startMonth));
  const months = timelineMonthKeys(year, startMonth);
  const selected = timeline.modules.find(module => module.id === selectedId) || timeline.modules[0];
  const firstAnchor = timeline.modules.map(module => module.weekAnchor || module.startDate).filter(Boolean).sort()[0];
  const anchor = selected?.weekAnchor || selected?.startDate || firstAnchor || timeline.periodStart && `${timeline.periodStart}-01` || `${year}-01-01`;
  const weeks = timelineWeekKeys(year, startMonth, anchor);
  const years = timelineYears([...(timeline.periodStart ? [`${timeline.periodStart}-01`] : []), ...(timeline.periodEnd ? [`${timeline.periodEnd}-01`] : [])], Number(today.slice(0, 4)), year);
  const position = (start: string | null, end: string | null) => view === 'week' ? weeklyPosition(start || '', end || '', anchor, weeks.length) : barPosition(start || '', end || '', year, startMonth);
  const current = timeline.modules.find(module => module.startDate && module.startDate <= today && (module.endDate || '') >= today && module.status !== 'completed');
  const reviewDays = [...new Set(timeline.reviews.map(review => review.date).filter(date => position(date, date)))].sort().map(date => ({ date, items: timeline.reviews.filter(review => review.date === date) }));
  const reviewStatus = (review: LearningPlanProjection['timeline']['reviews'][number]) => ({ completed: 'Completed', scheduled: review.invited === false ? 'Booking pending' : 'Booked', 'not-scheduled': review.date < today ? 'Overdue' : 'Not booked', 'awaiting-signature': 'Awaiting signatures', 'in-progress': 'In progress' }[review.status] || 'Not booked');
  const statusLabel = (status: string) => ({ completed: 'Completed', 'in-progress': 'In progress', 'not-started': 'Not started' }[status] || status);
  const period = startMonth ? `${monthLabel(months[0])} – ${monthLabel(months[11])}` : String(year);
  const chart = <section id="module-timeline" className={`${layout.root} ${fullscreen ? layout.expanded : ''}`} aria-label="Module timeline">
    <header className={layout.toolbar}><div className={layout.title}><h2>Module timeline</h2><span>{timeline.modules.length} assigned modules · {timeline.modules.filter(module => position(module.startDate, module.endDate)).length} scheduled in {period}</span></div>
      <div className={layout.actions}><div className={layout.viewToggle} role="group" aria-label="Timeline view">{(['month', 'week'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'month' ? 'Month' : 'Week'}</button>)}</div>
        <label>{startMonth ? 'Period' : 'Year'}<select aria-label="Timeline year" value={year} onChange={event => setMonth(`${event.target.value}-${String(startMonth + 1).padStart(2, '0')}`)}>{years.map(value => <option key={value} value={value}>{startMonth ? `${value}–${value + 1}` : value}</option>)}</select></label>
        <button type="button" onClick={() => setMonth(today.slice(0, 7))}>Today</button><button type="button" onClick={() => { if (current) { onSelect(current.id); setMonth(today.slice(0, 7)); } else setNotice('No unfinished module is scheduled for today.'); }}>Current module</button>
        <button ref={trigger} type="button" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => setFullscreen(value => !value)}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{fullscreen ? 'Exit full screen' : 'Full screen'}</span></button>
      </div></header>
    {notice && <p role="status" className={layout.notice}>{notice}</p>}
    <div className={layout.caption}><div className={layout.legend}><span><i className={layout.inProgress} />In progress</span><span><i className={layout.completed} />Completed</span><span><i className={layout.notStarted} />Not started</span><span><i className={layout.todayKey} />Today</span></div><p>Select a bar to view module details.</p></div>
    <div className={layout.body} style={{ '--timeline-content-height': `${76 + Math.max(1, timeline.modules.length) * 52 + (timeline.reviews.length ? 50 : 0)}px` } as CSSProperties}>
      <div ref={plot} className={layout.plot} tabIndex={0} aria-label="Scroll module timeline"
        onPointerDown={event => { if (event.button || (event.target as Element).closest('button,select,input,a')) return; const node = event.currentTarget; pan.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }; node.setPointerCapture?.(event.pointerId); }}
        onPointerMove={event => { if (pan.current && plot.current) { plot.current.scrollLeft = pan.current.left - event.clientX + pan.current.x; plot.current.scrollTop = pan.current.top - event.clientY + pan.current.y; } }}
        onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}>
        <div className={`${layout.grid} ${view === 'week' ? layout.weekGrid : ''}`} style={view === 'week' ? { minWidth: `calc(var(--label-width) + ${weeks.length * 44}px)` } : undefined}>
          <div className={layout.chartHeader}><div className={layout.moduleHeading}>Modules<span>Progress</span></div><div className={view === 'month' ? layout.months : layout.weeks} style={view === 'week' ? { gridTemplateColumns: `repeat(${weeks.length}, minmax(44px, 1fr))` } : undefined}>{(view === 'month' ? months : weeks).map((key, index) => <button type="button" key={key} onClick={() => setMonth(key.slice(0, 7))}>{view === 'month' ? new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : <><strong>W{index + 1}</strong><small>{dateLabel(key)}</small></>}</button>)}</div></div>
          {timeline.modules.map(module => { const range = position(module.startDate, module.endDate); const status = statusLabel(module.status); return <div key={module.id} className={layout.row} data-module-id={module.id}>
            <div className={layout.moduleLabel}><button type="button" onClick={() => onSelect(module.id)} title={module.title}>{module.title}</button><span role="progressbar" aria-label={`${module.title} activity progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={module.progressPercent ?? undefined} aria-valuetext={module.progressPercent == null ? 'Progress unavailable' : `${Math.round(module.progressPercent)}%`}>{module.progressPercent == null ? '—' : `${Math.round(module.progressPercent)}%`}</span></div>
            <div className={layout.track}>{(view === 'month' ? months : weeks).map(key => <span key={key} className={`${layout.monthCell} ${view === 'month' && month === key ? layout.selectedCell : ''}`} />)}{range ? <button type="button" className={`${layout.bar} ${module.status === 'completed' ? layout.completed : module.status === 'in-progress' ? layout.inProgress : layout.notStarted}`} style={{ left: `${range.left}%`, width: `${range.width}%` }}
              onClick={() => onSelect(module.id)} aria-label={`Show ${module.title} overview`} aria-pressed={selectedId === module.id}
              title={`${module.title} · ${dateLabel(module.startDate || '')} – ${dateLabel(module.endDate || '')} · ${status} · ${module.progressPercent == null ? 'Progress unavailable' : `${Math.round(module.progressPercent)}% completed`}`}>
              <span className={layout.barFill} style={{ width: `${module.progressPercent || 0}%` }} /><span className={layout.barCaption}>{dateLabel(module.startDate || '')} – {dateLabel(module.endDate || '')}</span>
            </button> : <button type="button" className={layout.noDates} onClick={() => onSelect(module.id)}>Dates to be confirmed</button>}
              {module.notes?.map(note => { const point = position(note.date, note.date); return point ? <span key={`${note.slotNumber}-${note.date}`} className={layout.weekNoteMarker} role="img" tabIndex={0} aria-label={`Week ${note.slotNumber} note`} style={{ left: `${point.left}%` }}><MessageSquareText size={12} /><span className={layout.weekNoteTooltip} role="tooltip"><span className={layout.weekNoteTooltipHeader}>Reading Week</span><span className={layout.weekNoteTooltipBody}><strong>Week {note.slotNumber}{note.weekTitle ? ` \u00b7 ${note.weekTitle}` : ''}</strong>{note.holidays?.map((holiday, index) => <span key={index} className={layout.weekNoteHoliday}>{holiday.label}{'\u00b7'} {dateLabel(holiday.startDate)}{holiday.endDate && holiday.endDate !== holiday.startDate ? ` \u2013 ${dateLabel(holiday.endDate)}` : ''}{holiday.type ? ` \u00b7 ${holiday.type}` : ''}{holiday.notes ? ` \u00b7 ${holiday.notes}` : ''}</span>)}<span><strong>From your curriculum team:</strong> {note.holidayNote}</span></span></span></span> : null; })}{position(today, today) && <span className={layout.todayLine} style={{ left: `${position(today, today)!.left}%` }} />}</div>
          </div>; })}
          {!timeline.modules.length && <p className={layout.empty}>Your modules will appear here when they are assigned.</p>}
          {!!reviewDays.length && <div className={layout.reviewRow}><div className={layout.reviewLabel}><CalendarDays size={15} /><strong>Coaching reviews</strong><span>{reviewDays.reduce((sum, day) => sum + day.items.length, 0)}</span></div><div className={layout.track}>{(view === 'month' ? months : weeks).map(key => <span key={key} className={layout.monthCell} />)}{reviewDays.map(day =>
            <span key={day.date} className={layout.reviewMarker} tabIndex={0} role="img" aria-label={`${day.items.map(review => review.title || review.type).join(', ')} on ${dateLabel(day.date)}`} style={{ left: `clamp(14px, ${position(day.date, day.date)!.left}%, calc(100% - 14px))` }} title={`${dateLabel(day.date)} \u00b7 ${day.items.map(review => `${review.title || review.type}: ${reviewStatus(review)}`).join(' \u00b7 ')}`}><CalendarDays size={14} />{day.items.length > 1 && <small>{day.items.length}</small>}</span>
          )}</div></div>}
        </div>
      </div>
    </div>
  </section>;
  return fullscreen ? <Modal title="Module timeline" onClose={() => setFullscreen(false)} size="max-w-none" className={layout.fullscreen} returnFocusRef={trigger}>{chart}</Modal> : chart;
}
