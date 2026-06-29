import { useState } from 'react';
import { MonthGroup as MonthGroupType, TrainingActivity, ACTIVITY_TYPE_META, STATUS_META } from '@/mocks/training-plan';

interface MonthGroupProps {
  group: MonthGroupType;
  defaultOpen?: boolean;
  expandAllWeeks?: boolean;
  onActivityClick: (activity: TrainingActivity) => void;
  isCurrentMonth?: boolean;
  searchQuery: string;
  filterType: string;
  filterStatus: string;
}

const WEEK_ACCENT_COLORS = [
  { border: 'border-l-primary-400', bg: 'bg-white', headerBg: 'bg-primary-50/50', badge: 'bg-primary-100 text-primary-700', dot: 'bg-primary-500' },
  { border: 'border-l-accent-400', bg: 'bg-background-50/60', headerBg: 'bg-accent-50/50', badge: 'bg-accent-100 text-accent-700', dot: 'bg-accent-500' },
  { border: 'border-l-secondary-400', bg: 'bg-white', headerBg: 'bg-secondary-50/50', badge: 'bg-secondary-100 text-secondary-700', dot: 'bg-secondary-500' },
  { border: 'border-l-amber-400', bg: 'bg-background-50/60', headerBg: 'bg-amber-50/50', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { border: 'border-l-emerald-400', bg: 'bg-white', headerBg: 'bg-emerald-50/50', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
];

export default function MonthGroup({
  group,
  defaultOpen = false,
  expandAllWeeks = false,
  onActivityClick,
  isCurrentMonth = false,
  searchQuery,
  filterType,
  filterStatus,
}: MonthGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  const filtered = group.activities.filter(a => {
    const matchSearch = !searchQuery || a.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = !filterType || a.type === filterType;
    const matchStatus = !filterStatus || a.status === filterStatus;
    return matchSearch && matchType && matchStatus;
  });

  if (filtered.length === 0 && (searchQuery || filterType || filterStatus)) return null;

  const completed = group.activities.filter(a => a.status === 'Completed').length;
  const overdue = group.activities.filter(a => a.status === 'overdue' || a.status === 'Referred').length;
  const total = group.activities.filter(a => !a.isSpecial).length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const allCompleted = completed >= total && total > 0;
  const hasOverdue = overdue > 0;

  // Filter week groups
  const visibleWeekGroups = group.weekGroups.map(wg => ({
    ...wg,
    activities: wg.activities.filter(a => {
      const matchSearch = !searchQuery || a.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchType = !filterType || a.type === filterType;
      const matchStatus = !filterStatus || a.status === filterStatus;
      return matchSearch && matchType && matchStatus;
    }),
  })).filter(wg => wg.activities.length > 0);

  return (
    <div className={`rounded-2xl border transition-all ${
      isCurrentMonth
        ? 'border-primary-300/50 bg-background-50'
        : allCompleted
        ? 'border-foreground-200/30 bg-background-50'
        : hasOverdue
        ? 'border-red-300/50 bg-background-50'
        : 'border-foreground-200/30 bg-background-50'
    }`}>
      {/* Month Header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        {/* Month status icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          allCompleted ? 'bg-emerald-100' : isCurrentMonth ? 'bg-primary-100' : hasOverdue ? 'bg-red-100' : 'bg-background-100'
        }`}>
          <i className={`${
            allCompleted ? 'ri-checkbox-circle-fill text-emerald-600' :
            isCurrentMonth ? 'ri-calendar-line text-primary-600' :
            hasOverdue ? 'ri-error-warning-fill text-red-500' :
            'ri-calendar-line text-foreground-400'
          } text-lg`}></i>
        </div>

        {/* Month label */}
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-heading font-bold uppercase tracking-wide ${
              allCompleted ? 'text-foreground-500' : isCurrentMonth ? 'text-primary-700' : hasOverdue ? 'text-foreground-800' : 'text-foreground-800'
            }`}>{group.label}</span>
            {isCurrentMonth && (
              <span className="text-xs font-semibold px-2 py-0.5 bg-primary-500 text-white rounded-full">Current</span>
            )}
            {hasOverdue && (
              <span className="text-xs font-semibold px-2 py-0.5 bg-red-500 text-white rounded-full">
                {overdue} overdue
              </span>
            )}
            {group.hasQuarterlyReview && (
              <span className="text-xs font-semibold px-2 py-0.5 bg-accent-100 text-accent-700 rounded-full">Quarterly</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-foreground-400">{completed}/{total} components</span>
            <div className="flex-1 max-w-[120px] h-1.5 bg-background-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${allCompleted ? 'bg-emerald-500' : isCurrentMonth ? 'bg-primary-500' : hasOverdue ? 'bg-red-400' : 'bg-foreground-300'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-foreground-400">{progress}%</span>
          </div>
        </div>

        {/* Toggle */}
        <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100 shrink-0">
          <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
        </div>
      </button>

      {/* Weekly structure */}
      {open && (
        <div className="border-t border-foreground-300/50">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-foreground-400">
              No activities match your filters.
            </div>
          ) : (
            <div className="space-y-3 p-3">
              {visibleWeekGroups.map((week, idx) => {
                const regularComps = week.activities.filter(a => !a.isSpecial);
                const specialComps = week.activities.filter(a => a.isSpecial);
                const accent = WEEK_ACCENT_COLORS[(week.weekNumber - 1) % WEEK_ACCENT_COLORS.length];
                const hasOverdueOrReferred = week.overdue > 0;
                const isCurrentWeek = idx === visibleWeekGroups.length - 1 && isCurrentMonth;

                return (
                  <WeekSection
                    key={week.weekNumber}
                    week={week}
                    accent={accent}
                    regularComps={regularComps}
                    specialComps={specialComps}
                    defaultOpen={expandAllWeeks || hasOverdueOrReferred || isCurrentWeek}
                    onActivityClick={onActivityClick}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   WeekSection — collapsible week block (like months)
   ───────────────────────────────────────────── */
interface WeekData {
  weekNumber: number;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  completed: number;
  overdue: number;
}

interface WeekAccent {
  border: string;
  bg: string;
  headerBg: string;
  badge: string;
  dot: string;
}

function WeekSection({
  week,
  accent,
  regularComps,
  specialComps,
  defaultOpen,
  onActivityClick,
}: {
  week: WeekData;
  accent: WeekAccent;
  regularComps: TrainingActivity[];
  specialComps: TrainingActivity[];
  defaultOpen: boolean;
  onActivityClick: (activity: TrainingActivity) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const allDone = regularComps.length > 0 && week.completed >= regularComps.length;
  const hasOverdue = week.overdue > 0;

  return (
    <div className={`rounded-xl border-l-[3px] ${accent.border} ${accent.bg} border-t border-r border-b border-foreground-200/30 overflow-hidden transition-all`}>
      {/* Week Header — clickable toggle */}
      <button
        className={`w-full flex items-center gap-3 px-4 py-3 ${accent.headerBg} border-b border-foreground-200/20 cursor-pointer text-left transition-colors hover:brightness-[0.97]`}
        onClick={() => setOpen(o => !o)}
      >
        {/* Week number badge */}
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${allDone ? 'bg-emerald-100 text-emerald-700' : hasOverdue ? 'bg-red-100 text-red-700' : accent.badge}`}>
          {allDone ? <i className="ri-check-line text-sm"></i> : week.weekNumber}
        </span>

        {/* Week label + dates */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${allDone ? 'text-emerald-700' : 'text-foreground-800'}`}>
              {week.weekLabel}
            </span>
            <span className="text-xs text-foreground-400">
              {week.weekStart} – {week.weekEnd}
            </span>
          </div>
        </div>

        {/* Week stats */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs ${allDone ? 'text-emerald-600 font-semibold' : 'text-foreground-400'}`}>
            {week.completed}/{regularComps.length} done
          </span>
          {hasOverdue && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
              {week.overdue} overdue
            </span>
          )}
          {/* Toggle arrow */}
          <div className="w-6 h-6 flex items-center justify-center rounded-md bg-foreground-100/60 shrink-0">
            <i className={`ri-arrow-down-s-line text-foreground-400 text-sm transition-transform ${open ? 'rotate-180' : ''}`}></i>
          </div>
        </div>
      </button>

      {/* Week content — collapsible */}
      {open && (
        <>
          {/* Regular components (11 items) */}
          <div className="divide-y divide-foreground-200/20">
            {regularComps.map(activity => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                onClick={() => onActivityClick(activity)}
              />
            ))}
          </div>

          {/* Special components (monthly coaching, quarterly review) */}
          {specialComps.length > 0 && (
            <div className="border-t border-foreground-300/50 divide-y divide-foreground-200/20">
              {specialComps.map(activity => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  onClick={() => onActivityClick(activity)}
                  isSpecial
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Collapsed summary bar */}
      {!open && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs text-foreground-400 bg-foreground-50/30">
          <span>{regularComps.length + specialComps.length} components</span>
          <span>·</span>
          <span>
            {regularComps.filter(a => a.status === 'Completed').length + specialComps.filter(a => a.status === 'Completed').length} done
          </span>
          {regularComps.filter(a => a.status === 'In Progress').length > 0 && (
            <>
              <span>·</span>
              <span className="text-accent-600 font-medium">{regularComps.filter(a => a.status === 'In Progress').length} active</span>
            </>
          )}
          {regularComps.filter(a => a.status === 'Not Started').length > 0 && (
            <>
              <span>·</span>
              <span>{regularComps.filter(a => a.status === 'Not Started').length} upcoming</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Activity Card — styled like "This Week" CompactComponentCard
   ───────────────────────────────────────────── */
function ActivityCard({ activity, onClick, isSpecial = false }: { activity: TrainingActivity; onClick: () => void; isSpecial?: boolean }) {
  const typeMeta = ACTIVITY_TYPE_META[activity.type] || ACTIVITY_TYPE_META['Evidence'];
  const statusMeta = STATUS_META[activity.status] || STATUS_META['Not Started'];
  const isCompleted = activity.status === 'Completed';
  const isInProgress = activity.status === 'In Progress';
  const isReferred = activity.status === 'Referred';
  const isOverdue = activity.status === 'overdue';

  return (
    <button
      className={`w-full flex items-start gap-3.5 px-4 py-3 hover:bg-background-100/60 transition-colors cursor-pointer text-left group ${
        isSpecial ? 'bg-accent-50/30 border-l-2 border-l-accent-400' : ''
      } ${
        isReferred ? 'bg-red-50/20' : ''
      } ${
        isOverdue ? 'bg-red-50/20' : ''
      }`}
      onClick={onClick}
    >
      {/* Type icon */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${typeMeta.bg}`}>
        <i className={`${activity.typeIcon || typeMeta.icon} text-sm ${typeMeta.color}`}></i>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {/* Type chip */}
              <span className={`text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${typeMeta.bg} ${typeMeta.color}`}>
                {typeMeta.label}
              </span>
              {/* Overdue pill */}
              {isOverdue && (
                <span className="text-xs font-semibold text-white bg-red-500 px-2 py-0.5 rounded-full animate-pulse">Overdue</span>
              )}
              {/* Referred pill */}
              {isReferred && (
                <span className="text-xs font-semibold text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">Referred</span>
              )}
              {/* Live badge */}
              {activity.isLive && (
                <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
              )}
              {/* Active badge */}
              {isInProgress && !activity.isLive && (
                <span className="text-xs font-semibold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">Active</span>
              )}
              {/* Done badge */}
              {isCompleted && !isSpecial && (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <i className="ri-check-line"></i> Done
                </span>
              )}
            </div>
            {/* Title */}
            <p className={`text-sm font-semibold leading-snug ${
              isCompleted && !isSpecial ? 'text-foreground-400 line-through' : 'text-foreground-900'
            } group-hover:text-primary-700 transition-colors`}>
              {activity.title}
            </p>
            {isSpecial && (
              <p className="text-xs text-accent-600 mt-0.5 font-medium">
                {activity.type === 'monthly-coaching' ? '1-to-1 Coaching Session' : 'Formal Progress Review'}
              </p>
            )}
          </div>
          {/* Status badge */}
          <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${statusMeta.bg} ${statusMeta.color}`}>
            {!isSpecial && <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusMeta.dot}`}></span>}
            {statusMeta.label}
          </span>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-x-3 gap-y-1 text-xs text-foreground-400 mt-1 flex-wrap">
          <span className="flex items-center gap-1"><i className="ri-timer-line"></i> {activity.duration}</span>
          {activity.plannedOTJH > 0 && (
            <span className="flex items-center gap-1"><i className="ri-time-line"></i> {activity.plannedOTJH}h OTJH</span>
          )}
          {activity.actualOTJH > 0 && activity.status === 'Completed' && (
            <span className="flex items-center gap-1 text-emerald-600">
              <i className="ri-check-line"></i> {activity.actualOTJH}h logged
            </span>
          )}
          <span className="flex items-center gap-1"><i className="ri-calendar-line"></i> {activity.dueDate}</span>
          {activity.points > 0 && (
            <span className="flex items-center gap-1 text-amber-600"><i className="ri-coin-line"></i> {activity.points} pts</span>
          )}
          {activity.ksbs && activity.ksbs.length > 0 && (
            <div className="flex gap-1">
              {activity.ksbs.slice(0, 3).map(k => (
                <span key={k} className="text-xs font-medium px-1.5 py-0.5 bg-accent-100 text-accent-700 rounded">{k}</span>
              ))}
              {activity.ksbs.length > 3 && (
                <span className="text-xs text-foreground-400">+{activity.ksbs.length - 3}</span>
              )}
            </div>
          )}
          {isOverdue && (
            <span className="text-xs text-red-500 font-medium flex items-center gap-1">
              <i className="ri-error-warning-line"></i>Overdue
            </span>
          )}
          {isReferred && (
            <span className="text-xs text-red-500 font-medium flex items-center gap-1">
              <i className="ri-arrow-go-back-line"></i>Referred
            </span>
          )}
        </div>
      </div>

      <i className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-400 text-lg shrink-0 transition-colors mt-1.5"></i>
    </button>
  );
}