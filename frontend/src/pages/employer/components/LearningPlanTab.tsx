// Readdy WeeksTimeline + WeekActivitiesTable composition, ported for the
// employer portal. Unlike the rest of the employer components this one does
// NOT reuse a shared cross-role component — the learner-facing plan view
// (RealLearnerPlanView / LearnerPlanBody) stays untouched so its layout and
// behaviour for coach/learner routes is unaffected. Instead this reads the
// same underlying data through the exported `buildLearnerJourney` utility
// (the module -> week -> component grouping) and the exact same
// completed-ids formula RealLearnerPlanView.tsx uses, so "completed" here
// means the same thing it does on the learner's own plan — nothing here is
// invented or approximated.
import { useEffect, useMemo, useState } from 'react';
import type { LearnerDetail } from '@/api/learnerDetail';
import { buildLearnerJourney, componentTypeMeta, formatHoursMinutes, hasComponentContent, type JourneyModule } from '@/utils/learnerJourney';
import EmptyState from './EmptyState';

const WEEKS_PER_PAGE = 8;
const ACTIVITIES_PER_PAGE = 10;

type WeekStatus = 'completed' | 'current' | 'upcoming';

function WeekMarker({ status }: { status: WeekStatus }) {
  if (status === 'completed') return <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-background-50"><i className="ri-check-line text-[11px]" aria-hidden="true" /></span>;
  if (status === 'current') return <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary-500 bg-background-50"><span className="h-2 w-2 rounded-full bg-primary-600" aria-hidden="true" /></span>;
  return <span className="relative z-10 flex h-5 w-5 shrink-0 rounded-full border-2 border-background-300 bg-background-50" />;
}

const TYPE_META: Record<string, { icon: string; className: string }> = {
  video: { icon: 'ri-play-line', className: 'bg-primary-100 text-primary-700' },
  reading: { icon: 'ri-book-open-line', className: 'bg-secondary-100 text-secondary-800' },
  podcast: { icon: 'ri-mic-line', className: 'bg-accent-100 text-accent-800' },
  assignment: { icon: 'ri-file-list-3-line', className: 'bg-primary-100 text-primary-700' },
  quiz: { icon: 'ri-question-line', className: 'bg-secondary-100 text-secondary-800' },
  live_session: { icon: 'ri-live-line', className: 'bg-accent-100 text-accent-800' },
};
const DEFAULT_TYPE_META = { icon: 'ri-links-line', className: 'bg-background-200 text-foreground-600' };

function ActivityStatusPill({ completed }: { completed: boolean }) {
  if (completed) return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><i className="ri-check-line text-sm" aria-hidden="true" />Completed</span>;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-background-200 bg-background-100 px-2.5 py-1 text-xs font-medium text-foreground-500"><i className="ri-circle-line text-sm" aria-hidden="true" />Not started</span>;
}

export default function LearningPlanTab({ real, loading, loadError, onRetry }: { real: LearnerDetail | null; loading: boolean; loadError: string | null; onRetry: () => void }) {
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  // Same formula as RealLearnerPlanView.tsx's completedIds — reused verbatim
  // so "completed" never drifts from what the learner's own plan shows.
  const completedIds = useMemo(() => new Set<string>([
    ...(real?.videoProgress || []).map(v => v.componentId),
    ...(real?.componentProgress || []).map(c => c.componentId),
  ]), [real]);
  const isDone = (componentId: string | null | undefined, isQuiz: boolean | undefined, quizAttempts: unknown[] | undefined) =>
    isQuiz ? (quizAttempts?.length ?? 0) > 0 : !!componentId && completedIds.has(componentId);

  const currentWeekKey = useMemo(() => {
    for (const mod of journey) {
      for (const w of mod.weeks) {
        const openable = w.components.filter(hasComponentContent);
        const done = openable.filter(c => isDone(c.componentId, c.isQuiz, c.quizAttempts)).length;
        if (openable.length > 0 && done < openable.length) return `${mod.module}::${w.week}`;
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, completedIds]);

  const [moduleIndex, setModuleIndex] = useState(0);
  const [weekKey, setWeekKey] = useState('');
  const [page, setPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);

  // Land on the module/week the learner is currently working through, the
  // first time real data arrives.
  useEffect(() => {
    if (!journey.length || weekKey) return;
    if (currentWeekKey) {
      const idx = journey.findIndex(m => currentWeekKey.startsWith(`${m.module}::`));
      if (idx >= 0) { setModuleIndex(idx); setWeekKey(currentWeekKey); return; }
    }
    setModuleIndex(0);
    setWeekKey(`${journey[0].module}::${journey[0].weeks[0]?.week ?? ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, currentWeekKey]);

  const activeModule: JourneyModule | undefined = journey[moduleIndex];
  const activeWeek = activeModule?.weeks.find(w => `${activeModule.module}::${w.week}` === weekKey) ?? activeModule?.weeks[0];

  if (loading) return <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]"><div className="h-64 animate-pulse rounded-lg bg-background-200" /><div className="h-64 animate-pulse rounded-lg bg-background-200" /></div>;
  if (loadError) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center"><h3 className="text-base font-semibold text-foreground-950">We couldn't load the learning plan</h3><p className="mt-1 text-sm text-foreground-600">{loadError}</p><button type="button" onClick={onRetry} className="mt-4 whitespace-nowrap rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600">Try again</button></div>;
  if (!journey.length || !activeModule || !activeWeek) return <EmptyState icon="ri-road-map-line" title="No learning plan available" description="A learning plan has not been published for this learner yet." />;

  const openable = activeWeek.components.filter(hasComponentContent);
  const doneCount = openable.filter(c => isDone(c.componentId, c.isQuiz, c.quizAttempts)).length;
  const weekPercent = openable.length ? Math.round((doneCount / openable.length) * 100) : 0;

  const totalPages = Math.max(1, Math.ceil(activeModule.weeks.length / WEEKS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageWeeks = activeModule.weeks.slice((safePage - 1) * WEEKS_PER_PAGE, safePage * WEEKS_PER_PAGE);

  const totalActivityPages = Math.max(1, Math.ceil(activeWeek.components.length / ACTIVITIES_PER_PAGE));
  const safeActivityPage = Math.min(activityPage, totalActivityPages);
  const pageActivities = activeWeek.components.slice((safeActivityPage - 1) * ACTIVITIES_PER_PAGE, safeActivityPage * ACTIVITIES_PER_PAGE);

  const weekNumberMatch = activeWeek.week.match(/\d+/);

  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
    <aside className="h-fit rounded-lg border border-background-200 bg-background-50 p-4 lg:sticky lg:top-6">
      <div className="border-b border-background-200 pb-3">
        <p className="text-base font-semibold text-foreground-950">Weeks</p>
        <label htmlFor="employer-plan-module" className="mt-3 block text-xs font-medium text-foreground-500">Module</label>
        <select id="employer-plan-module" value={moduleIndex} onChange={e => { const idx = Number(e.target.value); setModuleIndex(idx); const mod = journey[idx]; setWeekKey(`${mod.module}::${mod.weeks[0]?.week ?? ''}`); setPage(1); }} className="mt-1 w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100">
          {journey.map((m, idx) => <option key={m.module} value={idx}>{m.module}</option>)}
        </select>
      </div>
      <div className="relative mt-3">
        <span className="absolute bottom-3 left-[22px] top-3 w-px bg-background-200" aria-hidden="true" />
        <div className="space-y-1">
          {pageWeeks.map(w => {
            const key = `${activeModule.module}::${w.week}`;
            const selected = key === weekKey;
            const openableW = w.components.filter(hasComponentContent);
            const doneW = openableW.filter(c => isDone(c.componentId, c.isQuiz, c.quizAttempts)).length;
            const status: WeekStatus = key === currentWeekKey ? 'current' : (openableW.length > 0 && doneW === openableW.length) ? 'completed' : 'upcoming';
            return <button key={w.week} type="button" onClick={() => { setWeekKey(key); setActivityPage(1); }} aria-current={selected ? 'true' : undefined} className={`relative flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-background-100'}`}>
              <WeekMarker status={status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground-950">{w.week}</span>
                <span className="mt-0.5 block text-xs text-foreground-500">{openableW.length ? `${doneW} of ${openableW.length} activities` : 'No activities'}</span>
              </span>
              {selected && <i className="ri-arrow-right-s-line mt-0.5 text-lg text-primary-600" aria-hidden="true" />}
            </button>;
          })}
        </div>
      </div>
      {totalPages > 1 && <div className="mt-3 flex items-center justify-between border-t border-background-200 pt-3">
        <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} className="whitespace-nowrap rounded-md border border-background-300 px-3 py-1.5 text-xs font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <span className="text-xs text-foreground-500">Page {safePage} of {totalPages}</span>
        <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="whitespace-nowrap rounded-md border border-background-300 px-3 py-1.5 text-xs font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>}
    </aside>

    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {weekNumberMatch && <p className="text-xs font-bold uppercase tracking-widest text-primary-600">Week {weekNumberMatch[0]}</p>}
          <h2 className="mt-1 text-2xl font-bold text-foreground-950">{activeWeek.week}</h2>
          <p className="mt-1 text-sm text-foreground-600">{activeModule.module}</p>
        </div>
        <div className="sm:w-64">
          <div className="flex items-baseline justify-between"><span className="text-sm text-foreground-600">Week progress</span><span className="text-xl font-bold text-foreground-950">{openable.length ? `${weekPercent}%` : 'Unavailable'}</span></div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-background-200"><div className="h-full rounded-full bg-primary-500" style={{ width: `${weekPercent}%` }} /></div>
          <p className="mt-1 text-xs text-foreground-500">{openable.length ? `${doneCount} of ${openable.length} activities` : 'No activities this week'}</p>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-foreground-950">Week activities ({activeWeek.components.length})</h3>
        <div className="mt-3">
          {activeWeek.components.length === 0 ? (
            <div className="rounded-lg border border-dashed border-background-300 bg-background-50 px-6 py-10 text-center text-sm text-foreground-600">No activities have been published for this week yet.</div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-background-200 bg-background-50">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-foreground-950 text-background-50">
                    <tr>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">Title</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">Expected time</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">KSB mapping</th>
                      <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-background-50">
                    {pageActivities.map((c, idx) => {
                      const rawType = (c.type || '').toLowerCase().replace(/[\s-]+/g, '_');
                      const meta = TYPE_META[c.isQuiz ? 'quiz' : rawType] || DEFAULT_TYPE_META;
                      const label = componentTypeMeta(c.title).label || c.title;
                      const codes = (c.ksbMappings || []).map(m => m.code).filter(Boolean);
                      return <tr key={c.componentId || `${label}-${idx}`} className="border-b border-background-200 last:border-b-0 hover:bg-background-100/60">
                        <td className="px-4 py-3"><span className={`flex h-8 w-8 items-center justify-center rounded-md ${meta.className}`}><i className={`${meta.icon} text-base`} aria-hidden="true" /></span></td>
                        <td className="px-4 py-3 text-foreground-800">{label}</td>
                        <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-foreground-600"><i className="ri-time-line text-sm" aria-hidden="true" />{c.isQuiz ? 'Unavailable' : formatHoursMinutes(c.expectedOtjh)}</span></td>
                        <td className="px-4 py-3">{codes.length ? <span className="rounded border border-background-200 bg-background-100 px-2 py-0.5 text-xs font-medium text-foreground-700">{codes.join(', ')}</span> : <span className="text-foreground-400">—</span>}</td>
                        <td className="px-4 py-3"><ActivityStatusPill completed={isDone(c.componentId, c.isQuiz, c.quizAttempts)} /></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              {totalActivityPages > 1 && <div className="flex items-center justify-between border-t border-background-200 px-4 py-3">
                <button type="button" onClick={() => setActivityPage(p => Math.max(1, p - 1))} disabled={safeActivityPage === 1} className="whitespace-nowrap rounded-md border border-background-300 px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <span className="text-sm text-foreground-500">Page {safeActivityPage} of {totalActivityPages}</span>
                <button type="button" onClick={() => setActivityPage(p => Math.min(totalActivityPages, p + 1))} disabled={safeActivityPage === totalActivityPages} className="whitespace-nowrap rounded-md border border-background-300 px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>;
}
