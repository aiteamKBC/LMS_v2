import { offScheduleRunSentence, type OffScheduleRun } from './offScheduleRuns';

export function OffScheduleRunDetails({ runs, when }: { runs: OffScheduleRun[]; when: (iso: string) => string }) {
  if (!runs.length) return null;
  return <details className="basis-full rounded-lg border border-background-200 bg-background-50 px-2 py-1 text-[11px] font-normal text-foreground-600">
    <summary className="cursor-pointer rounded font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
      {runs.length} link {runs.length === 1 ? 'use' : 'uses'} outside this session
    </summary>
    <p className="mt-2">These uses do not count towards this session. Its attendance and recordings are kept separately.</p>
    <ul className="mt-2 space-y-2">{runs.map(run => <li key={`${run.runStartUtc}-${run.runEndUtc}`}>
      {offScheduleRunSentence(run, when)}
    </li>)}</ul>
  </details>;
}
