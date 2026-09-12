import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, X } from 'lucide-react';
import type { TimelineModule } from './model';
import { dateLabel, hours, moduleStatus, sessionTime } from './presentation';
import layout from './ModuleTimeline.module.css';

export function TimelineInspector({ module, coach, href, onClose }: { module: TimelineModule; coach: string; href: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, [module.id]);
  return <aside className={layout.inspector} aria-label="Timeline module details">
    <header><span>Module details</span><button ref={close} type="button" aria-label="Close module details" onClick={onClose}><X size={17} /></button></header>
    <div className={layout.inspectorContent}>
      <span className={layout.status}>{moduleStatus(module)}</span><h3>{module.title}</h3>
      {module.detail?.description && <p className={layout.description}>{module.detail.description}</p>}
      <div className={layout.progressHeading}><span>Activity progress</span><strong>{module.progress}%</strong></div>
      <div className={layout.inspectorMeter}><span style={{ width: `${module.progress}%` }} /></div>
      <p className={layout.muted}>{module.done} of {module.activityCount} activities completed</p>
      <dl className={layout.facts}>
        <div><dt>Start date</dt><dd>{dateLabel(module.start)}</dd></div><div><dt>End date</dt><dd>{dateLabel(module.end)}</dd></div>
        <div><dt>Teaching weeks</dt><dd>{module.weeks || '—'}</dd></div><div><dt>Recorded hours</dt><dd>{hours(module.actual)}</dd></div>
        <div><dt>Coach</dt><dd>{module.detail?.coach_name || coach || 'To be assigned'}</dd></div><div><dt>Tutor</dt><dd>{module.detail?.tutor_name || 'To be assigned'}</dd></div>
      </dl>
      <h4>Live sessions <span>{module.sessions.length}</span></h4>
      {module.sessions.length ? <ul className={layout.sessions}>{[...module.sessions].sort((a, b) => a.start.localeCompare(b.start)).map(session => <li key={session.id}><CalendarDays size={14} /><div><strong>{session.title}</strong><span>{sessionTime(session.start)} · UK time</span><span>{session.minutes} min{session.attended === true ? ' · Attended' : session.attended === false ? ' · Not attended' : ''}</span></div></li>)}</ul> : <p className={layout.muted}>No live sessions scheduled yet.</p>}
      {!!module.activities.length && <><h4>Activities</h4><ul className={layout.activities}>{module.activities.slice(0, 5).map(activity => <li key={activity.id}><span>{activity.title}</span><small>{activity.completed ? 'Completed' : 'Pending'}</small></li>)}</ul>{module.activityCount > 5 && <p className={layout.muted}>Open the module to view all {module.activityCount} activities.</p>}</>}
    </div>
    <footer><Link to={href}>Open module<ArrowRight size={15} /></Link></footer>
  </aside>;
}
