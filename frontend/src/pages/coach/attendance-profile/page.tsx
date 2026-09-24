import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceProfile.module.css';

const coachNav = roleNavMap.coach;
const ENDPOINT = '/coach_api/coach/attendance';
const DETAILS = '/coach_api/coach/attendance/details';
interface Learner { id: string; learner: string; email?: string | null; programme: string; cohort: string; group: string; attendance: number | null; sessions: number | null; present: number | null }
interface Session { sessionId: string; sessionTitle: string; sessionType: string; sessionDate: string | null; sessionDateLabel: string; status: string; absenceReport?: { id: string; status: string; url?: string } | null }
const show = (value?: string | null) => value?.trim() || '--';
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

export default function CoachAttendanceProfile() {
  const coach = useCoachIdentity();
  const { learnerId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [learner, setLearner] = useState<Learner | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!coach.isInitialized) return;
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        if (!coach.email) throw new Error('Coach access is required to load this attendance profile.');
        const overviewResponse = await coachFetch(ENDPOINT);
        if (!overviewResponse.ok) throw new Error('Unable to load learner attendance.');
        const overview = await overviewResponse.json();
        const selected = (overview.learners || []).find((row: Learner) => String(row.id) === String(learnerId));
        if (!selected) throw new Error('Learner attendance record was not found.');
        const detailsResponse = await coachFetch(`${DETAILS}?${new URLSearchParams({ learner_id: String(selected.id) })}`);
        if (!detailsResponse.ok) throw new Error('Unable to load attendance sessions.');
        const details = await detailsResponse.json();
        if (!cancelled) { setLearner(selected); setSessions((details.sessions || []).sort((a: Session, b: Session) => (b.sessionDate || '').localeCompare(a.sessionDate || ''))); }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load attendance profile.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load(); return () => { cancelled = true; };
  }, [coach.email, coach.isInitialized, learnerId]);
  const recorded = useMemo(() => sessions.filter(row => ['present', 'absent'].includes(row.status)), [sessions]);
  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Attendance" pageSubtitle="Attendance history" userName={coach.name} userRole="Progress Coach"><main className={styles.page}>
    {loading && <section className={styles.card}><RowsSkeleton rows={6} /></section>}
    {error && <EmptyState variant="error" title="Unable to load this attendance profile." description={error} />}
    {!loading && !error && learner && <><section className={`${styles.card} ${styles.hero}`}><div><p className={styles.eyebrow}>Learner attendance</p><h1>{learner.learner}</h1><p>{show(learner.email)}</p><div className={styles.meta}><span><b>Programme</b>{show(learner.programme)}</span><span><b>Cohort</b>{show(learner.cohort)}</span><span><b>Group</b>{show(learner.group)}</span></div></div><div className={styles.actions}><button type="button" onClick={() => window.print()}>Export PDF</button><button type="button" onClick={() => navigate('/coach/attendance', { state: location.state })}>Back</button></div></section>
      <section className={styles.summary} aria-label="Attendance summary"><Summary title="Coach" lines={[coach.name, coach.email || '--', 'Phone not available']} /><Summary title="Tutor" lines={['Not assigned', '--']} /><Summary title="Attendance" lines={[learner.attendance === null ? '--' : `${learner.attendance}%`, `${learner.present ?? 0} present out of ${learner.sessions ?? 0}`]} accent /></section>
      <section className={styles.card}><header className={styles.sectionHeader}><div><h2>Attendance</h2><p>{recorded.length} records</p></div></header><fieldset className={styles.addRecord} disabled><legend>Add attendance record</legend><label>Date<input type="date" /></label><label>Module<select><option>Select module</option></select></label><label>Lecture / Session<select><option>Select session</option></select></label><label>Status<select><option>Present</option><option>Absent</option></select></label><button type="button">Add attendance record</button><small>New coach-created records are unavailable until the canonical attendance service supports them.</small></fieldset>
        <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Module</th><th>Lecture / Session</th><th>Status</th><th>Actions</th></tr></thead><tbody>{recorded.length ? recorded.map((row, index) => <tr key={`${row.sessionId}-${row.sessionDate}-${index}`}><td>{show(row.sessionDateLabel)}</td><td>{show(row.sessionType)}</td><td><strong>{show(row.sessionTitle)}</strong>{row.status === 'absent' && <small className={styles.report}>Absent report: {row.absenceReport ? 'Uploaded' : 'Not uploaded'}{row.absenceReport?.url && <a href={row.absenceReport.url}>View report</a>}</small>}</td><td><span className={styles.status} data-status={row.status}>{titleCase(row.status)}</span></td><td><span className={styles.unavailable}>No actions</span></td></tr>) : <tr><td colSpan={5}><EmptyState size="sm" title="No attendance records found for this learner." /></td></tr>}</tbody></table></div>
      </section></>}
  </main></WorkspaceShell>;
}
function Summary({ title, lines, accent = false }: { title: string; lines: string[]; accent?: boolean }) { return <article className={styles.summaryCard} data-accent={accent}><h2>{title}</h2>{lines.map((line, index) => <p key={`${line}-${index}`} className={index === 0 ? styles.summaryLead : undefined}>{line}</p>)}</article>; }
