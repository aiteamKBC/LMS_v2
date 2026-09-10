import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { buildLearnerJourney } from '@/utils/learnerJourney';
import { PageContainer } from '@/components/ui/PageContainer';

const learnerNav = roleNavMap.learner;

function learnerRoute(base: string, kind?: string, id?: string) {
  return kind && id ? `${base}/${kind}/${id}` : base;
}

/**
 * The learner's learning-plan entry point. It keeps the two high-level choices
 * separate so the learner can either work through modules or see what is
 * already booked without changing the existing calendar or plan pages.
 */
export default function LearnerLearningPlanPage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { real, loading } = useLearnerDetailParam(kind, id);
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';
  const overviewHref = kind && id ? `/workspace/learner/${kind}/${id}` : '/workspace/learner';
  const modulesHref = learnerRoute('/learner/learning-plan/modules', kind, id);
  const trainingPlanHref = learnerRoute('/learner/training-plan-timeline', kind, id);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Learning Plan"
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
      breadcrumbCurrentLabel="Learning Plan"
    >
      <PageContainer>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to={overviewHref}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground-500 transition-colors hover:text-primary-600"
          >
            <AppIcon className="ri-arrow-left-line" />
            Back to Overview
          </Link>
          {loading ? (
            <span className="text-xs font-medium text-foreground-400">Loading your plan…</span>
          ) : (
            <span className="text-xs font-medium text-foreground-500">
              {journey.length} {journey.length === 1 ? 'module' : 'modules'} in your plan
            </span>
          )}
        </div>

        <section className="rounded-2xl border border-primary-200/60 bg-primary-50/60 p-5 shadow-sm dark:border-primary-300/20 dark:bg-primary-900/20 md:p-7">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">Your learning journey</span>
            <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight text-foreground-900 md:text-3xl">What would you like to open?</h1>
            <p className="mt-2 text-sm leading-6 text-foreground-600 md:text-base">
              Open your modules to continue learning, or view your calendar to see and book sessions with your coach.
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            to={modulesHref}
            className="group flex min-h-56 flex-col rounded-2xl border border-foreground-100/70 bg-background-50 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md md:p-6"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 transition-colors group-hover:bg-primary-100">
              <AppIcon className="ri-book-2-line text-2xl" />
            </span>
            <h2 className="mt-5 font-heading text-xl font-bold text-foreground-900">Modules</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-foreground-500">
              Open your learning modules, weeks, activities, presentations and forms.
            </p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-bold text-primary-600 group-hover:text-primary-700">
              Open Module
              <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            to="/learner/calendar"
            className="group flex min-h-56 flex-col rounded-2xl border border-foreground-100/70 bg-background-50 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md md:p-6"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 transition-colors group-hover:bg-primary-100">
              <AppIcon className="ri-calendar-2-line text-2xl" />
            </span>
            <h2 className="mt-5 font-heading text-xl font-bold text-foreground-900">Calendar</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-foreground-500">
              See your upcoming coaching and learning sessions, then book your next available session.
            </p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-bold text-primary-600 group-hover:text-primary-700">
              Open Calendar
              <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            to={trainingPlanHref}
            className="group flex min-h-56 flex-col rounded-2xl border border-foreground-100/70 bg-background-50 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md md:p-6"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-600 transition-colors group-hover:bg-violet-100">
              <AppIcon className="ri-calendar-todo-line text-2xl" />
            </span>
            <h2 className="mt-5 font-heading text-xl font-bold text-foreground-900">Training Plan</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-foreground-500">
              Review your training plan month by month alongside your learning progress.
            </p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-bold text-primary-600 group-hover:text-primary-700">
              Open Training Plan
              <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </PageContainer>
    </WorkspaceShell>
  );
}
