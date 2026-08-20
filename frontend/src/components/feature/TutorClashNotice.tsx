import type { CurriculumTutorAvailabilityVerdict } from '@/lib/curriculumApi';

/**
 * Why a tutor cannot take the slot being filled in, shown while they are still
 * being picked rather than after the save is refused.
 *
 * The dates are listed rather than counted: "already teaching on 3 dates" leaves
 * the reader to go and find out which, and the fix is usually to move one of the
 * two modules — a decision they can only make once they know the dates.
 *
 * Pair it with `useTutorAvailability`, and render only when the verdict says the
 * tutor is unavailable.
 */
export function TutorClashNotice({ verdict }: { verdict: CurriculumTutorAvailabilityVerdict }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900"
    >
      <p className="flex items-center gap-1.5 font-bold">
        <i className="ri-error-warning-line" aria-hidden="true" />
        {verdict.tutor} is already teaching in this slot
      </p>
      <ul className="mt-2 space-y-1.5">
        {verdict.conflicts.map(conflict => (
          <li key={conflict.moduleCatalogueId}>
            <span className="font-semibold">{conflict.moduleName}</span>
            {' '}({conflict.startTime}–{conflict.endTime})
            {conflict.group ? <span className="opacity-80"> · {conflict.group}</span> : null}
            <div className="opacity-80">{conflict.dates.join(', ')}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 opacity-80">
        Saving anyway will be refused. Pick another tutor, or move one of the two modules.
      </p>
    </div>
  );
}
