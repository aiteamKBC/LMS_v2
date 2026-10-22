import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackButton } from '@/components/navigation/BackButton';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachViewAs } from '@/lib/coachViewAs';
import { roleNavMap } from '@/mocks/navigation';
import styles from './attendanceProfile.module.css';
import { useAttendanceDetail } from '@/features/coach/attendance/hooks/useAttendanceDetail';
import { acquireAttendanceDetail, attendanceDetailKey } from '@/features/coach/attendance/api/attendanceDetailCache';
import { formatAttendancePercentage } from '@/features/coach/attendance/selectors/attendanceSelectors';
import { deleteManualAttendance, deleteSourceAttendance, saveManualAttendance, updateSourceAttendance } from '@/features/coach/attendance/api/attendanceApi';
import type { AttendanceStatus, CoachAttendanceDetailRecord } from '@/features/coach/attendance/types/attendance.types';

const coachNav = roleNavMap.coach;
const show = (value?: string | null) => value?.trim() || '--';
const modeLabel = (mode?: 'live' | 'lazy') => mode === 'lazy' ? 'Recorded mode' : mode === 'live' ? 'Attendance mode' : 'Not available';
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
const generatedAt = () => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date()).replace(',', '');

export default function CoachAttendanceProfile() {
  const coach = useCoachIdentity();
  const { learnerId = '' } = useParams();
  const attendanceScope = JSON.stringify([
    coach.email.trim().toLowerCase(),
    coach.isViewingAsCoach ? coachViewAs()?.adminEmail.trim().toLowerCase() || '' : '',
    coach.isViewingAsCoach ? 'view-as' : 'coach',
  ]);
  const detail = useAttendanceDetail(learnerId, coach.isInitialized && Boolean(coach.email), attendanceScope);
  const { learner } = detail;
  const recorded = detail.recorded;
  const page = detail.page;
  const totalRecords = detail.pagination?.total || 0;
  const awaitingRecording = detail.awaitingRecording;
  const pageSize = detail.pagination?.pageSize || 20;
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize));
  const pageStart = (page - 1) * pageSize;
  const [printResult, setPrintResult] = useState<{ key: string; rows: CoachAttendanceDetailRecord[] } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const exportRequest = useRef<ReturnType<typeof acquireAttendanceDetail> | null>(null);
  const exportGeneration = useRef(0);
  useEffect(() => {
    setExporting(false); setPrintError(null);
    return () => { exportGeneration.current += 1; exportRequest.current?.release(); };
  }, [detail.key]);
  const exportReport = async () => {
    const generation = ++exportGeneration.current;
    setExporting(true); setPrintError(null);
    try {
      const rows: CoachAttendanceDetailRecord[] = [];
      for (let number = 1; number <= pageCount; number += 1) {
        const request = acquireAttendanceDetail(attendanceDetailKey(attendanceScope, learnerId, number, pageSize));
        exportRequest.current = request;
        try {
          const payload = await request.promise;
          if (generation !== exportGeneration.current) return;
          rows.push(...payload.records);
        } finally { request.release(); }
      }
      setPrintResult({ key: detail.key, rows });
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (generation === exportGeneration.current) window.print();
    } catch (reason) {
      if (generation === exportGeneration.current && !(reason instanceof Error && reason.name === 'AbortError')) {
        setPrintError(reason instanceof Error ? reason.message : 'Unable to prepare attendance report.');
      }
    } finally {
      if (generation === exportGeneration.current) setExporting(false);
    }
  };
  const [draft, setDraft] = useState({ date: '', module: '', sessionTitle: '', status: 'absent' as AttendanceStatus | '' });
  const [editingRecord, setEditingRecord] = useState<CoachAttendanceDetailRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const updateDraft = (field: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [field]: value }));
  const resetDraft = () => { setDraft({ date: '', module: '', sessionTitle: '', status: 'absent' }); setEditingRecord(null); setMutationError(null); };
  const editRecord = (row: CoachAttendanceDetailRecord) => {
    setEditingRecord(row);
    setDraft({ date: row.date || '', module: row.module || '', sessionTitle: row.title,
      status: row.status === 'present' || row.status === 'absent' ? row.status : '' });
    setMutationError(null);
  };
  const submitRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!learner || !draft.status) return;
    const input = { learnerId: learner.id, ...draft, status: draft.status };
    setSaving(true); setMutationError(null);
    try {
      if (editingRecord) {
        const { source, sourceId } = attendanceAction(editingRecord.id);
        if (source === 'coach-manual') await saveManualAttendance(input, sourceId);
        else await updateSourceAttendance({ ...input, source, sourceId });
      } else await saveManualAttendance(input);
      setPrintResult(null); resetDraft(); detail.reload();
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : 'Unable to save the attendance record.');
    } finally { setSaving(false); }
  };
  const removeRecord = async (row: CoachAttendanceDetailRecord) => {
    if (!learner || !window.confirm('Delete this attendance record for this learner?')) return;
    setMutationError(null);
    try {
      const { source, sourceId } = attendanceAction(row.id);
      if (source === 'coach-manual') await deleteManualAttendance(sourceId);
      else await deleteSourceAttendance({ learnerId: learner.id, source, sourceId });
      if (editingRecord?.id === row.id) resetDraft();
      setPrintResult(null); detail.reload();
    }
    catch (reason) { setMutationError(reason instanceof Error ? reason.message : 'Unable to delete the attendance record.'); }
  };
  const loading = coach.isInitialized && !coach.email ? false : (!coach.isInitialized || detail.loading);
  const error = coach.isInitialized && !coach.email
    ? 'Coach access is required to load this attendance profile.'
    : detail.error;
  return <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Attendance" pageSubtitle="Attendance history" userName={coach.name} userRole="Progress Coach"><main className={`${styles.page} attendance-profile-print-page`}>
    {loading && <section className={styles.card}><RowsSkeleton rows={6} /></section>}
    {error && <section className={styles.card}><EmptyState variant="error" title="Unable to load this attendance profile." description={error} /><div className={styles.actions}><button type="button" onClick={detail.reload}>Retry attendance history</button><BackButton fallback="/coach/attendance">Back</BackButton></div></section>}
    {!loading && !error && learner && <>
      <section className={`${styles.card} ${styles.hero}`}>
        <div className={styles.identity}>
          <p className={styles.eyebrow}>Learner attendance</p>
          <div className={styles.titleRow}>
            <h1>{learner.learner}</h1>
            <span className={styles.modeBadge} data-mode={learner.attendanceMode || 'unknown'} aria-label={`Learning mode: ${modeLabel(learner.attendanceMode)}`}>
              {modeLabel(learner.attendanceMode)}
            </span>
          </div>
          <p className={styles.email}>{show(learner.email)}</p>
          <div className={styles.meta}>
            <span><b>Programme</b>{show(learner.programme)}</span>
            <span><b>Cohort</b>{show(learner.cohort)}</span>
            <span><b>Group</b>{show(learner.group)}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={exporting} onClick={() => void exportReport()}>{exporting ? 'Preparing PDF...' : 'Export PDF'}</button>
          <BackButton fallback="/coach/attendance">Back</BackButton>
        </div>
      </section>
      <section className={styles.summary} aria-label="Attendance summary"><Summary title="Coach" lines={[detail.coach?.name || coach.name, detail.coach?.email || coach.email || '--', 'Phone not available']} /><Summary title="Tutor" lines={[detail.tutor?.name || 'Not assigned', detail.tutor?.email || '--']} /><Summary title="Attendance" lines={[formatAttendancePercentage(learner.attendance), `${learner.present ?? 0} present out of ${learner.sessions ?? 0}`, `${learner.absent ?? 0} absent`, ...(awaitingRecording ? [`${awaitingRecording} awaiting recording — counted as absent until completed in this view and PDF report`] : [])]} accent /></section>
      <section className={`${styles.card} ${styles.tableCard}`}>
        <header className={styles.sectionHeader}>
          <div><h2>Attendance history</h2><p>Review sessions and manage attendance records.</p></div>
          <span className={styles.recordCount}>{totalRecords} records</span>
        </header>
        {printError && <p className={styles.error} role="alert">{printError}</p>}
        <form onSubmit={submitRecord}>
          <fieldset className={styles.addRecord} disabled={saving || coach.isViewingAsCoach}>
            <legend>{editingRecord ? 'Edit attendance record' : 'Add attendance record'}</legend>
            <div className={styles.formFields}>
              <label>Date<input aria-label="Manual attendance date" type="date" required value={draft.date} onChange={event => updateDraft('date', event.target.value)} /></label>
              <label>Module<input aria-label="Manual attendance module" required value={draft.module} onChange={event => updateDraft('module', event.target.value)} /></label>
              <label>Lecture / Session<input aria-label="Manual attendance session" required value={draft.sessionTitle} onChange={event => updateDraft('sessionTitle', event.target.value)} /></label>
              <label>Status<select aria-label="Manual attendance status" required value={draft.status} onChange={event => updateDraft('status', event.target.value)}><option value="" disabled>Select a correction</option><option value="present">Present</option><option value="absent">Absent</option></select></label>
            </div>
            <div className={styles.formFooter}>
              <small>Edits and deletions are saved for this learner and appear in both learner and coach attendance.</small>
              <div className={styles.formActions}>
                {editingRecord && <button className={styles.secondaryButton} type="button" onClick={resetDraft}>Cancel edit</button>}
                <button type="submit" disabled={!draft.status}>{saving ? 'Saving…' : editingRecord ? 'Save changes' : 'Add attendance record'}</button>
              </div>
            </div>
            {mutationError && <small className={styles.error} role="alert">{mutationError}</small>}
          </fieldset>
        </form>
        <div className={styles.tableScroll} role="region" aria-label="Attendance history table" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Date</th><th scope="col">Module</th><th scope="col">Lecture / Session</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>{recorded.length ? recorded.map((row, index) => <tr key={`${row.id}-${row.date}-${index}`} data-status={row.status}>
              <td>{show(formatRecordDate(row.date))}</td>
              <td>{show(row.module)}</td>
              <td><strong>{show(row.title)}</strong>{Boolean(row.legacyAmbiguity?.length) && <small>Ambiguous legacy match: records kept separate</small>}{(row.status === 'absent' || Boolean(row.absenceReport)) && <small className={styles.report}>Absent report: {row.absenceReport ? 'Uploaded' : 'Not uploaded'}{row.absenceReport?.url && <a href={row.absenceReport.url}>View report</a>}</small>}</td>
              <td><span className={styles.status} data-status={row.status}>{titleCase(row.status)}</span>{row.status === 'awaiting_recording' && <small>Counts as absent until recording is completed</small>}</td>
              <td><span className={styles.rowActions}><button type="button" onClick={() => editRecord(row)}>Edit</button><button type="button" onClick={() => void removeRecord(row)}>Delete</button></span></td>
            </tr>) : <tr><td colSpan={5}><EmptyState size="sm" title="No attendance records found for this learner." /></td></tr>}</tbody>
          </table>
        </div>
      </section>
      {recorded.length > 0 && <nav className={styles.pagination} aria-label="Attendance pagination"><span aria-live="polite">Showing {pageStart + 1}–{Math.min(pageStart + recorded.length, totalRecords)} of {totalRecords} records</span><div><button type="button" disabled={page === 1} onClick={() => detail.setPage(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={!detail.pagination?.hasMore} onClick={() => detail.setPage(page + 1)}>Next</button></div></nav>}
      <AttendancePrintReport learner={learner} coachName={detail.coach?.name || coach.name} rows={printResult?.key === detail.key ? printResult.rows : recorded} tutorName={detail.tutor?.name} awaitingRecording={awaitingRecording} />
      </>}
  </main></WorkspaceShell>;
}
function Summary({ title, lines, accent = false }: { title: string; lines: string[]; accent?: boolean }) {
  return <article className={styles.summaryCard} data-accent={accent}>
    <h2>{title}</h2>
    {lines.map((line, index) => <p key={`${line}-${index}`} className={
      index === 0 ? styles.summaryLead : accent && index > 2 ? styles.summaryNote : undefined
    }>{line}</p>)}
  </article>;
}

function AttendancePrintReport({ learner, coachName, tutorName, rows, awaitingRecording }: { learner: NonNullable<ReturnType<typeof useAttendanceDetail>['learner']>; coachName: string; tutorName?: string; rows: CoachAttendanceDetailRecord[]; awaitingRecording: number }) {
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
      <PrintDetail label="Learning mode" value={modeLabel(learner.attendanceMode)} />
      <PrintDetail label="Programme dates" value={programmeDates} />
      <PrintDetail label="Coach" value={show(coachName)} />
      <PrintDetail label="Tutor" value={tutorName || '--'} />
    </section>
    <section className={styles.printStats} aria-label="Report totals">
      <PrintStat label="Total lectures" value={total} />
      <PrintStat label="Present" value={learner.present || 0} />
      <PrintStat label="Absent" value={learner.absent || 0} />
      <PrintStat label="Attendance rate" value={attendanceRate} />
    </section>
    {awaitingRecording > 0 && <p className={styles.printNote}>{awaitingRecording} awaiting recording. In this report and Coach View, these sessions count as absent until the recording is completed.</p>}
    <table className={styles.printTable}>
      <colgroup><col className={styles.numberColumn} /><col className={styles.dateColumn} /><col className={styles.moduleColumn} /><col className={styles.lectureColumn} /><col className={styles.statusColumn} /></colgroup>
      <thead><tr><th>#</th><th>Date</th><th>Module</th><th>Lecture Name</th><th>Status</th></tr></thead>
      <tbody>{rows.length ? rows.map((row, index) => <tr key={`print-${row.id}-${row.date}-${index}`}><td>{index + 1}</td><td>{show(row.date)}</td><td>{show(row.module)}</td><td>{show(row.title)}</td><td data-status={row.status}>{titleCase(row.status)}</td></tr>) : <tr><td colSpan={5}>No attendance records found for this learner.</td></tr>}</tbody>
    </table>
    <footer className={styles.printFooter}><span>KBC LearningOS · Confidential attendance record</span><span className={styles.pageNumber}>Page </span></footer>
  </article>;
}

function PrintDetail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function PrintStat({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function attendanceAction(id: string) {
  const separator = id.indexOf(':');
  const source = id.slice(0, separator);
  const sourceId = id.slice(separator + 1);
  if (separator < 1 || !sourceId || !['coach-manual', 'microsoft-teams', 'kbc-attendance'].includes(source)) {
    throw new Error('Unable to identify this attendance record.');
  }
  return { source, sourceId };
}
function formatRecordDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(parsed);
}
