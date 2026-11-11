import { useEffect, useState } from 'react';
import { loadDailyResults, type DailyResults } from '../dailyResults';
import { SessionRecordingPlayer } from '@/components/feature/SessionRecordingPlayer';
import { resolveRecordingUrl, sessionFileUrl } from '@/api/sessionResults';
import { attendanceSheetRows } from "../../shared/entities/liveSessionArtifacts.helpers";
import type { Lecture } from '../types';

const labels = { present: 'Present', absent: 'Absent', pending: 'Attendance not confirmed', review: 'Identity needs review' };
export default function LectureAttendance({ lecture, timeZone }: { lecture: Lecture; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DailyResults | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [previewId, setPreviewId] = useState('');
  const { moduleId, occurrenceId, date, seriesId, sessionNumber } = lecture;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true); setData(null); setError(''); setPreviewId('');
    loadDailyResults({ moduleId, occurrenceId, date, seriesId, sessionNumber }, timeZone, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Attendance could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open, moduleId, occurrenceId, date, seriesId, sessionNumber, timeZone, revision]);
  const duration = (Date.parse(lecture.endsAt || '') - Date.parse(lecture.startsAt || '')) / 60000;
  const linked = Boolean(lecture.seriesId && lecture.occurrenceId && lecture.sessionNumber);
  const downloadSheet = async () => {
    if (!data) return;
    setDownloadError('');
    try {
      const XLSX = await import('xlsx');
      const rows = attendanceSheetRows(data.attendance.map((person, index) => ({
        id: String(index), occurrence_id: lecture.occurrenceId!, display_name: person.name, email: person.email,
        attended: person.status === 'present', expected: true, total_attendance_seconds: person.seconds,
        intervals: (person.intervals || []).map(visit => ({ joinDateTime: visit.joinedAt, leaveDateTime: visit.leftAt })),
      }))).map((row, index) => ({ ...row, Status: labels[data.attendance[index].rawStatus || data.attendance[index].status as keyof typeof labels] || 'Attendance not confirmed',
        'Lecture date': lecture.date, 'Calendar time zone': timeZone, Module: lecture.module, Group: lecture.group }));
      const safeRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^[=+@-]/.test(value) ? `'${value}` : value])));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(safeRows);
      sheet['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 24 }));
      XLSX.utils.book_append_sheet(workbook, sheet, lecture.date);
      const title = lecture.title.replace(/[^a-z0-9_-]+/gi, '-');
      XLSX.writeFile(workbook, `${title}-${lecture.date}-attendance.xlsx`, { compression: true });
    } catch (reason) { setDownloadError(reason instanceof Error ? reason.message : 'Sheet could not be downloaded.'); }
  };
  const downloadFile = async (file: DailyResults['artifacts'][number]) => {
    setFileBusy(file.id); setDownloadError('');
    try {
      const url = file.type === 'recording' ? await resolveRecordingUrl(lecture.seriesId!, file.id, true)
        : sessionFileUrl(lecture.seriesId!, file, undefined, true);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = ''; anchor.click();
    } catch (reason) { setDownloadError(reason instanceof Error ? reason.message : 'File could not be downloaded.'); }
    finally { setFileBusy(''); }
  };
  return <div className="border-t border-background-200 bg-background-100/40 px-3 py-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-foreground-600">{duration > 0 ? `Lecture duration: ${Math.round(duration)} min` : 'Lecture duration unavailable'}</span>
      {linked ? <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="font-semibold text-primary-700 underline">{open ? 'Hide attendance & saved files' : 'View attendance & saved files'}</button>
        : <span>Attendance not linked to a saved session</span>}
    </div>
    {open && linked && <section className="mt-3 space-y-3" aria-label={`Attendance for ${lecture.module} on ${lecture.date}`}>
      {busy && <p role="status">Loading attendance...</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-bold">{lecture.module} / {lecture.group} / {lecture.date}</p>
            <p className="mt-1">{data.attendance.length} assigned learners / {data.attendance.filter(p => p.status === 'present').length} present / {data.attendance.filter(p => p.status === 'absent').length} absent / {data.attendance.filter(p => !['present', 'absent'].includes(p.status)).length} unconfirmed</p></div>
          <button type="button" disabled={!data.attendance.length} onClick={() => void downloadSheet()} className="font-semibold text-primary-700 underline disabled:opacity-50">Download attendance sheet</button>
        </div>
        {!data.reportReady && <p role="status" className="rounded bg-amber-50 p-2 text-amber-900">A complete attendance report for this lecture day is not available. Missing evidence is not treated as absence.</p>}
        {!data.attendance.length ? <p>No assigned learner register is available for this module lecture.</p> : <div className="max-h-80 overflow-auto rounded border border-background-200"><table className="w-full text-left"><thead className="sticky top-0 bg-background-100"><tr><th className="p-2">Assigned learner</th><th className="p-2">Time in session</th><th className="p-2">Attendance</th></tr></thead><tbody>
          {data.attendance.map(person => <tr key={person.email} className="border-t border-background-200"><td className="p-2"><p className="font-semibold">{person.name}</p><p className="text-foreground-500">{person.email}</p></td><td className="p-2 whitespace-nowrap">{Math.floor(person.seconds / 60)}m {person.seconds % 60}s</td><td className="p-2">{labels[person.rawStatus || person.status as keyof typeof labels] || 'Attendance not confirmed'}</td></tr>)}
        </tbody></table></div>}
        {data.staff.length > 0 && <details><summary className="cursor-pointer font-semibold">Staff participation (excluded from learner totals)</summary><ul className="mt-2 space-y-2">{data.staff.map(person => <li key={person.email}>{person.name} / {person.roles.join(', ')} / {person.status === 'joined' ? `Joined: ${Math.floor(person.seconds / 60)}m ${person.seconds % 60}s` : 'No confirmed join evidence for this day'}</li>)}</ul></details>}
        <div><p className="font-semibold">Saved files for {lecture.date} only</p>
          {!data.artifacts.length && <p className="mt-1">No dated files are available for this lecture day.</p>}
          {data.artifacts.map((file, index) => <div key={file.id} className="mt-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>{file.type === 'recording' ? 'Recording' : 'Transcript'} {index + 1}</span>
              <div className="flex gap-3"><button type="button" disabled={file.state !== 'ready'} aria-expanded={previewId === file.id} onClick={() => setPreviewId(current => current === file.id ? '' : file.id)} className="font-semibold text-primary-700 underline disabled:opacity-50">{previewId === file.id ? 'Hide preview' : 'Preview'}</button>
                <button type="button" disabled={file.state !== 'ready' || Boolean(fileBusy)} onClick={() => void downloadFile(file)} className="font-semibold text-primary-700 underline disabled:opacity-50">{fileBusy === file.id ? 'Preparing...' : file.state === 'ready' ? 'Download file' : 'Not ready'}</button></div>
            </div>
            {previewId === file.id && (file.type === 'recording' ? <SessionRecordingPlayer seriesId={lecture.seriesId!} file={file} transcripts={data.artifacts.filter(item => item.type === 'transcript')} label={`Lecture recording ${index + 1}`} />
              : <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background-50 p-3">{file.text || 'Saved transcript text is not available yet.'}</pre>)}
          </div>)}
          {data.unplacedFileCount > 0 && <p className="mt-1 text-foreground-500">Other-day or undated files are excluded from this view.</p>}
        </div>
      </>}
      {downloadError && <p role="alert" className="text-red-700">{downloadError}</p>}
      <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)} className="font-semibold text-primary-700 underline disabled:opacity-50">Refresh saved attendance</button>
    </section>}
  </div>;
}
