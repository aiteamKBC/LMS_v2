import type { RecordingsLibrary } from '@/api/sessionResults';
import { AppIcon } from '@/components/feature/AppIcon';
import type { Lecture } from '../types';
import { lectureNeedsAttention, lectureOverallStatus, STATUS_META } from '../utils';
import styles from '../RecordingsPage.module.css';

export default function LibrarySummary({ library, lectures, includeInactive, loading }: {
  library: RecordingsLibrary | null; lectures: Lecture[]; includeInactive: boolean; loading: boolean;
}) {
  const available = Boolean(library);
  const statusAvailable = available && library!.attentionChecked && library!.calendarAvailable !== false;
  const moduleCount = library?.modules ? new Set(library.modules.filter(item => includeInactive || (item.programmeActive && !item.archived)).map(item => item.moduleId)).size : null;
  const files = new Map((library?.deliveries || []).filter(item => includeInactive || (item.programmeActive && !item.archived)).flatMap(item => item.weeks.flatMap(week => week.recordings)).map(file => [`${file.seriesId}:${file.id}`, file]));
  const readyCount = [...files.values()].filter(file => file.state === 'ready').length;
  const attention = lectures.filter(lectureNeedsAttention);
  const breakdown = new Map<string, number>();
  attention.forEach(lecture => { const label = STATUS_META[lectureOverallStatus(lecture)].label; breakdown.set(label, (breakdown.get(label) || 0) + 1); });
  const unknown = loading && !library ? 'Loading...' : 'Unavailable';
  return <div>
    <dl className={styles.metrics} aria-label="Recording library totals">
      <div className={styles.metric}><AppIcon name="ri-film-line" size={18} /><div><dt>Lectures across all dates</dt><dd>{available && library!.calendarAvailable !== false ? lectures.length : unknown}</dd><p>{moduleCount === null ? 'Module total unavailable' : `Across ${moduleCount} LMS modules`}</p></div></div>
      <div className={styles.metric}><AppIcon name="ri-download-cloud-line" size={18} /><div><dt>Ready to download</dt><dd>{available ? readyCount : unknown}</dd><p>Saved recording files, including undated files</p></div></div>
      <div className={styles.metric}><AppIcon name="ri-error-warning-line" size={18} /><div><dt>Need attention</dt><dd>{statusAvailable ? attention.length : unknown}</dd><p>{statusAvailable ? [...breakdown].map(([label,count]) => `${count} ${label.toLowerCase()}`).join(' · ') || 'No lecture checks need attention' : 'Complete session status check unavailable'}</p></div></div>
    </dl>
    <p className={styles.scopeNote}>Across all dates before search and filters. Draft and archived inclusion follows the checkbox below.</p>
  </div>;
}
