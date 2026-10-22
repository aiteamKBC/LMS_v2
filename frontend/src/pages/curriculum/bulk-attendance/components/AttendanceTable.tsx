import type { AttendanceStatus, Learner } from "@/types/bulkAttendance";
import { formatShortDate, getInitials } from "@/utils/bulkAttendance";
import LearnerStatusBadge from "./LearnerStatusBadge";
import { AppIcon } from '@/components/feature/AppIcon';
import styles from '../bulkAttendance.module.css';

export interface AttendanceRow {
  learner: Learner;
  index: number;
  groupName: string;
  cohortName: string;
}

/** A saved attendance record that can be switched between present and absent. */
export interface EditableRecord {
  source: "kbc" | "live";
  recordKey: string;
  /** The saved status, before any unsaved change. */
  attendance: AttendanceStatus;
}

export interface RecentLecture {
  id: string;
  name: string;
  sessionDate: string;
  /** Shown status, including an unsaved change. */
  status: AttendanceStatus;
  editable?: EditableRecord;
}

export interface LectureInfo {
  name: string;
  moduleName: string;
  date: string | null;
  recent: RecentLecture[];
}

interface AttendanceTableProps {
  rows: AttendanceRow[];
  loading: boolean;
  selectedIds: string[];
  lectureInfo: Record<string, LectureInfo>;
  onToggleSelect: (learnerId: string) => void;
  onToggleSelectAll: () => void;
  onOpenHistory: (row: AttendanceRow) => void;
  onToggleRecord?: (record: EditableRecord) => void;
  currentRegister?: {
    ready: boolean;
    statuses: Record<string, AttendanceStatus>;
    savingIds: string[];
    onMark: (learnerId: string, status: 'present' | 'absent') => void;
  };
}

function formatBadgeDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AttendanceTable({ rows, loading, selectedIds, lectureInfo, onToggleSelect, onToggleSelectAll, onOpenHistory, onToggleRecord, currentRegister }: AttendanceTableProps) {
  const allSelected = rows.length > 0 && rows.every(row => selectedIds.includes(row.learner.id));
  return <div className={styles.tableScroll}><div className={styles.table}>
    <div className={styles.tableHeader}>
      <button type="button" className={styles.select} aria-pressed={allSelected} aria-label="Select all learners" onClick={onToggleSelectAll}><AppIcon name="ri-check-line" /></button>
      <span>Learner / Status</span><span>This session</span><span>Last 4 lectures</span><span>Cohort / Group</span><span>History</span>
    </div>
    {loading ? <div className={styles.empty} role="status">Loading learners...</div> : !rows.length ? <div className={styles.empty}><strong>No learners found</strong><p>Try a different programme, cohort, module, or search term.</p></div>
      : rows.map(({ learner, index, groupName, cohortName }) => {
        const row = { learner, index, groupName, cohortName };
        const recent = lectureInfo[learner.id]?.recent ?? [];
        const current = currentRegister?.ready ? currentRegister.statuses[learner.id] ?? 'unmarked' : null;
        const saving = currentRegister?.savingIds.includes(learner.id);
        const markedRecent = recent.filter(record => record.status !== 'unmarked');
        return <div key={learner.id} className={styles.tableRow} data-selected={selectedIds.includes(learner.id)}>
          <button type="button" className={styles.select} aria-pressed={selectedIds.includes(learner.id)} aria-label={`Select ${learner.name}`} onClick={() => onToggleSelect(learner.id)}><AppIcon name="ri-check-line" /></button>
          <div className={styles.learnerCell}><span className={styles.avatar}>{getInitials(learner.name)}</span><div className={styles.learnerCopy}>
            <button type="button" className={styles.name} onClick={() => onOpenHistory(row)}>{learner.name}</button>
            <p>{learner.programme || 'Programme not recorded'}</p><p>{learner.email}</p>
            {lectureInfo[learner.id]?.moduleName && <p>Module: {lectureInfo[learner.id].moduleName}</p>}
            <p><LearnerStatusBadge status={learner.status} /></p>
          </div></div>
          <div><div className={styles.currentControls}>
            {(['present', 'absent'] as const).map(status => <button key={status} type="button" aria-label={`Mark ${learner.name} ${status}`} aria-pressed={current === status} data-active={current === status ? status : undefined}
              disabled={!currentRegister?.ready || Boolean(currentRegister.savingIds.length) || !learner.kbcId}
              onClick={() => currentRegister?.onMark(learner.id, status)}>{status === 'present' ? 'Present' : 'Absent'}</button>)}
          </div><p className={styles.recentSummary}>{saving ? 'Saving...' : current === null ? 'Choose a session to view its register' : current === 'unmarked' ? 'Unmarked' : ''}</p></div>
          <div><div className={styles.recent}>{recent.map(lecture => {
            const present = lecture.status === 'present', absent = lecture.status === 'absent';
            const title = `${lecture.name} \u2022 ${formatShortDate(lecture.sessionDate)} \u2022 ${present ? 'Present' : absent ? 'Absent' : 'Unmarked'}`;
            const changed = lecture.editable && lecture.status !== lecture.editable.attendance;
            const badge = `${present ? styles.recentPresent : absent ? styles.recentAbsent : styles.recentUnmarked} ${changed ? styles.recentPending : ''}`;
            return <span key={lecture.id} className={styles.recentItem}>
              {lecture.editable && onToggleRecord ? <button type="button" className={badge} title={title} aria-label={`${title}. Click to mark ${present ? 'absent' : 'present'}`} onClick={() => onToggleRecord(lecture.editable!)}><AppIcon name={present ? 'ri-check-line' : absent ? 'ri-close-line' : 'ri-subtract-line'} /></button>
                : <span className={badge} title={title}><AppIcon name={present ? 'ri-check-line' : absent ? 'ri-close-line' : 'ri-subtract-line'} /></span>}
              <span>{formatBadgeDate(lecture.sessionDate)}</span></span>;
          })}</div><p className={styles.recentSummary}>{recent.length ? `${recent.filter(record => record.status === 'present').length} present / ${markedRecent.length} marked recent` : 'No recent records'}</p></div>
          <div className={styles.placement}><span>{cohortName}</span><span>{groupName}</span></div>
          <div className={styles.history}><span title="Overall attendance is read when learner history is opened">&mdash;</span><button type="button" onClick={() => onOpenHistory(row)} aria-label={`View details for ${learner.name}`} title="View details"><AppIcon name="ri-history-line" /></button></div>
        </div>;
      })}
  </div></div>;
}
