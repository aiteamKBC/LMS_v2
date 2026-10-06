import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { fetchCurriculumGroups, type CurriculumGroup } from '@/lib/curriculumApi';
import { useListQueryState } from '@/hooks/useListQueryState';
import { formatSystemTimestamp } from '@/lib/format';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceOverview.module.css';
import lastFourStyles from './attendanceLastFour.module.css';
import { useCoachAttendance } from '@/features/coach/attendance/hooks/useCoachAttendance';
import { selectRecentAttendance } from '@/features/coach/attendance/selectors/attendanceSelectors';
import { fetchBulkAttendance, saveBulkAttendance, type BulkSession, type BulkLearner, type BulkAttendanceWarning } from '@/features/coach/attendance/api/attendanceApi';

const coachNav = roleNavMap.coach;
const PAGE_SIZE = 10;
const QUERY_DEFAULTS = { group: '', programme: '', status: 'all', page: 1 };

const display = (value?: string | null) => value?.trim() || '--';
const shortDate = (value: string | null, compact = false) => {
  if (!value) return '--';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '--';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', ...(compact ? {} : { year: 'numeric' as const }), timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day))).replace('Sept', 'Sep');
};

export default function CoachAttendance() {
  const coach = useCoachIdentity();
  const navigate = useNavigate();
  const { state: query, setValues: setQueryValues } = useListQueryState(QUERY_DEFAULTS);
  const attendance = useCoachAttendance(coach.isInitialized && Boolean(coach.email));
  const { learners, records } = attendance;
  const loading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || attendance.loading);
  const error = coach.isInitialized && !coach.email ? 'Coach access is required to load attendance data.' : attendance.error;
  const [groupId, setGroupId] = useState(String(query.group));
  const [programmeId, setProgrammeId] = useState(String(query.programme));
  const loaded = useMemo(() => query.group ? { groupId: String(query.group), programmeId: String(query.programme) } : null, [query.group, query.programme]);
  const programStatus = String(query.status);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<BulkSession[]>([]);
  const [sessionLearners, setSessionLearners] = useState<BulkLearner[]>([]);
  const [bulkWarnings, setBulkWarnings] = useState<BulkAttendanceWarning[]>([]);
  const [pending, setPending] = useState<Record<string, 'present' | 'absent'>>({});
  const [sessionLoading, setSessionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const page = Number(query.page);
  const [notice, setNotice] = useState<string | null>(null);
  const [curriculumGroups, setCurriculumGroups] = useState<CurriculumGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  useEffect(() => {
    if (!coach.isInitialized || !coach.email) return;
    const controller = new AbortController();
    setGroupsLoading(true);
    setGroupsError(null);
    setCurriculumGroups([]);
    fetchCurriculumGroups(controller.signal).then(rows => {
      if (!controller.signal.aborted) setCurriculumGroups(rows);
    }).catch(reason => {
      if (!controller.signal.aborted) setGroupsError(reason instanceof Error ? reason.message : 'Unable to load programme groups.');
    }).finally(() => {
      if (!controller.signal.aborted) setGroupsLoading(false);
    });
    return () => controller.abort();
  }, [coach.isInitialized, coach.email]);

  useEffect(() => {
    setGroupId(String(query.group));
    setProgrammeId(String(query.programme));
  }, [query.group, query.programme]);

  useEffect(() => {
    const controller = new AbortController();
    setSessionId(''); setSessions([]); setSessionLearners([]); setBulkWarnings([]); setPending({}); setSelected(new Set());
    setBulkError(null);
    if (!programmeId || !groupId) { setSessionLoading(false); return; }
    setSessionLoading(true);
    fetchBulkAttendance(programmeId, groupId, '', controller.signal).then(payload => {
      if (!controller.signal.aborted) setSessions(payload.sessions || []);
    }).catch(reason => {
      if (!controller.signal.aborted) setBulkError(reason instanceof Error ? reason.message : 'Unable to load sessions.');
    }).finally(() => { if (!controller.signal.aborted) setSessionLoading(false); });
    return () => controller.abort();
  }, [programmeId, groupId]);

  useEffect(() => {
    const controller = new AbortController();
    setSessionLearners([]); setBulkWarnings([]); setPending({}); setSelected(new Set()); setBulkError(null); setNotice(null);
    if (!sessionId) { setSessionLoading(false); return; }
    setSessionLoading(true);
    fetchBulkAttendance(programmeId, groupId, sessionId, controller.signal).then(payload => {
      if (!controller.signal.aborted) { setSessionLearners(payload.learners || []); setBulkWarnings(payload.warnings || []); }
    }).catch(reason => {
      if (!controller.signal.aborted) setBulkError(reason instanceof Error ? reason.message : 'Unable to load attendance.');
    }).finally(() => { if (!controller.signal.aborted) setSessionLoading(false); });
    return () => controller.abort();
  }, [programmeId, groupId, sessionId]);

  const apply = async () => {
    setSaving(true); setBulkError(null); setNotice(null);
    try {
      const payload = await saveBulkAttendance(programmeId, groupId, sessionId, Object.entries(pending).map(([learnerId, status]) => ({
        learnerId, status, version: sessionLearners.find(row => row.learnerId === learnerId)!.version,
      })));
      attendance.replaceAttendance(payload.results.map(row => row.attendanceRecord));
      setSessionLearners(current => current.map(row => payload.results.find(result => result.learnerId === row.learnerId) || row));
      setPending(current => {
        const next = { ...current };
        for (const row of payload.results) delete next[row.learnerId];
        return next;
      });
      setNotice('Attendance saved.');
    } catch (reason) {
      setBulkError(reason instanceof Error ? reason.message : 'Unable to save attendance.');
    } finally { setSaving(false); }
  };
  const sessionLabel = (session: BulkSession) => `${formatSystemTimestamp(session.occurrenceStart, {
    dateStyle: 'medium', timeStyle: 'short',
  })} · ${session.module} · ${session.sessionTitle}`;

  const programmes = useMemo(() => [...new Map(learners.filter(row => row.programmeId).map(row => [String(row.programmeId), row.programme])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [learners]);
  const groups = useMemo(() => {
    const options = new Map(learners.filter(row => String(row.programmeId) === programmeId && row.groupId).map(row => [String(row.groupId), display(row.groupName || row.group)]));
    for (const row of curriculumGroups) {
      if (String(row.programmeId) === programmeId && row.id && !['archived', 'deleted'].includes(row.status?.toLowerCase())) options.set(String(row.id), display(row.name));
    }
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [learners, curriculumGroups, programmeId]);
  const statuses = useMemo(() => [...new Set(learners.map(row => display(row.programStatus)).filter(value => value !== '--'))].sort(), [learners]);
  const loadedLearners = useMemo(() => loaded ? learners.filter(row => String(row.groupId) === loaded.groupId && (!loaded.programmeId || String(row.programmeId) === loaded.programmeId) && (!sessionId || sessionLearners.some(item => item.learnerId === row.id))) : [], [learners, loaded, sessionId, sessionLearners]);
  const visible = useMemo(() => loadedLearners.filter(row => programStatus === 'all' || (programStatus === 'active' ? display(row.programStatus).toLowerCase() === 'active' : display(row.programStatus) === programStatus)), [loadedLearners, programStatus]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const recent = (id: string) => selectRecentAttendance(records, id);
  const stageStatus = (ids: Iterable<string>, status: 'present' | 'absent') => {
    setPending(current => {
      const next = { ...current };
      for (const id of ids) {
        const learner = sessionLearners.find(row => row.learnerId === id);
        if (!learner) continue;
        if (learner.status === status) delete next[id];
        else next[id] = status;
      }
      return next;
    });
  };
  const loadStudents = () => { setQueryValues({ group: groupId, programme: programmeId, page: 1 }); setSelected(new Set()); setNotice(null); };


  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance" pageSubtitle="Bulk and individual attendance" userName={coach.name} userRole="Progress Coach"><main className={styles.page}>
    <section className={styles.card} aria-labelledby="bulk-title"><CardHeading id="bulk-title" icon="ri-group-line" title="Bulk attendance" copy="Manage attendance for learners in the selected programme and group." />
      {groupsLoading && <p role="status">Loading programme groups…</p>}
      {groupsError && <p role="alert">Unable to load programme groups: {groupsError}</p>}
      <div className={styles.formRow}><Field label="Programme"><select aria-label="Programme" value={programmeId} onChange={event => { setProgrammeId(event.target.value); setGroupId(''); }} disabled={loading || saving}><option value="">Select programme</option>{programmes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><Field label="Group"><select aria-label="Group" value={groupId} onChange={event => setGroupId(event.target.value)} disabled={!programmeId || saving}><option value="">Select group</option>{groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><button className={styles.primary} type="button" onClick={loadStudents} disabled={!programmeId || !groupId || saving}><AppIcon name="ri-group-line" />Load students</button></div>
    </section>
    <section className={`${styles.card} ${styles.editCard}`} aria-labelledby="edit-title"><CardHeading id="edit-title" icon="ri-calendar-edit-line" title="Attendance edit" copy="Choose a session and update selected learners." />
      <div className={`${styles.formRow} ${styles.sessionRow}`}><Field label="Session / occurrence"><select aria-label="Session / occurrence" value={sessionId} disabled={!programmeId || !groupId || sessionLoading || saving} onChange={event => { setSessionId(event.target.value); setQueryValues({ programme: programmeId, group: groupId, page: 1 }); }}><option value="">Select session</option>{sessions.map(session => <option key={session.id} value={session.id}>{sessionLabel(session)}</option>)}</select></Field></div>
      {sessionLoading && <p role="status">Loading session attendance...</p>}
      <div className={styles.editActions}><div className={styles.selectActions}><button className={styles.presentAction} type="button" disabled={!sessionId || !selected.size || sessionLoading || saving} onClick={() => stageStatus(selected, 'present')}><AppIcon name="ri-checkbox-circle-line" />Mark selected Present</button><button className={styles.absentAction} type="button" disabled={!sessionId || !selected.size || sessionLoading || saving} onClick={() => stageStatus(selected, 'absent')}><AppIcon name="ri-close-circle-line" />Mark selected Absent</button></div>
      <div><button className={styles.primary} type="button" disabled={!sessionId || !Object.keys(pending).length || saving || sessionLoading} onClick={() => void apply()}><AppIcon name="ri-check-line" />{saving ? 'Saving...' : 'Apply bulk update'}</button><button className={styles.secondary} type="button" disabled={saving || !Object.keys(pending).length} onClick={() => setPending({})}><AppIcon name="ri-delete-bin-line" />Discard</button></div></div>
      <div className={styles.editFooter}><div aria-live="polite" aria-atomic="true"><strong>Selected: {selected.size}</strong><strong>Pending changes: {Object.keys(pending).length}</strong></div></div>
      {bulkError && <p role="alert">{bulkError}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
    <section className={styles.card} aria-labelledby="students-title"><header className={styles.studentsHeader}><div className={styles.studentsSummary}><CardHeading id="students-title" icon="ri-user-3-line" title={`Students (${visible.length})`} copy="Learners loaded from the selected programme and group." />{bulkWarnings.length > 0 && <p className={styles.inlineWarning} role="status" title="Enrolment record unavailable.">{bulkWarnings.length} {bulkWarnings.length === 1 ? 'learner' : 'learners'} unavailable</p>}</div><Field label="Programme status"><select aria-label="Programme status" value={programStatus} onChange={event => setQueryValues({ status: event.target.value, page: 1 })}><option value="all">All statuses</option><option value="active">Active</option>{statuses.filter(value => value.toLowerCase() !== 'active').map(value => <option key={value} value={value}>{value}</option>)}</select></Field></header>
      <div className={`${styles.selectActions} ${styles.studentsSelection}`}><button type="button" disabled={!visible.length} onClick={() => setSelected(new Set(visible.map(row => row.id)))}><AppIcon name="ri-checkbox-blank-line" />Select all</button><button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}><AppIcon name="ri-delete-bin-line" />Clear</button></div>
      <div className={styles.tableScroll}><table><colgroup><col className={styles.checkboxColumn} /><col className={styles.learnerColumn} /><col className={styles.emailColumn} /><col className={styles.programmeColumn} /><col className={styles.attendanceColumn} /><col /><col className={styles.detailsColumn} /></colgroup><thead><tr><th aria-label="Selection" /><th>Learner</th><th>Email</th><th>Programme</th><th>Attendance</th><th>Recent</th><th>Actions</th></tr></thead><tbody>
        {loading ? Array.from({ length: 5 }, (_, row) => <tr key={row} aria-hidden="true">{Array.from({ length: 7 }, (_, column) => <td key={column}><SkeletonBlock className={styles.studentSkeleton} /></td>)}</tr>) : error ? <tr><td colSpan={7}><EmptyState variant="error" size="sm" title="Unable to load attendance" description={error} /></td></tr> : !loaded ? <tr><td colSpan={7}><EmptyState size="sm" title="Choose a group" description="Select a group, then load its learners." /></td></tr> : !pageRows.length ? <tr><td colSpan={7}><EmptyState size="sm" title="No learners found for this group." /></td></tr> : pageRows.map(learner => <tr key={learner.id} data-selected={selected.has(learner.id)}><td><input aria-label={`Select ${learner.learner}`} type="checkbox" checked={selected.has(learner.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(learner.id) ? next.delete(learner.id) : next.add(learner.id); return next; })} /></td><td><div className={styles.learnerIdentity}><strong>{learner.learner}</strong></div></td><td><span className={styles.emailText} title={display(learner.email)}>{display(learner.email)}</span></td><td><span className={styles.programStatus} data-programme-status={display(learner.programStatus).toLowerCase()}>{display(learner.programStatus)}</span></td><td><select aria-label={`Attendance for ${learner.learner}`} disabled={!sessionId || sessionLoading || saving || !sessionLearners.some(row => row.learnerId === learner.id)} value={pending[learner.id] || (['present', 'absent'].includes(sessionLearners.find(row => row.learnerId === learner.id)?.status || '') ? sessionLearners.find(row => row.learnerId === learner.id)?.status : '')} onChange={event => stageStatus([learner.id], event.target.value as 'present' | 'absent')}><option value="" disabled hidden>Not marked</option><option value="present">Present</option><option value="absent">Absent</option></select></td><td>{display(learner.programStatus).toLowerCase() === 'paused' ? <span className={lastFourStyles.paused}>Attendance paused</span> : <div className={`${styles.chips} ${lastFourStyles.chips}`}>{recent(learner.id).map(row => <span key={`${row.sessionId}-${row.sessionDate}`} data-status={row.status} title={`${row.status === 'present' ? 'Present' : 'Absent'} \u00b7 ${shortDate(row.sessionDate)}`}>{row.status === 'present' ? 'P' : 'A'} · {shortDate(row.sessionDate, true)}</span>)}{!recent(learner.id).length && '\u2014'}</div>}</td><td><button className={styles.linkButton} type="button" onClick={() => navigate(`/coach/attendance/${learner.id}`, { state: { groupId: loaded.groupId, programmeId: loaded.programmeId, programStatus } })}><AppIcon name="ri-eye-line" />View</button></td></tr>)}
      </tbody></table></div>{pageCount > 1 && <nav className={styles.pagination} aria-label="Students pagination"><button disabled={page === 1} onClick={() => setQueryValues({ page: page - 1 }, { replace: false })}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page === pageCount} onClick={() => setQueryValues({ page: page + 1 }, { replace: false })}>Next</button></nav>}
    </section>
  </main></WorkspaceShell>;
}

function CardHeading({ id, icon, title, copy }: { id: string; icon: string; title: string; copy: string }) { return <div className={styles.heading}><span><AppIcon className={icon} /></span><div><h1 id={id}>{title}</h1><p>{copy}</p></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span>{label}</span>{children}</label>; }
