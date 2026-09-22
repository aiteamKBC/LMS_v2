import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceOverview.module.css';

const coachNav = roleNavMap.coach;
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';

type AttendanceStatus = 'present' | 'absent';

interface AttendanceRecord {
  learnerId: string;
  learnerName: string;
  learnerEmail?: string | null;
  sessionId: string;
  sessionTitle: string;
  subjectId?: string;
  subjectTitle?: string;
  sessionDate: string | null;
  sessionDateLabel: string;
  status: AttendanceStatus | string;
}
interface AttendanceResponse {
  attendanceRecords?: AttendanceRecord[];
}

function subjectName(sessionTitle: string) {
  return sessionTitle.replace(/\s+[—–-]\s+Session\s+\d+\s*$/i, '').trim() || sessionTitle;
}

function subjectKey(record: AttendanceRecord) {
  return record.subjectId || subjectName(record.sessionTitle);
}

function subjectLabel(record: AttendanceRecord) {
  return record.subjectTitle || subjectName(record.sessionTitle);
}

function formatLectureDate(record: AttendanceRecord) {
  return record.sessionDateLabel || record.sessionDate || 'Unknown date';
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'L';
}

export default function CoachAttendance() {
  const coach = useCoachIdentity();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    if (!coach.isInitialized) return;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setLoadError(null);

      if (!coach.email) {
        setRecords([]);
        setLoadError('Coach access is required to load attendance data.');
        setLoading(false);
        return;
      }

      try {
        const response = await coachFetch(ATTENDANCE_ENDPOINT, { signal: controller.signal });
        if (!response.ok) throw new Error(`Attendance request failed with ${response.status}`);
        const payload = await response.json() as AttendanceResponse;
        if (!controller.signal.aborted) setRecords(payload.attendanceRecords || []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setRecords([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load attendance data.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [coach.email, coach.isInitialized]);

  const subjects = useMemo(() => {
    const byId = new Map<string, string>();
    records.forEach(record => {
      const key = subjectKey(record);
      if (key) byId.set(key, subjectLabel(record));
    });
    return [...byId.entries()].sort(([, left], [, right]) => left.localeCompare(right));
  }, [records]);

  const lectureDates = useMemo(() => {
    const dates = new Map<string, string>();
    records.forEach((record) => {
      if (subjectKey(record) === selectedSubject && record.sessionDate) {
        dates.set(record.sessionDate, formatLectureDate(record));
      }
    });
    return [...dates.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [records, selectedSubject]);

  const attendanceRows = useMemo(() => records
    .filter(record => (
      subjectKey(record) === selectedSubject
      && record.sessionDate === selectedDate
      && (record.status === 'present' || record.status === 'absent')
    ))
    .sort((left, right) => left.learnerName.localeCompare(right.learnerName)), [records, selectedDate, selectedSubject]);

  const changeSubject = (value: string) => {
    setSelectedSubject(value);
    setSelectedDate('');
  };

  const emptyTitle = !selectedSubject
    ? 'Select a subject'
    : !selectedDate
      ? 'Select a lecture date'
      : 'No attendance found';
  const emptyDescription = !selectedSubject
    ? 'Choose a subject to see its lecture dates.'
    : !selectedDate
      ? 'Choose a lecture date to see who attended.'
      : 'There are no learner attendance records for this lecture.';

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Attendance"
      pageSubtitle="Lecture attendance register"
      userName={coach.name}
      userRole="Progress Coach"
    >
      <main className={styles.page}>
        <section className={styles.filters} aria-labelledby="attendance-title">
          <div className={styles.heading}>
            <span className={styles.headingIcon}><AppIcon className="ri-calendar-check-line" /></span>
            <div>
              <h1 id="attendance-title">Lecture Attendance</h1>
              <p>Select a subject and lecture date to view learner attendance.</p>
            </div>
          </div>

          <div className={styles.filterGrid} aria-label="Attendance filters">
            <label>
              <span>Subject</span>
              <select
                aria-label="Subject"
                value={selectedSubject}
                onChange={event => changeSubject(event.target.value)}
                disabled={loading || Boolean(loadError)}
              >
                <option value="">Select subject</option>
                {subjects.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Lecture date</span>
              <select
                aria-label="Lecture date"
                value={selectedDate}
                onChange={event => setSelectedDate(event.target.value)}
                disabled={!selectedSubject || loading || Boolean(loadError)}
              >
                <option value="">Select lecture date</option>
                {lectureDates.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className={styles.tableCard} aria-labelledby="attendance-register-title">
          <header className={styles.tableTitle}>
            <span><AppIcon className="ri-list-check-3" /></span>
            <h2 id="attendance-register-title">Attendance Register</h2>
          </header>
          <div className={styles.tableScroll}>
            <table>
              <caption className="sr-only">Learners present or absent for the selected lecture</caption>
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  <th scope="col">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={2}><RowsSkeleton rows={5} /></td></tr>
                ) : loadError || attendanceRows.length === 0 ? (
                  <tr><td colSpan={2}>
                    <EmptyState
                      icon={loadError ? 'ri-error-warning-line' : 'ri-calendar-check-line'}
                      title={loadError || emptyTitle}
                      description={loadError ? 'Try again when attendance data is available.' : emptyDescription}
                      size="sm"
                    />
                  </td></tr>
                ) : attendanceRows.map(record => {
                  const isPresent = record.status === 'present';
                  return (
                    <tr key={`${record.sessionId}-${record.learnerId}`}>
                      <td>
                        <div className={styles.learner}>
                          <span className={styles.avatar}>{initials(record.learnerName)}</span>
                          <strong>{record.learnerName}</strong>
                        </div>
                      </td>
                      <td>
                        <span className={styles.status} data-status={isPresent ? 'present' : 'absent'}>
                          <AppIcon className={isPresent ? 'ri-checkbox-circle-fill' : 'ri-close-circle-fill'} />
                          {isPresent ? 'Present' : 'Absent'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </WorkspaceShell>
  );
}
