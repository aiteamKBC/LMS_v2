import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { PageContainer } from '@/components/ui/PageContainer';
import { useCurriculumHome, type HomeModule, type ProgrammeFocus } from './useCurriculumHome';
import { curriculumNavItems } from '@/mocks/navigation';
import styles from './page.module.css';
import { LiveTotalsSection } from './LiveTotalsSection';

type AttentionTone = 'rose' | 'amber' | 'sky';
type AttentionIssue = { key: string; title: string; detail: string; count: number; href: string; action: string; icon: string; tone: AttentionTone };
type GuideStep = {
  title: string;
  shortTitle: string;
  summary: string;
  details: string[];
  result: string;
  href: string;
  action: string;
  icon: string;
};

const CURRICULUM_GUIDE_STEPS: GuideStep[] = [
  {
    shortTitle: 'Create programme',
    title: 'Create the programme',
    summary: 'Start with the programme record and the standard it will be measured against.',
    details: [
      'Select Create programme from Curriculum Home.',
      'Add the programme name, level and core delivery details.',
      'Choose its KSB standard or profile so the same source is available while authoring.',
    ],
    result: 'You will have one programme workspace for its delivery, modules, KSB coverage and quality checks.',
    href: '/curriculum/programmes?create=programme',
    action: 'Create programme',
    icon: 'ri-stack-line',
  },
  {
    shortTitle: 'Add cohort',
    title: 'Add the first cohort',
    summary: 'Define when this intake starts and finishes before organising its groups.',
    details: [
      'Open the programme, then choose Cohorts.',
      'Add the practical period, apprenticeship end date and status.',
      'Create another cohort later when the same programme runs for a new intake.',
    ],
    result: 'The programme now has a clear delivery window that groups and sessions can sit inside.',
    href: '/curriculum/cohorts',
    action: 'Open cohorts',
    icon: 'ri-calendar-schedule-line',
  },
  {
    shortTitle: 'Create groups',
    title: 'Create the delivery groups',
    summary: 'Split the cohort into the classes learners will attend and assign their delivery setup.',
    details: [
      'Open Groups and select the programme and cohort.',
      'Set the group name, delivery days and times.',
      'Assign a coach now, or leave it unassigned and finish it from Needs attention later.',
    ],
    result: 'Each group has its own timetable and can receive modules, learners, coaches and sessions.',
    href: '/curriculum/groups',
    action: 'Open groups',
    icon: 'ri-team-line',
  },
  {
    shortTitle: 'Build modules',
    title: 'Build modules and weeks',
    summary: 'Create the learning structure once, then reuse it across the programme delivery.',
    details: [
      'Open Modules, then launch Module Builder.',
      'Create a module and add its weeks in the order learners should follow.',
      'Open a week to add learning components, activities and live sessions.',
    ],
    result: 'The learning journey is organised into reusable modules, ordered weeks and editable components.',
    href: '/curriculum/module-builder',
    action: 'Open Module Builder',
    icon: 'ri-layout-4-line',
  },
  {
    shortTitle: 'Add materials',
    title: 'Add content, materials and KSBs',
    summary: 'Complete each component in one editor, including what learners see and how it is measured.',
    details: [
      'Select Add component and choose the activity type; its settings open immediately.',
      'For a file, choose Uploaded File and upload a PowerPoint or PDF up to 5 MB.',
      'Add the OTJH, points and relevant KSBs, then save the component.',
    ],
    result: 'The component is learner-ready and contributes to the week hours, points and KSB coverage.',
    href: '/curriculum/module-builder',
    action: 'Add learning content',
    icon: 'ri-file-upload-line',
  },
  {
    shortTitle: 'Review & finish',
    title: 'Review coverage and finish setup',
    summary: 'Use the final checks to catch missing content or delivery assignments before learners rely on them.',
    details: [
      'Open KSB Coverage and resolve any unmapped Knowledge, Skills or Behaviours.',
      'Check OTJH, component readiness, coaches, tutors and scheduled sessions.',
      'Use Quality and Needs attention to return directly to anything still incomplete.',
    ],
    result: 'The programme has a traceable learning plan and a complete delivery setup ready for review.',
    href: '/curriculum/quality',
    action: 'Review quality',
    icon: 'ri-shield-check-line',
  },
];

export default function CurriculumStudio() {
  const [guideOpen, setGuideOpen] = useState(false);
  const { data, loading, error, reload } = useCurriculumHome();
  const counts = data?.attentionCounts;
  const continueModules = data?.continueModules ?? [];
  const programmeFocus = data?.programmeFocus ?? [];
  const openIssueCount = data?.stats.openIssues ?? 0;
  const unavailable = !data && Boolean(error);

  const attentionIssues = useMemo<AttentionIssue[]>(() => {
    const issues: AttentionIssue[] = [
      { key: 'programme-ksb-source', title: 'Programmes need a KSB source', detail: 'Choose the standard or KSB profile before mapping content.', count: counts?.['programme-ksb-source'] ?? 0, href: '/curriculum/programmes', action: 'Review programmes', icon: 'ri-node-tree', tone: 'rose' },
      { key: 'module-mapping', title: 'Modules have no KSB mappings', detail: 'Open coverage and map each gap to the right component.', count: counts?.['module-mapping'] ?? 0, href: '/curriculum/ksb-mapping', action: 'Open coverage', icon: 'ri-link-unlink', tone: 'amber' },
      { key: 'draft-content', title: 'Modules are still in draft', detail: 'Continue authoring the content that is not yet published.', count: counts?.['draft-content'] ?? 0, href: '/curriculum/module-builder', action: 'Continue authoring', icon: 'ri-draft-line', tone: 'sky' },
      { key: 'group-coach', title: 'Groups have no coach', detail: 'Assign a coach before the delivery setup is complete.', count: counts?.['group-coach'] ?? 0, href: '/curriculum/groups', action: 'Assign coaches', icon: 'ri-user-search-line', tone: 'amber' },
      { key: 'module-tutor', title: 'Modules have no tutor', detail: 'A scheduled module needs an owner for its live sessions.', count: counts?.['module-tutor'] ?? 0, href: '/curriculum/delivery', action: 'Review delivery', icon: 'ri-user-settings-line', tone: 'amber' },
    ];
    return issues.filter(issue => issue.count > 0).sort((left, right) => right.count - left.count);
  }, [counts]);

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Curriculum Home" pageSubtitle="Your next curriculum actions, in priority order" userName="Rachel Myers" userRole="Curriculum Designer">
      <PageContainer className={styles.page}>
        <div className={styles.content}>
          <header className={styles.pageHeading}>
            <div>
              <h1 className={styles.pageTitle}>Curriculum home</h1>
              <p className={styles.pageSubtitle}>Your next curriculum actions, in priority order.</p>
              {!loading && !unavailable && (
                <div className={styles.overviewMeta}>
                  <span className={openIssueCount ? styles.actionBadge : styles.clearBadge}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {openIssueCount ? openIssueCount + ' open actions' : 'Everything looks clear'}
                  </span>
                  <span>{attentionIssues.length} types of action across {data?.stats.programmes ?? 0} programmes</span>
                </div>
              )}
            </div>
            <div className={styles.pageActions}>
              <Link to="/curriculum/programmes?create=programme" className={styles.primaryAction}><AppIcon className="ri-add-line" aria-hidden="true" />Create programme</Link>
              <Link to="/curriculum/module-builder" className={styles.secondaryAction}><AppIcon className="ri-edit-box-line" aria-hidden="true" />Continue authoring</Link>
            </div>
          </header>

          <section className={styles.attentionBanner} aria-labelledby="curriculum-attention-title">
            <div className={styles.bannerCopy}>
              <p className={styles.eyebrow}>Curriculum</p>
              <h2 id="curriculum-attention-title" className={styles.bannerTitle}>What needs your attention?</h2>
              <p className={styles.bannerDescription}>Start with a blocker, continue your latest module, or create a programme. Supporting reports stay out of the way until you need them.</p>
            </div>
            <button type="button" onClick={() => setGuideOpen(true)} className={styles.secondaryAction}><AppIcon className="ri-compass-3-line" aria-hidden="true" />How to build a programme</button>
          </section>

          {error && <div className={styles.error} role="alert">Curriculum data could not be refreshed: {error} <button type="button" onClick={() => { void reload(); }} className={styles.retry}>Retry</button></div>}

          <LiveTotalsSection />

          <section className={styles.workingPanel} aria-label="Curriculum priorities and recent modules">
            <div className={styles.attentionColumn}>
              <SectionHeader title="Needs attention" detail="Live gaps, ordered by impact. Each row opens where it can be fixed." href="/curriculum/quality" action="View Quality" />
              <div className={styles.rows}>
                {loading ? <LoadingRows count={4} /> : unavailable ? null : attentionIssues.length ? attentionIssues.map(issue => <AttentionRow key={issue.key} issue={issue} />) : <EmptyState icon="ri-checkbox-circle-line" title="No curriculum blockers found" detail="You can continue authoring or review an active programme." />}
              </div>
            </div>
            <aside className={styles.continueColumn}>
              <SectionHeader title="Continue working" detail="Draft and recently updated modules." href="/curriculum/library" action="Open Library" />
              <div className={styles.rows}>
                {loading ? <LoadingRows count={4} /> : unavailable ? null : continueModules.length ? continueModules.map(module => <ContinueModuleRow key={module.id} module={module} />) : <EmptyState icon="ri-layout-4-line" title="No modules yet" detail="Create your first reusable module from the Library." compact />}
              </div>
            </aside>
          </section>

          <section className={styles.reviewPanel} aria-label="Programmes to review">
            <SectionHeader title="Programmes to review" detail="Programme-level gaps grouped together, so you do not have to hunt across separate lists." href="/curriculum/programmes" action="All programmes" />
            <div className={styles.programmeGrid}>
              {loading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className={styles.cardSkeleton} />) : unavailable ? null : programmeFocus.length ? programmeFocus.map(item => <ProgrammeFocusCard key={item.programme.id} item={item} />) : <div className={styles.fullWidth}><EmptyState icon="ri-shield-check-line" title="All programmes are clear" detail="No missing structure, KSB source or staffing gaps were found in the current data." /></div>}
            </div>
          </section>

          <section className={styles.workflowPanel} aria-labelledby="curriculum-workflow-title">
            <h2 id="curriculum-workflow-title" className={styles.workflowTitle}>How to build a programme</h2>
            <div className={styles.workflowGrid}>
              <WorkflowCard step="1" title="Set up cohorts" detail="Create the programme cohorts and groups, then confirm dates and staff." href="/curriculum/delivery" icon="ri-calendar-schedule-line" />
              <WorkflowCard step="2" title="Design learning" detail="Build the modules, weeks and components those delivery groups will use." href="/curriculum/library" icon="ri-layout-4-line" />
              <WorkflowCard step="3" title="Check quality" detail="Resolve KSB and readiness gaps before learners depend on the content." href="/curriculum/quality" icon="ri-shield-check-line" />
            </div>
          </section>
        </div>
      </PageContainer>
      <CurriculumGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </WorkspaceShell>
  );
}

function CurriculumGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStep = CURRICULUM_GUIDE_STEPS[activeIndex];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-foreground-950/55 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="curriculum-guide-title" className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-background-50 shadow-2xl sm:max-h-[min(820px,calc(100dvh-2rem))] sm:rounded-3xl">
        <header className="relative overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 px-5 py-5 text-white sm:px-7 sm:py-6">
          <div className="absolute -right-12 -top-20 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.16em] text-primary-100"><AppIcon className="ri-compass-3-line" />Curriculum guide</span>
              <h2 id="curriculum-guide-title" className="mt-3 font-heading text-2xl font-bold tracking-tight sm:text-3xl">Build a programme without getting lost</h2>
              <p className="mt-2 max-w-2xl text-[12px] leading-5 text-primary-100 sm:text-sm">Follow the recommended order below. Open any step for the exact actions, then jump straight to the right workspace.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close curriculum guide" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"><AppIcon className="ri-close-line text-xl" /></button>
          </div>
          <div className="relative mt-5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white transition-all duration-300" style={{ width: `${((activeIndex + 1) / CURRICULUM_GUIDE_STEPS.length) * 100}%` }} /></div>
            <span className="shrink-0 text-[10px] font-bold text-primary-100">Step {activeIndex + 1} of {CURRICULUM_GUIDE_STEPS.length}</span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[310px_minmax(0,1fr)]">
          <nav aria-label="Programme building steps" className="border-b border-background-200 bg-background-100/70 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
            <p className="mb-2 hidden px-2 text-[9px] font-extrabold uppercase tracking-[0.14em] text-foreground-400 lg:block">Recommended flow</p>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {CURRICULUM_GUIDE_STEPS.map((step, index) => {
                const selected = index === activeIndex;
                const complete = index < activeIndex;
                return (
                  <button key={step.shortTitle} type="button" onClick={() => setActiveIndex(index)} aria-label={`Step ${index + 1}: ${step.shortTitle}`} aria-current={selected ? 'step' : undefined} className={`group flex min-w-[210px] items-center gap-3 rounded-xl border p-3 text-left transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300 lg:min-w-0 ${selected ? 'border-primary-300 bg-background-50 shadow-sm' : 'border-transparent hover:border-background-300 hover:bg-background-50'}`}>
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-extrabold ${selected ? 'bg-primary-600 text-white' : complete ? 'bg-emerald-50 text-emerald-700' : 'bg-background-200 text-foreground-500'}`}>{complete ? <AppIcon className="ri-check-line text-base" /> : index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[11px] font-bold ${selected ? 'text-primary-800' : 'text-foreground-800'}`}>{step.shortTitle}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-foreground-400">{index === 0 ? 'Start here' : `Follows step ${index}`}</span>
                    </span>
                    <AppIcon className={`ri-arrow-right-s-line hidden text-foreground-300 lg:block ${selected ? 'text-primary-600' : ''}`} />
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700"><AppIcon className={`${activeStep.icon} text-2xl`} /></span>
                <div className="min-w-0">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-primary-600">Step {activeIndex + 1}</p>
                  <h3 className="mt-1 font-heading text-xl font-bold text-foreground-950 sm:text-2xl">{activeStep.title}</h3>
                  <p className="mt-2 text-[12px] leading-6 text-foreground-500 sm:text-[13px]">{activeStep.summary}</p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-background-200 bg-background-100/65 p-4 sm:p-5">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-foreground-500">What to do</h4>
                <ol className="mt-4 space-y-3">
                  {activeStep.details.map((detail, index) => (
                    <li key={detail} className="flex gap-3 text-[12px] leading-5 text-foreground-700">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background-50 text-[10px] font-extrabold text-primary-700 shadow-sm ring-1 ring-background-200">{index + 1}</span>
                      <span className="pt-0.5">{detail}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-4 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><AppIcon className="ri-checkbox-circle-line" /></span>
                <div><p className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">You are done when</p><p className="mt-1 text-[11px] leading-5 text-emerald-900">{activeStep.result}</p></div>
              </div>
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <button type="button" onClick={() => setActiveIndex(index => Math.max(0, index - 1))} disabled={activeIndex === 0} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-foreground-200 px-4 text-[11px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"><AppIcon className="ri-arrow-left-line" />Previous</button>
              <div className="flex gap-2">
                <Link to={activeStep.href} onClick={onClose} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 sm:flex-none"><AppIcon className={activeStep.icon} />{activeStep.action}</Link>
                {activeIndex < CURRICULUM_GUIDE_STEPS.length - 1 ? <button type="button" onClick={() => setActiveIndex(index => Math.min(CURRICULUM_GUIDE_STEPS.length - 1, index + 1))} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700 sm:flex-none">Next step<AppIcon className="ri-arrow-right-line" /></button> : <button type="button" onClick={onClose} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-5 text-[11px] font-bold text-white transition-smooth hover:bg-primary-700 sm:flex-none">Finish guide<AppIcon className="ri-check-line" /></button>}
              </div>
            </footer>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AttentionRow({ issue }: { issue: AttentionIssue }) {
  return (
    <Link to={issue.href} className={styles.attentionRow}>
      <span className={styles.issueIcon}><AppIcon className={issue.icon} aria-hidden="true" /></span>
      <span className={styles.issueBody}>
        <span className={styles.issueHeading}><span>{issue.title}</span><span className={styles.issueCount}>{issue.count}</span></span>
        <span className={styles.issueDetail}>{issue.detail}</span>
      </span>
      <span className={styles.rowAction}>{issue.action}<AppIcon className="ri-arrow-right-line" aria-hidden="true" /></span>
    </Link>
  );
}

function ContinueModuleRow({ module }: { module: HomeModule }) {
  const href = '/curriculum/module-builder?module=' + encodeURIComponent(module.id);
  const published = normalise(module.status) === 'published';
  return (
    <Link to={href} className={styles.moduleRow}>
      <span className={published ? styles.publishedIcon : styles.draftIcon}><AppIcon className="ri-file-text-line" aria-hidden="true" /></span>
      <span className={styles.moduleBody}>
        <span className={styles.moduleName}>{clean(module.name) || 'Untitled module'}</span>
        <span className={styles.moduleDetail}>{clean(module.programme) || 'Reusable module'} · {Number(module.weeks || 0)} weeks</span>
      </span>
      <span className={published ? styles.publishedStatus : styles.draftStatus}>{published ? 'Published' : 'Draft'}</span>
      <AppIcon className="ri-arrow-right-s-line" aria-hidden="true" />
    </Link>
  );
}

function ProgrammeFocusCard({ item }: { item: ProgrammeFocus }) {
  const id = item.programme.id;
  return (
    <Link to={'/curriculum/programmes/' + encodeURIComponent(id)} className={styles.programmeCard}>
      <span className={styles.programmeCardTop}>
        <span className={styles.programmeIcon}><AppIcon className="ri-stack-line" aria-hidden="true" /></span>
        <span className={styles.programmeBadge}>{item.issueCount} {item.issueCount === 1 ? 'action' : 'actions'}</span>
      </span>
      <h3 className={styles.programmeName}><span className={styles.statusDot} aria-hidden="true" />{item.programme.name}</h3>
      <p className={styles.programmeDetail}>{item.issues.join(' · ')}</p>
      <span className={styles.programmeLink}>Open programme<AppIcon className="ri-arrow-right-line" aria-hidden="true" /></span>
    </Link>
  );
}

function WorkflowCard({ step, title, detail, href, icon }: { step: string; title: string; detail: string; href: string; icon: string }) {
  return (
    <Link to={href} className={styles.workflowCard}>
      <span className={styles.workflowIcon}><AppIcon className={icon} aria-hidden="true" /></span>
      <span className={styles.workflowBody}>
        <span className={styles.workflowStep}>Step {step}</span>
        <span className={styles.workflowName}>{title}</span>
        <span className={styles.workflowDetail}>{detail}</span>
      </span>
    </Link>
  );
}

function SectionHeader({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionCopy}><h2 className={styles.sectionTitle}>{title}</h2><p className={styles.sectionDetail}>{detail}</p></div>
      <Link to={href} className={styles.sectionAction}><AppIcon className={action === 'Open Library' ? 'ri-folder-open-line' : action === 'All programmes' ? 'ri-stack-line' : 'ri-shield-check-line'} aria-hidden="true" />{action}</Link>
    </div>
  );
}

function EmptyState({ icon, title, detail, compact = false }: { icon: string; title: string; detail: string; compact?: boolean }) {
  return <div className={compact ? styles.compactEmptyState : styles.emptyState}><span className={styles.emptyIcon}><AppIcon className={icon} aria-hidden="true" /></span><p className={styles.emptyTitle}>{title}</p><p className={styles.emptyDetail}>{detail}</p></div>;
}

function LoadingRows({ count }: { count: number }) {
  return <div className={styles.loadingRows} role="status" aria-label="Loading curriculum data">{Array.from({ length: count }).map((_, index) => <div key={index} className={styles.rowSkeleton} />)}</div>;
}

function clean(value: unknown) { return String(value ?? '').trim(); }
function normalise(value: unknown) { return clean(value).toLowerCase(); }
