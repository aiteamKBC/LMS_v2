import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { cn } from '@/lib/cn';
import { BigMetric, ProfileEmpty, ReferencePanel } from '../components/CaseFilePrimitives';
import type { useCaseFileAttendance } from '../useCaseFileAttendance';
import {
  displayInline as display,
  formatAttendanceFraction as formatFraction,
  formatAttendanceMonth as formatMonth,
  formatAttendanceSessionDate as formatSessionDate,
} from '../formatters';
import styles from '../learnerCaseFile.module.css';

type Session = {
  sessionId: string; sessionTitle: string; sessionType: string; sessionDate: string | null; sessionDateLabel: string;
  status: string; reason?: string | null; catchupCompleted?: boolean;
};

export function AttendanceTab({ attendanceState }: { attendanceState: ReturnType<typeof useCaseFileAttendance> }) {
  const attendance = attendanceState.data;
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState('all');
  const [attendanceMonth, setAttendanceMonth] = useState('all');
  const sessions: Session[] = (attendance?.sessionHistory || []).map(session => ({
    sessionId: session.id, sessionTitle: session.title, sessionType: session.sessionType,
    sessionDate: session.date, sessionDateLabel: formatSessionDate(session.date),
    status: session.status === 'missed' ? 'absent' : 'present', reason: '--', catchupCompleted: false,
  }));

  if (attendanceState.loading) return <ReferencePanel title="Attendance" icon="ri-calendar-check-line" tone="primary"><RowsSkeleton rows={3} avatar={false} /></ReferencePanel>;
  if (attendanceState.error) return <ReferencePanel title="Attendance" icon="ri-calendar-check-line" tone="primary"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800"><span>{attendanceState.error}</span> <button type="button" onClick={attendanceState.retry}>Retry attendance</button></div></ReferencePanel>;
  if (!attendance) return <ReferencePanel title="Attendance" icon="ri-calendar-check-line" tone="primary"><ProfileEmpty text="Live attendance data is not available for this learner." /></ReferencePanel>;

  const months = Array.from(new Set(sessions.map(session => session.sessionDate?.slice(0, 7)).filter((month): month is string => Boolean(month)))).sort((a, b) => b.localeCompare(a));
  const search = attendanceSearch.trim().toLowerCase();
  const filtered = sessions.filter(session => {
    const status = session.catchupCompleted ? 'catchup' : session.status.toLowerCase();
    return (attendanceStatus === 'all' || status === attendanceStatus)
      && (attendanceMonth === 'all' || session.sessionDate?.startsWith(attendanceMonth))
      && (!search || [session.sessionTitle, session.sessionType, session.reason].some(value => String(value || '').toLowerCase().includes(search)));
  });

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <BigMetric value={formatFraction(attendance.present, attendance.sessions)} label="Attendance" tone="primary" />
      <BigMetric value={String(attendance.sessions ?? '--')} label="Total Sessions" tone="muted" />
      <BigMetric value={String(attendance.present ?? '--')} label="Attended" tone="emerald" />
      <BigMetric value={String(attendance.absent ?? '--')} label="Absent" tone="red" />
      <BigMetric value={String(attendance.absent ?? '--')} label="Outstanding Absences" tone="red" />
    </div>
    <ReferencePanel title="Session History" icon="ri-table-line" tone="primary">
      {sessions.length ? <>
        <div className={styles.attendanceToolbar}>
          <label className={styles.attendanceSearch}><span className="sr-only">Search sessions</span><AppIcon className="ri-search-line" /><input value={attendanceSearch} onChange={event => setAttendanceSearch(event.target.value)} placeholder="Search session or reason" /></label>
          <label className={styles.attendanceFilter}><span>Status</span><select value={attendanceStatus} onChange={event => setAttendanceStatus(event.target.value)}><option value="all">All statuses</option><option value="present">Attended</option><option value="absent">Absent</option><option value="catchup">Catch-up completed</option></select></label>
          <label className={styles.attendanceFilter}><span>Month</span><select value={attendanceMonth} onChange={event => setAttendanceMonth(event.target.value)}><option value="all">All dates</option>{months.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label>
        </div>
        <p className={styles.attendanceResults}>{filtered.length} of {sessions.length} sessions</p>
        <div className={styles.attendanceTableScroll}><table className={styles.attendanceTable}><thead><tr><th>Session</th><th>Date</th><th>Attendance</th><th>Reason</th></tr></thead><tbody>{filtered.map((session, index) => <tr key={`${session.sessionId}-${session.sessionDate || index}-history`}><td><strong>{display(session.sessionTitle)}</strong></td><td>{display(session.sessionDateLabel, '—')}</td><td><span className={cn(styles.attendanceStatus, statusClass(session))}>{statusLabel(session)}</span></td><td>{reason(session)}</td></tr>)}</tbody></table></div>
        {filtered.length === 0 && <ProfileEmpty text="No sessions match the selected filters." />}
      </> : <ProfileEmpty text="No session history is available for this learner yet." />}
    </ReferencePanel>
  </div>;
}

function statusLabel(session: Session) { if (session.catchupCompleted) return 'Catch-up'; const value = session.status.toLowerCase(); return value === 'present' ? 'Present' : value === 'late' ? 'Late' : value === 'absent' ? 'Absent' : value ? value[0].toUpperCase() + value.slice(1) : '—'; }
function statusClass(session: Session) { const value = session.status.toLowerCase(); return session.catchupCompleted || value === 'present' ? styles.attendanceStatusPositive : value === 'absent' ? styles.attendanceStatusNegative : styles.attendanceStatusNeutral; }
function reason(session: Session) { const value = String(session.reason || '').trim(); return value && value !== '--' ? value : session.status.toLowerCase() === 'absent' ? 'No reason provided' : '—'; }
