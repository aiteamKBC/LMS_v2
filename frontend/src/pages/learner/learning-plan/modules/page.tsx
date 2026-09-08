import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { LearnerPlanBody } from '@/components/feature/RealLearnerPlanView';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { roleNavMap } from '@/mocks/navigation';
import {
  buildLearnerJourney,
  componentContentKind,
  hasComponentContent,
  isComponentComplete,
  isOpenableComponent,
  completedComponentIds,
  type JourneyComponent,
} from '@/utils/learnerJourney';
import { PageContainer } from '@/components/ui/PageContainer';

const learnerNav = roleNavMap.learner;
type ResourceKind = 'ppt' | 'form';

interface PlanResource {
  component: JourneyComponent;
  module: string;
  week: string;
}

function learnerRoute(base: string, kind?: string, id?: string) {
  return kind && id ? `${base}/${kind}/${id}` : base;
}

function resourceMatches(resource: PlanResource, resourceKind: ResourceKind) {
  const typeAndTitle = `${resource.component.type || ''} ${resource.component.title}`.toLowerCase();
  if (resourceKind === 'ppt') {
    return componentContentKind(resource.component.type) === 'slides'
      || /\bpptx?\b|powerpoint|presentation|slides?/.test(typeAndTitle);
  }
  return /\bform\b|reflection|assignment/.test(typeAndTitle);
}

function resourceHref(resource: PlanResource, kind?: string, id?: string) {
  const component = resource.component;
  if (!kind || !id || !component.componentId) return component.resourceUrl || component.liveSessionUrl || null;
  const query = `?module=${encodeURIComponent(resource.module)}&week=${encodeURIComponent(resource.week)}`;
  if (component.type === 'video' && component.videoUrl) {
    return `/learner/video/${kind}/${id}/${component.componentId}${query}`;
  }
  if (isOpenableComponent(component)) {
    return `/learner/component/${kind}/${id}/${component.componentId}${query}`;
  }
  return component.resourceUrl || component.liveSessionUrl || null;
}

function ResourceMenu({
  resourceKind,
  resources,
  kind,
  learnerId,
  completedIds,
  open,
  onToggle,
}: {
  resourceKind: ResourceKind;
  resources: PlanResource[];
  kind?: string;
  learnerId?: string;
  completedIds: Set<string>;
  open: boolean;
  onToggle: () => void;
}) {
  const label = resourceKind === 'ppt' ? 'PPT' : 'Form';
  const icon = resourceKind === 'ppt' ? 'ri-slideshow-3-line' : 'ri-file-list-3-line';

  return (
    <div className="learner-resource-menu relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-4 text-sm font-bold text-foreground-800 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
      >
        <AppIcon className={icon} />
        {label}
        <AppIcon className={`ri-arrow-down-s-line text-base transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" aria-label={`${label} resources`} className="learner-resource-menu__panel absolute left-1/2 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-foreground-200 bg-background-50 p-2 shadow-xl">
          <p className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-400">
            {resourceKind === 'ppt' ? 'PowerPoint materials' : 'Forms and activities'}
          </p>
          {resources.length === 0 ? (
            <p className="px-3 py-3 text-sm text-foreground-500">No {label} resources assigned yet.</p>
          ) : (
            <div className="space-y-1">
              {resources.map((resource) => {
                const href = resourceHref(resource, kind, learnerId);
                const complete = isComponentComplete(resource.component, completedIds);
                const labelText = `${resource.module} · ${resource.week}`;
                const content = (
                  <>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                      <AppIcon className={icon} />
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-foreground-800">{resource.component.title}</span>
                      <span className="mt-0.5 block break-words text-xs text-foreground-400">{labelText}</span>
                    </span>
                    <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      complete
                        ? 'border-emerald-200/70 bg-emerald-50 text-emerald-700'
                        : 'border-foreground-200/70 bg-background-100 text-foreground-500'
                    }`}>
                      <AppIcon className={complete ? 'ri-checkbox-circle-fill' : 'ri-circle-line'} />
                      {complete ? 'Completed' : 'Open'}
                    </span>
                    <AppIcon className="ri-arrow-right-line shrink-0 text-foreground-400" />
                  </>
                );
                if (!href) {
                  return (
                    <div key={`${resource.module}-${resource.week}-${resource.component.title}`} className="flex items-center gap-2 rounded-xl px-2 py-2 opacity-60">
                      {content}
                    </div>
                  );
                }
                if (/^https?:\/\//i.test(href)) {
                  return (
                    <a key={`${resource.module}-${resource.week}-${resource.component.title}`} href={href} target="_blank" rel="noreferrer" role="menuitem" className="flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-primary-50">
                      {content}
                    </a>
                  );
                }
                return (
                  <Link key={`${resource.module}-${resource.week}-${resource.component.title}`} to={href} role="menuitem" className="flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-primary-50">
                    {content}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Module view reached from the learner's Learning Plan hub. */
export default function LearnerLearningPlanModulesPage() {
  const navigate = useNavigate();
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { real, loading, loadError } = useLearnerDetailParam(kind, id);
  const [openResource, setOpenResource] = useState<ResourceKind | null>(null);
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const completedIds = useMemo(() => completedComponentIds(real), [real]);
  const resources = useMemo(() => journey.flatMap((module) => module.weeks.flatMap((week) => week.components
    .filter(hasComponentContent)
    .map((component) => ({ component, module: module.module, week: week.week })))), [journey]);
  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';
  const hubHref = learnerRoute('/learner/learning-plan', kind, id);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Modules"
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
      breadcrumbCurrentLabel="Modules"
    >
      <PageContainer>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={hubHref}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground-500 transition-colors hover:text-primary-600"
          >
            <AppIcon className="ri-arrow-left-line" />
            Back to Learning Plan
          </Link>
          <Link
            to="/learner/calendar"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700"
          >
            View Calendar
            <AppIcon className="ri-arrow-right-line" />
          </Link>
        </div>

        <section className="rounded-2xl border border-foreground-100/70 bg-background-50 p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-primary-600">Learning plan</span>
              <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-foreground-900 md:text-3xl">Your Modules</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-500">
                Choose an activity below, book a coaching session, or open the learning materials assigned to your plan.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/learner/calendar')}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-700"
              >
                <AppIcon className="ri-calendar-event-line" />
                Book Session
              </button>
              <ResourceMenu
                resourceKind="ppt"
                resources={resources.filter((resource) => resourceMatches(resource, 'ppt'))}
                kind={kind}
                learnerId={id}
                completedIds={completedIds}
                open={openResource === 'ppt'}
                onToggle={() => setOpenResource((current) => current === 'ppt' ? null : 'ppt')}
              />
              <ResourceMenu
                resourceKind="form"
                resources={resources.filter((resource) => resourceMatches(resource, 'form'))}
                kind={kind}
                learnerId={id}
                completedIds={completedIds}
                open={openResource === 'form'}
                onToggle={() => setOpenResource((current) => current === 'form' ? null : 'form')}
              />
            </div>
          </div>
        </section>

        <LearnerPlanBody
          real={real}
          loading={loading}
          loadError={loadError}
          pageLabel="Modules"
          note="Open a module or week to work through its activities."
          kind={kind}
          learnerId={id}
          showHero={false}
          compact
        />
      </PageContainer>
    </WorkspaceShell>
  );
}
