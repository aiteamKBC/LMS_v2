import type { RecordingsDelivery, RecordingsModule } from '@/api/sessionResults';
import type { Lecture, RecordingFilter } from '../types';
import { formatFullDate, lectureNeedsAttention, lectureReadyCount } from '../utils';
import { agendaMatches, matchesLectureQuery } from '../filters';

interface Props {
  modules: RecordingsModule[];
  deliveries: RecordingsDelivery[];
  lectures: Lecture[];
  query: string;
  programme: string;
  statusFilter: RecordingFilter;
  includeInactive: boolean;
  onOpenLecture: (lecture: Lecture) => void;
}

/** The module catalogue is independent of whether Teams has booked a meeting. */
export default function ModuleDirectory({ modules, deliveries, lectures, query, programme, statusFilter, includeInactive, onOpenLecture }: Props) {
  const byModule = new Map<string, Lecture[]>();
  for (const lecture of lectures) {
    const list = byModule.get(lecture.moduleId) ?? [];
    list.push(lecture);
    byModule.set(lecture.moduleId, list);
  }
  const deliveryByModule = new Map(deliveries.map(item => [item.moduleId, item]));
  const needle = query.trim().toLocaleLowerCase();
  const shown = modules.filter(module => {
    if (!includeInactive && (module.archived || !module.programmeActive)) return false;
    if (programme !== 'all' && module.programme !== programme) return false;
    const sessions = byModule.get(module.moduleId) ?? [];
    if (statusFilter === 'ready' && !sessions.some(item => lectureReadyCount(item) > 0)) return false;
    if (statusFilter === 'attention' && !sessions.some(lectureNeedsAttention)) return false;
    if (!['all', 'ready', 'attention'].includes(statusFilter) && !sessions.some(lecture => agendaMatches(lecture, statusFilter, Date.now()))) return false;
    return !needle || `${module.title} ${module.programme} ${module.cohort} ${module.group}`.toLocaleLowerCase().includes(needle) || sessions.some(lecture => matchesLectureQuery(lecture, query));
  });

  return <section aria-label="All LMS modules" className="mt-4 rounded-xl border border-background-200 bg-background-50 p-4 sm:p-5">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-heading text-lg font-bold text-foreground-950">All LMS modules</h2>
        <p className="mt-1 text-xs text-foreground-600">Every saved module delivery appears here, including modules without a dated lecture or recording.</p>
      </div>
      <span className="text-sm font-semibold text-primary-700">{shown.length} of {modules.length} modules</span>
    </div>
    {shown.length === 0 ? <p className="mt-4 rounded-lg bg-background-100 p-4 text-sm text-foreground-600">No modules match the current search and filters.</p>
      : <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto pr-1 scrollbar-slim">
        {shown.map(module => {
          const sessions = byModule.get(module.moduleId) ?? [];
          const saved = deliveryByModule.get(module.moduleId)?.recordingCount ?? 0;
          const ready = sessions.reduce((count, lecture) => count + lectureReadyCount(lecture), 0);
          return <details key={module.moduleId} className="group min-w-0 rounded-lg border border-background-200 bg-background-50 open:border-primary-300">
            <summary className="flex min-w-0 cursor-pointer flex-wrap items-center justify-between gap-2 p-3 marker:text-primary-600 sm:flex-nowrap">
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-semibold text-foreground-950">{module.title}</span>
                <span className="mt-0.5 block break-words text-xs text-foreground-600">{[module.programme, module.cohort, module.group].filter(Boolean).join(' · ') || 'Module delivery'}</span>
              </span>
              <span className="flex shrink-0 flex-wrap gap-1 text-[11px] text-foreground-600">
                {module.archived && <span className="rounded-full bg-slate-100 px-2 py-1">Archived</span>}
                <span className="rounded-full bg-primary-50 px-2 py-1">{sessions.length} dated</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1">{ready} ready</span>
                {saved > ready && <span className="rounded-full bg-background-100 px-2 py-1">{saved} recording entries</span>}
              </span>
            </summary>
            <div className="border-t border-background-200 p-3">
              {sessions.length === 0 ? <p className="text-xs text-foreground-600">No dated lecture is saved for this module in the LMS. No Teams meeting or recording is assumed.</p>
                : <div className="max-h-60 space-y-1.5 overflow-y-auto">
                  {sessions.map(lecture => <button key={lecture.id} type="button" onClick={() => onOpenLecture(lecture)}
                    className="flex w-full min-w-0 items-start justify-between gap-2 rounded-md bg-background-100 px-3 py-2 text-left hover:bg-primary-50">
                    <span className="min-w-0 break-words text-xs font-semibold text-foreground-900">{lecture.title}</span>
                    <span className="shrink-0 text-[11px] text-foreground-600">{formatFullDate(lecture.date)}</span>
                  </button>)}
                </div>}
            </div>
          </details>;
        })}
      </div>}
  </section>;
}
