import {
  type CurriculumProgrammeLearnerRosterResponse,
  type CurriculumProgrammeAssignedLearner,
} from '@/lib/curriculumApi';
import { useMemo, useState } from 'react';
import {
  type RosterStatusFilter,
  type RosterSort,
  learnerOtjhProgress,
  learnerTint,
  learnerInitials,
} from '@/features/curriculum/programme-detail/model/roster';
import { normalise, clean, formatHours } from '@/features/curriculum/programme-detail/model/presentation';
import { AppIcon } from '@/components/feature/AppIcon';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';

// Read-only view of the learners the enrolment team placed into a scope.
// Curriculum owns the delivery structure, not the placements, so this panel
// deliberately offers no allocation controls.
//
// The roster it is handed is already the scope's own -- asked for at
// `/curriculum/groups/<id>/learner-roster/` -- so it lists what it is given and
// filters nothing by placement. It used to be handed the whole programme's
// roster and match rows on cohort and group *names*, which quietly dropped
// learners whose stored labels had drifted from the records they were placed in.
//
// The controls here are the other kind of filtering. A cohort is 30+ people and
// a programme is several cohorts, so the list is searched, filtered by lifecycle
// and sorted, then sectioned by the cohort and group each person sits in. The
// sections are what make a long roster readable: a flat list of 90 names says
// nothing about the structure they were placed into, and the placement is the
// thing the reader is holding in their head while they scan it.
//
// Each row is a button, because the roster is the way into the one thing a
// designer actually comes here to ask: what has this person achieved in this
// scope. The figures themselves belong to the achievement read, not to this
// panel, so the row opens them rather than restating them -- with the single
// exception of off-the-job progress, which is what decides who needs chasing and
// is already on the roster row.
export function EnrolledLearnersPanel({
  roster,
  loading,
  error,
  selectedLearnerId,
  onSelectLearner,
  emptyHint,
  scopeLabel = 'this group',
}: {
  roster: CurriculumProgrammeLearnerRosterResponse | null;
  loading: boolean;
  error: string | null;
  selectedLearnerId: string;
  onSelectLearner: (learner: CurriculumProgrammeAssignedLearner | null) => void;
  emptyHint?: string;
  /** What to call this scope in the summary line, e.g. "this group" or "this programme". */
  scopeLabel?: string;
}) {
  const learners = useMemo(() => roster?.assignedLearners || [], [roster]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RosterStatusFilter>('all');
  const [sort, setSort] = useState<RosterSort>('name');

  // The Learners column in the table above counts active placements; this list
  // is asked for with learnerStatus=all, because someone paused or withdrawn is
  // still a person this scope holds and still keeps whatever they earned here.
  // Where the two disagree, say why rather than leaving the reader to wonder
  // which number is wrong.
  const inactive = useMemo(
    () => learners.filter(learner => normalise(learner.lifecycleStatus) !== 'active').length,
    [learners],
  );

  const visible = useMemo(() => {
    const needle = normalise(query);
    const matched = learners.filter(learner => {
      if (statusFilter !== 'all') {
        const isActive = normalise(learner.lifecycleStatus) === 'active';
        if (statusFilter === 'active' && !isActive) return false;
        if (statusFilter === 'inactive' && isActive) return false;
      }
      if (!needle) return true;
      // Coach, cohort and group are searched too: "who does coach 2 have here"
      // is asked as often as a person's own name.
      return [learner.name, learner.email, learner.group, learner.cohort, learner.coachName]
        .some(field => normalise(field).includes(needle));
    });

    const byName = (a: CurriculumProgrammeAssignedLearner, b: CurriculumProgrammeAssignedLearner) =>
      clean(a.name || a.email).localeCompare(clean(b.name || b.email), undefined, { sensitivity: 'base' });

    return [...matched].sort((a, b) => {
      if (sort === 'group') {
        const placement = clean(`${a.cohort} ${a.group}`)
          .localeCompare(clean(`${b.cohort} ${b.group}`), undefined, { sensitivity: 'base' });
        return placement || byName(a, b);
      }
      if (sort === 'progress') {
        // Furthest behind first: this sort exists to find who needs chasing, so
        // a learner with no target recorded sorts last rather than as 0%, which
        // would bury the people who are genuinely behind.
        const left = learnerOtjhProgress(a);
        const right = learnerOtjhProgress(b);
        if (left && right) return left.percent - right.percent || byName(a, b);
        if (left) return -1;
        if (right) return 1;
        return byName(a, b);
      }
      return byName(a, b);
    });
  }, [learners, query, sort, statusFilter]);

  // Sectioned by placement, but only when there is more than one placement in
  // view: a group's own roster is already one section, and a single header above
  // every row would be noise.
  const sections = useMemo(() => {
    const buckets = new Map<string, { cohort: string; group: string; rows: CurriculumProgrammeAssignedLearner[] }>();
    for (const learner of visible) {
      const cohort = clean(learner.cohort);
      const group = clean(learner.group);
      const key = `${cohort}|${group}`;
      const bucket = buckets.get(key) || { cohort, group, rows: [] };
      bucket.rows.push(learner);
      buckets.set(key, bucket);
    }
    return [...buckets.values()];
  }, [visible]);
  const sectioned = sections.length > 1;

  const filtering = Boolean(clean(query)) || statusFilter !== 'all';
  const controlClass = 'h-8 rounded-lg border border-background-200 bg-background-50 px-2 text-[11px] font-semibold text-foreground-700 outline-none transition-smooth focus:border-primary-300';

  const renderRow = (learner: CurriculumProgrammeAssignedLearner) => {
    const key = String(learner.id);
    const selected = key === selectedLearnerId;
    const name = clean(learner.name) || clean(learner.email) || `Learner ${learner.id}`;
    const active = normalise(learner.lifecycleStatus) === 'active';
    const otjh = learnerOtjhProgress(learner);
    return (
      <button
        key={key}
        type="button"
        onClick={() => onSelectLearner(selected ? null : learner)}
        aria-pressed={selected}
        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-smooth ${
          selected
            ? 'border-primary-300 bg-primary-50 shadow-sm'
            : 'border-background-200 bg-background-50 hover:border-primary-200 hover:bg-background-100'
        }`}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${learnerTint(key)}`}>
          {learnerInitials(name)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-bold text-foreground-900">{name}</span>
            {!active && learner.lifecycleStatus && (
              <span className="shrink-0 rounded-full bg-foreground-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-foreground-500">
                {learner.lifecycleStatus}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-foreground-500">
            {clean(learner.email) || 'No email on record'}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {learner.group ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-background-100 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-600">
                <AppIcon className="ri-group-line text-[10px]"></AppIcon>
                {learner.group}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                No group recorded
              </span>
            )}
            {/* Coach only. The tutor belongs to the module, not to the group a
                learner sits in, so naming one here would name the wrong person. */}
            {learner.coachName ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-background-100 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-600">
                <AppIcon className="ri-user-star-line text-[10px]"></AppIcon>
                {learner.coachName}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                No coach assigned
              </span>
            )}
          </span>
        </span>

        <span className="hidden w-28 shrink-0 sm:block">
          {otjh ? (
            <>
              <span className="flex items-baseline justify-between text-[10px] font-bold text-foreground-600">
                <span>{otjh.percent}%</span>
                <span className="font-semibold text-foreground-400">{formatHours(otjh.done)}/{formatHours(otjh.target)}h</span>
              </span>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-background-200">
                <span
                  className={`block h-full rounded-full ${otjh.percent >= 100 ? 'bg-emerald-500' : otjh.percent >= 50 ? 'bg-primary-400' : 'bg-accent-400'}`}
                  style={{ width: `${Math.max(otjh.percent, 2)}%` }}
                />
              </span>
            </>
          ) : (
            <span className="block text-right text-[10px] font-semibold text-foreground-400">No OTJH target set</span>
          )}
        </span>

        <AppIcon className={`shrink-0 text-sm ${selected ? 'ri-arrow-up-s-line text-primary-600' : 'ri-arrow-right-s-line text-foreground-300'}`}></AppIcon>
      </button>
    );
  };

  return (
    <>
      {loading && <p className="text-[12px] text-foreground-500"><LoadingSkeleton label="Loading assigned learners..." variant="rows" /></p>}

      {!loading && error && (
        <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">{error}</p>
      )}

      {!loading && !error && learners.length === 0 && (
        <p className="rounded-lg border border-background-200 bg-background-100 px-3 py-2 text-[12px] text-foreground-500">
          {emptyHint || 'No learners have been assigned here by the enrolment team yet.'}
        </p>
      )}

      {!loading && !error && learners.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-background-200 bg-background-100/60 p-2">
            <label className="relative min-w-[180px] flex-1">
              <AppIcon className="ri-search-line pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-foreground-400"></AppIcon>
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search name, email, group or coach"
                aria-label="Search this roster"
                className={`${controlClass} w-full pl-8`}
              />
            </label>

            <div className="flex items-center gap-1 rounded-lg border border-background-200 bg-background-50 p-0.5">
              {([
                { id: 'all', label: 'All', count: learners.length },
                { id: 'active', label: 'Active', count: learners.length - inactive },
                { id: 'inactive', label: 'Not active', count: inactive },
              ] as const).map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setStatusFilter(option.id)}
                  aria-pressed={statusFilter === option.id}
                  className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold transition-smooth ${
                    statusFilter === option.id
                      ? 'bg-primary-100 text-primary-800'
                      : 'text-foreground-500 hover:bg-background-100'
                  }`}
                >
                  {option.label}
                  <span className={statusFilter === option.id ? 'text-primary-600' : 'text-foreground-400'}>{option.count}</span>
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">Sort</span>
              <select
                value={sort}
                onChange={event => setSort(event.target.value as RosterSort)}
                aria-label="Sort this roster"
                className={controlClass}
              >
                <option value="name">Name (A-Z)</option>
                <option value="group">Cohort and group</option>
                <option value="progress">OTJH - furthest behind</option>
              </select>
            </label>
          </div>

          <p className="mb-2 text-[11px] text-foreground-500">
            {filtering
              ? `${visible.length} of ${learners.length} learner${learners.length === 1 ? '' : 's'} shown in ${scopeLabel}`
              : `${learners.length} learner${learners.length === 1 ? '' : 's'} placed in ${scopeLabel}`}
            {inactive && statusFilter === 'all' ? `, ${inactive} of them no longer active - the count above is active placements only` : ''}.
            {' '}Open one to see the off-the-job hours and KSBs they have achieved here.
          </p>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-background-200 bg-background-100 px-3 py-2 text-[12px] text-foreground-500">
              No learner in {scopeLabel} matches {clean(query) ? `"${clean(query)}"` : 'this filter'}
              {statusFilter !== 'all' ? ` with status "${statusFilter === 'active' ? 'Active' : 'Not active'}"` : ''}.
            </p>
          ) : (
            // Capped and scrolled: a cohort of 30+ would otherwise push the
            // achievement detail this list opens off the bottom of the page.
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {sectioned
                ? sections.map(section => (
                  <section key={`${section.cohort}|${section.group}`}>
                    <h4 className="sticky top-0 z-10 -mx-1 mb-1.5 flex items-center gap-1.5 bg-background-50/95 px-1 py-1 text-[10px] font-extrabold uppercase tracking-wider text-foreground-500 backdrop-blur">
                      <AppIcon className="ri-folder-user-line text-[11px] text-primary-500"></AppIcon>
                      {section.cohort || 'No cohort recorded'}
                      <AppIcon className="ri-arrow-right-s-line text-[11px] text-foreground-300"></AppIcon>
                      {section.group || 'No group recorded'}
                      <span className="ml-auto rounded-full bg-background-200 px-1.5 py-0.5 text-[9px] font-bold text-foreground-600">
                        {section.rows.length}
                      </span>
                    </h4>
                    <div className="grid gap-2 lg:grid-cols-2">{section.rows.map(renderRow)}</div>
                  </section>
                ))
                : <div className="grid gap-2 lg:grid-cols-2">{visible.map(renderRow)}</div>}
            </div>
          )}
        </>
      )}
    </>
  );
}
