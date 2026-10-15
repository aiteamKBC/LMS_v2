import type { Lecture, Recording } from "@/pages/curriculum/recordings/types";
import {
  formatFullDate,
  formatTimeRange,
  lectureReadyCount,
} from "@/pages/curriculum/recordings/utils";
import LectureAttendance from './LectureAttendance';
import RecordingItem from "@/pages/curriculum/recordings/components/RecordingItem";

interface LectureDetailsPanelProps {
  lecture: Lecture;
  timeZone: string;
  playingId: string | null;
  onClose: () => void;
  onPlay: (lecture: Lecture, recording: Recording) => void;
}

export default function LectureDetailsPanel({
  lecture,
  timeZone,
  playingId,
  onClose,
  onPlay,
}: LectureDetailsPanelProps) {
  const readyCount = lectureReadyCount(lecture);
  const total = lecture.recordings.length;

  const details: { label: string; value: string }[] = [
    { label: "Date", value: formatFullDate(lecture.date) },
    { label: "Time", value: `${formatTimeRange(lecture.startTime, lecture.endTime)} (${timeZone})` },
    { label: "Programme", value: lecture.programme },
    { label: "Cohort", value: lecture.cohort },
    { label: "Group", value: lecture.group },
    { label: "Module", value: lecture.module },
    ...(lecture.week ? [{ label: "Week", value: `Week ${lecture.week}${lecture.weekTitle ? ` · ${lecture.weekTitle}` : ''}` }] : []),
  ];

  return (
    <aside
      aria-label="Lecture details"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-background-200 bg-background-50 shadow-2xl animate-slide-in-right"
    >
      <div className="flex items-start justify-between gap-3 border-b border-background-200 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Lecture details</p>
          <h2 className="mt-1 font-heading text-base font-bold leading-snug text-foreground-950">
            {lecture.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details panel"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-500 transition-colors hover:bg-background-100 hover:text-foreground-900"
        >
          <i className="ri-close-line text-lg" aria-hidden="true"></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 scrollbar-slim">
        {lecture.archived && <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">Archived module. Its saved recordings remain available.</p>}
        {lecture.statusReason && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{lecture.statusReason}</p>}
        {lecture.joinUrl && ['upcoming', 'inProgress'].includes(lecture.status) && <a href={lecture.joinUrl} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Open Teams meeting</a>}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {details.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                {item.label}
              </dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-foreground-900">{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex items-center justify-between border-t border-background-200 pt-4">
          <h3 className="font-heading text-sm font-bold text-foreground-950">Recordings</h3>
          <span className="text-xs font-medium text-foreground-600">
            {total === 0 ? "None" : `${readyCount} of ${total} ready`}
          </span>
        </div>

        <div className="mt-3 space-y-3">
          {total === 0 ? (
            <p className="rounded-md border border-dashed border-background-300 px-3 py-4 text-center text-xs text-foreground-500">
              {lecture.status === 'upcoming' ? 'This lecture has not started yet.'
                : lecture.status === 'inProgress' ? 'This lecture is in progress. Its recording is not available yet.'
                  : lecture.status === 'cancelled' ? 'This lecture was cancelled.'
                    : 'No saved recording is linked to this lecture yet.'}
            </p>
          ) : (
            lecture.recordings.map((recording) => (
              <RecordingItem
                key={recording.id}
                lecture={lecture}
                recording={recording}
                isPlaying={playingId === recording.id}
                onPlay={onPlay}
              />
            ))
          )}
        </div>

        <div className="mt-5"><LectureAttendance key={`${lecture.id}:${timeZone}`} lecture={lecture} timeZone={timeZone} /></div>

        <p className="mt-5 flex items-start gap-2 rounded-md bg-secondary-50 px-3 py-2.5 text-[11px] leading-relaxed text-secondary-900">
          <i className="ri-shield-check-line mt-0.5 text-sm" aria-hidden="true"></i>
          Downloads are served by the LMS archive through an authenticated request. Only recordings marked
          Ready have a saved file available.
        </p>
      </div>
    </aside>
  );
}
