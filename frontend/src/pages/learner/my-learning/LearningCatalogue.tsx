import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ClipboardList, Clock3, Headphones, LayoutGrid, List, Map, Search, Trophy } from 'lucide-react';
import type { Subject, UnifiedLearningSummary } from './SubjectWorkspace';
import type { OverviewWeek } from '@/api/learnerOverview';
import type { PlanSession } from '@/api/trainingPlanDashboard';
import { formatSystemTimestamp } from '@/lib/format';
import { sessionDay } from '@/pages/learner/training-plan-timeline/model';
import { learningDate, learningHref, learningToday, subjectPercent } from './subjectLearning';
import { DEFAULT_MODULE_COVER } from './moduleCover';
import styles from './SubjectWorkspace.module.css';

function assignmentsHref(kind?: string, learnerId?: string) {
  return `${learningHref('catalogue', kind, learnerId)}?tab=assignments`;
}

function deadlineHref(item: OverviewWeek['deadlines'][number], kind?: string, learnerId?: string) {
  const componentId = item.id.startsWith('native:') ? item.id.slice('native:'.length) : '';
  return componentId && kind && learnerId
    ? `/learner/component/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}/${encodeURIComponent(componentId)}`
    : item.type === 'checkpoint' ? learningHref('catalogue', kind, learnerId, item.subjectId)
      : assignmentsHref(kind, learnerId);
}

function sessionHref(session: PlanSession, subjects: Subject[], kind?: string, learnerId?: string) {
  const moduleActivities = subjects.flatMap(subject => subject.activities).filter(activity =>
    activity.native?.componentId && activity.native.moduleId === session.moduleId
    && activity.native.type?.replace('-', '_') === 'live_session');
  const linked = moduleActivities.filter(activity => activity.native?.teamsLiveSessionId === session.id);
  const start = Date.parse(session.start);
  const exact = moduleActivities.filter(activity => Date.parse(activity.native?.sessionDateTimeUtc || '') === start);
  const day = sessionDay(session.start);
  const dated = moduleActivities.filter(activity => activity.schedule.date === day || activity.native?.sessionDate === day);
  const match = linked.length === 1 ? linked[0] : exact.length === 1 ? exact[0] : dated.length === 1 ? dated[0] : null;
  if (match?.native?.componentId && kind && learnerId) {
    return `/learner/component/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}/${encodeURIComponent(match.native.componentId)}?week=${encodeURIComponent(match.week || '')}`;
  }
  const subject = subjects.find(item => item.activities.some(activity => activity.native?.moduleId === session.moduleId));
  return learningHref('catalogue', kind, learnerId, subject?.id);
}

function sessionStartMs(start: string) {
  if (!start.includes('T')) return Date.parse(start);
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(start) ? start : `${start}Z`);
}

export function LearningHero({ map = false }: { map?: boolean }) {
  return <header className={styles.hero}>
    <div className={styles.heroIntro}><p className={styles.eyebrow}>{map ? 'Learning journey' : 'Your learner workspace'}</p>
      <h1>{map ? 'Your week-by-week timeline' : 'My Learning'}</h1>
      <p>{map ? 'Explore your module, open a week and work through your learning materials.' : 'Your subjects, activities and progress. Every step brings you closer.'}</p>
    </div>
    <div className={styles.heroJourney}>
      <p>Your learning journey<br /><strong>builds a brighter tomorrow.</strong></p>
      <span className={styles.heroTag} aria-hidden="true">LEARN<br />GROW<br />ACHIEVE</span>
      <div className={styles.journeyDots} aria-hidden="true"><i /><span /><i /><span /><i /></div>
    </div>
  </header>;
}

export function LearningCatalogue({ summary, search, onSearch, current, renderCard, onContinue, moduleStartDate, kind, learnerId, total, done, percent, deadlines = [], covers = {}, upcomingSessions = [] }: {
  summary: UnifiedLearningSummary; search: string; onSearch: (value: string) => void; current?: Subject;
  renderCard: (subject: Subject) => ReactNode; onContinue: (subject: Subject) => void;
  moduleStartDate: (subject: Subject) => string | null | undefined; kind?: string; learnerId?: string;
  total: number | string; done: number | string; percent: number | null;
  deadlines?: OverviewWeek['deadlines']; covers?: Record<string, string>; upcomingSessions?: PlanSession[];
}) {
  const [filter, setFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | Subject['source']>('all');
  const [sort, setSort] = useState('start');
  const [layout, setLayout] = useState('list');
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const term = search.trim().toLocaleLowerCase();
  const visible = summary.subjects.filter(subject => {
    const progress = subjectPercent(subject);
    return (!term || subject.title.toLocaleLowerCase().includes(term) || subject.activities.some(a => a.title.toLocaleLowerCase().includes(term)))
      && (sourceFilter === 'all' || subject.source === sourceFilter)
      && (filter === 'all' || (filter === 'complete' ? progress === 100 : filter === 'new' ? progress === 0 : progress > 0 && progress < 100));
  }).sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title);
    if (sort === 'progress') return subjectPercent(b) - subjectPercent(a) || a.title.localeCompare(b.title);
    const aStart = moduleStartDate(a)?.trim();
    const bStart = moduleStartDate(b)?.trim();
    if (aStart && bStart) return aStart.localeCompare(bStart) || a.title.localeCompare(b.title);
    if (aStart) return -1;
    if (bStart) return 1;
    return a.title.localeCompare(b.title);
  });
  const today = learningToday();
  const upcoming = [
    ...deadlines.filter(item => item.date >= today).map(item => ({
      id: `deadline:${item.id}`, title: item.title, detail: item.type === 'assignment' ? 'Assignment due' : 'Checkpoint',
      date: item.date, sortDate: Date.parse(item.date), href: deadlineHref(item, kind, learnerId), type: item.type, online: false,
    })),
    ...upcomingSessions.filter(item => item.start && !['cancelled', 'canceled', 'completed', 'deleted', 'failed', 'superseded'].includes(item.status?.toLowerCase() || '')
      && (item.start.length === 10 ? item.start >= today : sessionStartMs(item.start) >= Date.now())).map(item => ({
      id: `session:${item.id}`, title: item.title, detail: 'Live session', date: item.start,
      sortDate: sessionStartMs(item.start), href: sessionHref(item, summary.subjects, kind, learnerId),
      type: 'session', online: Boolean(item.joinUrl),
    })),
  ].sort((a, b) => a.sortDate - b.sortDate);
  const hasRemainingActivity = (subject: Subject) => subject.activities.some(activity => !activity.completed);
  const continueSubject = current && hasRemainingActivity(current)
    ? current
    : summary.subjects.find(hasRemainingActivity);

  return <div className={styles.catalogueLayout}>
    <div className={styles.catalogueMain}>
      <div className={styles.stats}>
        {[{ label: 'Total subjects', value: summary.subjectCount, caption: 'Across your programme', icon: BookOpen, tone: 'purple' },
          { label: 'Learning activities', value: total, caption: 'Activities and resources', icon: ClipboardList, tone: 'purple' },
          { label: 'Completed activities', value: done, caption: 'Keep going!', icon: CheckCircle2, tone: 'green' }].map(({ label, value, caption, icon: Icon, tone }) =>
          <div className={styles.stat} key={label}><span className={styles.statIcon} data-tone={tone}><Icon size={22} strokeWidth={1.9} /></span><div><strong>{value}</strong><p>{label}</p><small>{caption}</small></div></div>)}
        <div className={styles.stat}><div className={styles.progressRing} role="progressbar" aria-label="Overall learning progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent == null ? 'Unavailable' : `${percent}%`} style={{ background: `conic-gradient(var(--learner-purple, #673ab7) ${percent ?? 0}%, #edf0f5 0)` }}><span /></div><div><strong>{percent == null ? '—' : `${Math.round(percent)}%`}</strong><p>Overall progress</p><small>{done} of {total} activities completed</small></div></div>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.sourceTabs} role="tablist" aria-label="Module source">
          <button type="button" role="tab" aria-selected={sourceFilter === 'all'} onClick={() => setSourceFilter('all')}>All modules</button>
          <button type="button" role="tab" aria-selected={sourceFilter === 'current'} onClick={() => setSourceFilter('current')}>New LMS</button>
          <button type="button" role="tab" aria-selected={sourceFilter === 'legacy'} onClick={() => setSourceFilter('legacy')}>Old LMS</button>
        </div>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input aria-label="Search modules or activities" placeholder="Search subjects or activities…" value={search} onChange={e => onSearch(e.target.value)} /></label>
        <label className={styles.selectLabel}>Status<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All modules</option><option value="started">In progress</option><option value="new">Not started</option><option value="complete">Completed</option></select></label>
        <label className={styles.selectLabel}>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="start">Module start date</option><option value="name">Subject name</option><option value="progress">Highest progress</option></select></label>
        <div className={styles.viewToggle} role="group" aria-label="Subject layout"><button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={16} />List</button><button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={16} />Grid</button></div>
      </div>
      <div className={styles.subjectHeading}><h2>Your subjects</h2><span>{summary.subjectCount} subjects · {total} activities{visible.length !== summary.subjectCount ? ` · ${visible.length} shown` : ''}</span></div>
      {visible.length ? <div className={layout === 'grid' ? styles.grid : styles.list}>{visible.map(renderCard)}</div>
        : <div className={styles.empty}><BookOpen size={30} /><p>{summary.subjectCount ? 'No subjects or activities match your filters.' : 'Your subjects will appear here when they are assigned.'}</p>{summary.subjectCount > 0 && <button onClick={() => { onSearch(''); setSourceFilter('all'); setFilter('all'); }}>Clear filters</button>}</div>}
    </div>
    <aside className={styles.catalogueAside} aria-label="Learning shortcuts">
      {continueSubject && <section className={styles.asidePanel}><div className={styles.asideHeading}><h2><BookOpen size={19} />Continue learning</h2><button type="button" className={styles.asideTextButton} onClick={() => onContinue(continueSubject)}>Open<ArrowRight size={14} /></button></div><div className={styles.continueSubject}><img src={covers[continueSubject.id] || DEFAULT_MODULE_COVER} alt="" loading="lazy" className={covers[continueSubject.id] ? undefined : styles.defaultCoverImage} /><div><strong>{continueSubject.title}</strong><p>{continueSubject.activities.filter(item => item.completed).length} of {continueSubject.activities.length} activities</p><div className={styles.miniTrack}><span style={{ width: `${subjectPercent(continueSubject)}%` }} /></div></div><b>{subjectPercent(continueSubject)}%</b></div><button type="button" className={styles.primaryButton} onClick={() => onContinue(continueSubject)}>Continue learning<ArrowRight size={17} /></button></section>}
      <section className={styles.asidePanel}><div className={styles.asideHeading}><h2><CalendarDays size={19} />Upcoming</h2>{upcoming.length > 3 && <button type="button" className={styles.asideTextButton} aria-expanded={showAllUpcoming} onClick={() => setShowAllUpcoming(value => !value)}>{showAllUpcoming ? 'Show less' : 'View all'}<ArrowRight size={14} /></button>}</div>
        {upcoming.length ? (showAllUpcoming ? upcoming : upcoming.slice(0, 3)).map(item => <Link className={styles.deadline} key={item.id} to={item.href}><span className={styles.deadlineIcon} data-kind={item.type}>{item.type === 'session' ? <CalendarDays size={18} /> : <ClipboardList size={18} />}</span><div><strong>{item.title}</strong><small>{item.detail} · {item.type === 'session' ? formatSystemTimestamp(item.date, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : learningDate(item.date)}</small></div>{item.online && <span className={styles.onlineBadge}>Online</span>}</Link>) : <p className={styles.asideEmpty}>No upcoming sessions or deadlines.</p>}
      </section>
      <Link className={styles.mapShortcut} to={learningHref('map', kind, learnerId)}><Map size={25} /><div><strong>Learner’s Map</strong><span>See your learning week by week</span></div><ArrowRight size={18} /></Link>
      <section className={styles.asidePanel}><h2><Headphones size={19} />Need help?</h2><nav className={styles.helpLinks} aria-label="Learning help"><Link to="/learner/calendar?book=student-support"><CalendarDays size={16} />Book a tutor meeting<ArrowRight size={15} /></Link><Link to="/learner/knowledge-base"><Clock3 size={16} />Visit the help centre<ArrowRight size={15} /></Link><Link to="/learner/support?action=new-ticket&category=learning"><Headphones size={16} />Contact student support<ArrowRight size={15} /></Link></nav></section>
      <div className={styles.encouragement}><Trophy size={30} strokeWidth={1.8} /><div><strong>Consistency leads to progress.</strong><p>Keep going!</p></div></div>
    </aside>
  </div>;
}
