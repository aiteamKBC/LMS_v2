import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { curriculumNavItems } from '@/mocks/navigation';
import type { CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

type AttentionTone = 'rose' | 'amber' | 'sky';
type AttentionIssue = { key: string; title: string; detail: string; count: number; href: string; action: string; icon: string; tone: AttentionTone };
type ProgrammeFocus = { programme: CurriculumProgramme; issues: string[]; issueCount: number };
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
  const { data, loading: dataLoading, error: dataError } = useCurriculumData({ compact: true });
  const { programmes, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();
  const modules = useMemo(() => data?.modules ?? [], [data?.modules]);
  const cohorts = useMemo(() => data?.cohorts ?? [], [data?.cohorts]);
  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const loading = dataLoading || programmesLoading;
  const error = dataError || programmesError;

  const draftModules = useMemo(() => modules.filter(module => normalise(module.status) !== 'published'), [modules]);
  const modulesWithoutKsb = useMemo(() => modules.filter(module => Number(module.ksbCount || 0) === 0), [modules]);
  const unassignedTutors = useMemo(() => modules.filter(module => isMissingAssignment(module.tutor)), [modules]);
  const unassignedCoaches = useMemo(() => groups.filter(group => isMissingAssignment(group.coach)), [groups]);
  const programmesWithoutKsb = useMemo(
    () => programmes.filter(programme => Number(programme.ksbTotal || 0) === 0 && !clean(programme.ksbProfileSourceId)),
    [programmes],
  );

  const attentionIssues = useMemo<AttentionIssue[]>(() => {
    const issues: AttentionIssue[] = [
      { key: 'programme-ksb-source', title: 'Programmes need a KSB source', detail: 'Choose the standard or KSB profile before mapping content.', count: programmesWithoutKsb.length, href: '/curriculum/programmes', action: 'Review programmes', icon: 'ri-node-tree', tone: 'rose' },
      { key: 'module-mapping', title: 'Modules have no KSB mappings', detail: 'Open coverage and map each gap to the right component.', count: modulesWithoutKsb.length, href: '/curriculum/ksb-mapping', action: 'Open coverage', icon: 'ri-link-unlink', tone: 'amber' },
      { key: 'draft-content', title: 'Modules are still in draft', detail: 'Continue authoring the content that is not yet published.', count: draftModules.length, href: '/curriculum/module-builder', action: 'Continue authoring', icon: 'ri-draft-line', tone: 'sky' },
      { key: 'group-coach', title: 'Groups have no coach', detail: 'Assign a coach before the delivery setup is complete.', count: unassignedCoaches.length, href: '/curriculum/groups', action: 'Assign coaches', icon: 'ri-user-search-line', tone: 'amber' },
      { key: 'module-tutor', title: 'Modules have no tutor', detail: 'A scheduled module needs an owner for its live sessions.', count: unassignedTutors.length, href: '/curriculum/delivery', action: 'Review delivery', icon: 'ri-user-settings-line', tone: 'amber' },
    ];
    return issues.filter(issue => issue.count > 0).sort((left, right) => right.count - left.count);
  }, [draftModules.length, modulesWithoutKsb.length, programmesWithoutKsb.length, unassignedCoaches.length, unassignedTutors.length]);

  const programmeFocus = useMemo(
    () => programmes.map(programme => buildProgrammeFocus(programme, modules, cohorts, groups)).filter(item => item.issueCount > 0).sort((left, right) => right.issueCount - left.issueCount).slice(0, 6),
    [cohorts, groups, modules, programmes],
  );
  const continueModules = useMemo(
    () => [...(draftModules.length ? draftModules : modules)].sort((left, right) => dateValue(right.lastUpdated) - dateValue(left.lastUpdated)).slice(0, 5),
    [draftModules, modules],
  );
  const openIssueCount = attentionIssues.reduce((total, issue) => total + issue.count, 0);
  const activeCohorts = cohorts.filter(cohort => normalise(cohort.status) === 'active').length;

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Curriculum Home" pageSubtitle="Your next curriculum actions, in priority order" userName="Rachel Myers" userRole="Curriculum Designer">
      <main className="min-h-full bg-background-100 p-4 sm:p-6">
        <div className="mx-auto max-w-[1480px] space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-primary-100 bg-background-50 shadow-sm">
            <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-l from-primary-100/70 to-transparent lg:block" />
            <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-7">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary-700">Curriculum home</span>
                  {!loading && <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${openIssueCount ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{openIssueCount ? `${openIssueCount} open actions` : 'Everything looks clear'}</span>}
                </div>
                <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight text-foreground-950">What needs your attention?</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-500">Start with a blocker, continue your latest module, or create a programme. Supporting reports stay out of the way until you need them.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:max-w-[440px] lg:justify-end">
                <Link to="/curriculum/programmes?create=programme" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-[12px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"><AppIcon className="ri-add-circle-line text-base" />Create programme</Link>
                <Link to="/curriculum/module-builder" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-5 text-[12px] font-bold text-foreground-700 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300"><AppIcon className="ri-edit-box-line text-base" />Continue authoring</Link>
                <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-5 text-[12px] font-bold text-primary-700 transition-smooth hover:border-primary-300 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300"><AppIcon className="ri-road-map-line text-base" />How to build a programme</button>
              </div>
            </div>
          </section>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">Curriculum data could not be refreshed: {error}</div>}

          <section className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Programmes" value={programmes.length} detail="Open programme workspaces" href="/curriculum/programmes" icon="ri-stack-line" loading={loading} />
            <SummaryCard label="Active delivery" value={activeCohorts} detail={`${groups.length} groups across all cohorts`} href="/curriculum/delivery" icon="ri-calendar-check-line" loading={loading} />
            <SummaryCard label="Needs attention" value={openIssueCount} detail={attentionIssues.length ? `${attentionIssues.length} types of action` : 'No blockers found'} href="/curriculum/quality" icon="ri-error-warning-line" loading={loading} warning={openIssueCount > 0} />
          </section>

          <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
            <div className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
              <SectionHeader title="Needs attention" detail="Live gaps, ordered by impact. Each row opens where it can be fixed." href="/curriculum/quality" action="View Quality" />
              <div className="p-3">
                {loading ? <LoadingRows count={4} /> : attentionIssues.length ? <div className="space-y-2">{attentionIssues.map(issue => <AttentionRow key={issue.key} issue={issue} />)}</div> : <EmptyState icon="ri-checkbox-circle-line" title="No curriculum blockers found" detail="You can continue authoring or review an active programme." />}
              </div>
            </div>
            <aside className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
              <SectionHeader title="Continue working" detail="Draft and recently updated modules." href="/curriculum/library" action="Open Library" />
              <div className="divide-y divide-background-200 px-4">
                {loading ? <LoadingRows count={4} /> : continueModules.length ? continueModules.map(module => <ContinueModuleRow key={moduleIdentity(module)} module={module} />) : <EmptyState icon="ri-layout-4-line" title="No modules yet" detail="Create your first reusable module from the Library." compact />}
              </div>
            </aside>
          </section>

          <section className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
            <SectionHeader title="Programmes to review" detail="Programme-level gaps grouped together, so you do not have to hunt across separate lists." href="/curriculum/programmes" action="All programmes" />
            <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
              {loading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-xl bg-background-100" />) : programmeFocus.length ? programmeFocus.map(item => <ProgrammeFocusCard key={programmeIdentity(item.programme)} item={item} />) : <div className="md:col-span-2 xl:col-span-3"><EmptyState icon="ri-shield-check-line" title="All programmes are clear" detail="No missing structure, KSB source or staffing gaps were found in the current data." /></div>}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <WorkflowCard step="1" title="Set up cohorts" detail="Create the programme cohorts and groups, then confirm dates and staff." href="/curriculum/delivery" icon="ri-calendar-schedule-line" />
            <WorkflowCard step="2" title="Design learning" detail="Build the modules, weeks and components those delivery groups will use." href="/curriculum/library" icon="ri-layout-4-line" />
            <WorkflowCard step="3" title="Check quality" detail="Resolve KSB and readiness gaps before learners depend on the content." href="/curriculum/quality" icon="ri-shield-check-line" />
          </section>
        </div>
      </main>
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

function SummaryCard({ label, value, detail, href, icon, loading, warning = false }: { label: string; value: number; detail: string; href: string; icon: string; loading: boolean; warning?: boolean }) {
  return <Link to={href} className="group flex items-center gap-3 rounded-xl border border-foreground-200 bg-background-50 p-4 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${warning ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700'}`}><AppIcon className={`${icon} text-xl`} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-extrabold uppercase tracking-wide text-foreground-400">{label}</span><span className="mt-0.5 block font-heading text-xl font-bold text-foreground-950">{loading ? '—' : value}</span><span className="mt-0.5 block truncate text-[11px] text-foreground-500">{detail}</span></span><AppIcon className="ri-arrow-right-s-line text-foreground-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-600" /></Link>;
}

function AttentionRow({ issue }: { issue: AttentionIssue }) {
  const tones: Record<AttentionTone, string> = { rose: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', sky: 'bg-sky-50 text-sky-700' };
  return <Link to={issue.href} className="group grid gap-3 rounded-xl border border-background-200 bg-background-100/45 p-3 transition-smooth hover:border-primary-200 hover:bg-primary-50/35 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[issue.tone]}`}><AppIcon className={`${issue.icon} text-lg`} /></span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-bold text-foreground-900">{issue.title}</span><span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-extrabold text-foreground-700 shadow-sm">{issue.count}</span></span><span className="mt-1 block text-[11px] leading-5 text-foreground-500">{issue.detail}</span></span><span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700">{issue.action}<AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" /></span></Link>;
}

function ContinueModuleRow({ module }: { module: CurriculumModule }) {
  const href = `/curriculum/module-builder?module=${encodeURIComponent(moduleIdentity(module))}`;
  const published = normalise(module.status) === 'published';
  return <Link to={href} className="group flex items-center gap-3 py-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-layout-4-line" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold text-foreground-900">{clean(module.name) || 'Untitled module'}</span><span className="mt-0.5 block truncate text-[10px] text-foreground-500">{clean(module.programme) || 'Reusable module'} · {Number(module.weeks || 0)} weeks</span></span><span className={`rounded-full px-2 py-1 text-[9px] font-extrabold uppercase ${published ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{published ? 'Published' : 'Draft'}</span><AppIcon className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-600" /></Link>;
}

function ProgrammeFocusCard({ item }: { item: ProgrammeFocus }) {
  const id = programmeIdentity(item.programme);
  return <Link to={`/curriculum/programmes/${encodeURIComponent(id)}`} className="group flex min-h-36 flex-col rounded-xl border border-background-200 bg-background-100/45 p-4 transition-smooth hover:-translate-y-0.5 hover:border-primary-200 hover:bg-background-50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-300"><div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-stack-line" /></span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-700">{item.issueCount} {item.issueCount === 1 ? 'action' : 'actions'}</span></div><h3 className="mt-3 line-clamp-1 text-[13px] font-bold text-foreground-950">{item.programme.name}</h3><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-foreground-500">{item.issues.join(' · ')}</p><span className="mt-auto inline-flex items-center gap-1 pt-3 text-[10px] font-bold text-primary-700">Open programme <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" /></span></Link>;
}

function WorkflowCard({ step, title, detail, href, icon }: { step: string; title: string; detail: string; href: string; icon: string }) {
  return <Link to={href} className="group flex gap-3 rounded-xl border border-foreground-200 bg-background-50 p-4 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><AppIcon className={`${icon} text-lg`} /></span><span className="min-w-0"><span className="text-[9px] font-extrabold uppercase tracking-widest text-primary-600">Step {step}</span><span className="mt-0.5 block text-[12px] font-bold text-foreground-900">{title}</span><span className="mt-1 block text-[11px] leading-5 text-foreground-500">{detail}</span></span></Link>;
}

function SectionHeader({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return <div className="flex flex-col gap-2 border-b border-background-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-heading text-base font-bold text-foreground-950">{title}</h2><p className="mt-1 text-[11px] text-foreground-500">{detail}</p></div><Link to={href} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:text-primary-800">{action}<AppIcon className="ri-arrow-right-line" /></Link></div>;
}

function EmptyState({ icon, title, detail, compact = false }: { icon: string; title: string; detail: string; compact?: boolean }) {
  return <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-10'}`}><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><AppIcon className={`${icon} text-xl`} /></span><p className="mt-3 text-[12px] font-bold text-foreground-900">{title}</p><p className="mt-1 max-w-md text-[11px] leading-5 text-foreground-500">{detail}</p></div>;
}

function LoadingRows({ count }: { count: number }) {
  return <div className="space-y-2 py-1">{Array.from({ length: count }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-background-100" />)}</div>;
}

function buildProgrammeFocus(programme: CurriculumProgramme, modules: CurriculumModule[], cohorts: CurriculumCohort[], groups: CurriculumGroup[]): ProgrammeFocus {
  const programmeModules = modules.filter(module => belongsToProgramme(programme, module.programmeId) || belongsToProgramme(programme, module.programme));
  const programmeCohorts = cohorts.filter(cohort => belongsToProgramme(programme, cohort.programmeId) || belongsToProgramme(programme, cohort.programme));
  const cohortIds = new Set(programmeCohorts.map(cohort => normalise(cohort.id)));
  const programmeGroups = groups.filter(group => belongsToProgramme(programme, group.programmeId) || belongsToProgramme(programme, group.programme) || cohortIds.has(normalise(group.cohortId)));
  const issues: string[] = [];
  if (Number(programme.ksbTotal || 0) === 0 && !clean(programme.ksbProfileSourceId)) issues.push('No KSB source');
  if (!programmeModules.length) issues.push('No modules');
  if (!programmeCohorts.length) issues.push('No delivery setup');
  const moduleMappingGaps = programmeModules.filter(module => Number(module.ksbCount || 0) === 0).length;
  const tutorGaps = programmeModules.filter(module => isMissingAssignment(module.tutor)).length;
  const coachGaps = programmeGroups.filter(group => isMissingAssignment(group.coach)).length;
  if (moduleMappingGaps) issues.push(`${moduleMappingGaps} mapping ${moduleMappingGaps === 1 ? 'gap' : 'gaps'}`);
  if (tutorGaps) issues.push(`${tutorGaps} without tutor`);
  if (coachGaps) issues.push(`${coachGaps} without coach`);
  return { programme, issues, issueCount: issues.length };
}

function belongsToProgramme(programme: CurriculumProgramme, value: unknown) { const key = normalise(value); return Boolean(key) && [programme.id, programme.sourceId, programme.name].some(candidate => normalise(candidate) === key); }
function programmeIdentity(programme: CurriculumProgramme) { return clean(programme.sourceId || programme.id || programme.name); }
function moduleIdentity(module: CurriculumModule) { return clean(module.moduleCatalogueId || module.catalogueId || module.id || module.sourceId || module.name); }
function clean(value: unknown) { return String(value ?? '').trim(); }
function normalise(value: unknown) { return clean(value).toLowerCase(); }
function isMissingAssignment(value: unknown) { const key = normalise(value); return !key || key === 'unassigned' || key === 'not assigned' || key === 'tbc'; }
function dateValue(value: unknown) { const parsed = Date.parse(clean(value)); return Number.isFinite(parsed) ? parsed : 0; }
