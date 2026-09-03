import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { JourneyComponent } from '@/utils/learnerJourney';
import { componentTypeMeta, gradePercent, hasComponentContent, isComponentComplete } from '@/utils/learnerJourney';
import {
  isNavigableComponent,
  toggleExpandedWeek,
  weekComponentRows,
  type SidebarWeek,
} from './weekPreview';

// ============================================================================
// The list beside an open activity: this week's activities, and the plan's
// other weeks underneath.
//
// Shared, because it is how a learner moves between activities — a quiz that
// did not have it was a dead end, reachable only by going back to the plan.
// The rows are the same wherever it appears; only the extras differ (the
// component runner adds an editable completion time for demo accounts), which
// is what `rowExtras` is for.
// ============================================================================

export interface ActivitySidebarProps {
  /** This week's activities, in plan order. */
  weekComponents: JourneyComponent[];
  weekTitle: string;
  moduleTitle: string;
  /** Every week of the module, for the dropdown list. */
  weeks: SidebarWeek[];
  completedIds: Set<string>;
  kind?: string;
  id?: string;
  /** The component being consumed, if this sidebar sits beside one. */
  currentComponentId?: string;
  /** The quiz being sat, if it sits beside one. Quizzes have no componentId. */
  currentQuizId?: number | null;
  /** Per-row completion time, when there is one to show. */
  completionTimeFor?: (component: JourneyComponent) => string | null;
  /** Anything the host page adds under a completed row. */
  rowExtras?: (component: JourneyComponent, completed: boolean) => ReactNode;
  /** Where each row goes. */
  routeFor: (component: JourneyComponent, week: string) => string;
}

export function ActivitySidebar({
  weekComponents,
  weekTitle,
  moduleTitle,
  weeks,
  completedIds,
  currentComponentId,
  currentQuizId,
  completionTimeFor,
  rowExtras,
  routeFor,
}: ActivitySidebarProps) {
  const navigate = useNavigate();
  // Which week of the plan is expanded, if any. Picking a week used to navigate
  // straight into one of its activities; it now opens under the row it belongs
  // to and whatever is on screen stays there.
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);

  // Moving to another activity collapses the list: what was expanded belonged
  // to the page the learner was reading, not the one they opened.
  useEffect(() => {
    setExpandedWeek(null);
  }, [currentComponentId, currentQuizId]);

  const weekDoneCount = weeks.find((w) => w.active)?.completed ?? 0;

  /** Whether this row is the activity the host page is showing. */
  const isCurrentRow = (c: JourneyComponent) => (
    c.isQuiz
      ? currentQuizId != null && c.quizMeta?.quizId === currentQuizId
      : Boolean(c.componentId) && c.componentId === currentComponentId
  );

  return (
    <aside className="space-y-4 lg:sticky lg:top-4">
      <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-background-300">
          <h2 className="text-sm font-heading font-bold text-foreground-800">{weekTitle || 'This week'}</h2>
          <p className="text-[11px] text-foreground-400 mt-0.5">
            {weekComponents.length} components{' '}
            {weekDoneCount > 0 && <span className="text-emerald-600 font-semibold"> · {weekDoneCount} done</span>}
          </p>
        </div>
        <ul className="divide-y divide-background-300">
          {weekComponents.map((c) => {
            const cm = componentTypeMeta(c.title);
            const isCurrent = isCurrentRow(c);
            const contentAvailable = hasComponentContent(c);
            const clickable = contentAvailable && isNavigableComponent(c) && !isCurrent;
            const attempts = c.isQuiz ? (c.quizAttempts || []) : [];
            const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
            const completed = isComponentComplete(c, completedIds);
            const completionTime = completed ? completionTimeFor?.(c) ?? null : null;
            return (
              <li key={c.componentId || c.title}>
                <button
                  disabled={!clickable}
                  onClick={() => clickable && navigate(routeFor(c, weekTitle))}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    !contentAvailable
                      ? 'cursor-not-allowed bg-background-100/70 opacity-55 grayscale'
                      : isCurrent
                        ? 'bg-primary-50'
                        : completed
                          ? `bg-emerald-50/70 ${clickable ? 'hover:bg-emerald-50 cursor-pointer' : 'cursor-default'}`
                          : clickable ? 'hover:bg-background-50 cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${completed ? 'bg-emerald-100' : cm.bg}`}>
                    <AppIcon className={completed ? 'ri-check-line text-[12px] text-emerald-700' : `${cm.icon} text-[12px] ${cm.color}`} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{cm.label}</span>
                    <span className={`block text-[13px] font-semibold leading-snug truncate ${
                      isCurrent ? 'text-primary-700' : completed ? 'text-emerald-900' : 'text-foreground-800'
                    }`}>
                      {cm.detail || cm.label}
                    </span>
                    {completionTime && (
                      <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] font-semibold tabular-nums text-emerald-700" title="Time taken">
                        <AppIcon className="ri-timer-line text-[10px]" />
                        {completionTime}
                      </span>
                    )}
                  </span>
                  {c.isQuiz && lastAttempt && (
                    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {gradePercent(lastAttempt.grade)}%
                    </span>
                  )}
                  {!contentAvailable ? (
                    <AppIcon className="ri-lock-line shrink-0 text-sm text-foreground-400" />
                  ) : completed ? (
                    <AppIcon className="ri-checkbox-circle-fill text-emerald-600 text-sm shrink-0" />
                  ) : isCurrent ? (
                    <AppIcon className="ri-focus-3-line text-primary-600 text-sm shrink-0" />
                  ) : clickable ? (
                    <AppIcon className="ri-arrow-right-s-line text-foreground-400 text-sm shrink-0" />
                  ) : null}
                </button>
                {rowExtras?.(c, completed)}
              </li>
            );
          })}
        </ul>
      </div>

      {weeks.length > 1 && (
        <div className="rounded-xl border border-background-300 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-background-300">
            <h2 className="text-sm font-heading font-bold text-foreground-800">{moduleTitle || 'Module'}</h2>
            <p className="text-[11px] text-foreground-400 mt-0.5">{weeks.length} weeks</p>
          </div>
          <ul className="divide-y divide-background-300">
            {weeks.map((w) => {
              const weekComplete = w.count > 0 && w.completed >= w.count;
              // A week with nothing in it has nothing to drop down; every other
              // week can be opened, whether or not its activities can be
              // started yet.
              const viewable = w.count > 0;
              const expanded = viewable && w.week === expandedWeek;
              return (
                <li key={w.week}>
                  <button
                    disabled={!viewable}
                    aria-expanded={viewable ? expanded : undefined}
                    onClick={() => setExpandedWeek(toggleExpandedWeek(expandedWeek, w.week))}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      !viewable
                        ? 'cursor-not-allowed bg-background-100/70 opacity-55'
                        : expanded
                          ? 'bg-background-100 cursor-pointer'
                          : weekComplete
                            ? 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                            : 'hover:bg-background-50 cursor-pointer'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      weekComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-background-200 text-foreground-500'
                    }`}>
                      <AppIcon className={`${weekComplete ? 'ri-check-line' : 'ri-calendar-line'} text-[12px]`} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[13px] font-semibold leading-snug truncate ${
                        weekComplete ? 'text-emerald-900' : w.active ? 'text-foreground-900' : 'text-foreground-700'
                      }`}>
                        {w.week}
                      </span>
                      <span className={`block text-[10px] ${weekComplete ? 'text-emerald-700' : 'text-foreground-400'}`}>
                        {w.count} components{weekComplete ? ' complete' : ''}
                      </span>
                    </span>
                    {w.active && (
                      <span className="text-[10px] font-semibold text-primary-600 shrink-0">Current</span>
                    )}
                    {weekComplete && !w.active && (
                      <span className="text-[10px] font-semibold text-emerald-700 shrink-0">Done</span>
                    )}
                    {!viewable ? (
                      <AppIcon className="ri-lock-line shrink-0 text-sm text-foreground-400" />
                    ) : (
                      <AppIcon
                        className={`shrink-0 text-sm text-foreground-400 ri-arrow-${expanded ? 'up' : 'down'}-s-line`}
                      />
                    )}
                  </button>

                  {/* The week's own activities, under the week they belong to.
                      Everything is listed, including what cannot be started
                      yet, so the count above and the list below agree. */}
                  {expanded && (
                    <ul className="border-t border-background-300 bg-background-50/60 divide-y divide-background-300/70">
                      {weekComponentRows(w, completedIds).map((row) => {
                        const rowMeta = componentTypeMeta(row.component.title);
                        return (
                          <li key={row.component.componentId || row.component.title}>
                            <button
                              type="button"
                              disabled={!row.openable}
                              onClick={() => row.openable && navigate(routeFor(row.component, w.week))}
                              className={`w-full flex items-center gap-2 pl-11 pr-4 py-2 text-left transition-colors ${
                                row.openable ? 'hover:bg-white cursor-pointer' : 'cursor-not-allowed opacity-60'
                              }`}
                            >
                              <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${rowMeta.bg}`}>
                                <AppIcon className={`${rowMeta.icon} text-[11px] ${rowMeta.color}`} />
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground-400">
                                  {rowMeta.label}
                                </span>
                                <span className={`block text-[12px] font-medium leading-snug truncate ${
                                  row.complete ? 'text-emerald-900' : 'text-foreground-800'
                                }`}>
                                  {rowMeta.detail || rowMeta.label}
                                </span>
                              </span>
                              {row.complete ? (
                                <AppIcon className="ri-checkbox-circle-fill text-emerald-600 text-[13px] shrink-0" />
                              ) : !row.openable ? (
                                <AppIcon className="ri-lock-line text-foreground-400 text-[13px] shrink-0" />
                              ) : (
                                <AppIcon className="ri-arrow-right-s-line text-foreground-400 text-[13px] shrink-0" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
