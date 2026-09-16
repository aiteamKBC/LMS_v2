import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ClipboardList, LayoutGrid, List, Map, Search, Sprout } from 'lucide-react';
import type { Subject, UnifiedLearningSummary } from './SubjectWorkspace';
import type { OverviewWeek } from '@/api/learnerOverview';
import { learningDate, learningHref, learningToday, subjectPercent } from './subjectLearning';
import styles from './SubjectWorkspace.module.css';

function assignmentsHref(kind?: string, learnerId?: string) {
  return `${learningHref('catalogue', kind, learnerId)}?tab=assignments`;
}

function deadlineHref(item: OverviewWeek['deadlines'][number], kind?: string, learnerId?: string) {
  const componentId = item.type === 'assignment' && item.id.startsWith('native:') ? item.id.slice('native:'.length) : '';
  return componentId && kind && learnerId
    ? `/learner/monthly-submission/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}/${encodeURIComponent(componentId)}`
    : assignmentsHref(kind, learnerId);
}

export function LearningHero({ map = false }: { map?: boolean }) {
  return <header className={styles.hero}>
    <div><p className={styles.eyebrow}>{map ? 'Learning journey' : 'Your learner workspace'}</p>
      <h1>{map ? 'Your week-by-week timeline' : 'My Learning'}</h1>
      <p>{map ? 'Explore your module, open a week and work through your learning materials.' : 'Your subjects, activities and progress. Every step brings you closer.'}</p>
    </div>
    <div className={styles.heroJourney} aria-hidden="true"><span className={styles.heroIcon}><Map size={32} strokeWidth={1.4} /></span><p>Your learning journey<br /><strong>builds a brighter tomorrow.</strong></p><div className={styles.journeyDots}><i /><span /><i /><span /><i /></div></div>
  </header>;
}

export function LearningCatalogue({ summary, search, onSearch, current, renderCard, onContinue, kind, learnerId, total, done, percent, deadlines = [] }: {
  summary: UnifiedLearningSummary; search: string; onSearch: (value: string) => void; current?: Subject;
  renderCard: (subject: Subject) => ReactNode; onContinue: (subject: Subject) => void; kind?: string; learnerId?: string;
  total: number | string; done: number | string; percent: number | null;
  deadlines?: OverviewWeek['deadlines'];
}) {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('current');
  const [layout, setLayout] = useState('grid');
  const term = search.trim().toLocaleLowerCase();
  const visible = summary.subjects.filter(subject => {
    const progress = subjectPercent(subject);
    return (!term || subject.title.toLocaleLowerCase().includes(term) || subject.activities.some(a => a.title.toLocaleLowerCase().includes(term)))
      && (filter === 'all' || (filter === 'complete' ? progress === 100 : filter === 'new' ? progress === 0 : progress > 0 && progress < 100));
  }).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'progress' ? subjectPercent(b) - subjectPercent(a) || a.title.localeCompare(b.title)
    : Number(b.id === current?.id) - Number(a.id === current?.id) || a.title.localeCompare(b.title));
  const upcoming = deadlines.filter(d => d.date >= learningToday()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const hasRemainingActivity = (subject: Subject) => subject.activities.some(activity => !activity.completed);
  const continueSubject = current && hasRemainingActivity(current)
    ? current
    : summary.subjects.find(hasRemainingActivity);

  return <>
      <div className={styles.stats}>
        {[{ label: 'Total subjects', value: summary.subjectCount, caption: 'Across your programme', icon: BookOpen, tone: 'navy' },
          { label: 'Total activities', value: total, caption: 'Learning tasks and resources', icon: ClipboardList, tone: 'green' },
          { label: 'Completed activities', value: done, caption: 'Every step is progress', icon: CheckCircle2, tone: 'purple' }].map(({ label, value, caption, icon: Icon, tone }) =>
          <div className={styles.stat} key={label}><span className={styles.statIcon} data-tone={tone}><Icon size={25} strokeWidth={1.8} /></span><div><p>{label}</p><strong>{value}</strong><small>{caption}</small></div></div>)}
        <div className={styles.stat}><div className={styles.progressRing} role="progressbar" aria-label="Overall learning progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent == null ? 'Unavailable' : `${percent}%`} style={{ background: `conic-gradient(var(--learner-purple, #673ab7) ${percent ?? 0}%, #edf0f5 0)` }}><span>{percent == null ? '—' : `${Math.round(percent)}%`}</span></div><div><p>Overall progress</p><small>{done} of {total} activities completed</small></div></div>
      </div>
    <div className={styles.catalogueLayout}>
    <div className={styles.catalogueMain}>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={18} aria-hidden="true" /><input aria-label="Search modules or activities" placeholder="Search subjects or activities…" value={search} onChange={e => onSearch(e.target.value)} /></label>
        <label className={styles.selectLabel}>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="current">Planned module first</option><option value="name">Subject name</option><option value="progress">Highest progress</option></select></label>
        <label className={styles.selectLabel}>Filter by progress<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All subjects</option><option value="started">In progress</option><option value="new">Not started</option><option value="complete">Completed</option></select></label>
        <div className={styles.viewToggle} role="group" aria-label="Subject layout"><button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={16} />Grid</button><button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={16} />List</button></div>
      </div>
      <div className={styles.subjectHeading}><h2>Your subjects</h2><span>{summary.subjectCount} subjects · {total} activities{visible.length !== summary.subjectCount ? ` · ${visible.length} shown` : ''}</span></div>
      {visible.length ? <div className={layout === 'grid' ? styles.grid : styles.list}>{visible.map(renderCard)}</div>
        : <div className={styles.empty}><BookOpen size={30} /><p>{summary.subjectCount ? 'No subjects or activities match your filters.' : 'Your subjects will appear here when they are assigned.'}</p>{summary.subjectCount > 0 && <button onClick={() => { onSearch(''); setFilter('all'); }}>Clear filters</button>}</div>}
    </div>
    <aside className={styles.catalogueAside} aria-label="Learning shortcuts">
      {continueSubject && <section className={styles.asidePanel}><h2><BookOpen size={21} />Continue learning</h2><div className={styles.continueSubject}><span className={styles.statIcon} data-tone="purple"><BookOpen size={26} /></span><div><strong>{continueSubject.title}</strong><p>{subjectPercent(continueSubject)}% complete</p></div></div><div className={styles.miniTrack}><span style={{ width: `${subjectPercent(continueSubject)}%` }} /></div><button type="button" className={styles.primaryButton} onClick={() => onContinue(continueSubject)}>Continue learning<ArrowRight size={17} /></button></section>}
      <section className={styles.asidePanel}><div className={styles.asideHeading}><h2><CalendarDays size={21} />Upcoming deadlines</h2><Link to={assignmentsHref(kind, learnerId)} aria-label="View all assignments">View all<ArrowRight size={14} /></Link></div>
        {upcoming.length ? upcoming.map(item => <Link className={styles.deadline} key={item.id} to={deadlineHref(item, kind, learnerId)}><ClipboardList size={19} /><div><strong>{item.title}</strong><small>{summary.subjects.find(s => s.id === item.subjectId)?.title || (item.type === 'assignment' ? 'Assignment' : 'Checkpoint')}</small></div><time dateTime={item.date}>{learningDate(item.date)}</time></Link>) : <p className={styles.asideEmpty}>No upcoming deadlines. Keep exploring your subjects at your own pace.</p>}
      </section>
      <Link className={styles.mapShortcut} to={learningHref('map', kind, learnerId)}><Map size={25} /><div><strong>Learner’s Map</strong><span>See your learning week by week</span></div><ArrowRight size={18} /></Link>
      <div className={styles.encouragement}><Sprout size={33} strokeWidth={1.6} /><div><strong>You’re doing great!</strong><p>Consistency leads to progress. Keep going.</p></div></div>
    </aside>
  </div></>;
}
