import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CalendarEventDialog } from '@/components/feature/CalendarEventDialog';
import { AppIcon } from '@/components/feature/AppIcon';
import type { ProgrammeTimelineRun } from './ProgrammeDeliveryTimeline';
import { programmeColorText } from '../shared/programmeColors';
import styles from './ProgrammeTimelineModule.module.css';

export interface ProgrammeTimelineDetails {
  tutor?: string;
  coach?: string;
  schedule?: string;
  sessionCount?: number;
  holidays?: Array<{ id: string | number; label: string; startDate: string; endDate: string; type?: string }>;
  sessions?: Array<{ id: string; title: string; date: string; skippedHolidays?: string[] }>;
  overviewHref?: string;
  onEditSchedule?: () => void;
}

const dateLabel = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Not recorded';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'Not recorded';
};

export function ProgrammeTimelineModule({ run, className, style, dateDescription, color }: {
  run: ProgrammeTimelineRun;
  className: string;
  style: CSSProperties;
  dateDescription: string;
  color?: string;
}) {
  const [preview, setPreview] = useState<CSSProperties | null>(null);
  const [choosing, setChoosing] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressFocus = useRef(false);
  const previewId = useId();
  const cancelClose = () => clearTimeout(closing.current);
  const closeSoon = () => { cancelClose(); closing.current = setTimeout(() => setPreview(null), 150); };
  const showPreview = () => {
    cancelClose();
    if (choosing) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 24);
    const rightFits = rect.right + width + 12 <= window.innerWidth;
    const leftFits = rect.left - width - 8 >= 12;
    const below = window.innerHeight - rect.bottom - 20;
    if (rightFits || leftFits) {
      const left = rightFits ? rect.right + 8 : rect.left - width - 8;
      setPreview(window.innerHeight - rect.top >= 240
        ? { left, top: rect.top, width, maxHeight: Math.min(620, window.innerHeight - rect.top - 12) }
        : { left, bottom: Math.max(12, window.innerHeight - rect.bottom), width, maxHeight: Math.min(620, rect.bottom - 12) });
    } else {
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      // A wide bar/narrow viewport leaves no side room. Anchor above/below
      // the bar so the preview never blocks the click that opens the chooser.
      setPreview(below >= 240
        ? { left, top: rect.bottom + 8, width, maxHeight: Math.min(620, below) }
        : { left, bottom: window.innerHeight - rect.top + 8, width, maxHeight: Math.min(620, Math.max(100, rect.top - 20)) });
    }
  };

  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (!preview) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setPreview(null);
    };
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) setPreview(null); };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [preview]);

  const closeChoices = () => { suppressFocus.current = true; setChoosing(false); setPreview(null); };
  return <>
    <Link ref={trigger} to={run.href} className={className} style={{ ...style, ...(color ? { backgroundColor: color, borderColor: color, color: programmeColorText(color) } : {}) }}
      aria-haspopup="dialog" aria-expanded={choosing || Boolean(preview)} aria-describedby={preview ? previewId : undefined}
      onMouseEnter={showPreview} onMouseLeave={closeSoon}
      onFocus={() => { if (suppressFocus.current) suppressFocus.current = false; else showPreview(); }}
      onBlur={closeSoon}
      onClick={event => {
        // Preserve open-in-new-tab and the existing catalogue URL.
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); cancelClose(); setPreview(null); setChoosing(true);
      }}>
      {run.name}<span className={styles.srOnly}> · {dateDescription}</span>
    </Link>
    {preview && !choosing && createPortal(<div ref={panel} id={previewId} role="dialog" aria-label={`${run.name} details`}
      className={styles.preview} style={preview} onMouseEnter={cancelClose} onMouseLeave={closeSoon}
      onFocusCapture={cancelClose} onBlurCapture={closeSoon}>
      <header style={color ? { backgroundColor: color, color: programmeColorText(color) } : undefined}><strong>{run.name}</strong><button type="button" aria-label="Close module details" onClick={() => setPreview(null)}>×</button></header>
      <div className={styles.body}>
        <p className={styles.context}>{[run.group, run.cohort].filter(Boolean).join(' · ') || 'No group or cohort recorded'}</p>
        <dl>
          <div><dt>Tutor / Lecturer</dt><dd>{run.tutor?.trim() || 'Not assigned'}</dd></div>
          <div><dt>Coach</dt><dd>{run.coach?.trim() || 'Not assigned'}</dd></div>
          <div><dt>Dates</dt><dd>{dateLabel(run.startDate)} → {dateLabel(run.endDate)}</dd></div>
          <div><dt>Schedule</dt><dd>{run.schedule?.trim() || 'Not recorded'}</dd></div>
        </dl>
        <div className={styles.totals}>
          <div><span>Module sessions</span><strong>{Number.isFinite(run.sessionCount) && run.sessionCount! >= 0 ? run.sessionCount : 'Not recorded'}</strong></div>
          <div><span>Module holiday records</span><strong>{run.holidays?.length ?? 'Not included'}</strong></div>
        </div>
        {run.holidays?.map(holiday => {
          // Describe stored dates/flags only; never derive a replacement date,
          // session number or holiday extension from a calendar overlap.
          const recorded = (run.sessions || []).filter(session => session.skippedHolidays?.some(date => date >= holiday.startDate && date <= holiday.endDate));
          return <section key={holiday.id} className={styles.holiday}>
            <strong>{holiday.label || 'Unnamed holiday'}</strong>
            {holiday.type && <small>{holiday.type}</small>}
            <p>{dateLabel(holiday.startDate)} – {dateLabel(holiday.endDate)}</p>
            {recorded.length > 0 && <><h4>Sessions with recorded holiday flags</h4>{recorded.map(session => <p key={session.id}>{session.title || 'Session'} · {dateLabel(session.date)}</p>)}</>}
          </section>;
        })}
        <p className={styles.note}>Holiday effects and replacement dates are not included in these records. Open Module Overview for the full schedule.</p>
      </div>
    </div>, document.body)}
    {choosing && <CalendarEventDialog title="Choose What To Edit" onClose={closeChoices}
      badges={<span>{[run.group, run.cohort, run.name].filter(Boolean).join(' · ')}</span>}>
      <div className={styles.choices}>
        <button type="button" disabled={!run.onEditSchedule} onClick={() => {
          closeChoices(); run.onEditSchedule?.();
        }}>
          <span className={styles.choiceIcon}><AppIcon className="ri-calendar-line" /></span><strong>Edit schedule assignment</strong>
          <span>Open the existing module form for this placement’s dates and tutor. Coach and delivery times belong to its group.</span>
          <small>{run.onEditSchedule ? [run.group, run.cohort].filter(Boolean).join(' · ') : 'No editable placement record is available.'}</small>
        </button>
        <Link to={run.href} onClick={closeChoices}>
          <span className={styles.choiceIcon}><AppIcon className="ri-stack-line" /></span><strong>Edit module catalogue</strong>
          <span>Open Module Builder for the shared module content, weeks and components.</span><small>{run.name}</small>
        </Link>
        {run.overviewHref ? <Link to={run.overviewHref} onClick={closeChoices}>
          <span className={styles.choiceIcon}><AppIcon className="ri-layout-grid-line" /></span><strong>Module Overview</strong>
          <span>View its schedule, sessions, holidays and KSB details in the existing module workspace.</span>
          <small>{dateLabel(run.startDate)} – {dateLabel(run.endDate)}</small>
        </Link> : <button type="button" disabled><span className={styles.choiceIcon}><AppIcon className="ri-layout-grid-line" /></span><strong>Module Overview</strong><span>No module workspace identity is available.</span></button>}
      </div>
    </CalendarEventDialog>}
  </>;
}
