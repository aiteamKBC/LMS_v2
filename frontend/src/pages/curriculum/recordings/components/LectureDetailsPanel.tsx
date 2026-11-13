import type { Lecture, Recording } from "@/pages/curriculum/recordings/types";
import {
  formatFullDate,
  formatTimeRange,
  lectureReadyCount,
} from "@/pages/curriculum/recordings/utils";
import LectureAttendance from './LectureAttendance';
import LectureTranscript from './LectureTranscript';
import RecordingItem from "@/pages/curriculum/recordings/components/RecordingItem";
import { lazy, Suspense, useMemo, useState } from 'react';
import { ShieldCheck, Video } from 'lucide-react';
import RecordingsDetailsHeader from '@/components/feature/RecordingsDetailsHeader';
import detailsStyles from '@/components/feature/RecordingsDetails.module.css';
const QualityReviewDialog = lazy(() => import('@/pages/coaching-recordings/QualityReviewDialog'));

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
  const [qualityOpen, setQualityOpen] = useState(false);
  const teachingLecture = useMemo(() => lecture.seriesId && lecture.occurrenceId
    ? { moduleId: lecture.moduleId, seriesId: lecture.seriesId, occurrenceId: lecture.occurrenceId } : undefined,
  [lecture.moduleId, lecture.seriesId, lecture.occurrenceId]);
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
    <><aside
      aria-label="Lecture details"
      className={`${detailsStyles.drawer} animate-slide-in-right`}
    >
      <RecordingsDetailsHeader eyebrow="Lecture details" title={lecture.title} closeLabel="Close details panel" onClose={onClose} />

      <div className={`${detailsStyles.body} scrollbar-slim`}>
        {lecture.archived && <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">Archived module. Its saved recordings remain available.</p>}
        {lecture.statusReason && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{lecture.statusReason}</p>}
        {lecture.joinUrl && ['upcoming', 'inProgress'].includes(lecture.status) && <a href={lecture.joinUrl} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Open Teams meeting</a>}

        <dl className={detailsStyles.metadata}>
          {details.map((item) => (
            <div key={item.label} className={item.label === 'Week' ? detailsStyles.wide : 'min-w-0'}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                {item.label}
              </dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-foreground-900">{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className={detailsStyles.sectionHeading}>
          <h3><Video size={16} aria-hidden="true" />Recordings</h3>
          <span className={detailsStyles.count}>
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

        {teachingLecture && <LectureTranscript key={`${teachingLecture.moduleId}:${teachingLecture.seriesId}:${teachingLecture.occurrenceId}`} scope={teachingLecture} />}

        <div className={detailsStyles.attendance}><LectureAttendance key={`${lecture.id}:${timeZone}`} lecture={lecture} timeZone={timeZone} /></div>

        <section className={detailsStyles.quality} aria-label="Teaching quality check">
          <h3><ShieldCheck size={16} aria-hidden="true" />Teaching Quality Check</h3>
          <p className="mt-1 text-xs leading-5 text-foreground-600">Teaching Session Feedback Form · One review for the lecture and tutor.</p>
          {teachingLecture ? <button type="button" onClick={() => setQualityOpen(true)} className={`${detailsStyles.primary} mt-3`}>Open teaching quality check</button>
            : <p className="mt-2 text-xs text-foreground-600">A saved lecture is required before its teaching review can be opened.</p>}
        </section>

        <p className={detailsStyles.notice}>
          <ShieldCheck size={14} aria-hidden="true" />
          Downloads are served by the LMS archive through an authenticated request. Only recordings marked
          Ready have a saved file available.
        </p>
      </div>
    </aside>
    {qualityOpen && teachingLecture && <Suspense fallback={<p role="status" className="fixed inset-0 z-[90] flex items-center justify-center bg-white/95">Loading teaching quality check…</p>}>
      <QualityReviewDialog key={`${teachingLecture.moduleId}:${teachingLecture.occurrenceId}`} teachingLecture={teachingLecture} timeZone={timeZone} onClose={() => setQualityOpen(false)} />
    </Suspense>}</>
  );
}
