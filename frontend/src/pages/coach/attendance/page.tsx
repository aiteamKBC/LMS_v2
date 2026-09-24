import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceOverview.module.css';

const coachNav = roleNavMap.coach;
const ENDPOINT = '/coach_api/coach/attendance';
const PAGE_SIZE = 10;
type AttendanceStatus = 'present' | 'absent';
interface RecordRow { learnerId: string; sessionId: string; sessionDate: string | null; status: string }
interface Learner { id: string; learner: string; email?: string | null; programme: string; programmeId?: string | null; group: string; groupName?: string | null; groupId?: string | null; programStatus?: string }
interface Payload { learners?: Learner[]; attendanceRecords?: RecordRow[] }
interface DayDraft { id: number; date: string; status: AttendanceStatus }
const display = (value?: string | null) => value?.trim() || '--';
const shortDate = (value: string | null) => value ? `${value.slice(5, 7)}-${value.slice(8, 10)}` : '--';

export default function CoachAttendance() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const restored = (useLocation().state as { groupId?: string; programmeId?: string; programStatus?: string } | null) || {};
  const [learners, setLearners] = useState<Learner[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState(restored.groupId || '');
  const [programmeId, setProgrammeId] = useState(restored.programmeId || '');
  const [loaded, setLoaded] = useState<{ groupId: string; programmeId: string } | null>(null);
  const [programStatus, setProgramStatus] = useState(restored.programStatus || 'all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draftDate, setDraftDate] = useState('');
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus>('present');
  const [days, setDays] = useState<DayDraft[]>([]);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    if (!coach.email) { setError('Coach access is required to load attendance data.'); setLoading(false); return; }
    coachFetch(ENDPOINT, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Attendance request failed with ${response.status}`);
      return response.json() as Promise<Payload>;
    }).then(payload => { if (!controller.signal.aborted) { setLearners(payload.learners || []); setRecords(payload.attendanceRecords || []); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load attendance data.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [coach.email, coach.isInitialized]);

  const groups = useMemo(() => [...new Map(learners.filter(row => row.groupId).map(row => [String(row.groupId), display(row.groupName || row.group)])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [learners]);
  const programmes = useMemo(() => [...new Map(learners.filter(row => String(row.groupId) === groupId && row.programmeId).map(row => [String(row.programmeId), row.programme])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [groupId, learners]);
  const statuses = useMemo(() => [...new Set(learners.map(row => display(row.programStatus)).filter(value => value !== '--'))].sort(), [learners]);
  const loadedLearners = useMemo(() => loaded ? learners.filter(row => String(row.groupId) === loaded.groupId && (!loaded.programmeId || String(row.programmeId) === loaded.programmeId)) : [], [learners, loaded]);
  const visible = useMemo(() => loadedLearners.filter(row => programStatus === 'all' || (programStatus === 'active' ? display(row.programStatus).toLowerCase() === 'active' : display(row.programStatus) === programStatus)), [loadedLearners, programStatus]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const recent = (id: string) => records.filter(row => row.learnerId === id && ['present', 'absent'].includes(row.status)).sort((a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || '')).slice(0, 3);
  const loadStudents = () => { setLoaded({ groupId, programmeId }); setSelected(new Set()); setPage(1); setNotice(null); };
  const addDay = () => { if (!draftDate) return; setDays(current => current.some(row => row.date === draftDate) ? current : [...current, { id: Date.now(), date: draftDate, status: draftStatus }]); setDraftDate(''); };

  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance" pageSubtitle="Bulk and individual attendance" userName={coach.name} userRole="Progress Coach"><main className={styles.page}>
    <section className={styles.card} aria-labelledby="bulk-title"><CardHeading id="bulk-title" icon="ri-group-line" title="Bulk attendance" copy="Load learners by their assigned group and programme." />
      <div className={styles.formRow}><Field label="Group"><select aria-label="Group" value={groupId} onChange={event => { setGroupId(event.target.value); setProgrammeId(''); }} disabled={loading}><option value="">Select group</option>{groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><Field label="Programme"><select aria-label="Programme" value={programmeId} onChange={event => setProgrammeId(event.target.value)} disabled={!groupId}><option value="">All programmes</option>{programmes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><button className={styles.primary} type="button" onClick={loadStudents} disabled={!groupId}>Load students</button></div>
    </section>
    <section className={styles.card} aria-labelledby="edit-title"><CardHeading id="edit-title" icon="ri-calendar-edit-line" title="Attendance edit" copy="Prepare one or more days for the selected learners." />
      <div className={styles.formRow}><Field label="Date"><input aria-label="Date" type="date" value={draftDate} onChange={event => setDraftDate(event.target.value)} /></Field><Field label="Status"><select aria-label="Status" value={draftStatus} onChange={event => setDraftStatus(event.target.value as AttendanceStatus)}><option value="present">Present</option><option value="absent">Absent</option></select></Field><button className={styles.secondary} type="button" onClick={addDay} disabled={!draftDate}>Add day</button></div>
      {days.length > 0 && <div className={styles.dayList}>{days.map(day => <span key={day.id}>{day.date} · {day.status}<button type="button" aria-label={`Remove ${day.date}`} onClick={() => setDays(current => current.filter(row => row.id !== day.id))}>×</button></span>)}</div>}
      <div className={styles.editFooter}><div><strong>Selected students: {selected.size}</strong><strong>Days: {days.length}</strong></div><div><button className={styles.primary} type="button" disabled={!selected.size || !days.length} onClick={() => setNotice('Not saved: the canonical attendance service does not support coach-created or absent records. Existing records remain unchanged.')}>Apply bulk update</button><button className={styles.danger} type="button" disabled={!days.length} onClick={() => setDays([])}>Delete selected days</button></div></div>{notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
    <section className={styles.card} aria-labelledby="students-title"><header className={styles.studentsHeader}><CardHeading id="students-title" icon="ri-user-3-line" title={`Students (${visible.length})`} copy="Learners loaded from stable group and programme assignments." /><Field label="Programme status"><select aria-label="Programme status" value={programStatus} onChange={event => { setProgramStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option>{statuses.filter(value => value.toLowerCase() !== 'active').map(value => <option key={value} value={value}>{value}</option>)}</select></Field></header>
      <div className={styles.selectActions}><button type="button" disabled={!visible.length} onClick={() => setSelected(new Set(visible.map(row => row.id)))}>Select all</button><button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</button></div>
      <div className={styles.tableScroll}><table><thead><tr><th>Select</th><th>Learner</th><th>Email</th><th>Programme status</th><th>Last attendance</th><th>Details</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={6}><RowsSkeleton rows={5} /></td></tr> : error ? <tr><td colSpan={6}><EmptyState variant="error" size="sm" title="Unable to load attendance" description={error} /></td></tr> : !loaded ? <tr><td colSpan={6}><EmptyState size="sm" title="Choose a group" description="Select a group, then load its learners." /></td></tr> : !pageRows.length ? <tr><td colSpan={6}><EmptyState size="sm" title="No learners found for this group." /></td></tr> : pageRows.map(learner => <tr key={learner.id}><td><input aria-label={`Select ${learner.learner}`} type="checkbox" checked={selected.has(learner.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(learner.id) ? next.delete(learner.id) : next.add(learner.id); return next; })} /></td><td><strong>{learner.learner}</strong></td><td>{display(learner.email)}</td><td><span className={styles.programStatus}>{display(learner.programStatus)}</span></td><td><div className={styles.chips}>{recent(learner.id).map(row => <span key={`${row.sessionId}-${row.sessionDate}`} data-status={row.status}>{row.status === 'present' ? 'P' : 'A'} {shortDate(row.sessionDate)}</span>)}{!recent(learner.id).length && '--'}</div></td><td><button className={styles.linkButton} type="button" onClick={() => navigate(`/coach/attendance/${learner.id}`, { state: { groupId: loaded.groupId, programmeId: loaded.programmeId, programStatus } })}>View details</button></td></tr>)}
      </tbody></table></div>{pageCount > 1 && <nav className={styles.pagination} aria-label="Students pagination"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
    </section>
  </main></WorkspaceShell>;
}

function CardHeading({ id, icon, title, copy }: { id: string; icon: string; title: string; copy: string }) { return <div className={styles.heading}><span><AppIcon className={icon} /></span><div><h1 id={id}>{title}</h1><p>{copy}</p></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span>{label}</span>{children}</label>; }
