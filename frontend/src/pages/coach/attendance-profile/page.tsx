import { useParams } from 'react-router-dom';
import { BackButton } from '@/components/navigation/BackButton';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceProfile.module.css';
import { useAttendanceDetail } from '@/features/coach/attendance/hooks/useAttendanceDetail';
import { formatAttendancePercentage } from '@/features/coach/attendance/selectors/attendanceSelectors';

const coachNav = roleNavMap.coach;
const show = (value?: string | null) => value?.trim() || '--';
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

export default function CoachAttendanceProfile() {
  const coach = useCoachIdentity();
  const { learnerId = '' } = useParams();
  const detail = useAttendanceDetail(learnerId, coach.isInitialized && Boolean(coach.email));
  const { learner, recorded } = detail;
  const loading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || detail.loading);
  const error = coach.isInitialized && !coach.email
    ? 'Coach access is required to load this attendance profile.'
    : detail.error;
  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Attendance" pageSubtitle="Attendance history" userName={coach.name} userRole="Progress Coach"><main className={styles.page}>
    {loading && <section className={styles.card}><RowsSkeleton rows={6} /></section>}
    {error && <EmptyState variant="error" title="Unable to load this attendance profile." description={error} />}
    {!loading && !error && learner && <><section className={`${styles.card} ${styles.hero}`}><div><p className={styles.eyebrow}>Learner attendance</p><h1>{learner.learner}</h1><p>{show(learner.email)}</p><div className={styles.meta}><span><b>Programme</b>{show(learner.programme)}</span><span><b>Cohort</b>{show(learner.cohort)}</span><span><b>Group</b>{show(learner.group)}</span></div></div><div className={styles.actions}><button type="button" onClick={() => window.print()}>Export PDF</button><BackButton fallback="/coach/attendance">Back</BackButton></div></section>
      <section className={styles.summary} aria-label="Attendance summary"><Summary title="Coach" lines={[coach.name, coach.email || '--', 'Phone not available']} /><Summary title="Tutor" lines={['Not assigned', '--']} /><Summary title="Attendance" lines={[formatAttendancePercentage(learner.attendance), `${learner.present ?? 0} present out of ${learner.sessions ?? 0}`]} accent /></section>
      <section className={styles.card}><header className={styles.sectionHeader}><div><h2>Attendance</h2><p>{recorded.length} records</p></div></header><fieldset className={styles.addRecord} disabled><legend>Add attendance record</legend><label>Date<input type="date" /></label><label>Module<select><option>Select module</option></select></label><label>Lecture / Session<select><option>Select session</option></select></label><label>Status<select><option>Present</option><option>Absent</option></select></label><button type="button">Add attendance record</button><small>New coach-created records are unavailable until the canonical attendance service supports them.</small></fieldset>
        <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Module</th><th>Lecture / Session</th><th>Status</th><th>Actions</th></tr></thead><tbody>{recorded.length ? recorded.map((row, index) => <tr key={`${row.sessionId}-${row.sessionDate}-${index}`}><td>{show(row.sessionDateLabel)}</td><td>{show(row.sessionType)}</td><td><strong>{show(row.sessionTitle)}</strong>{row.status === 'absent' && <small className={styles.report}>Absent report: {row.absenceReport ? 'Uploaded' : 'Not uploaded'}{row.absenceReport?.url && <a href={row.absenceReport.url}>View report</a>}</small>}</td><td><span className={styles.status} data-status={row.status}>{titleCase(row.status)}</span></td><td><span className={styles.unavailable}>No actions</span></td></tr>) : <tr><td colSpan={5}><EmptyState size="sm" title="No attendance records found for this learner." /></td></tr>}</tbody></table></div>
      </section></>}
  </main></WorkspaceShell>;
}
function Summary({ title, lines, accent = false }: { title: string; lines: string[]; accent?: boolean }) { return <article className={styles.summaryCard} data-accent={accent}><h2>{title}</h2>{lines.map((line, index) => <p key={`${line}-${index}`} className={index === 0 ? styles.summaryLead : undefined}>{line}</p>)}</article>; }
