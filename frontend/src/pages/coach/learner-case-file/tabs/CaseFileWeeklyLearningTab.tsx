import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { AnimatedProgressCircle } from '@/components/ui/AnimatedProgressCircle';
import type { LearnerKind } from '@/api/learnerDetail';
import type { JourneyComponent } from '@/utils/learnerJourney';
import { formatHoursMinutes } from '@/utils/learnerJourney';
import { useCaseFileWeeklyLearning } from '@/features/coach/case-file/hooks/useCaseFileWeeklyLearning';
import { ActivitiesTableModern, LiveSessionSummary, ReadingWeekPanel, WeekStatCard, WeeklyLearningPlanSkeleton } from '@/pages/workspace/learner/WeeklyLearningPlan';
import { dateLabel } from '@/pages/workspace/learner/overviewSchedule';
import { activityExpectedTimeLabel } from '@/pages/workspace/learner/weeklyPlanHelpers';
import { HolidayNoteHint } from '@/components/feature/HolidayNoteHint';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from '@/pages/learner/training-plan-timeline/TrainingPlanDetails.module.css';

export function CaseFileWeeklyLearningTab({ kind, learnerId }: { kind: LearnerKind; learnerId: string }) {
  const [selection, setSelection] = useState<string>();
  const response = useCaseFileWeeklyLearning(selection);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  // Keep the navigator available while only the selected week's data loads.
  const [navigator, setNavigator] = useState(response.data?.weeks || []);
  useEffect(() => { if (response.data) setNavigator(response.data.weeks); }, [response.data]);
  const weeks = response.data?.weeks || navigator;
  const selected = response.data?.selectedWeek;
  const current = selected || weeks.find(week => week.id === selection);
  const modules = [...new Map(weeks.map(week => [week.moduleId, week.moduleTitle])).entries()];
  const moduleId = current?.moduleId || weeks[0]?.moduleId;
  const activities: JourneyComponent[] = (selected?.activities || []).map(activity => ({
    componentId: activity.id, title: activity.title, type: activity.type,
    expectedOtjh: activity.expectedHours, durationMinutes: activity.durationMinutes,
    isQuiz: activity.isQuiz,
  }));
  const summaries = Object.fromEntries((selected?.activities || []).map(activity => [activity.id, {
    status: activity.status, ksbCodes: activity.ksbCodes,
    expectedTimeLabel: activityExpectedTimeLabel({ isQuiz: activity.isQuiz, durationMinutes: activity.durationMinutes,
      expectedOtjh: null, quizMeta: activity.isQuiz ? { duration: activity.quizDuration, timeUnit: activity.quizTimeUnit } : undefined }),
  }]));
  const completedIds = new Set((selected?.activities || []).filter(item => item.completed).map(item => item.id));
  if (!weeks.length && !response.error && !response.data) return <WeeklyLearningPlanSkeleton />;
  return <section aria-label="Weekly learning plan" className={`${styles.weeklyPlan} grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]`}>
    <aside className={`${styles.weekRail} rounded-2xl border border-foreground-100 bg-background-50 p-3 shadow-sm`}>
      <h2 className="text-base font-extrabold text-foreground-950">Weeks</h2>
      {weeks.length > 0 && <div role="group" aria-label="Week marker key" className="mt-2 px-2 text-[10px] font-medium text-foreground-600">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 leading-tight">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#6eefa0]" />Attended</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#ef4444]" />Not attended</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#94a3b8]" />Upcoming</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#8b5cf6]" />Current week</span>
          {weeks.some(week => week.kind === 'reading-week') && <span className="inline-flex items-center gap-1.5"><BookOpen size={10} aria-hidden="true" />Reading week</span>}
        </div><p className="mt-3 pt-4 text-foreground-500">Outer ring shows activity progress.</p>
      </div>}
      {modules.length > 1 && <label className="mt-2.5 block text-xs font-medium text-foreground-500">Module
        <select aria-label="Module" value={moduleId} onChange={event => {
          const candidates = weeks.filter(week => week.moduleId === event.target.value);
          const initial = candidates.find(week => week.status === 'current') || candidates.find(week => week.status === 'upcoming') || candidates.at(-1);
          setSelection(initial?.id);
        }} className="mt-1 w-full rounded-lg border border-foreground-200 px-2.5 py-1.5">
          {modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
      </label>}
      <ol className={`${styles.weekList} mt-2.5 space-y-1`}>
        {weeks.filter(week => week.moduleId === moduleId).map((week, index, moduleWeeks) => <li key={week.id} className="relative pl-9">
          {index < moduleWeeks.length - 1 && <span aria-hidden="true" className="absolute left-[11px] top-8 bottom-[-0.25rem] w-px bg-foreground-200" />}
          <span role="img" className={`${styles.weekSessionStatus} absolute left-0 top-2 z-10`} aria-label={`${week.title} session: ${week.sessionState === 'missed' ? 'not attended' : week.sessionState}`} data-state={week.kind === 'reading-week' ? 'reading' : week.status === 'current' && week.sessionState !== 'attended' ? 'current' : week.sessionState}>
            {week.kind === 'reading-week' ? <BookOpen size={13} aria-hidden="true" /> : <><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" strokeWidth="2" /><AnimatedProgressCircle cx="12" cy="12" r="10" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${week.progress} 100`} pathLength="100" /></svg><span aria-hidden="true" /></>}
          </span>
          {!!week.totalActivities && <span role="progressbar" className="sr-only" aria-label={`${week.title} activity progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={week.progress} aria-valuetext={`${week.completedActivities} of ${week.totalActivities} activities complete`} />}
          <button type="button" aria-current={(selection || selected?.id) === week.id ? 'true' : undefined}
            onClick={() => { if (week.id !== selected?.id) setSelection(week.id); }} className={`block w-full rounded-lg px-2.5 py-2 text-left transition ${week.status === 'past' ? 'bg-emerald-50/70 text-emerald-950 hover:bg-emerald-50' : week.status === 'current' ? 'bg-slate-100 text-foreground-950 shadow-sm' : (selection || selected?.id) === week.id ? 'bg-primary-50 text-primary-950 shadow-sm' : week.kind === 'reading-week' ? 'bg-amber-50/75 hover:bg-amber-50' : 'hover:bg-background-100'}`}>
            <span className="block text-[13px] font-bold">{week.title}</span>
            <span className="block text-[11px] text-foreground-500">{dateLabel(week.startDate)} – {dateLabel(week.endDate)}</span>
            <span className="sr-only">{week.status === 'current' ? 'Current week' : week.status === 'past' ? 'Completed' : 'Upcoming'}</span>
          </button>
          <HolidayNoteHint note={week.holidayNote} />
        </li>)}
      </ol>
    </aside>
    <div className={`${styles.weekDetail} min-w-0 rounded-2xl border border-foreground-100 bg-background-50 p-4 shadow-sm`}>
      {response.error ? <div role="alert">{response.error} <button type="button" onClick={response.refresh}>Retry weekly learning</button></div>
        : !response.data ? <div role="status">Loading this week…</div>
          : !selected ? <EmptyState title="Your weekly plan will appear here" description="Once a module is assigned, its weeks and activities will show up in this space." /> : <>
            <div className="flex flex-col gap-4 border-b border-foreground-100 pb-5 xl:flex-row xl:justify-between">
              <div><p className="text-xs font-bold">{selected.kind === 'reading-week' ? 'Reading week' : `Week ${selected.weekNumber}`}</p>
                <h2 className="text-2xl font-extrabold">{selected.title}</h2>
                <p className="text-sm text-foreground-500">{dateLabel(selected.startDate)} – {dateLabel(selected.endDate)}</p>
                <HolidayNoteHint note={selected.holidayNote} />
              </div>
              {selected.kind !== 'reading-week' && <div className="grid w-full shrink-0 grid-cols-1 gap-3 sm:grid-cols-3 xl:w-[660px]">
                <WeekStatCard label="Week progress" value={`${selected.summary.progress}%`} percent={selected.summary.totalActivities ? selected.summary.progress : null} tone="bg-primary-600" caption={`${selected.summary.completedActivities} of ${selected.summary.totalActivities} activities`} />
                <WeekStatCard label="KSBs this week" value={selected.summary.ksbCount ? `${Math.round(selected.summary.achievedKsbCount / selected.summary.ksbCount * 10000) / 100}%` : '—'} percent={selected.summary.ksbCount ? selected.summary.achievedKsbCount / selected.summary.ksbCount * 100 : null} tone="bg-emerald-600" caption={selected.summary.ksbCount ? `${selected.summary.achievedKsbCount} of ${selected.summary.ksbCount} KSBs` : 'No KSBs mapped this week'} />
                <WeekStatCard label="OTJH this week" value={selected.summary.plannedOtjhHours ? `${Math.round((selected.summary.otjhHours || 0) / selected.summary.plannedOtjhHours * 10000) / 100}%` : '—'} percent={selected.summary.plannedOtjhHours ? (selected.summary.otjhHours || 0) / selected.summary.plannedOtjhHours * 100 : null} tone="bg-amber-500" caption={selected.summary.plannedOtjhHours ? `${formatHoursMinutes(selected.summary.otjhHours || 0)} of ${formatHoursMinutes(selected.summary.plannedOtjhHours)} hours${selected.summary.untimedActivities ? ` · ${selected.summary.untimedActivities} untimed` : ''}` : 'No expected time set'} />
              </div>}
            </div>
            <section className="mt-5" aria-labelledby="weekly-session-heading">
              {selected.kind === 'reading-week' ? <ReadingWeekPanel week={{ kind: 'reading-week', slotNumber: selected.slotNumber, date: selected.startDate, holidays: selected.holidays }} />
                : selected.liveSession ? <LiveSessionSummary derivedState={selected.liveSession.sessionState} headingId="weekly-session-heading" canJoinSession={false} now={now} week={{ kind: 'session', slotNumber: selected.slotNumber, sessionNumber: selected.weekNumber, date: selected.startDate, title: selected.liveSession.title, start: selected.liveSession.start, minutes: selected.liveSession.durationMinutes, attended: selected.liveSession.attended, joinUrl: selected.liveSession.joinUrl, holidays: selected.holidays, learningOutcomes: [] }} />
                  : <p id="weekly-session-heading">No live session is scheduled for this week.</p>}
            </section>
            {selected.kind !== 'reading-week' && <section className="mt-5" aria-labelledby="weekly-activities-heading">
              <ActivitiesTableModern components={activities} completedIds={completedIds} kind={kind} learnerId={learnerId} week={selected.title} canOpenActivities={false} summaries={summaries} />
            </section>}
          </>}
    </div>
  </section>;
}
