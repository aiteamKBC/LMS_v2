import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { trainingPlanWeekPosition, type JourneyComponent, type JourneyModule, type JourneyWeek } from '@/utils/learnerJourney';
import { buildCaseFileActivityStates, moduleActivitySummary, type ActivityStatus, type CaseFileActivityStates } from '../activityState';
import {
  flattenJourney,
  formatAttemptGrade,
  formatHours,
  formatPercent,
} from '../data';
import type { CaseFileTabProps } from '../types';
import styles from '../learnerCaseFile.module.css';

type CaseFileKsbSummary = {
  total: number;
  achieved: number;
  remaining: number;
  percent: number | null;
  knowledge: { total: number; achieved: number; percent: number | null };
  skills: { total: number; achieved: number; percent: number | null };
  behaviours: { total: number; achieved: number; percent: number | null };
};

export default function OverviewTab({ data, ksbSummary, onOpenNotes }: CaseFileTabProps & { ksbSummary?: CaseFileKsbSummary; onOpenNotes?: () => void }) {
  const flatComponents = flattenJourney(data);
  const totalWeeks = data.journey.reduce((count, module) => count + module.weeks.length, 0);
  const weekPosition = trainingPlanWeekPosition(data.detail);
  const activityStates = data.activityStates && Object.keys(data.activityStates).length > 0
    ? data.activityStates
    : buildCaseFileActivityStates(data.journey, data.detail, null);
  const programmeSummary = data.journey.reduce((totals, module) => {
    const summary = moduleActivitySummary(module, activityStates);
    totals.total += summary.total;
    totals.completed += summary.completed;
    totals.inProgress += summary['in-progress'];
    totals.notStarted += summary['not-started'];
    totals.unavailable += summary.unavailable;
    return totals;
  }, { total: 0, completed: 0, inProgress: 0, notStarted: 0, unavailable: 0 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-background-200 bg-white px-4 py-3">
        <LearningMetric label="Overall Progress" value={formatPercent(data.overallProgress)} />
        <LearningMetric label="Attendance" value={formatPercent(data.attendanceRate)} tone="warning" />
        <LearningMetric label="Actual" value={formatHours(data.otjhCompleted)} />
        <LearningMetric label="Planned" value={formatHours(data.totalExpectedOtjh || null)} tone="positive" />
        <LearningMetric label="Mapped KSBs" value={ksbSummary ? `${ksbSummary.achieved} / ${ksbSummary.total}` : '--'} />
      </div>

      <div className={styles.learningGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div className={styles.panelHeading}>
              <span className={styles.panelIcon}><AppIcon className="ri-book-open-line" /></span>
              <div>
                <h2 className={styles.panelTitle}>Programme Journey</h2>
                <p className={styles.panelSubtitle}>Read-only module, week, and component view for coach context.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <SummaryPill label="Modules" value={String(data.journey.length)} />
              <SummaryPill label="Weeks" value={String(totalWeeks)} />
              <SummaryPill label="Components" value={String(flatComponents.length)} />
              <SummaryPill label="Completed" value={String(programmeSummary.completed)} />
              <SummaryPill label="In progress" value={String(programmeSummary.inProgress)} />
              <SummaryPill label="Not started" value={String(programmeSummary.notStarted)} />
              {programmeSummary.unavailable > 0 && <SummaryPill label="Unavailable" value={String(programmeSummary.unavailable)} />}
            </div>
          </div>

          {totalWeeks === 0 ? (
            <div className={styles.panelBody}>
              <EmptyState
                variant="empty"
                size="sm"
                title="No structured plan"
                description="No structured plan has been saved for this learner yet."
              />
            </div>
          ) : (
            <div className="max-h-[680px] overflow-y-auto bg-background-100/20 p-3 md:p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-background-200 pb-3 text-[11px] text-foreground-500">
                <span className="font-semibold text-foreground-700">Status</span><LegendDot tone="bg-emerald-500" label="Complete" /><LegendDot tone="bg-primary-500" label="In progress" /><LegendDot tone="bg-background-300" label="Not started" /><LegendDot tone="bg-amber-500" label="Unavailable" />
              </div>
              <CoachPlanView modules={data.journey} activityStates={activityStates} weekPosition={weekPosition?.current ?? null} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className={`h-2 w-2 rounded-full ${tone}`} />{label}</span>;
}

function LearningMetric({
  label,
  value,
  tone = 'brand',
}: {
  label: string;
  value: string;
  tone?: 'brand' | 'positive' | 'warning';
}) {
  return (
    <div className={styles.learningMetric} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CoachPlanView({
  modules,
  activityStates,
  weekPosition,
}: {
  modules: JourneyModule[];
  activityStates: CaseFileActivityStates;
  weekPosition: number | null;
}) {
  const moduleOffsets = modules.map((_, index) => modules.slice(0, index).reduce((sum, item) => sum + item.weeks.length, 0));
  return (
    <div className="space-y-3">
      {modules.map((module, index) => (
        <CoachModuleSection
          key={`${module.module}-${index}`}
          module={module}
          moduleIndex={index}
          defaultOpen={index === 0}
          activityStates={activityStates}
          currentWeek={weekPosition != null && weekPosition > moduleOffsets[index] && weekPosition <= moduleOffsets[index] + module.weeks.length ? weekPosition - moduleOffsets[index] : null}
        />
      ))}
    </div>
  );
}

function CoachModuleSection({
  module,
  moduleIndex,
  defaultOpen,
  activityStates,
  currentWeek,
}: {
  module: JourneyModule;
  moduleIndex: number;
  defaultOpen: boolean;
  activityStates: CaseFileActivityStates;
  currentWeek: number | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const weekCount = module.weeks.length;
  const moduleComponents = module.weeks.flatMap((week) => week.components);
  const componentCount = moduleComponents.length;
  const summary = moduleActivitySummary(module, activityStates);
  const completedCount = summary.completed;
  const progress = summary.percent;
  const moduleOtjh = module.weeks.reduce((total, week) => total + (week.otjh || 0), 0);

  return (
    <article className={`overflow-hidden rounded-xl border bg-white ${currentWeek ? 'border-primary-300 ring-1 ring-primary-100' : 'border-background-200'}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-background-100/50 md:px-5"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><AppIcon className="ri-book-2-line text-sm"></AppIcon></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold uppercase tracking-[0.16em] text-primary-600">
            Module {String(moduleIndex + 1).padStart(2, '0')}
          </span>
          <span className="block truncate text-sm font-heading font-bold text-foreground-950">{module.module}</span>
          <span className="mt-0.5 block text-[12px] text-foreground-400">
            {weekCount} {weekCount === 1 ? 'week' : 'weeks'} · {componentCount} {componentCount === 1 ? 'component' : 'components'} · {progress}%
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          {currentWeek && <StatusBadge tone="info" label="Current module" size="sm" />}
          <ActivityStatusBadge status={summary.status} />
          {moduleOtjh > 0 && <SummaryPill label="OTJH" value={formatHours(moduleOtjh)} compact />}
          <SummaryPill label="Completed" value={`${completedCount} / ${componentCount}`} compact />
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
                    activityStates={activityStates}
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
  activityStates,
}: {
  week: JourneyWeek;
  defaultOpen: boolean;
  activityStates: CaseFileActivityStates;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const componentCount = week.components.length;
  const completedCount = week.components.filter((component) => activityStates[String(component.componentId || '')]?.status === 'completed').length;

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
            <span className="mt-0.5 block text-[12px] text-foreground-400">
              {completedCount} / {componentCount} completed
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
                    state={activityStates[String(component.componentId || '')] || { status: 'not-started', completedAt: null }}
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

function CoachComponentRow({ component, state }: { component: JourneyComponent; state: { status: ActivityStatus; completedAt: string | null; unavailableReason?: string } }) {
  const display = componentDisplay(component);
  const attempts = component.quizAttempts || [];
  const latestAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${display.bg}`}>
        <AppIcon className={`${display.icon} ${display.color} text-[13px]`}></AppIcon>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-400">{display.label}</p>
        <p className="text-sm font-semibold leading-snug text-foreground-900">{display.title}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {component.isQuiz && component.quizMeta?.questions != null && (
          <span className="hidden items-center gap-1 text-[12px] text-foreground-400 sm:inline-flex">
            <AppIcon className="ri-questionnaire-line text-[12px]"></AppIcon>
            {component.quizMeta.questions} {component.quizMeta.questions === 1 ? 'question' : 'questions'}
          </span>
        )}
        {!component.isQuiz && component.expectedOtjh != null && component.expectedOtjh > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground-400">
            <AppIcon className="ri-time-line text-[12px]"></AppIcon>
            {formatHours(component.expectedOtjh)}
          </span>
        )}
        {latestAttempt && (
          <StatusBadge
            tone={latestAttempt.passed ? 'positive' : 'critical'}
            label={`${formatAttemptGrade(latestAttempt)} ${latestAttempt.passed ? 'Passed' : 'Failed'}`}
            size="sm"
            showIcon
          />
        )}
        {state.completedAt && <span className="text-[11px] text-foreground-400">{new Date(state.completedAt).toLocaleDateString('en-GB')}</span>}
        {state.unavailableReason && <span className="hidden text-[11px] text-amber-700 lg:inline">{unavailableReasonLabel(state.unavailableReason)}</span>}
        <ActivityStatusBadge status={state.status} />
      </div>
    </div>
  );
}

function ActivityStatusBadge({ status }: { status: ActivityStatus }) {
  const config = status === 'completed'
    ? { tone: 'positive' as const, label: '✓ Completed' }
    : status === 'in-progress'
      ? { tone: 'caution' as const, label: '• In progress' }
      : status === 'unavailable'
        ? { tone: 'caution' as const, label: 'Unavailable' }
      : { tone: 'neutral' as const, label: '○ Not started' };
  return <StatusBadge tone={config.tone} label={config.label} size="sm" />;
}

function unavailableReasonLabel(reason: string) {
  return ({
    missing_source_component_id: 'Missing source component ID',
    missing_group_id_activity_id: 'Missing group/activity ID',
    no_aptem_result: 'No Aptem result',
    ambiguous_lineage: 'Ambiguous lineage',
    activity_source_unavailable: 'Activity source unavailable',
  } as Record<string, string>)[reason] || 'Activity unavailable';
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
  'recording placeholder': { label: 'Recording Placeholder', icon: 'ri-record-circle-line', bg: 'bg-background-100', color: 'text-foreground-500' },
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
    .replace(/Â?·/g, '|')
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
      compact ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[12px]'
    }`}>
      <span className="text-foreground-400">{label}</span>
      {value}
    </span>
  );
}
