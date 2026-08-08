import { useState } from 'react';
import { EmptyState } from '@/pages/users/components/ui';
import type { JourneyComponent, JourneyModule, JourneyWeek } from '@/utils/learnerJourney';
import {
  flattenJourney,
  formatAttemptGrade,
  formatDisplayDate,
  formatQuizAttemptScore,
  formatHours,
  formatPercent,
  quizGradeValue,
  resolveQuizAttemptModule,
  resolveQuizAttemptTitle,
  type CaseFileTabProps,
} from '../data';

export default function OverviewTab({ data }: CaseFileTabProps) {
  const flatComponents = flattenJourney(data);
  const totalWeeks = data.journey.reduce((count, module) => count + module.weeks.length, 0);
  const completedComponentIds = new Set([
    ...(data.detail?.videoProgress || []).map((item) => item.componentId),
    ...(data.detail?.componentProgress || []).map((item) => item.componentId),
  ].filter((value): value is string => Boolean(value)));
  const latestAttempts = [...(data.detail?.quizAttempts || [])]
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon="ri-pie-chart-line" label="Overall Progress" value={formatPercent(data.overallProgress)} tone="primary" />
        <StatCard icon="ri-calendar-check-line" label="Attendance" value={formatPercent(data.attendanceRate)} tone="amber" />
        <StatCard icon="ri-time-line" label="OTJH Logged" value={formatHours(data.otjhCompleted)} tone="secondary" />
        <StatCard icon="ri-line-chart-line" label="Programme Total" value={formatHours(data.totalExpectedOtjh || null)} tone="emerald" />
        <StatCard icon="ri-award-line" label="Mapped KSBs" value={String(data.detail?.ksbs.length || 0)} tone="accent" />
        <StatCard icon="ri-folder-upload-line" label="Evidence Count" value={String(data.evidenceCount ?? '--')} tone="primary" />
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-user-line text-primary-500"></AppIcon> About
            </h2>
          </div>
          <p className="text-[13px] text-foreground-600 leading-relaxed">
            {data.displayName} is currently tracked under <strong>{data.programme}</strong>
            {data.cohort ? <> in cohort <strong>{data.cohort}</strong></> : null}.
            {data.group ? <> Group assignment is <strong>{data.group}</strong>.</> : null}
            {' '}The coach snapshot shows <strong>{formatPercent(data.overallProgress)}</strong> overall progress,
            {' '}<strong>{formatPercent(data.attendanceRate)}</strong> attendance,
            {' '}and <strong>{formatHours(data.otjhCompleted)}</strong> logged against a current target of <strong>{formatHours(data.otjhTarget)}</strong>
            {' '}within an overall OTJH plan of <strong>{formatHours(data.totalExpectedOtjh || null)}</strong>.
            {' '}This learner currently has <strong>{flatComponents.length}</strong> structured component(s),
            {' '}<strong>{totalWeeks}</strong> learning week(s),
            {' '}and <strong>{data.detail?.quizAttempts.length || 0}</strong> recorded quiz attempt(s).
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-background-200 bg-background-50 shadow-[0_10px_30px_rgba(31,14,59,0.05)]">
        <div className="flex flex-col gap-3 border-b border-background-200 bg-background-100/45 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-heading font-bold text-foreground-950 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100">
                <AppIcon className="ri-route-line text-sm"></AppIcon>
              </span>
              Programme Journey
            </h2>
            <p className="mt-1 text-[12px] text-foreground-500">
              Read-only module, week, and component view for coach context.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummaryPill label="Modules" value={String(data.journey.length)} />
            <SummaryPill label="Weeks" value={String(totalWeeks)} />
            <SummaryPill label="Components" value={String(flatComponents.length)} />
          </div>
        </div>

        {totalWeeks === 0 ? (
          <div className="p-6">
            <EmptyState text="No structured plan has been saved for this learner yet." />
          </div>
        ) : (
          <div className="max-h-[680px] overflow-y-auto bg-background-100/35 p-4 md:p-5">
            <CoachPlanView modules={data.journey} completedComponentIds={completedComponentIds} />
          </div>
        )}
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-question-answer-line text-secondary-500"></AppIcon> Recent Assessments
            </h2>
            <span className="text-[11px] text-foreground-400">{data.detail?.quizAttempts.length || 0} total attempt(s)</span>
          </div>
          {latestAttempts.length === 0 ? (
            <EmptyState text="No quiz attempts have been recorded for this learner yet." />
          ) : (
            <div className="space-y-3">
              {latestAttempts.map((attempt, index) => (
                <div
                  key={`${attempt.quizId}-${attempt.attempt ?? 0}-${attempt.submittedAt}-${index}`}
                  className="flex items-center gap-4 p-3 rounded-xl bg-background-100/60 border border-foreground-200/60"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    attempt.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    <AppIcon className="ri-questionnaire-line text-base"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{resolveQuizAttemptTitle(data.detail, attempt)}</p>
                    <p className="text-[11px] text-foreground-400">
                      {resolveQuizAttemptModule(data.detail, attempt) || 'Quiz'} - Submitted {formatDisplayDate(attempt.submittedAt)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${
                      attempt.passed
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {attempt.passed ? 'Passed' : 'Submitted'}
                    </span>
                    <p className="text-[12px] font-semibold text-foreground-900 mt-1">
                      {[formatAttemptGrade(attempt), formatQuizAttemptScore(attempt)].filter(Boolean).join(' - ') || '--'}
                    </p>
                    <p className="text-[10px] text-foreground-400">
                      {attempt.ksbs?.length ? `${attempt.ksbs.length} KSB link(s)` : `${quizGradeValue(attempt)}%`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CoachPlanView({
  modules,
  completedComponentIds,
}: {
  modules: JourneyModule[];
  completedComponentIds: Set<string>;
}) {
  return (
    <div className="space-y-3">
      {modules.map((module, index) => (
        <CoachModuleSection
          key={`${module.module}-${index}`}
          module={module}
          moduleIndex={index}
          defaultOpen={index === 0}
          completedComponentIds={completedComponentIds}
        />
      ))}
    </div>
  );
}

function CoachModuleSection({
  module,
  moduleIndex,
  defaultOpen,
  completedComponentIds,
}: {
  module: JourneyModule;
  moduleIndex: number;
  defaultOpen: boolean;
  completedComponentIds: Set<string>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const weekCount = module.weeks.length;
  const componentCount = module.weeks.reduce((count, week) => count + week.components.length, 0);
  const moduleOtjh = module.weeks.reduce((total, week) => total + (week.otjh || 0), 0);

  return (
    <article className="overflow-hidden rounded-2xl border border-background-300 bg-background-50 shadow-[0_10px_26px_rgba(31,14,59,0.04)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-background-100/50 md:px-5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100">
          <AppIcon className="ri-book-2-line text-base"></AppIcon>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">
            Module {String(moduleIndex + 1).padStart(2, '0')}
          </span>
          <span className="block truncate text-sm font-heading font-bold text-foreground-950">{module.module}</span>
          <span className="mt-0.5 block text-[11px] text-foreground-400">
            {weekCount} {weekCount === 1 ? 'week' : 'weeks'} - {componentCount} {componentCount === 1 ? 'component' : 'components'}
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          {moduleOtjh > 0 && <SummaryPill label="OTJH" value={formatHours(moduleOtjh)} compact />}
          <SummaryPill label="Items" value={String(componentCount)} compact />
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
          <AppIcon className={`ri-arrow-down-s-line text-sm transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
        </span>
      </button>

      {open && (
        <div className="border-t border-background-300">
          {weekCount === 0 ? (
            <p className="px-5 py-4 text-[12px] italic text-foreground-400">No weeks added yet.</p>
          ) : (
            <div className="relative py-4 pl-10 pr-3 md:pl-12 md:pr-5">
              <div className="absolute bottom-0 left-7 top-0 w-px bg-background-300 md:left-[34px]"></div>
              <div className="space-y-2">
                {module.weeks.map((week, index) => (
                  <CoachWeekCard
                    key={`${module.module}-${week.week}-${index}`}
                    week={week}
                    defaultOpen={defaultOpen && index === 0}
                    completedComponentIds={completedComponentIds}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function CoachWeekCard({
  week,
  defaultOpen,
  completedComponentIds,
}: {
  week: JourneyWeek;
  defaultOpen: boolean;
  completedComponentIds: Set<string>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const componentCount = week.components.length;

  return (
    <div className="relative pl-6 md:pl-7">
      <div className="absolute left-[-15px] top-[19px] z-10 h-2 w-2 rounded-full bg-background-300 ring-2 ring-background-100 md:left-[-16px]"></div>
      <div className="overflow-hidden rounded-xl border border-background-300 bg-background-50 transition-all">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background-100/55"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500">
            <AppIcon className="ri-calendar-line text-sm"></AppIcon>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-heading font-bold text-foreground-800">{week.week}</span>
            <span className="mt-0.5 block text-[11px] text-foreground-400">
              {componentCount} {componentCount === 1 ? 'component' : 'components'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {week.otjh > 0 && <span className="text-xs font-semibold text-foreground-500">{formatHours(week.otjh)}</span>}
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
              <AppIcon className={`ri-arrow-down-s-line text-xs transition-transform ${open ? 'rotate-180' : ''}`}></AppIcon>
            </span>
          </span>
        </button>

        {open && (
          <div className="border-t border-background-300">
            {componentCount === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-foreground-400">No components in this week.</div>
            ) : (
              <div className="divide-y divide-background-300">
                {week.components.map((component, index) => (
                  <CoachComponentRow
                    key={component.componentId || `${component.title}-${index}`}
                    component={component}
                    completed={Boolean(component.componentId && completedComponentIds.has(component.componentId))}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CoachComponentRow({ component, completed }: { component: JourneyComponent; completed: boolean }) {
  const display = componentDisplay(component);
  const attempts = component.quizAttempts || [];
  const latestAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${display.bg}`}>
        <AppIcon className={`${display.icon} ${display.color} text-[13px]`}></AppIcon>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{display.label}</p>
        <p className="text-sm font-semibold leading-snug text-foreground-900">{display.title}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {component.isQuiz && component.quizMeta?.questions != null && (
          <span className="hidden items-center gap-1 text-[11px] text-foreground-400 sm:inline-flex">
            <AppIcon className="ri-questionnaire-line text-[10px]"></AppIcon>
            {component.quizMeta.questions} {component.quizMeta.questions === 1 ? 'question' : 'questions'}
          </span>
        )}
        {!component.isQuiz && component.expectedOtjh != null && component.expectedOtjh > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-400">
            <AppIcon className="ri-time-line text-[10px]"></AppIcon>
            {formatHours(component.expectedOtjh)}
          </span>
        )}
        {latestAttempt && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            latestAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
          }`}>
            <AppIcon className={latestAttempt.passed ? 'ri-checkbox-circle-line text-[10px]' : 'ri-close-circle-line text-[10px]'}></AppIcon>
            {formatAttemptGrade(latestAttempt)} {latestAttempt.passed ? 'Passed' : 'Failed'}
          </span>
        )}
        {completed && !component.isQuiz && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <AppIcon className="ri-checkbox-circle-line text-[10px]"></AppIcon>
            Done
          </span>
        )}
      </div>
    </div>
  );
}

type ComponentStyle = {
  label: string;
  icon: string;
  bg: string;
  color: string;
};

const COMPONENT_TYPE_STYLES: Record<string, ComponentStyle> = {
  video: { label: 'Video', icon: 'ri-play-circle-line', bg: 'bg-red-50', color: 'text-red-600' },
  quiz: { label: 'Quiz', icon: 'ri-questionnaire-line', bg: 'bg-amber-50', color: 'text-amber-600' },
  reading: { label: 'Reading', icon: 'ri-book-open-line', bg: 'bg-blue-50', color: 'text-blue-600' },
  podcast: { label: 'Podcast', icon: 'ri-headphone-line', bg: 'bg-violet-50', color: 'text-violet-600' },
  reflection: { label: 'Reflection', icon: 'ri-brain-line', bg: 'bg-purple-50', color: 'text-purple-600' },
  powerpoint: { label: 'PowerPoint', icon: 'ri-slideshow-line', bg: 'bg-orange-50', color: 'text-orange-600' },
  activity: { label: 'Activity', icon: 'ri-tools-line', bg: 'bg-orange-50', color: 'text-orange-600' },
  evidence: { label: 'Evidence', icon: 'ri-file-add-line', bg: 'bg-emerald-50', color: 'text-emerald-600' },
  'workplace evidence': { label: 'Workplace Evidence', icon: 'ri-file-add-line', bg: 'bg-emerald-50', color: 'text-emerald-600' },
  'live session': { label: 'Live Session', icon: 'ri-vidicon-line', bg: 'bg-rose-50', color: 'text-rose-600' },
  'recording placeholder': { label: 'Recording Placeholder', icon: 'ri-record-circle-line', bg: 'bg-slate-50', color: 'text-slate-600' },
};

const DEFAULT_COMPONENT_STYLE: ComponentStyle = {
  label: 'Component',
  icon: 'ri-checkbox-circle-line',
  bg: 'bg-background-100',
  color: 'text-foreground-500',
};

function componentDisplay(component: JourneyComponent) {
  const rawTitle = (component.title || '').trim();
  const parts = splitComponentTitle(rawTitle);
  const rawType = component.isQuiz ? 'quiz' : (component.type || parts[0] || '');
  const typeKey = normalizeComponentType(rawType);
  const style = COMPONENT_TYPE_STYLES[typeKey] || {
    ...DEFAULT_COMPONENT_STYLE,
    label: humanizeComponentType(parts[0] || rawType) || DEFAULT_COMPONENT_STYLE.label,
  };
  const title = parts.length > 1
    ? parts.slice(1).join(' - ')
    : rawTitle || component.description || style.label;

  return {
    ...style,
    title,
  };
}

function splitComponentTitle(title: string) {
  const dotParts = title
    .replace(/\u00C2?\u00B7/g, '|')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  if (dotParts.length > 1) {
    return dotParts;
  }

  const dashParts = title
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (dashParts.length > 1 && COMPONENT_TYPE_STYLES[normalizeComponentType(dashParts[0])]) {
    return dashParts;
  }

  return dotParts.length ? dotParts : [title];
}

function normalizeComponentType(value?: string | null) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function humanizeComponentType(value?: string | null) {
  const normalized = normalizeComponentType(value);
  if (!normalized) return '';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function SummaryPill({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-background-200 bg-background-50 font-semibold text-foreground-700 shadow-sm ${
      compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]'
    }`}>
      <span className="text-foreground-400">{label}</span>
      {value}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'accent' | 'emerald' | 'secondary' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    accent: 'bg-accent-100 text-accent-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    secondary: 'bg-secondary-100 text-secondary-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-[0_8px_24px_rgba(31,14,59,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</p>
          <p className="mt-2 text-lg font-heading font-bold text-foreground-950">{value}</p>
        </div>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${toneMap[tone]}`}>
          <AppIcon className={`${icon} text-base`}></AppIcon>
        </div>
      </div>
    </div>
  );
}
