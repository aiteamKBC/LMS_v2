import type { Lecture } from '../types';
import { lectureOverallStatus, lectureStatusSummary, STATUS_META } from '../utils';
import RecordingDownloadButton from './RecordingDownloadButton';
import styles from '../RecordingsPage.module.css';

export default function DayAgenda({ lectures, selectedLectureId, onSelectLecture, onClearFilters }: {
  lectures: Lecture[]; selectedLectureId: string | null;
  onSelectLecture: (lecture: Lecture) => void; onClearFilters: () => void;
}) {
  if (!lectures.length) return <div className={styles.empty}><h3>No lectures match this day and filters</h3><p>Choose another day or adjust the filters.</p><button type="button" onClick={onClearFilters}>Clear search and filters</button></div>;
  return <div className={styles.agendaRows} role="region" aria-label="Daily lecture agenda" aria-hidden={selectedLectureId ? true : undefined}>
    {[...lectures].sort((a,b) => a.startTime.localeCompare(b.startTime)).map(lecture => {
      const status = lectureOverallStatus(lecture);
      const start = Date.parse(lecture.startsAt || ''), end = Date.parse(lecture.endsAt || '');
      const duration = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 60000) : null;
      const ready = [...new Map(lecture.recordings.filter(file => file.status === 'ready').map(file => [`${file.source.seriesId}:${file.source.id}`, file])).values()];
      return <article key={lecture.id} className={styles.lectureRow} aria-label={`${lecture.title} - ${lecture.id}`}>
        <div className={styles.rowTime}>{lecture.startTime}<span>{lecture.endTime}</span>{duration !== null && <small>{duration}m</small>}</div>
        <div>
          <button type="button" className={styles.lectureTitle} onClick={() => onSelectLecture(lecture)}>{lecture.title}</button>
          <p className={styles.lectureContext}>{[lecture.module, lecture.programme].filter(Boolean).join(' · ')}</p>
          <div className={styles.lectureMeta}><span>{[lecture.cohort, lecture.group].filter(Boolean).join(' · ')}</span>{lecture.archived && <span>Archived module</span>}{lecture.recordings.length > 0 && <span>{lectureStatusSummary(lecture)}</span>}</div>
        </div>
        <div className={styles.rowActions}>
          <span className={`${styles.recordingBadge} ${styles.statusColor}`} data-status={status}>{status === 'ready' ? 'Ready to download' : STATUS_META[status].label}</span>
          {ready.map(file => <div className={styles.fileAction} key={`${file.source.seriesId}:${file.source.id}`}>
            {ready.length > 1 && <span>{file.label}</span>}
            <RecordingDownloadButton seriesId={file.source.seriesId} artifactId={file.source.id} className={styles.download} />
          </div>)}
        </div>
      </article>;
    })}
  </div>;
}
