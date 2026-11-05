import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { useListQueryState } from '@/hooks/useListQueryState';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceOverview.module.css';
import lastFourStyles from './attendanceLastFour.module.css';
import { useAttendanceOptions } from '@/features/coach/attendance/hooks/useAttendanceOptions';
import type { CoachAttendanceLearner } from '@/features/coach/attendance/types/attendance.types';
import { fetchAttendanceSession, saveBulkAttendance, type AttendanceRecent, type AttendanceSessionOption, type BulkLearner, type BulkAttendanceWarning } from '@/features/coach/attendance/api/attendanceApi';
import { acquireAttendanceContext, attendanceContextKey, invalidateAttendanceContext } from '@/features/coach/attendance/api/attendanceContextCache';
import { attendanceDetailKey, invalidateAttendanceDetail } from '@/features/coach/attendance/api/attendanceDetailCache';
import { coachViewAs } from '@/lib/coachViewAs';
import { AttendanceCorrectionMenu, type AttendanceCorrectionAction } from '@/components/feature/AttendanceCorrectionMenu';
import { invalidateLearnerReads } from '@/api/learnerRead';

const coachNav = roleNavMap.coach;
const PAGE_SIZE = 10;
const QUERY_DEFAULTS = { group: '', programme: '', module: '', status: 'all', page: 1 };
const moduleValue = (group: string, module: string) => JSON.stringify([group, module]);
const groupLabel = (group: { name: string; cohort: string }) => `${group.name}${group.cohort && group.cohort !== '--' ? ` (${group.cohort})` : ''}`;

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
  const options = useAttendanceOptions(coach.email, coach.isInitialized && Boolean(coach.email));
  const [learners, setLearners] = useState<Array<CoachAttendanceLearner & { recent: AttendanceRecent[] }>>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const loading = !coach.isInitialized || (Boolean(coach.email) && (options.loading || groupLoading));
  const error = coach.isInitialized && !coach.email ? 'Coach access is required to load attendance data.' : options.error;
  const [groupId, setGroupId] = useState(String(query.group));
  const [programmeId, setProgrammeId] = useState(String(query.programme));
  const loaded = useMemo(() => query.group ? { groupId: String(query.group), programmeId: String(query.programme) } : null, [query.group, query.programme]);
  const programStatus = String(query.status);
  const moduleKey = String(query.module);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<Array<Omit<AttendanceSessionOption, 'status'>>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsRetry, setSessionsRetry] = useState(0);
  const [sessionLearners, setSessionLearners] = useState<BulkLearner[]>([]);
  const [bulkWarnings, setBulkWarnings] = useState<BulkAttendanceWarning[]>([]);
  const [pending, setPending] = useState<Record<string, 'present' | 'absent'>>({});
  const [sessionLoading, setSessionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const page = Number(query.page);
  const [notice, setNotice] = useState<string | null>(null);
  const previousCoach = useRef(coach.email);
  const currentCoach = useRef(coach.email);
  currentCoach.current = coach.email;
  const sessionContext = useRef('');
  const selectedGroupAllowed = options.programmes.some(row => row.id === programmeId && row.groups.some(group => group.id === groupId));
  const attendanceScope = JSON.stringify([coach.email.trim().toLowerCase(),
    coach.isViewingAsCoach ? coachViewAs()?.adminEmail.trim().toLowerCase() || '' : '',
    coach.isViewingAsCoach ? 'view-as' : 'coach']);
  const contextKey = attendanceContextKey(attendanceScope, programmeId, groupId);
  const moduleOptions = useAttendanceOptions(attendanceScope,
    coach.isInitialized && Boolean(coach.email) && options.programmes.some(row => row.id === programmeId), programmeId);
  const groups = (moduleOptions.programmes.find(row => row.id === programmeId)
    || options.programmes.find(row => row.id === programmeId))?.groups || [];
  const selectedModule = groups.find(group => group.id === groupId)?.modules?.find(module => module.key === moduleKey);
  const moduleReady = !moduleKey || Boolean(selectedModule);
  const availableSessions = moduleKey ? sessions.filter(session => selectedModule?.sessionIds.includes(session.id)) : sessions;
  useEffect(() => {
    if (previousCoach.current === coach.email) return;
    previousCoach.current = coach.email;
    setGroupId(''); setProgrammeId(''); setQueryValues({ group: '', programme: '', module: '', page: 1 });
    setLearners([]);
  }, [coach.email, setQueryValues]);

  useEffect(() => {
    setGroupId(String(query.group));
    setProgrammeId(String(query.programme));
  }, [query.group, query.programme]);

  useEffect(() => {
    let cancelled = false;
    setLearners([]); setGroupLoading(false);
    sessionContext.current = '';
    setSessionId(''); setSessions([]); setSessionsLoading(false); setSessionLearners([]); setBulkWarnings([]); setPending({}); setSelected(new Set());
    setBulkError(null); setSessionsError(null);
    if (!programmeId || !groupId || !selectedGroupAllowed) { setSessionLoading(false); return; }
    setGroupLoading(true); setSessionsLoading(true);
    const request = acquireAttendanceContext(contextKey);
    request.promise.then(payload => {
      if (!cancelled) {
        setLearners(payload.learners.map(row => ({ id: row.id, learner: row.name, email: row.email,
          programme: payload.programme.name, programmeId: payload.programme.id, group: payload.group.name, groupId: payload.group.id,
          programStatus: row.status === 'on-break' ? 'Paused' : 'Active', recent: row.recent })));
        setSessions(payload.sessions);
      }
    }).catch(reason => {
      if (!cancelled && !(reason instanceof Error && reason.name === 'AbortError')) {
        setSessionsError(reason instanceof Error ? reason.message : 'Unable to load group attendance context.');
      }
    }).finally(() => { if (!cancelled) { setGroupLoading(false); setSessionsLoading(false); } });
    return () => { cancelled = true; request.release(); };
  }, [programmeId, groupId, moduleKey, contextKey, selectedGroupAllowed, sessionsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setSessionLearners([]); setBulkWarnings([]); setPending({}); setSelected(new Set()); setBulkError(null); setNotice(null);
    if (!sessionId || sessionContext.current !== JSON.stringify([coach.email, programmeId, groupId, moduleKey])) { setSessionLoading(false); return; }
    setSessionLoading(true);
    fetchAttendanceSession(programmeId, groupId, sessionId, controller.signal).then(payload => {
      if (!controller.signal.aborted) { setSessionLearners(payload.learners || []); setBulkWarnings(payload.warnings || []); }
    }).catch(reason => {
      if (!controller.signal.aborted) setBulkError(reason instanceof Error ? reason.message : 'Unable to load attendance.');
    }).finally(() => { if (!controller.signal.aborted) setSessionLoading(false); });
    return () => controller.abort();
  }, [programmeId, groupId, moduleKey, sessionId, coach.email]);

  const selectedSession = availableSessions.find(session => session.id === sessionId);
  const hasValidSession = Boolean(selectedSession);
  const selectionEnabled = hasValidSession && !saving && !coach.isViewingAsCoach;
  const currentSaveScope = useRef('');
  currentSaveScope.current = JSON.stringify([coach.email, programmeId, groupId, moduleKey, sessionId]);
  const correctOne = async (learnerId: string, status: AttendanceCorrectionAction) => {
    const row = sessionLearners.find(item => item.learnerId === learnerId);
    if (!selectionEnabled || !row || sessionLoading || Object.keys(pending).length) return;
    const scope = currentSaveScope.current;
    setSaving(true); setBulkError(null); setNotice(null);
    try {
      const payload = await saveBulkAttendance(programmeId, groupId, sessionId, [{ learnerId, status, version: row.version }]);
      invalidateAttendanceContext(contextKey); invalidateLearnerReads();
      moduleOptions.reload();
      for (const result of payload.results) invalidateAttendanceDetail(attendanceDetailKey(attendanceScope, result.learnerId));
      if (scope !== currentSaveScope.current) return;
      setLearners(current => current.map(learner => {
        const result = payload.results.find(item => item.learnerId === learner.id);
        return result ? { ...learner, recent: result.recent } : learner;
      }));
      setSessionLearners(current => current.map(item => payload.results.find(result => result.learnerId === item.learnerId) || item));
      setNotice(status === 'reset' ? 'Manual correction reset. Original attendance restored.' : 'Attendance saved.');
    } catch (reason) {
      if (scope === currentSaveScope.current) setBulkError(reason instanceof Error ? reason.message : 'Unable to save attendance.');
    } finally { setSaving(false); }
  };

  const apply = async () => {
    if (!hasValidSession || !selected.size || !Object.keys(pending).length || sessionLoading || saving) return;
    const owner = coach.email;
    setSaving(true); setBulkError(null); setNotice(null);
    try {
      const payload = await saveBulkAttendance(programmeId, groupId, sessionId, Object.entries(pending).map(([learnerId, status]) => ({
        learnerId, status, version: sessionLearners.find(row => row.learnerId === learnerId)!.version,
      })));
      if (currentCoach.current !== owner) return;
      invalidateAttendanceContext(contextKey);
      moduleOptions.reload();
      for (const result of payload.results) invalidateAttendanceDetail(attendanceDetailKey(attendanceScope, result.learnerId));
      setLearners(current => current.map(learner => {
        const result = payload.results.find(row => row.learnerId === learner.id);
        return result ? { ...learner, recent: result.recent } : learner;
      }));
      setSessionLearners(current => current.map(row => payload.results.find(result => result.learnerId === row.learnerId) || row));
      setPending(current => {
        const next = { ...current };
        for (const row of payload.results) delete next[row.learnerId];
        return next;
      });
      setNotice('Attendance saved.');
    } catch (reason) {
      if (currentCoach.current === owner) setBulkError(reason instanceof Error ? reason.message : 'Unable to save attendance.');
    } finally { setSaving(false); }
  };
  const sessionLabel = (session: Omit<AttendanceSessionOption, 'status'>) => `${shortDate(session.date)} · ${session.time} · ${session.title}`;

  const programmes = options.programmes.map(row => [row.id, row.name]);
  const statuses = useMemo(() => [...new Set(learners.map(row => display(row.programStatus)).filter(value => value !== '--'))].sort(), [learners]);
  const loadedLearners = useMemo(() => loaded ? learners.filter(row => String(row.groupId) === loaded.groupId && (!loaded.programmeId || String(row.programmeId) === loaded.programmeId) && (!sessionId || sessionLoading || sessionLearners.some(item => item.learnerId === row.id))) : [], [learners, loaded, sessionId, sessionLoading, sessionLearners]);
  const visible = useMemo(() => loadedLearners.filter(row =>
    (!moduleKey || selectedModule?.learnerIds.includes(row.id))
    && (programStatus === 'all' || (programStatus === 'active' ? display(row.programStatus).toLowerCase() === 'active' : display(row.programStatus) === programStatus)))
    .map(row => moduleKey ? { ...row, recent: selectedModule?.recentByLearner[row.id] || [] } : row),
    [loadedLearners, programStatus, moduleKey, selectedModule]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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
    <section className={styles.card} aria-labelledby="bulk-title"><CardHeading id="bulk-title" icon="ri-group-line" title="Bulk attendance" copy="Choose a programme, then a group or a module within that group. Select a session, choose learners and mark them Present or Absent. Click Apply bulk update to save changes for that session only. Use View to open a learner's full attendance history." />
      {options.loading && <p role="status">Loading programme groups…</p>}
      {options.error && <p role="alert">Unable to load programme groups: {options.error}</p>}
      <button type="button" disabled={saving || options.loading} onClick={() => { options.reload(); moduleOptions.reload(); }}>Refresh options</button>
      {programmeId && moduleOptions.loading && <p role="status">Loading attendance modules…</p>}
      {programmeId && moduleOptions.error && <p role="alert">Unable to load attendance modules: {moduleOptions.error} <button type="button" onClick={moduleOptions.reload}>Retry modules</button></p>}
      <div className={styles.formRow}>
        <Field label="Programme"><select aria-label="Programme" value={programmeId} onChange={event => {
          setProgrammeId(event.target.value); setGroupId('');
          setQueryValues({ programme: event.target.value, group: '', module: '', page: 1 });
        }} disabled={loading || saving}><option value="">Select programme</option>{programmes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        <Field label="Group / module"><select aria-label="Group / module" value={moduleKey ? moduleValue(groupId, moduleKey) : groupId} onChange={event => {
          const value = event.target.value;
          const parent = groups.find(group => group.modules?.some(module => moduleValue(group.id, module.key) === value));
          const module = parent?.modules?.find(item => moduleValue(parent.id, item.key) === value);
          const nextGroup = parent?.id || value;
          setGroupId(nextGroup);
          setQueryValues({ programme: programmeId, group: nextGroup, module: module?.key || '', page: 1 });
        }} disabled={!programmeId || saving}>
          <option value="">Select group or module</option>
          {moduleKey && !selectedModule && <option value={moduleValue(groupId, moduleKey)} disabled>{moduleOptions.loading ? 'Loading selected module…' : 'Selected module unavailable'}</option>}
          {groups.map(group => <optgroup key={group.id} label={groupLabel(group)}>
            <option value={group.id}>{groupLabel(group)}</option>
            {group.modules?.map(module => <option key={module.key} value={moduleValue(group.id, module.key)}>{module.name} — {groupLabel(group)}</option>)}
          </optgroup>)}
        </select></Field>
        <button className={styles.primary} type="button" onClick={loadStudents} disabled={!programmeId || !groupId || !moduleReady || saving}><AppIcon name="ri-group-line" />Load students</button>
      </div>
    </section>
    <section className={`${styles.card} ${styles.editCard}`} aria-labelledby="edit-title"><CardHeading id="edit-title" icon="ri-calendar-edit-line" title="Attendance edit" copy="Choose a session and update selected learners. Changing the session clears unsaved changes. Edit attendance saves an individual correction immediately." />
      <div className={`${styles.formRow} ${styles.sessionRow}`}><Field label="Session / occurrence"><select aria-label="Session / occurrence" value={sessionId} disabled={!programmeId || !groupId || !moduleReady || groupLoading || sessionsLoading || sessionLoading || saving || !availableSessions.length} onChange={event => { sessionContext.current = JSON.stringify([coach.email, programmeId, groupId, moduleKey]); setSelected(new Set()); setPending({}); setSessionLearners([]); setBulkWarnings([]); setNotice(null); setSessionLoading(Boolean(event.target.value)); setSessionId(event.target.value); setQueryValues({ programme: programmeId, group: groupId, page: 1 }); }}><option value="" disabled={!availableSessions.length}>{sessionsLoading ? 'Loading sessions...' : sessionsError ? 'Unable to load sessions' : programmeId && groupId && !availableSessions.length ? (moduleKey ? 'No editable sessions for this module' : 'No sessions available for this group') : 'Select session'}</option>{availableSessions.map(session => <option key={session.id} value={session.id}>{sessionLabel(session)}</option>)}</select></Field></div>
      {selectedModule && !groupLoading && !sessionsError && !availableSessions.length && <p>Use View to see this module's attendance history.</p>}
      {moduleKey && !moduleOptions.loading && !selectedModule && !moduleOptions.error && <p role="alert">This module is no longer available in the selected group. Choose a group or module again.</p>}
      {sessionsError && <p role="alert">{sessionsError} <button type="button" onClick={() => setSessionsRetry(current => current + 1)}>Retry sessions</button></p>}
      {sessionsLoading && <p role="status">Loading sessions...</p>}
      {sessionLoading && <p role="status">Loading session attendance...</p>}
      <p>{hasValidSession ? 'Select learners to mark attendance.' : 'Select a session to begin marking attendance.'}</p>
      {selectedSession && <p className={styles.sessionScope} id="attendance-session-scope">Editing only: <strong>{sessionLabel(selectedSession)}</strong>. The table shows attendance for this session. Changes marked Unsaved need Apply bulk update.</p>}
      <div className={styles.editActions}><div className={styles.selectActions}><button className={styles.presentAction} type="button" disabled={!selectionEnabled || !selected.size || sessionLoading} onClick={() => stageStatus(selected, 'present')}><AppIcon name="ri-checkbox-circle-line" />Mark selected Present</button><button className={styles.absentAction} type="button" disabled={!selectionEnabled || !selected.size || sessionLoading} onClick={() => stageStatus(selected, 'absent')}><AppIcon name="ri-close-circle-line" />Mark selected Absent</button></div>
      <div><button className={styles.primary} type="button" disabled={!selectionEnabled || !selected.size || !Object.keys(pending).length || sessionLoading} onClick={() => void apply()}><AppIcon name="ri-check-line" />{saving ? 'Saving...' : 'Apply bulk update'}</button><button className={styles.secondary} type="button" disabled={!selectionEnabled || !Object.keys(pending).length} onClick={() => setPending({})}><AppIcon name="ri-delete-bin-line" />Discard</button></div></div>
      <div className={styles.editFooter}><div aria-live="polite" aria-atomic="true"><strong>Selected: {selected.size}</strong><strong>Pending changes: {Object.keys(pending).length}</strong></div></div>
      {bulkError && <p role="alert">{bulkError}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
    <section className={styles.card} aria-labelledby="students-title"><header className={styles.studentsHeader}><div className={styles.studentsSummary}><CardHeading id="students-title" icon="ri-user-3-line" title={`Students (${visible.length})`} copy={selectedModule ? `Learners with attendance for ${selectedModule.name} in the selected group.` : 'Learners loaded from the selected programme and group.'} />{bulkWarnings.length > 0 && <p className={styles.inlineWarning} role="status" title="Enrolment record unavailable.">{bulkWarnings.length} {bulkWarnings.length === 1 ? 'learner' : 'learners'} unavailable</p>}</div><Field label="Programme status"><select aria-label="Programme status" value={programStatus} onChange={event => setQueryValues({ status: event.target.value, page: 1 })}><option value="all">All statuses</option><option value="active">Active</option>{statuses.filter(value => value.toLowerCase() !== 'active').map(value => <option key={value} value={value}>{value}</option>)}</select></Field></header>
      <div className={`${styles.selectActions} ${styles.studentsSelection}`}><button type="button" disabled={!selectionEnabled || !visible.length} onClick={() => setSelected(new Set(visible.map(row => row.id)))}><AppIcon name="ri-checkbox-blank-line" />Select all</button><button type="button" disabled={!selectionEnabled || !selected.size} onClick={() => setSelected(new Set())}><AppIcon name="ri-delete-bin-line" />Clear</button></div>
      <div className={styles.tableScroll}><table><colgroup><col className={styles.checkboxColumn} /><col className={styles.learnerColumn} /><col className={styles.emailColumn} /><col className={styles.programmeColumn} /><col className={styles.attendanceColumn} /><col /><col className={styles.detailsColumn} /></colgroup><thead><tr><th aria-label="Selection" /><th>Learner</th><th>Email</th><th>Programme</th><th>Attendance</th><th>{selectedSession ? 'Selected session' : 'Recent'}</th><th>Actions</th></tr></thead><tbody>
        {loading ? Array.from({ length: 5 }, (_, row) => <tr key={row} aria-hidden="true">{Array.from({ length: 7 }, (_, column) => <td key={column}><SkeletonBlock className={styles.studentSkeleton} /></td>)}</tr>) : error ? <tr><td colSpan={7}><EmptyState variant="error" size="sm" title="Unable to load attendance" description={error} /></td></tr> : !loaded ? <tr><td colSpan={7}><EmptyState size="sm" title="Choose a group" description="Select a group, then load its learners." /></td></tr> : !pageRows.length ? <tr><td colSpan={7}><EmptyState size="sm" title="No learners found for this group." /></td></tr> : pageRows.map(learner => <tr key={learner.id} data-selected={selected.has(learner.id)}><td><input aria-label={`Select ${learner.learner}`} type="checkbox" disabled={!selectionEnabled} checked={selected.has(learner.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(learner.id) ? next.delete(learner.id) : next.add(learner.id); return next; })} /></td><td><div className={styles.learnerIdentity}><strong>{learner.learner}</strong></div></td><td><span className={styles.emailText} title={display(learner.email)}>{display(learner.email)}</span></td><td><span className={styles.programStatus} data-programme-status={display(learner.programStatus).toLowerCase()}>{display(learner.programStatus)}</span></td><td><select aria-label={`Attendance for ${learner.learner}`} aria-describedby={selectedSession ? "attendance-session-scope" : undefined} disabled={!selectionEnabled || sessionLoading || !sessionLearners.some(row => row.learnerId === learner.id)} value={pending[learner.id] || (['present', 'absent'].includes(sessionLearners.find(row => row.learnerId === learner.id)?.status || '') ? sessionLearners.find(row => row.learnerId === learner.id)?.status : '')} onChange={event => { setSelected(current => new Set(current).add(learner.id)); stageStatus([learner.id], event.target.value as 'present' | 'absent'); }}><option value="" disabled hidden>Not marked</option><option value="present">Present</option><option value="absent">Absent</option></select></td><td>{selectedSession ? <SessionAttendance session={selectedSession} learner={sessionLearners.find(row => row.learnerId === learner.id)} pending={pending[learner.id]} loading={sessionLoading} /> : display(learner.programStatus).toLowerCase() === 'paused' ? <span className={lastFourStyles.paused}>Attendance paused</span> : <div className={`${styles.chips} ${lastFourStyles.chips}`}>{learner.recent.map((row, index) => <span key={`${row.date}-${index}`} data-status={row.status} title={`${row.status === 'present' ? 'Present' : 'Absent'} \u00b7 ${shortDate(row.date)}`}>{row.status === 'present' ? 'P' : 'A'} · {shortDate(row.date, true)}</span>)}{!learner.recent.length && '\u2014'}</div>}</td><td>{hasValidSession && <AttendanceCorrectionMenu learnerName={learner.learner}
            manualStatus={sessionLearners.find(row => row.learnerId === learner.id)?.manualStatus}
            disabled={!selectionEnabled || sessionLoading || Object.keys(pending).length > 0 || !sessionLearners.some(row => row.learnerId === learner.id)}
            saving={saving} onAction={action => void correctOne(learner.id, action)} />}
          <button className={styles.linkButton} type="button" onClick={() => navigate(`/coach/attendance/${learner.id}`, { state: { groupId: loaded.groupId, programmeId: loaded.programmeId, programStatus } })}><AppIcon name="ri-eye-line" />View</button></td></tr>)}
      </tbody></table></div>{pageCount > 1 && <nav className={styles.pagination} aria-label="Students pagination"><button disabled={page === 1} onClick={() => setQueryValues({ page: page - 1 }, { replace: false })}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page === pageCount} onClick={() => setQueryValues({ page: page + 1 }, { replace: false })}>Next</button></nav>}
    </section>
  </main></WorkspaceShell>;
}

function CardHeading({ id, icon, title, copy }: { id: string; icon: string; title: string; copy: string }) { return <div className={styles.heading}><span><AppIcon className={icon} /></span><div><h1 id={id}>{title}</h1><p>{copy}</p></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span>{label}</span>{children}</label>; }

function SessionAttendance({ session, learner, pending, loading }: {
  session: Omit<AttendanceSessionOption, 'status'>; learner?: BulkLearner;
  pending?: 'present' | 'absent'; loading: boolean;
}) {
  if (loading) return <span className={styles.sessionState}>Loading attendance…</span>;
  const status = pending || learner?.status || 'unmarked';
  const label = !learner ? 'Unavailable' : status === 'present' ? 'Present' : status === 'absent' ? 'Absent'
    : status === 'upcoming' ? 'Upcoming' : status === 'in_progress' ? 'In progress' : 'Not marked';
  return <div className={styles.sessionAttendance}>
    <div className={`${styles.chips} ${lastFourStyles.chips}`}><span data-status={status}
      title={`${label} · ${shortDate(session.date)} · ${session.time} · ${session.title}`}>
      {label === 'Present' ? 'P' : label === 'Absent' ? 'A' : label} · {shortDate(session.date, true)}
    </span></div>
    {pending && <small className={styles.unsaved}>Unsaved</small>}
  </div>;
}
