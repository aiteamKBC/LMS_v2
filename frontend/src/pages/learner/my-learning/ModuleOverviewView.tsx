import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import {
  ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardList, FileText, Headphones, Layers3, ListChecks, Lock,
  MonitorPlay, PlayCircle, Presentation, Users, Video, type LucideIcon,
} from 'lucide-react';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { Cover } from './SubjectWorkspace';
import { DEFAULT_MODULE_COVER } from './moduleCover';
import { typeLabel, type ModuleOverviewModel, type OverviewGrade, type OverviewInstructor, type OverviewItem, type OverviewWeek } from './moduleOverviewModel';
import styles from './ModuleOverviewPage.module.css';

const OUTCOME_PREVIEW = 8;
/** Longer biographies start collapsed so the Hero keeps the CTA in view. */
const BIO_PREVIEW_CHARS = 260;

/** Activity-type icon and its accent, in the old KBC LMS curriculum style. */
const TYPE_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  live_session: { icon: Video, tone: 'purple' }, video: { icon: PlayCircle, tone: 'orange' },
  podcast: { icon: Headphones, tone: 'purple' }, audio: { icon: Headphones, tone: 'purple' },
  reading: { icon: FileText, tone: 'green' }, powerpoint: { icon: Presentation, tone: 'red' },
  quiz: { icon: CircleHelp, tone: 'orange' }, reading_quiz: { icon: CircleHelp, tone: 'orange' },
  assignment: { icon: ClipboardList, tone: 'purple' }, checkpoint: { icon: ListChecks, tone: 'purple' },
  reflection: { icon: BookOpen, tone: 'purple' },
};
const typeIcon = (type: string) => TYPE_ICONS[type] || { icon: MonitorPlay, tone: 'purple' };

export type OverviewTab = 'description' | 'curriculum' | 'grade';
export type OverviewProgress = { done: number; total: number; percent: number };
/**
 * `loading`: the module read is in flight -- a skeleton, never empty-content text.
 * `ready`: the read succeeded; empty states may describe genuinely empty content.
 * `error`: the read failed; an error with Retry replaces the tabs.
 */
export type OverviewStatus = 'loading' | 'ready' | 'error';
/** The curriculum's own state, when it loads separately (the editor preview). */
export type CurriculumStatus = 'loading' | 'ready' | 'unavailable';

/**
 * The Module Overview layout: hero, cover/progress card, Description /
 * Curriculum / Grade tabs and the course-information sidebar.
 *
 * Purely presentational. The learner page and the Module Builder's live
 * preview both render this component, so the preview is the learner page.
 * Every section renders only when it has real content; authored text is
 * rendered as text nodes, never as markup. The curriculum is a read-only
 * preview: its rows are not links and never change progress.
 */
export function ModuleOverviewView({
  model, coverUrl, progress, ctaLabel, onStart, onBack, headingRef, preview = false,
  status = 'ready', error, onRetry, curriculumStatus = 'ready',
}: {
  model: ModuleOverviewModel;
  coverUrl?: string;
  progress: OverviewProgress | null;
  ctaLabel: string;
  /** Absent in the editor preview: the button is shown but does nothing. */
  onStart?: () => void;
  onBack?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
  preview?: boolean;
  status?: OverviewStatus;
  error?: string;
  onRetry?: () => void;
  curriculumStatus?: CurriculumStatus;
}) {
  const titleId = useId();
  const instructor: OverviewInstructor | null = model.instructor
    || (model.tutorName ? { name: model.tutorName, bio: '', photoUrl: '' } : null);
  const percent = Math.min(100, Math.max(0, progress?.percent || 0));
  const loading = status === 'loading';

  const cta = <button type="button" className={styles.cta} onClick={onStart} aria-disabled={preview || undefined}
    title={preview ? 'Preview only: learners open the module from here.' : undefined}>
    <PlayCircle size={18} aria-hidden="true" />{ctaLabel}<ArrowRight size={18} aria-hidden="true" />
  </button>;

  return <article className={styles.page} aria-labelledby={titleId} aria-busy={loading || undefined} data-preview={preview || undefined}>
    {onBack && <nav className={styles.breadcrumb} aria-label="Breadcrumb">
      <ol>
        <li><button type="button" onClick={onBack}>My modules</button></li>
        <li aria-current="page">{model.title}</li>
      </ol>
    </nav>}

    <div className={styles.layout}>
      <div className={styles.band} aria-hidden="true" />
      <header className={styles.hero}>
        {model.programme && <p className={styles.eyebrow}>Programme: {model.programme}</p>}
        <h2 id={titleId} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={styles.title}>{model.title}</h2>
        {loading
          ? <div className={styles.skeletonGroup} aria-hidden="true"><span className={styles.skeleton} style={{ width: '92%' }} /><span className={styles.skeleton} style={{ width: '70%' }} /></div>
          : model.summary && <p className={styles.summary}>{model.summary}</p>}
        {instructor && <HeroInstructor key={`${instructor.name}|${instructor.photoUrl}`} instructor={instructor} />}
      </header>

      <aside className={styles.side} aria-label="Module summary">
        <section className={styles.heroCard} aria-label="Start this module">
          <div className={styles.coverFrame}><Cover title={model.title} url={coverUrl || undefined} fallbackUrl={DEFAULT_MODULE_COVER} /></div>
          {progress && progress.total > 0 && <div className={styles.progress}>
            <div className={styles.progressLabel}><span>Your progress</span><strong>{percent}% complete</strong></div>
            <div role="progressbar" aria-label={`${model.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
              aria-valuetext={`${progress.done} of ${progress.total} activities completed`} className={styles.progressTrack}>
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>}
          {cta}
        </section>
        {loading ? <SidebarSkeleton /> : status === 'ready' && <Sidebar model={model} curriculumStatus={curriculumStatus} />}
      </aside>

      <div className={styles.content}>
        {loading ? <TabsSkeleton />
          : status === 'error' ? <LearnerLoadError title="Some module details could not be loaded" error={error || 'Please try again.'} onRetry={onRetry} />
            : <OverviewTabs model={model} curriculumStatus={curriculumStatus} />}
      </div>
    </div>
  </article>;
}

const TABS: { id: OverviewTab; label: string }[] = [
  { id: 'description', label: 'Description' }, { id: 'curriculum', label: 'Curriculum' }, { id: 'grade', label: 'Grade' },
];

function OverviewTabs({ model, curriculumStatus }: { model: ModuleOverviewModel; curriculumStatus: CurriculumStatus }) {
  const base = useId();
  const [tab, setTab] = useState<OverviewTab>('description');
  const refs = useRef<Partial<Record<OverviewTab, HTMLButtonElement | null>>>({});
  // Grade is shown only when the learner's own module read lists quizzes for
  // this module; otherwise (no quizzes, or the editor preview with no learner)
  // the tab is omitted rather than shown disabled.
  const gradesAvailable = Boolean(model.grades && model.grades.length);
  // A tab that loses its content (e.g. the last quiz removed) falls back to Description.
  useEffect(() => { if (tab === 'grade' && !gradesAvailable) setTab('description'); }, [tab, gradesAvailable]);
  const enabled = TABS.filter(item => item.id !== 'grade' || gradesAvailable);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex(item => item.id === tab);
    const next = event.key === 'ArrowRight' ? enabled[(index + 1) % enabled.length]
      : event.key === 'ArrowLeft' ? enabled[(index - 1 + enabled.length) % enabled.length]
        : event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled[enabled.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    refs.current[next.id]?.focus();
  };

  return <section className={styles.tabsPanel} aria-label="Module information">
    <div role="tablist" aria-label="Module sections" className={styles.tabList} onKeyDown={onKeyDown}>
      {enabled.map(item => {
        const selected = tab === item.id;
        return <button key={item.id} ref={node => { refs.current[item.id] = node; }} type="button" role="tab"
          id={`${base}-${item.id}-tab`} aria-controls={`${base}-${item.id}-panel`}
          aria-selected={selected} tabIndex={selected ? 0 : -1}
          className={styles.tab} onClick={() => setTab(item.id)}>
          {item.label}
        </button>;
      })}
    </div>
    <div role="tabpanel" id={`${base}-${tab}-panel`} aria-labelledby={`${base}-${tab}-tab`} tabIndex={0} className={styles.tabPanel}>
      {tab === 'description' && <DescriptionTab model={model} outcomesStatus={curriculumStatus} />}
      {tab === 'curriculum' && <CurriculumTab weeks={model.weeks} activityTotal={model.activityTotal} status={curriculumStatus} />}
      {tab === 'grade' && model.grades && <GradeTab grades={model.grades} />}
    </div>
  </section>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className={styles.block} aria-labelledby={id}>
    <h3 id={id} className={styles.blockTitle}>{title}</h3>
    {children}
  </section>;
}

function Paragraphs({ items }: { items: string[] }) {
  return <>{items.map((paragraph, index) => <p key={index} className={styles.paragraph}>{paragraph}</p>)}</>;
}

/**
 * Authored text plus the module's existing learning outcomes. Outcomes come
 * from the curriculum, so while it is still loading (or could not be read) the
 * tab never claims the module has no description.
 */
function DescriptionTab({ model, outcomesStatus }: { model: ModuleOverviewModel; outcomesStatus: CurriculumStatus }) {
  const hasText = model.descriptionParagraphs.length > 0 || model.sections.length > 0 || model.outcomes.length > 0 || model.highlights.length > 0;
  return <div className={styles.description}>
    {model.descriptionParagraphs.length > 0 && <Block title="About this module"><Paragraphs items={model.descriptionParagraphs} /></Block>}
    {model.sections.map(section => <Block key={section.id} title={section.heading}>
      <Paragraphs items={section.paragraphs} />
      {section.bullets.length > 0 && <ul className={styles.bullets}>{section.bullets.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>}
    </Block>)}
    {outcomesStatus === 'loading' && <div className={styles.block} aria-busy="true">
      <p role="status" className={styles.srOnly}>Loading learning outcomes…</p>
      <div className={styles.skeletonGroup} aria-hidden="true">
        <span className={`${styles.skeleton} ${styles.skeletonHeading}`} style={{ width: '38%' }} />
        {['82%', '74%', '66%'].map(width => <span key={width} className={styles.skeleton} style={{ width }} />)}
      </div>
    </div>}
    {outcomesStatus === 'unavailable' && <p className={styles.emptyNote}>The learning outcomes could not be loaded for this preview.</p>}
    {outcomesStatus === 'ready' && model.outcomes.length > 0 && <Outcomes outcomes={model.outcomes} />}
    {model.highlights.length > 0 && <Block title="Course highlights">
      <ul className={styles.checks}>{model.highlights.map(item => <li key={item}><Check size={16} aria-hidden="true" /><span>{item}</span></li>)}</ul>
    </Block>}
    {!hasText && outcomesStatus === 'ready' && <p className={styles.emptyNote}>A description has not been added for this module yet.</p>}
  </div>;
}

function Outcomes({ outcomes }: { outcomes: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? outcomes : outcomes.slice(0, OUTCOME_PREVIEW);
  return <Block title="What you'll learn">
    <ul className={styles.checks}>{visible.map(outcome => <li key={outcome}><Check size={16} aria-hidden="true" /><span>{outcome}</span></li>)}</ul>
    {outcomes.length > OUTCOME_PREVIEW && <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show fewer' : `Show all ${outcomes.length} outcomes`}
    </button>}
  </Block>;
}

/**
 * Read-only curriculum preview. Every week starts collapsed; the open set lives
 * in this component, so leaving the tab (which unmounts it) and coming back
 * resets every week to collapsed.
 */
function CurriculumTab({ weeks, activityTotal, status }: { weeks: OverviewWeek[]; activityTotal: number; status: CurriculumStatus }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  if (status === 'loading') return <CurriculumSkeleton />;
  if (status === 'unavailable') return <p className={styles.emptyNote}>The curriculum could not be loaded for this preview.</p>;
  if (!weeks.length) return <p className={styles.emptyNote}>No learning activities have been added to this module yet.</p>;
  const toggle = (key: string) => setOpen(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  let number = 0;
  return <div className={styles.curriculum}>
    <p className={styles.curriculumSummary}>
      {weeks.length} {weeks.length === 1 ? 'section' : 'sections'} · {activityTotal} {activityTotal === 1 ? 'activity' : 'activities'}
    </p>
    <div className={styles.weeks}>
      {weeks.map(week => {
        const expanded = open.has(week.key);
        const first = number + 1;
        number += week.items.length;
        return <WeekAccordion key={week.key} week={week} expanded={expanded} firstNumber={first} onToggle={() => toggle(week.key)} />;
      })}
    </div>
  </div>;
}

function WeekAccordion({ week, expanded, firstNumber, onToggle }: { week: OverviewWeek; expanded: boolean; firstNumber: number; onToggle: () => void }) {
  const id = useId();
  const count = `${week.items.length} ${week.items.length === 1 ? 'activity' : 'activities'}`;
  return <section className={styles.week} data-open={expanded || undefined}>
    <h3 className={styles.weekHeading}>
      <button type="button" id={`${id}-header`} aria-expanded={expanded} aria-controls={`${id}-panel`} onClick={onToggle} className={styles.weekToggle}>
        <span className={styles.weekTitle}>{week.label}</span>
        <small>{count}</small>
        <span className={styles.weekChevron} aria-hidden="true"><ChevronDown size={16} /></span>
      </button>
    </h3>
    {expanded && <ol id={`${id}-panel`} role="list" aria-labelledby={`${id}-header`} className={styles.activityRows} start={firstNumber}>
      {week.items.map((item, index) => <ActivityRow key={item.id} item={item} number={firstNumber + index} />)}
    </ol>}
  </section>;
}

/** One read-only curriculum row: not a link, not a button, never changes progress. */
function ActivityRow({ item, number }: { item: OverviewItem; number: number }) {
  const { icon: Icon, tone } = typeIcon(item.type);
  const meta = item.questions ? `${item.questions} ${item.questions === 1 ? 'question' : 'questions'}` : typeLabel(item.type);
  return <li className={styles.activityRow} data-completed={item.completed === true || undefined}>
    <span className={styles.activityNumber} aria-hidden="true">{number}</span>
    <Icon size={18} aria-hidden="true" className={styles.activityIcon} data-tone={tone} />
    <span className={styles.activityTitle}>{item.title}</span>
    <span className={styles.activityEnd}>
      {item.completed === true && <span className={styles.statusDone} title="Completed">
        <CheckCircle2 size={17} aria-hidden="true" /><span className={styles.srOnly}>Completed</span>
      </span>}
      {item.completed === false && <span className={styles.statusLocked} title="Not completed yet">
        <Lock size={16} aria-hidden="true" /><span className={styles.srOnly}>Not completed yet</span>
      </span>}
      <span className={styles.activityMeta}>{meta}</span>
    </span>
  </li>;
}

function GradeTab({ grades }: { grades: OverviewGrade[] }) {
  return <div className={styles.grades}>
    <p className={styles.curriculumSummary}>Your best recorded score for each quiz in this module.</p>
    <table className={styles.gradeTable}>
      <thead><tr><th scope="col">Quiz</th><th scope="col">Attempts</th><th scope="col">Best score</th><th scope="col">Status</th></tr></thead>
      <tbody>{grades.map(grade => <tr key={grade.id}>
        <th scope="row"><span>{grade.title}</span>{grade.week && <small>{grade.week}</small>}</th>
        <td>{grade.attempts}</td>
        <td>{grade.bestPercent == null ? '–' : `${Math.round(grade.bestPercent)}%`}</td>
        <td><span className={styles.gradeStatus} data-state={grade.passed ? 'passed' : grade.attempts ? 'attempted' : 'none'}>
          {grade.passed ? 'Passed' : grade.attempts ? 'Not passed yet' : 'Not attempted'}
        </span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Sidebar({ model, curriculumStatus }: { model: ModuleOverviewModel; curriculumStatus: CurriculumStatus }) {
  const requirementGroups = [
    { label: 'Before you start', items: model.prerequisites },
    { label: 'What you will need', items: model.requirements },
  ].filter(group => group.items.length > 0);
  return <div className={styles.sideCards}>
    {curriculumStatus === 'loading' ? <SideCardSkeleton rows={4} />
      : curriculumStatus === 'ready' && model.activityTotal > 0 && <SideCard title="Course details">
        <dl className={styles.details}>
          <div><dt><Layers3 size={17} aria-hidden="true" />Sections</dt><dd>{model.weeks.length}</dd></div>
          {model.counts.map(item => {
            const Icon = typeIcon(item.type).icon;
            return <div key={item.type}><dt><Icon size={17} aria-hidden="true" />{item.label}</dt><dd>{item.count}</dd></div>;
          })}
        </dl>
      </SideCard>}
    {requirementGroups.length > 0 && <SideCard title="Learner requirements">
      {requirementGroups.map((group, index) => <div key={group.label} className={styles.requirement}>
        <h4>{index + 1}. {group.label}</h4>
        <ul className={styles.bullets}>{group.items.map(item => <li key={item}>{item}</li>)}</ul>
      </div>)}
    </SideCard>}
    {model.targetAudience.length > 0 && <SideCard title="Who this module is for">
      <ul className={styles.audience}>{model.targetAudience.map(item => <li key={item}><Users size={15} aria-hidden="true" /><span>{item}</span></li>)}</ul>
    </SideCard>}
    {/* Authored custom cards, below the system-managed ones. Headingless sections never reach the model. */}
    {model.sidebarSections.map(section => <SideCard key={section.id} title={section.heading}>
      {section.paragraphs.map((paragraph, index) => <p key={index} className={styles.sideText}>{paragraph}</p>)}
      {section.bullets.length > 0 && <ul className={styles.bullets}>{section.bullets.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>}
    </SideCard>)}
  </div>;
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className={styles.sideCard} aria-labelledby={id}>
    <h3 id={id} className={styles.sideTitle}>{title}</h3>
    {children}
  </section>;
}

/* Skeletons keep the loaded layout's shape so nothing jumps when content arrives. */
function TabsSkeleton() {
  return <div className={styles.tabsPanel} data-testid="module-overview-skeleton">
    <p role="status" className={styles.srOnly}>Loading module details…</p>
    <div className={styles.skeletonTabs} aria-hidden="true">{[88, 82, 52].map(width => <span key={width} className={styles.skeleton} style={{ width }} />)}</div>
    <div className={styles.skeletonGroup} aria-hidden="true">
      <span className={`${styles.skeleton} ${styles.skeletonHeading}`} style={{ width: '42%' }} />
      {['96%', '90%', '74%'].map(width => <span key={width} className={styles.skeleton} style={{ width }} />)}
      <span className={`${styles.skeleton} ${styles.skeletonHeading}`} style={{ width: '36%' }} />
      {['94%', '62%'].map(width => <span key={width} className={styles.skeleton} style={{ width }} />)}
    </div>
  </div>;
}

function CurriculumSkeleton() {
  return <div className={styles.curriculum} aria-busy="true">
    <p role="status" className={styles.srOnly}>Loading the curriculum…</p>
    <div className={styles.skeletonGroup} aria-hidden="true">{[0, 1, 2, 3].map(key => <span key={key} className={`${styles.skeleton} ${styles.skeletonRow}`} />)}</div>
  </div>;
}

function SideCardSkeleton({ rows }: { rows: number }) {
  return <div className={styles.sideCard} aria-hidden="true">
    <span className={`${styles.skeleton} ${styles.skeletonHeading}`} style={{ width: '58%' }} />
    <div className={styles.skeletonGroup}>{Array.from({ length: rows }, (_, index) => <span key={index} className={styles.skeleton} style={{ width: `${88 - index * 9}%` }} />)}</div>
  </div>;
}

function SidebarSkeleton() {
  return <div className={styles.sideCards}><SideCardSkeleton rows={4} /><SideCardSkeleton rows={3} /></div>;
}

function HeroInstructor({ instructor }: { instructor: OverviewInstructor }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const bioId = useId();
  const showPhoto = Boolean(instructor.photoUrl) && !photoFailed;
  const bio = instructor.bio.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean);
  const collapsible = instructor.bio.length > BIO_PREVIEW_CHARS;
  return <section className={styles.instructor} data-photo={showPhoto || undefined} aria-label="Your instructor">
    {showPhoto && <img className={styles.photo} src={instructor.photoUrl} alt={instructor.name} decoding="async"
      referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />}
    <div className={styles.instructorText}>
      <p className={styles.instructorLabel}>Instructor</p>
      <p className={styles.instructorName}>{instructor.name}</p>
      {bio.length > 0 && <div id={bioId} className={styles.bio} data-collapsed={(collapsible && !bioOpen) || undefined}>
        {bio.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>}
      {bio.length > 0 && collapsible && <button type="button" className={styles.more} aria-expanded={bioOpen} aria-controls={bioId}
        onClick={() => setBioOpen(value => !value)}>{bioOpen ? 'Show less' : 'Read full biography'}</button>}
    </div>
  </section>;
}
