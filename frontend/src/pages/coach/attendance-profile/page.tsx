import { useEffect, useState } from 'react';
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
import { deleteManualAttendance, deleteSourceAttendance, saveManualAttendance, updateSourceAttendance } from '@/features/coach/attendance/api/attendanceApi';
import type { AttendanceStatus, CoachAttendanceSession } from '@/features/coach/attendance/types/attendance.types';

const coachNav = roleNavMap.coach;
const show = (value?: string | null) => value?.trim() || '--';
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
const generatedAt = () => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date()).replace(',', '');

export default function CoachAttendanceProfile() {
  const coach = useCoachIdentity();
  const { learnerId = '' } = useParams();
  const detail = useAttendanceDetail(learnerId, coach.isInitialized && Boolean(coach.email));
  const { learner } = detail;
  const recorded = detail.recorded;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(recorded.length / 10));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * 10;
  const visibleRecords = recorded.slice(pageStart, pageStart + 10);
  useEffect(() => { setPage(1); }, [learnerId]);
  useEffect(() => { setPage(current => Math.min(current, pageCount)); }, [pageCount]);
  const [draft, setDraft] = useState({ date: '', module: '', sessionTitle: '', status: 'absent' as AttendanceStatus });
  const [editingRecord, setEditingRecord] = useState<CoachAttendanceSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const updateDraft = (field: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [field]: value }));
  const resetDraft = () => { setDraft({ date: '', module: '', sessionTitle: '', status: 'absent' }); setEditingRecord(null); setMutationError(null); };
  const editRecord = (row: CoachAttendanceSession) => {
    setEditingRecord(row);
    setDraft({ date: row.sessionDate || '', module: row.module || '', sessionTitle: row.sessionTitle, status: row.status as AttendanceStatus });
    setMutationError(null);
  };
  const submitRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!learner) return;
    setSaving(true); setMutationError(null);
    try {
      if (editingRecord?.manualId) await saveManualAttendance({ learnerId: learner.id, ...draft }, editingRecord.manualId);
      else if (editingRecord?.source && editingRecord.sourceId) await updateSourceAttendance({ learnerId: learner.id, ...draft, source: editingRecord.source, sourceId: editingRecord.sourceId });
      else await saveManualAttendance({ learnerId: learner.id, ...draft });
      resetDraft(); detail.reload();
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : 'Unable to save the attendance record.');
    } finally { setSaving(false); }
  };
  const removeRecord = async (row: CoachAttendanceSession) => {
    if (!learner || !window.confirm('Delete this attendance record for this learner?')) return;
    setMutationError(null);
    try {
      if (row.manualId) await deleteManualAttendance(row.manualId);
      else if (row.source && row.sourceId) await deleteSourceAttendance({ learnerId: learner.id, source: row.source, sourceId: row.sourceId });
      if (editingRecord?.sessionId === row.sessionId) resetDraft();
      detail.reload();
    }
    catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'Unable to delete the attendance record.'); }
  };
  const loading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || detail.loading);
  const error = coach.isInitialized && !coach.email
    ? 'Coach access is required to load this attendance profile.'
    : detail.error;
  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Attendance" pageSubtitle="Attendance history" userName={coach.name} userRole="Progress Coach"><main className={`${styles.page} attendance-profile-print-page`}>
    {loading && <section className={styles.card}><RowsSkeleton rows={6} /></section>}
    {error && <EmptyState variant="error" title="Unable to load this attendance profile." description={error} />}
    {!loading && !error && learner && <><section className={`${styles.card} ${styles.hero}`}><div><p className={styles.eyebrow}>Learner attendance</p><h1>{learner.learner}</h1><p>{show(learner.email)}</p><div className={styles.meta}><span><b>Programme</b>{show(learner.programme)}</span><span><b>Cohort</b>{show(learner.cohort)}</span><span><b>Group</b>{show(learner.group)}</span></div></div><div className={styles.actions}><button type="button" onClick={() => window.print()}>Export PDF</button><BackButton fallback="/coach/attendance">Back</BackButton></div></section>
      <section className={styles.summary} aria-label="Attendance summary"><Summary title="Coach" lines={[coach.name, coach.email || '--', 'Phone not available']} /><Summary title="Tutor" lines={['Not assigned', '--']} /><Summary title="Attendance" lines={[formatAttendancePercentage(learner.attendance), `${learner.present ?? 0} present out of ${learner.sessions ?? 0}`]} accent /></section>
      <section className={`${styles.card} ${styles.tableCard}`}><header className={styles.sectionHeader}><div><h2>Attendance</h2><p>{recorded.length} records</p></div></header><form onSubmit={submitRecord}><fieldset className={styles.addRecord} disabled={saving || coach.isViewingAsCoach}><legend>{editingRecord ? 'Edit attendance record' : 'Add attendance record'}</legend><label>Date<input aria-label="Manual attendance date" type="date" required value={draft.date} onChange={event => updateDraft('date', event.target.value)} /></label><label>Module<input aria-label="Manual attendance module" required value={draft.module} onChange={event => updateDraft('module', event.target.value)} /></label><label>Lecture / Session<input aria-label="Manual attendance session" required value={draft.sessionTitle} onChange={event => updateDraft('sessionTitle', event.target.value)} /></label><label>Status<select aria-label="Manual attendance status" value={draft.status} onChange={event => updateDraft('status', event.target.value)}><option value="present">Present</option><option value="absent">Absent</option></select></label><button type="submit">{saving ? 'Saving…' : editingRecord ? 'Save changes' : 'Add attendance record'}</button>{editingRecord && <button type="button" onClick={resetDraft}>Cancel edit</button>}<small>Edits and deletions are saved for this learner and appear in both learner and coach attendance.</small>{mutationError && <small role="alert">{mutationError}</small>}</fieldset></form>
        <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Module</th><th>Lecture / Session</th><th>Status</th><th>Actions</th></tr></thead><tbody>{recorded.length ? visibleRecords.map((row, index) => <tr key={`${row.sessionId}-${row.sessionDate}-${index}`} data-status={row.status}><td>{show(row.sessionDateLabel)}</td><td>{show(row.module)}</td><td><strong>{show(row.sessionTitle)}</strong>{Boolean(row.legacyAmbiguity?.length) && <small>Ambiguous legacy match: records kept separate</small>}{(row.rawStatus === 'absent' || row.status === 'absent') && <small className={styles.report}>Absent report: {row.absenceReport ? 'Uploaded' : 'Not uploaded'}{row.absenceReport?.url && <a href={row.absenceReport.url}>View report</a>}</small>}</td><td><span className={styles.status} data-status={row.status}>{titleCase(row.status)}</span></td><td><span className={styles.rowActions}><button type="button" onClick={() => editRecord(row)}>Edit</button><button type="button" onClick={() => void removeRecord(row)}>Delete</button></span></td></tr>) : <tr><td colSpan={5}><EmptyState size="sm" title="No attendance records found for this learner." /></td></tr>}</tbody></table></div>
      </section>
      {recorded.length > 0 && <nav className={styles.pagination} aria-label="Attendance pagination"><span aria-live="polite">Showing {pageStart + 1}–{Math.min(pageStart + 10, recorded.length)} of {recorded.length} records</span><div><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></nav>}
      <AttendancePrintReport learner={learner} coachName={learner.coachName || coach.name} rows={recorded} />
      </>}
  </main></WorkspaceShell>;
}
function Summary({ title, lines, accent = false }: { title: string; lines: string[]; accent?: boolean }) { return <article className={styles.summaryCard} data-accent={accent}><h2>{title}</h2>{lines.map((line, index) => <p key={`${line}-${index}`} className={index === 0 ? styles.summaryLead : undefined}>{line}</p>)}</article>; }

function AttendancePrintReport({ learner, coachName, rows }: { learner: NonNullable<ReturnType<typeof useAttendanceDetail>['learner']>; coachName: string; rows: CoachAttendanceSession[] }) {
  const total = learner.sessions || 0;
  const attendanceRate = formatAttendancePercentage(learner.attendance);
  const programmeDates = learner.learnerStartDate || learner.learnerEndDate
    ? `${show(learner.learnerStartDate)} — ${show(learner.learnerEndDate)}`
    : '--';
  return <article className={styles.printReport} aria-label="Student attendance report">
    <div className={styles.printTopBar} />
    <header className={styles.printHeader}>
      <img src="/assets/kbc-logo.png" alt="Kent Business College" />
      <div><h1>Student Attendance Report</h1><p>Generated {generatedAt()}</p></div>
    </header>
    <section className={styles.printDetails}>
      <PrintDetail label="Student" value={learner.learner} />
      <PrintDetail label="Email" value={show(learner.email)} />
      <PrintDetail label="Program" value={show(learner.programme)} />
      <PrintDetail label="Programme dates" value={programmeDates} />
      <PrintDetail label="Coach" value={show(coachName)} />
      <PrintDetail label="Tutor" value="--" />
    </section>
    <section className={styles.printStats} aria-label="Report totals">
      <PrintStat label="Total lectures" value={total} />
      <PrintStat label="Present" value={learner.present || 0} />
      <PrintStat label="Absent" value={learner.absent || 0} />
      <PrintStat label="Attendance rate" value={attendanceRate} />
    </section>
    <table className={styles.printTable}>
      <colgroup><col className={styles.numberColumn} /><col className={styles.dateColumn} /><col className={styles.moduleColumn} /><col className={styles.lectureColumn} /><col className={styles.statusColumn} /></colgroup>
      <thead><tr><th>#</th><th>Date</th><th>Module</th><th>Lecture Name</th><th>Status</th></tr></thead>
      <tbody>{rows.length ? rows.map((row, index) => <tr key={`print-${row.sessionId}-${row.sessionDate}-${index}`}><td>{index + 1}</td><td>{show(row.sessionDate || row.sessionDateLabel)}</td><td>{show(row.module)}</td><td>{show(row.sessionTitle)}</td><td data-status={row.status}>{titleCase(row.status)}</td></tr>) : <tr><td colSpan={5}>No attendance records found for this learner.</td></tr>}</tbody>
    </table>
    <footer className={styles.printFooter}><span>KBC LearningOS · Confidential attendance record</span><span className={styles.pageNumber}>Page </span></footer>
  </article>;
}

function PrintDetail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function PrintStat({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
