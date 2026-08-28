import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { curriculumNavItems } from '@/mocks/navigation';

type HubKind = 'library' | 'delivery' | 'quality';
type HubCard = {
  title: string;
  description: string;
  href: string;
  icon: string;
  meta?: string;
  tone?: 'primary' | 'sky' | 'emerald' | 'amber';
};

const HUB_COPY: Record<HubKind, { eyebrow: string; title: string; description: string }> = {
  library: {
    eyebrow: 'Reusable curriculum',
    title: 'Library',
    description: 'Create and reuse modules, KSB sources and assessments without mixing authoring work with delivery setup.',
  },
  delivery: {
    eyebrow: 'Run the curriculum',
    title: 'Delivery',
    description: 'Set up cohorts and groups, assign staff and keep every scheduled session visible from one place.',
  },
  quality: {
    eyebrow: 'Evidence-based checks',
    title: 'Quality',
    description: 'Find real curriculum gaps and go straight to the record that fixes them. No placeholder approval states.',
  },
};

export function CurriculumLibraryHub() {
  return <CurriculumHub kind="library" />;
}

export function CurriculumDeliveryHub() {
  return <CurriculumHub kind="delivery" />;
}

export function CurriculumQualityHub() {
  return <CurriculumHub kind="quality" />;
}

function CurriculumHub({ kind }: { kind: HubKind }) {
  const { data, loading: dataLoading, error: dataError } = useCurriculumData({ compact: true });
  const { programmes, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();
  const loading = dataLoading || programmesLoading;
  const error = dataError || programmesError;
  const modules = useMemo(() => data?.modules ?? [], [data?.modules]);
  const cohorts = useMemo(() => data?.cohorts ?? [], [data?.cohorts]);
  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const sessions = useMemo(() => data?.sessions ?? [], [data?.sessions]);
  const frameworks = useMemo(() => data?.ksbFrameworks ?? [], [data?.ksbFrameworks]);

  const draftModules = modules.filter(module => normalise(module.status) !== 'published');
  const modulesWithoutKsb = modules.filter(module => Number(module.ksbCount || 0) === 0);
  const unassignedTutors = modules.filter(module => isMissingAssignment(module.tutor));
  const unassignedCoaches = groups.filter(group => isMissingAssignment(group.coach));
  const programmesWithoutKsb = programmes.filter(programme => (
    Number(programme.ksbTotal || 0) === 0 && !clean(programme.ksbProfileSourceId)
  ));
  const activeCohorts = cohorts.filter(cohort => normalise(cohort.status) === 'active');

  const cards = hubCards(kind, {
    modules: modules.length,
    frameworks: frameworks.length,
    cohorts: cohorts.length,
    groups: groups.length,
    sessions: sessions.length,
    draftModules: draftModules.length,
    mappingGaps: modulesWithoutKsb.length,
  });
  const copy = HUB_COPY[kind];
  const primary = cards[0];

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={copy.title}
      pageSubtitle={copy.description}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <main className="min-h-full bg-background-100 p-4 sm:p-6">
        <div className="mx-auto max-w-[1480px] space-y-5">
          <section className="overflow-hidden rounded-2xl border border-primary-100 bg-background-50 shadow-sm">
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-7">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary-600">{copy.eyebrow}</p>
                <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground-950">{copy.title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-500">{copy.description}</p>
              </div>
              <Link
                to={primary.href}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-[12px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"
              >
                <AppIcon className={primary.icon} />
                Open {primary.title}
                <AppIcon className="ri-arrow-right-line" />
              </Link>
            </div>
          </section>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">
              Some live curriculum counts could not be loaded: {error}
            </div>
          )}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {hubStats(kind, {
              programmes: programmes.length,
              modules: modules.length,
              cohorts: activeCohorts.length,
              groups: groups.length,
              sessions: sessions.length,
              issues: programmesWithoutKsb.length + modulesWithoutKsb.length + unassignedTutors.length + unassignedCoaches.length,
            }).map(stat => (
              <StatCard key={stat.label} {...stat} loading={loading} />
            ))}
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-bold text-foreground-950">Choose what you want to do</h2>
                <p className="mt-1 text-[12px] text-foreground-500">Each destination owns one job, so you always know where a change will be saved.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {cards.map(card => <DestinationCard key={card.title} card={card} />)}
            </div>
          </section>

          {kind === 'delivery' && (
            <LiveAttentionPanel
              title="Delivery setup to finish"
              description="Assignments that can block a clean launch."
              items={[
                { label: 'Groups without a coach', value: unassignedCoaches.length, href: '/curriculum/groups', icon: 'ri-user-search-line' },
                { label: 'Modules without a tutor', value: unassignedTutors.length, href: '/curriculum/module-builder', icon: 'ri-user-settings-line' },
                { label: 'Planned or inactive cohorts', value: Math.max(0, cohorts.length - activeCohorts.length), href: '/curriculum/cohorts', icon: 'ri-calendar-todo-line' },
              ]}
            />
          )}

          {kind === 'quality' && (
            <LiveAttentionPanel
              title="Checks that need attention"
              description="Counts come from live curriculum records, not a simulated approval workflow."
              items={[
                { label: 'Programmes without a KSB source', value: programmesWithoutKsb.length, href: '/curriculum/programmes', icon: 'ri-node-tree' },
                { label: 'Modules without KSB mappings', value: modulesWithoutKsb.length, href: '/curriculum/ksb-mapping', icon: 'ri-link-unlink' },
                { label: 'Modules not yet published', value: draftModules.length, href: '/curriculum/module-builder', icon: 'ri-draft-line' },
              ]}
            />
          )}
        </div>
      </main>
    </WorkspaceShell>
  );
}

function hubCards(kind: HubKind, counts: {
  modules: number;
  frameworks: number;
  cohorts: number;
  groups: number;
  sessions: number;
  draftModules: number;
  mappingGaps: number;
}): HubCard[] {
  if (kind === 'library') {
    return [
      { title: 'Module Library', description: 'Build reusable module content with weeks and components.', href: '/curriculum/module-builder', icon: 'ri-layout-4-line', meta: `${counts.modules} modules`, tone: 'primary' },
      { title: 'KSB Sources', description: 'Manage standards and reusable KSB profiles.', href: '/curriculum/standards', icon: 'ri-node-tree', meta: `${counts.frameworks} profiles`, tone: 'sky' },
      { title: 'Week Templates', description: 'Prepare reusable week structures for faster authoring.', href: '/curriculum/week-builder', icon: 'ri-calendar-line', tone: 'emerald' },
      { title: 'Quiz Workspace', description: 'Create and edit quizzes connected to curriculum components.', href: '/curriculum/quiz-xml', icon: 'ri-question-answer-line', tone: 'amber' },
      { title: 'Question Bank', description: 'Reuse assessment questions across quizzes and modules.', href: '/curriculum/question-bank', icon: 'ri-questionnaire-line', tone: 'sky' },
      { title: 'Free Courses', description: 'Manage curriculum content that sits outside apprenticeship delivery.', href: '/curriculum/free-courses', icon: 'ri-graduation-cap-line', tone: 'emerald' },
    ];
  }
  if (kind === 'delivery') {
    return [
      { title: 'Cohorts', description: 'Set delivery windows and the groups running inside them.', href: '/curriculum/cohorts', icon: 'ri-group-line', meta: `${counts.cohorts} cohorts`, tone: 'primary' },
      { title: 'Groups', description: 'Assign coaches, delivery days and group schedules.', href: '/curriculum/groups', icon: 'ri-team-line', meta: `${counts.groups} groups`, tone: 'sky' },
      { title: 'Session Calendar', description: 'See every curriculum session in one chronological view.', href: '/curriculum/session-calendar', icon: 'ri-calendar-schedule-line', meta: `${counts.sessions} sessions`, tone: 'emerald' },
      { title: 'Teams Meetings', description: 'Review and restore the meetings attached to live sessions.', href: '/curriculum/teams-meetings', icon: 'ri-vidicon-line', tone: 'primary' },
      { title: 'Holidays', description: 'Control the dates session plans should skip.', href: '/curriculum/holidays', icon: 'ri-calendar-close-line', tone: 'amber' },
    ];
  }
  return [
    { title: 'KSB Coverage', description: 'Trace missing mappings back to their modules and components.', href: '/curriculum/ksb-mapping', icon: 'ri-node-tree', meta: `${counts.mappingGaps} module gaps`, tone: 'primary' },
    { title: 'Programme Checks', description: 'Open a programme to review its exact readiness blockers.', href: '/curriculum/programmes', icon: 'ri-shield-check-line', tone: 'emerald' },
    { title: 'Draft Content', description: 'Finish modules that are still being authored or reviewed.', href: '/curriculum/module-builder', icon: 'ri-draft-line', meta: `${counts.draftModules} drafts`, tone: 'amber' },
  ];
}

function hubStats(kind: HubKind, counts: { programmes: number; modules: number; cohorts: number; groups: number; sessions: number; issues: number }) {
  if (kind === 'library') return [
    { label: 'Programmes', value: counts.programmes, icon: 'ri-stack-line' },
    { label: 'Reusable modules', value: counts.modules, icon: 'ri-layout-4-line' },
    { label: 'Authoring issues', value: counts.issues, icon: 'ri-error-warning-line', tone: 'amber' as const },
  ];
  if (kind === 'delivery') return [
    { label: 'Active cohorts', value: counts.cohorts, icon: 'ri-group-line' },
    { label: 'Delivery groups', value: counts.groups, icon: 'ri-team-line' },
    { label: 'Scheduled sessions', value: counts.sessions, icon: 'ri-calendar-check-line' },
  ];
  return [
    { label: 'Programmes checked', value: counts.programmes, icon: 'ri-stack-line' },
    { label: 'Modules checked', value: counts.modules, icon: 'ri-layout-4-line' },
    { label: 'Open checks', value: counts.issues, icon: 'ri-error-warning-line', tone: 'amber' as const },
  ];
}

function StatCard({ label, value, icon, tone, loading }: { label: string; value: number; icon: string; tone?: 'amber'; loading: boolean }) {
  return (
    <div className="rounded-xl border border-foreground-200 bg-background-50 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700'}`}>
          <AppIcon className={`${icon} text-lg`} />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
          <p className="mt-0.5 font-heading text-xl font-bold text-foreground-950">{loading ? '—' : value}</p>
        </div>
      </div>
    </div>
  );
}

function DestinationCard({ card }: { card: HubCard }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-700',
    sky: 'bg-sky-50 text-sky-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <Link
      to={card.href}
      className="group flex min-h-40 flex-col rounded-2xl border border-foreground-200 bg-background-50 p-5 shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[card.tone || 'primary']}`}>
          <AppIcon className={`${card.icon} text-xl`} />
        </span>
        {card.meta && <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-500">{card.meta}</span>}
      </div>
      <h3 className="mt-4 font-heading text-base font-bold text-foreground-950">{card.title}</h3>
      <p className="mt-1 flex-1 text-[12px] leading-5 text-foreground-500">{card.description}</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-700">
        Open workspace <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function LiveAttentionPanel({ title, description, items }: {
  title: string;
  description: string;
  items: Array<{ label: string; value: number; href: string; icon: string }>;
}) {
  return (
    <section className="rounded-2xl border border-foreground-200 bg-background-50 p-5 shadow-sm">
      <div>
        <h2 className="font-heading text-base font-bold text-foreground-950">{title}</h2>
        <p className="mt-1 text-[12px] text-foreground-500">{description}</p>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {items.map(item => (
          <Link key={item.label} to={item.href} className="group flex items-center gap-3 rounded-xl border border-background-200 bg-background-100/60 p-3 hover:border-primary-200 hover:bg-primary-50/40">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.value ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              <AppIcon className={item.value ? item.icon : 'ri-checkbox-circle-line'} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-bold text-foreground-800">{item.label}</span>
              <span className={`mt-0.5 block text-[12px] font-extrabold ${item.value ? 'text-amber-700' : 'text-emerald-700'}`}>{item.value || 'Clear'}</span>
            </span>
            <AppIcon className="ri-arrow-right-s-line text-foreground-400 group-hover:text-primary-600" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function normalise(value: unknown) {
  return clean(value).toLowerCase();
}

function isMissingAssignment(value: unknown) {
  const key = normalise(value);
  return !key || key === 'unassigned' || key === 'not assigned' || key === 'tbc';
}
