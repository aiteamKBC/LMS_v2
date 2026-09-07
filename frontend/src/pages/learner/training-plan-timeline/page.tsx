// ============================================================================
// Learner → Training plan  (split view: Aptem plan ↔ LMS curriculum)
//
// LEFT  = the APTEM TRAINING PLAN. A list of months; each month expands to show
//         its own training-plan components (Aptem activities: a name, an Aptem
//         delivery type, and a status). Opening a month also selects it.
//
// RIGHT = the LMS CURRICULUM for the selected month. Each LMS module runs across
//         3–4 consecutive months (modules do not overlap, so a month maps to
//         exactly ONE module). The module is shown with its weeks and LMS
//         components (video / quiz / reading / assignment / …), which run far
//         longer than the months the module touches — so the pane scrolls on its
//         own and each module carries a "span bar" showing its full month range.
//
// These are TWO SEPARATE DATA SOURCES and both are placeholder for now:
//   • PLACEHOLDER_MONTHS — Aptem plan (Audit.learner_match, matched by email
//     later): [{ key, date, month, short, components: [{ activity, type, status }] }]
//   • PLACEHOLDER_MODULES — LMS curriculum (comes from elsewhere):
//     [{ id, name, monthKeys, weeks: [{ week, title, components: [{ title, type,
//     expectedOtjh, status }] }] }]
// Swapping either constant for its fetch result is the only change needed. The
// LMS component `type` values match the curriculum model (see componentTypeMeta
// in utils/learnerJourney.ts).
// ============================================================================
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { componentTypeMeta } from '@/utils/learnerJourney';
import { formatHoursMinutes } from '@/lib/format';
import { AppIcon } from '@/components/feature/AppIcon';
import { PageContainer } from '@/components/ui/PageContainer';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { StatusTone } from '@/lib/statusTone';

const learnerNav = roleNavMap.learner;
const MY_LEARNING_PATH = '/learner/my-learning';

// ---- APTEM training plan (left) --------------------------------------------
interface AptemComponent {
  activity: string;
  type: string;   // Aptem delivery type — Review, Mentoring, Digital learning, …
  status: string;
}
interface PlanMonth {
  key: string;
  date: string | null;
  month: string;
  short: string;
  components: AptemComponent[];
}

// ---- LMS curriculum (right) ------------------------------------------------
interface LmsComponent {
  title: string;
  type: string;   // curriculum type — video | quiz | reading | assignment | …
  expectedOtjh: number | null;
  status: string;
}
interface LmsWeek {
  week: string;
  title: string;
  components: LmsComponent[];
}
interface LmsModule {
  id: string;
  name: string;
  monthKeys: string[]; // the 3–4 months this module spans (non-overlapping)
  weeks: LmsWeek[];
}

const PLACEHOLDER_MONTHS: PlanMonth[] = [
  {
    key: '2025-09', date: '2025-09-01', month: 'September 2025', short: 'Sep',
    components: [
      { activity: 'Eligibility & induction', type: 'Review', status: 'Completed' },
      { activity: 'Business communication essentials', type: 'Online training – external', status: 'Completed' },
      { activity: 'Monthly progress review', type: 'Review', status: 'Completed' },
    ],
  },
  {
    key: '2025-10', date: '2025-10-01', month: 'October 2025', short: 'Oct',
    components: [
      { activity: 'Report writing', type: 'Digital learning', status: 'In progress' },
      { activity: 'Team meeting observation', type: 'Scheduled online event', status: 'Not started' },
      { activity: 'Monthly progress review', type: 'Review', status: 'Not started' },
    ],
  },
  {
    key: '2025-11', date: '2025-11-01', month: 'November 2025', short: 'Nov',
    components: [
      { activity: 'Presentation skills', type: 'Offline learning (placement/workshop)', status: 'Not started' },
      { activity: 'Reflective account', type: 'Assignment (task)', status: 'Not started' },
    ],
  },
  {
    key: '2025-12', date: '2025-12-01', month: 'December 2025', short: 'Dec',
    components: [
      { activity: 'Project scoping', type: 'Online training – external', status: 'Not started' },
      { activity: 'Workplace mentoring', type: 'Mentoring', status: 'Not started' },
    ],
  },
  {
    key: '2026-01', date: '2026-01-01', month: 'January 2026', short: 'Jan',
    components: [
      { activity: 'Stakeholder mapping', type: 'Digital learning', status: 'Not started' },
      { activity: 'Monthly progress review', type: 'Review', status: 'Not started' },
    ],
  },
  {
    key: '2026-02', date: '2026-02-01', month: 'February 2026', short: 'Feb',
    components: [
      { activity: 'Risk & issue management', type: 'Assignment (task)', status: 'Not started' },
      { activity: 'Portfolio evidence gathering', type: 'Miscellaneous', status: 'Not started' },
    ],
  },
  {
    key: '2026-03', date: '2026-03-01', month: 'March 2026', short: 'Mar',
    components: [
      { activity: 'Gateway readiness review', type: 'Review', status: 'Not started' },
      { activity: 'EPA briefing', type: 'End-point assessment', status: 'Not started' },
    ],
  },
];

const PLACEHOLDER_MODULES: LmsModule[] = [
  {
    id: 'mod-foundations',
    name: 'Business Administration Foundations',
    monthKeys: ['2025-09', '2025-10', '2025-11'], // 3-month module
    weeks: [
      {
        week: 'Week 1', title: 'Getting started',
        components: [
          { title: 'Welcome to the programme', type: 'video', expectedOtjh: 0.5, status: 'Completed' },
          { title: 'How apprenticeships work', type: 'reading', expectedOtjh: 1, status: 'Completed' },
          { title: 'Induction knowledge check', type: 'quiz', expectedOtjh: 0.5, status: 'Completed' },
        ],
      },
      {
        week: 'Week 2', title: 'Communicating at work',
        components: [
          { title: 'Written communication', type: 'powerpoint', expectedOtjh: 1.5, status: 'In progress' },
          { title: 'Active listening', type: 'podcast', expectedOtjh: 1, status: 'Not started' },
          { title: 'Communication styles reflection', type: 'reflection', expectedOtjh: 0.5, status: 'Not started' },
        ],
      },
      {
        week: 'Week 3', title: 'Working with documents',
        components: [
          { title: 'Business report structure', type: 'reading', expectedOtjh: 1.5, status: 'Not started' },
          { title: 'Draft a short report', type: 'assignment', expectedOtjh: 3, status: 'Not started' },
        ],
      },
      {
        week: 'Week 4', title: 'Evidence & review',
        components: [
          { title: 'Upload workplace evidence', type: 'workplace evidence', expectedOtjh: 2, status: 'Not started' },
          { title: 'Live catch-up with your coach', type: 'live session', expectedOtjh: 1, status: 'Not started' },
        ],
      },
    ],
  },
  {
    id: 'mod-projects',
    name: 'Managing Projects & Stakeholders',
    monthKeys: ['2025-12', '2026-01', '2026-02', '2026-03'], // 4-month module
    weeks: [
      {
        week: 'Week 5', title: 'Project fundamentals',
        components: [
          { title: 'What is a project?', type: 'video', expectedOtjh: 1, status: 'Not started' },
          { title: 'Scoping and deliverables', type: 'reading', expectedOtjh: 1.5, status: 'Not started' },
        ],
      },
      {
        week: 'Week 6', title: 'Planning & scheduling',
        components: [
          { title: 'Building a work breakdown', type: 'powerpoint', expectedOtjh: 1.5, status: 'Not started' },
          { title: 'Plan a small project', type: 'assignment', expectedOtjh: 3, status: 'Not started' },
        ],
      },
      {
        week: 'Week 7', title: 'Stakeholders',
        components: [
          { title: 'Stakeholder analysis', type: 'reading', expectedOtjh: 1, status: 'Not started' },
          { title: 'Managing difficult conversations', type: 'video', expectedOtjh: 1, status: 'Not started' },
          { title: 'Stakeholder reflection', type: 'reflection', expectedOtjh: 0.5, status: 'Not started' },
        ],
      },
      {
        week: 'Week 8', title: 'Risk & assessment prep',
        components: [
          { title: 'Risk & issue management', type: 'reading', expectedOtjh: 1.5, status: 'Not started' },
          { title: 'End-point assessment overview', type: 'quiz', expectedOtjh: 1, status: 'Not started' },
        ],
      },
    ],
  },
];

function isDone(status: string): boolean {
  return status.trim().toLowerCase() === 'completed';
}

/** Roll a set of statuses up to one tone/label for a header. */
function rollupStatuses(statuses: string[]): { tone: StatusTone; label: string } {
  if (statuses.length === 0) return { tone: 'neutral', label: 'No activity' };
  const done = statuses.filter(isDone).length;
  if (done === statuses.length) return { tone: 'positive', label: 'Complete' };
  if (done > 0) return { tone: 'info', label: 'In progress' };
  return { tone: 'neutral', label: 'Not started' };
}

/** "Sep – Nov" label for the months a module spans. */
function spanLabel(module: LmsModule, months: PlanMonth[]): string {
  const covered = months.filter((m) => module.monthKeys.includes(m.key));
  if (covered.length === 0) return '';
  if (covered.length === 1) return covered[0].short;
  return `${covered[0].short} – ${covered[covered.length - 1].short}`;
}

export default function TrainingPlanTimelinePage() {
  const navigate = useNavigate();
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { real } = useLearnerDetailParam(kind, id);

  // Swap these for the email-matched fetch results when wiring goes in.
  const months = PLACEHOLDER_MONTHS;
  const modules = PLACEHOLDER_MODULES;

  const [activeKey, setActiveKey] = useState<string>(() => (months.length ? months[0].key : ''));
  const [openMonths, setOpenMonths] = useState<string[]>(() => (months.length ? [months[0].key] : []));

  // Opening a month also selects it (drives the right-hand LMS pane).
  const onMonthClick = (key: string) => {
    setActiveKey(key);
    setOpenMonths((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  };

  const activeMonth = months.find((m) => m.key === activeKey) || null;
  // One module per month by construction — the module whose span covers it.
  const activeModule = useMemo(
    () => modules.find((mod) => mod.monthKeys.includes(activeKey)) || null,
    [modules, activeKey],
  );

  const goToMyLearning = () => navigate(MY_LEARNING_PATH);

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  const moduleComps = activeModule ? activeModule.weeks.flatMap((w) => w.components) : [];
  const moduleStatus = rollupStatuses(moduleComps.map((c) => c.status));
  const moduleHours = moduleComps.reduce((n, c) => n + (c.expectedOtjh || 0), 0);

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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
          {/* ══ LEFT: Aptem training plan, month by month ══ */}
          <Panel padding="sm" className="lg:sticky lg:top-4">
            <div className="mb-2 flex items-center gap-2 px-1">
              <AppIcon className="ri-calendar-2-line text-sm text-primary-600" />
              <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-500">Training plan</h2>
            </div>
            <div className="space-y-1.5">
              {months.map((m) => {
                const active = m.key === activeKey;
                const open = openMonths.includes(m.key);
                const status = rollupStatuses(m.components.map((c) => c.status));
                return (
                  <div
                    key={m.key}
                    className={`overflow-hidden rounded-xl border transition-colors ${
                      active ? 'border-primary-300 bg-primary-50/40' : 'border-background-200 bg-background-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onMonthClick(m.key)}
                      aria-expanded={open}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-primary-50' : 'hover:bg-background-100'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${
                          active ? 'bg-primary-600 text-white' : 'bg-background-100 text-foreground-500'
                        }`}
                      >
                        {m.short}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-bold ${active ? 'text-primary-800' : 'text-foreground-800'}`}>
                          {m.month}
                        </span>
                        <span className="mt-0.5 block text-[11px] font-medium text-foreground-400">
                          {m.components.length} {m.components.length === 1 ? 'activity' : 'activities'}
                        </span>
                      </span>
                      <span className="hidden shrink-0 sm:block lg:block">
                        <StatusBadge tone={status.tone} label={status.label} size="sm" />
                      </span>
                      <AppIcon
                        className={`ri-arrow-down-s-line shrink-0 text-base text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {open && (
                      <ul className="space-y-1 border-t border-primary-100/70 bg-white p-2">
                        {m.components.map((c, i) => (
                          <li
                            key={`${m.key}-${i}`}
                            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-background-100"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-foreground-800">{c.activity}</p>
                              <p className="text-[11px] text-foreground-400">{c.type}</p>
                            </div>
                            <StatusBadge status={c.status} size="sm" dot={false} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* ══ RIGHT: LMS curriculum for the selected month ══ */}
          <div className="space-y-3">
            <Panel padding="md">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-600">
                    {activeMonth?.month || 'No month selected'} · Course content
                  </p>
                  <h1 className="mt-0.5 truncate text-lg font-bold text-foreground-900">
                    {activeModule ? activeModule.name : 'No module this month'}
                  </h1>
                  {activeModule && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={moduleStatus.tone} label={moduleStatus.label} size="sm" />
                      <span className="text-xs text-foreground-500">
                        {moduleComps.length} components · {formatHoursMinutes(moduleHours)} planned
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={goToMyLearning}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-700"
                >
                  <AppIcon className="ri-book-open-line text-sm" />
                  My Learning
                </button>
              </div>

              {activeModule && (
                // span bar — the module runs across several months; the selected one is marked.
                <div className="mt-3 flex items-center gap-2 border-t border-background-200 pt-3">
                  <span className="flex gap-1" aria-hidden="true">
                    {months.map((m) => {
                      const covered = activeModule.monthKeys.includes(m.key);
                      const sel = m.key === activeKey;
                      return (
                        <span
                          key={m.key}
                          className={`h-1.5 w-6 rounded-full transition-colors ${covered ? 'bg-primary-500' : 'bg-background-200'} ${
                            sel && covered ? 'ring-2 ring-primary-300 ring-offset-1 ring-offset-background-50' : ''
                          }`}
                        />
                      );
                    })}
                  </span>
                  <span className="text-[11px] font-semibold text-primary-700">
                    Runs {spanLabel(activeModule, months)}
                  </span>
                </div>
              )}
            </Panel>

            {!activeModule ? (
              <Panel>
                <EmptyState
                  size="sm"
                  title="No course content this month"
                  description="No LMS module maps to this month yet. Pick another month on the left."
                />
              </Panel>
            ) : (
              activeModule.weeks.map((wk) => (
                <Panel key={wk.week} padding="md">
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-primary-600">{wk.week}</span>
                    <span className="text-sm font-bold text-foreground-900">{wk.title}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {wk.components.map((c, i) => {
                      const meta = componentTypeMeta(c.type);
                      return (
                        <li
                          key={`${wk.week}-${i}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-background-200 bg-background-50 px-3 py-2.5"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.bg} ${meta.color}`}>
                              <AppIcon className={`${meta.icon} text-base`} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground-900">{c.title}</p>
                              <p className="mt-0.5 text-[11px] font-medium capitalize text-foreground-400">
                                {meta.label}
                                {c.expectedOtjh ? ` · ${formatHoursMinutes(c.expectedOtjh)}` : ''}
                              </p>
                            </div>
                          </div>
                          <StatusBadge status={c.status} size="sm" />
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              ))
            )}
          </div>
        </div>
      </PageContainer>
    </WorkspaceShell>
  );
}
