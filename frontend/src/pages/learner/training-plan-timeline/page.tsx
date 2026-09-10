// ============================================================================
// Learner → Training plan  (split view: Aptem plan ↔ LMS modules & progress)
//
// LEFT  = the APTEM TRAINING PLAN — months from Audit.learner_match
//         (aptem_training_plan), matched to the learner server-side by aptem_id
//         (email-confirmed). Each month expands to its training-plan activities
//         (Aptem activity name + delivery type + status). Opening a month also
//         selects it.
//
// RIGHT = the LMS MODULES & PROGRESS for the selected month — the learner's
//         real Last_audit activity feed (fetchStudentActivity, already learner-
//         gated). Activities are grouped month → module (group_name) → activity,
//         each carrying real completion, OTJH and quiz score. Because a module's
//         activities run across several months, a module naturally reappears
//         under each month it touches. Rows reuse My Learning's StudentActivityRow
//         (and its "Open material" flow) verbatim.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { fetchAptemTrainingPlan, type AptemPlanModule } from '@/api/aptemTrainingPlan';
import { fetchStudentActivity, type StudentActivityItem, type StudentActivityResponse } from '@/api/studentActivity';
import { formatHoursMinutes } from '@/lib/format';
import { AppIcon } from '@/components/feature/AppIcon';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { componentTypeMeta } from '@/utils/learnerJourney';
import type { StatusTone } from '@/lib/statusTone';
import type { LearnerKind } from '@/api/learnerDetail';

const learnerNav = roleNavMap.learner;

interface AxisMonth {
  key: string;
  label: string;
  date: string | null;
  modules: AptemPlanModule[];
}
interface ActivityModule {
  id: number;
  name: string;
  activities: StudentActivityItem[];
}

/** "YYYY-MM" bucket key for a date, or '' when undated. */
function monthKey(dateIso?: string | null): string {
  if (!dateIso) return '';
  const m = /^(\d{4})-(\d{2})/.exec(dateIso);
  return m ? `${m[1]}-${m[2]}` : '';
}
function monthLabelFromKey(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
function isDone(status?: string | null): boolean {
  return (status || '').trim().toLowerCase() === 'completed';
}
function rollupStatuses(statuses: (string | null | undefined)[]): { tone: StatusTone; label: string } {
  const known = statuses.filter((s): s is string => Boolean(s && s.trim()));
  if (known.length === 0) return { tone: 'neutral', label: 'No activity' };
  const done = known.filter(isDone).length;
  if (done === known.length) return { tone: 'positive', label: 'Complete' };
  if (done > 0) return { tone: 'info', label: 'In progress' };
  return { tone: 'neutral', label: 'Not started' };
}

export default function TrainingPlanTimelinePage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { real } = useLearnerDetailParam(kind, id);

  const [plan, setPlan] = useState<AxisMonth[] | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);

  const [activity, setActivity] = useState<StudentActivityResponse | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [activeKey, setActiveKey] = useState<string>('');
  const [openMonths, setOpenMonths] = useState<string[]>([]);

  // --- fetch the Aptem training plan (left) ---
  useEffect(() => {
    if (!kind || !id) return;
    let cancelled = false;
    setPlanLoading(true);
    setPlanError(null);
    fetchAptemTrainingPlan(kind as LearnerKind, id)
      .then((res) => {
        if (cancelled) return;
        const months: AxisMonth[] = (res.months || []).map((m, i) => {
          const key = monthKey(m.date) || `plan:${i}`;
          return {
            key,
            label: m.month || monthLabelFromKey(key) || 'Undated',
            date: m.date,
            modules: m.modules || [],
          };
        });
        setPlan(months);
      })
      .catch((err) => { if (!cancelled) setPlanError(err instanceof Error ? err.message : 'Could not load the training plan'); })
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id]);

  // --- fetch the LMS activity feed (right) ---
  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    setActivityLoading(true);
    setActivityError(null);
    fetchStudentActivity(kind as LearnerKind, id, controller.signal)
      .then((res) => setActivity(res))
      .catch((err) => { if (!controller.signal.aborted) setActivityError(err instanceof Error ? err.message : 'Could not load LMS activity'); })
      .finally(() => { if (!controller.signal.aborted) setActivityLoading(false); });
    return () => controller.abort();
  }, [kind, id]);

  // LMS activities grouped: month key → module → activities.
  const activityByMonth = useMemo(() => {
    const byMonth = new Map<string, Map<number, ActivityModule>>();
    for (const item of activity?.activities || []) {
      const mk = monthKey(item.date);
      if (!mk) continue;
      let modules = byMonth.get(mk);
      if (!modules) { modules = new Map(); byMonth.set(mk, modules); }
      let group = modules.get(item.group_id);
      if (!group) { group = { id: item.group_id, name: item.group_name || 'Unnamed module', activities: [] }; modules.set(item.group_id, group); }
      group.activities.push(item);
    }
    return byMonth;
  }, [activity]);

  // The month axis on the left: the Aptem plan when present, else fall back to
  // the months the LMS activity itself covers (so the page is never empty when
  // only one source has data).
  const axis = useMemo<AxisMonth[]>(() => {
    if (plan && plan.length) return plan;
    return [...activityByMonth.keys()]
      .sort()
      .map((key) => ({ key, label: monthLabelFromKey(key), date: `${key}-01`, modules: [] }));
  }, [plan, activityByMonth]);

  // Default selection = first month, once the axis is known.
  useEffect(() => {
    if (!activeKey && axis.length) {
      setActiveKey(axis[0].key);
      setOpenMonths([axis[0].key]);
    }
  }, [axis, activeKey]);

  const onMonthClick = (key: string) => {
    setActiveKey(key);
    setOpenMonths((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  };

  const activeModules = useMemo<ActivityModule[]>(() => {
    const modules = activityByMonth.get(activeKey);
    if (!modules) return [];
    return [...modules.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [activityByMonth, activeKey]);

  const activeMonth = axis.find((m) => m.key === activeKey) || null;
  const monthActivities = activeModules.flatMap((m) => m.activities);
  const monthDone = monthActivities.filter((a) => a.completed).length;
  const monthHours = monthActivities.filter((a) => a.hours_mapped).reduce((n, a) => n + a.actual, 0);
  const anyMonthHours = monthActivities.some((a) => a.hours_mapped);

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const noData = !planLoading && !activityLoading && axis.length === 0;

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Training plan"
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
    >
      <PageContainer>
        {noData ? (
          <Panel>
            <EmptyState
              size="sm"
              title={planError || activityError || 'No training plan for this learner'}
              description="This learner isn’t linked to an Aptem training plan or LMS activity record."
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
            {/* ══ LEFT: Aptem training plan, month by month ══ */}
            <Panel padding="sm" className="lg:sticky lg:top-4">
              <div className="mb-2 flex items-center gap-2 px-1">
                <AppIcon className="ri-calendar-2-line text-sm text-primary-600" />
                <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-500">Training plan</h2>
              </div>
              {planLoading ? (
                <RowsSkeleton rows={6} />
              ) : (
                <div className="space-y-1.5">
                  {axis.map((m) => {
                    const active = m.key === activeKey;
                    const open = openMonths.includes(m.key);
                    const status = rollupStatuses(m.modules.map((mod) => mod.components?.status));
                    const lmsCount = activityByMonth.get(m.key)?.size ?? 0;
                    return (
                      <div
                        key={m.key}
                        className={`overflow-hidden rounded-xl border transition-colors ${active ? 'border-primary-300 bg-primary-50/40' : 'border-background-200 bg-background-50'}`}
                      >
                        <button
                          type="button"
                          onClick={() => onMonthClick(m.key)}
                          aria-expanded={open}
                          aria-pressed={active}
                          className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${active ? 'bg-primary-50' : 'hover:bg-background-100'}`}
                        >
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px] ${active ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-500'}`}>
                            <AppIcon className="ri-calendar-2-line text-sm" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm font-bold ${active ? 'text-primary-800' : 'text-foreground-800'}`}>{m.label}</span>
                            <span className="mt-0.5 block text-[11px] font-medium text-foreground-400">
                              {m.modules.length} plan {m.modules.length === 1 ? 'activity' : 'activities'}
                              {lmsCount ? ` · ${lmsCount} LMS ${lmsCount === 1 ? 'module' : 'modules'}` : ''}
                            </span>
                          </span>
                          {m.modules.length > 0 && (
                            <span className="hidden shrink-0 sm:block">
                              <StatusBadge tone={status.tone} label={status.label} size="sm" />
                            </span>
                          )}
                          <AppIcon className={`ri-arrow-down-s-line shrink-0 text-base text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                        {open && (
                          m.modules.length === 0 ? (
                            <p className="border-t border-primary-100/70 bg-white px-3 py-3 text-[12px] text-foreground-400">
                              No Aptem plan activities recorded for this month.
                            </p>
                          ) : (
                            <ul className="space-y-1 border-t border-primary-100/70 bg-white p-2">
                              {m.modules.map((mod, i) => (
                                <li key={`${m.key}-${i}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-background-100">
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] font-medium text-foreground-800">{mod.module || 'Activity'}</p>
                                    {mod.components?.type && <p className="text-[11px] text-foreground-400">{mod.components.type}</p>}
                                  </div>
                                  {mod.components?.status && <StatusBadge status={mod.components.status} size="sm" dot={false} />}
                                </li>
                              ))}
                            </ul>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* ══ RIGHT: LMS modules & progress for the selected month ══ */}
            <div className="space-y-3">
              <Panel padding="md">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-600">
                  {activeMonth?.label || 'No month selected'} · LMS activity
                </p>
                <h1 className="mt-0.5 text-lg font-bold text-foreground-900">
                  {activeModules.length} {activeModules.length === 1 ? 'module' : 'modules'} this month
                </h1>
                <p className="mt-1 text-xs text-foreground-500">
                  {monthActivities.length} {monthActivities.length === 1 ? 'activity' : 'activities'} · {monthDone} completed · Recorded OTJH {anyMonthHours ? formatHoursMinutes(monthHours) : 'unavailable'}
                </p>
              </Panel>

              {activityLoading ? (
                <Panel><RowsSkeleton rows={6} /></Panel>
              ) : activityError ? (
                <Panel><EmptyState size="sm" variant="error" title="Could not load LMS activity" description={activityError} /></Panel>
              ) : activeModules.length === 0 ? (
                <Panel>
                  <EmptyState size="sm" title="No LMS activity this month" description="No recorded module activity falls in this month. Pick another month on the left." />
                </Panel>
              ) : (
                activeModules.map((module) => {
                  const complete = module.activities.filter((a) => a.completed).length;
                  const moduleHasHours = module.activities.some((a) => a.hours_mapped);
                  const moduleHours = module.activities.reduce((n, a) => n + (a.hours_mapped ? a.actual : 0), 0);
                  return (
                    <Panel key={module.id} padding="none" className="overflow-hidden">
                      <div className="flex items-center gap-3 border-b border-foreground-100 px-4 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                          <AppIcon className="ri-book-open-line text-base" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-foreground-900">{module.name}</p>
                          <p className="text-[11px] text-foreground-500">
                            {complete} of {module.activities.length} completed · Recorded OTJH {moduleHasHours ? formatHoursMinutes(moduleHours) : 'unavailable'}
                          </p>
                        </div>
                        <StatusBadge
                          tone={complete === module.activities.length ? 'positive' : complete > 0 ? 'info' : 'neutral'}
                          label={complete === module.activities.length ? 'Complete' : complete > 0 ? 'In progress' : 'Not started'}
                          size="sm"
                        />
                      </div>
                      <div className="divide-y divide-foreground-100">
                        {module.activities.map((item) => {
                          const materialMeta = componentTypeMeta(item.category);
                          const score = item.quiz_score != null && item.quiz_maximum_score
                            ? `${item.quiz_score}/${item.quiz_maximum_score}`
                            : null;
                          return (
                            <div key={item.activity_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${materialMeta.bg}`}>
                                <AppIcon className={`${materialMeta.icon} text-[14px] ${materialMeta.color}`} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-semibold text-foreground-800">{item.activity}</p>
                                <p className="mt-0.5 text-[10px] text-foreground-500">{[item.category, item.date, score].filter(Boolean).join(' · ')}</p>
                              </div>
                              <span className="text-right text-[11px] text-foreground-500">
                                <span className="block">OTJH: {item.hours_mapped ? formatHoursMinutes(item.actual) : 'Unavailable'}</span>
                                <span className="block">Planned: {item.planned_hours_mapped ? formatHoursMinutes(item.planned) : 'Unavailable'}</span>
                              </span>
                              <StatusBadge tone={item.completed ? 'positive' : 'neutral'} label={item.completed ? 'Completed' : (item.status || 'Not started')} size="sm" />
                            </div>
                          );
                        })}
                      </div>
                    </Panel>
                  );
                })
              )}
            </div>
          </div>
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
