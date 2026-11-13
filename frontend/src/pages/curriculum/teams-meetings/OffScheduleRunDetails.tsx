import { offScheduleRunSentence, type OffScheduleRun } from './offScheduleRuns';

export function OffScheduleRunDetails({ runs, when }: { runs: OffScheduleRun[]; when: (iso: string) => string }) {
  if (!runs.length) return null;
  return <details className="basis-full rounded-xl border border-background-200 bg-background-50 px-4 py-2 text-[13px] font-normal leading-6 text-foreground-600">
    <summary className="min-h-9 cursor-pointer rounded py-1.5 font-semibold text-foreground-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
      {runs.length} link {runs.length === 1 ? 'use' : 'uses'} outside this session
    </summary>
    <p className="mt-2">These uses do not count towards this session. Its attendance and recordings are kept separately.</p>
    <ul className="mt-2 space-y-3">{runs.map(run => <li key={`${run.scheduledStartUtc}-${run.runStartUtc}-${run.runEndUtc}`}>
      {offScheduleRunSentence(run, when)}
    </li>)}</ul>
  </details>;
}
