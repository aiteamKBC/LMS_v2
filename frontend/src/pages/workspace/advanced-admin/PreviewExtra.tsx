import { useEffect, useMemo, useState } from 'react';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import {
  advancedAdminAttendance, advancedAdminCompliance, advancedAdminComplianceFile, advancedAdminEnrolment,
  advancedAdminMessages, advancedAdminMonthlyLogs, advancedAdminReviews,
  type AdvancedAdminComplianceDocument, type AdvancedAdminConversation, type AdvancedAdminEnrolment,
  type AdvancedAdminMonthlyLog, type AdvancedAdminAttendance, type AdvancedAdminReview,
} from '@/api/advancedAdmin';
import { buildUnifiedLearningSummary } from '@/pages/learner/my-learning/learningSummary';
import StructuredRecord from './StructuredRecord';

type Learning = { current: LearnerDetail; historical: StudentActivityResponse };

function usePreviewData<T>(learnerId: number, read: (id: number, signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    read(learnerId, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load this section.'); });
    return () => controller.abort();
  }, [learnerId, read]);
  return { data, error };
}

function State({ error, ready }: { error: string; ready: boolean }) {
  if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!ready) return <p role="status" className="rounded-xl border bg-white p-4 text-sm">Loading records…</p>;
  return null;
}

export function PreviewHome({ learning }: { learning: Learning }) {
  const summary = useMemo(() => buildUnifiedLearningSummary(learning.historical, learning.current), [learning]);
  return <section className="space-y-4" aria-label="Learner dashboard preview">
    <h2 className="text-xl font-semibold">Learning dashboard</h2>
    <div className="grid gap-3 sm:grid-cols-3">{[
      ['Courses', summary.subjectCount], ['Activities completed', `${summary.completedActivityCount} / ${summary.activityCount}`],
      ['Overall progress', `${summary.percent}%`],
    ].map(([name, value]) => <div key={name} className="rounded-2xl border bg-white p-5"><p className="text-sm text-foreground-500">{name}</p><strong className="mt-1 block text-2xl">{value}</strong></div>)}</div>
    <div className="rounded-2xl border bg-white p-5"><h3 className="font-semibold">Courses</h3><ul className="mt-3 space-y-2">{summary.subjects.map(subject => <li key={subject.id} className="flex justify-between border-b py-2 text-sm"><span>{subject.title}</span><strong>{subject.activities.filter(activity => activity.completed).length} / {subject.activities.length}</strong></li>)}</ul></div>
  </section>;
}

export function PreviewCalendar({ learnerId, learning }: { learnerId: number; learning: Learning }) {
  const attendance = usePreviewData<{ items: AdvancedAdminAttendance[] }>(learnerId, advancedAdminAttendance);
  const reviews = usePreviewData<{ pr: AdvancedAdminReview[]; mcm: AdvancedAdminReview[] }>(learnerId, advancedAdminReviews);
  const entries = useMemo(() => buildUnifiedLearningSummary(learning.historical, learning.current).subjects.flatMap(subject =>
    subject.activities.filter(activity => activity.schedule.date && !activity.schedule.date_needs_review)
      .map(activity => ({ id: `${subject.id}:${activity.id}`, date: activity.schedule.date!, subject: subject.title, title: activity.title, completed: activity.completed })))
    .sort((a, b) => a.date.localeCompare(b.date)), [learning]);
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Calendar</h2>
    <p className="text-sm text-foreground-600">Recorded activity dates, lectures and review appointments.</p>
    {attendance.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Attendance: {attendance.error}</p>}
    {reviews.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Reviews: {reviews.error}</p>}
    <h3 className="font-semibold">Learning activities</h3>
    {entries.length ? <div className="space-y-3">{entries.map(entry => <article key={entry.id} className="rounded-2xl border bg-white p-4">
      <time dateTime={entry.date} className="text-xs font-semibold text-primary-700">{entry.date}</time>
      <h3 className="mt-1 font-semibold">{entry.title}</h3><p className="text-sm text-foreground-600">{entry.subject} · {entry.completed ? 'Complete' : 'Not complete'}</p>
    </article>)}</div> : <p className="rounded-xl border bg-white p-4 text-sm">No dated learning activities recorded.</p>}
    <h3 className="font-semibold">Lectures and attendance</h3>
    {attendance.data && (attendance.data.items.length ? <ul className="space-y-2">{attendance.data.items.map((item, index) => <li key={`${item.sessionId || item.title}:${index}`} className="rounded-xl border bg-white p-4 text-sm">
      <strong>{item.date || 'Date not recorded'} · {item.title || 'Lecture'}</strong><p className="mt-1 text-foreground-600">{item.module} · {item.status}</p>
    </li>)}</ul> : <p className="rounded-xl border bg-white p-4 text-sm">No attendance dates recorded.</p>)}
    <h3 className="font-semibold">Review appointments</h3>
    {reviews.data && ([...reviews.data.pr, ...reviews.data.mcm].length ? <ul className="space-y-2">{[...reviews.data.pr, ...reviews.data.mcm].map(item => <li key={item.id} className="rounded-xl border bg-white p-4 text-sm">
      <strong>{item.plannedDate?.slice(0, 10) || item.completedDate?.slice(0, 10) || 'Date not recorded'} · {item.name || item.type}</strong>
      <p className="mt-1 text-foreground-600">{item.type} · {item.status}</p>
    </li>)}</ul> : <p className="rounded-xl border bg-white p-4 text-sm">No review appointments recorded.</p>)}
  </section>;
}

export function PreviewEnrolment({ learnerId }: { learnerId: number }) {
  const { data, error } = usePreviewData<AdvancedAdminEnrolment>(learnerId, advancedAdminEnrolment);
  return <section className="space-y-4"><h2 className="text-xl font-semibold">My Enrolment</h2><State error={error} ready={!!data} />
    {data && <><p className="rounded-xl border bg-white p-4 text-sm">{data.completed ? 'Enrolment questionnaire completed' : 'Enrolment questionnaire in progress or not recorded'}</p>
      <div className="grid gap-4 lg:grid-cols-2"><article className="rounded-2xl border bg-white p-5"><h3 className="mb-3 font-semibold">Programme and employer</h3><StructuredRecord value={data.summary} /></article>
        <article className="rounded-2xl border bg-white p-5"><h3 className="mb-3 font-semibold">Saved application</h3><StructuredRecord value={data.wizardDraft} /></article></div>
      <article className="rounded-2xl border bg-white p-5"><h3 className="mb-3 font-semibold">Extended ILR answers</h3><StructuredRecord value={data.answers} /></article></>}
  </section>;
}

export function PreviewCompliance({ learnerId }: { learnerId: number }) {
  const { data, error } = usePreviewData<{ items: AdvancedAdminComplianceDocument[] }>(learnerId, advancedAdminCompliance);
  const [openError, setOpenError] = useState('');
  async function open(documentId: string) {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { url } = await advancedAdminComplianceFile(learnerId, documentId);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setOpenError('');
    } catch (cause) { tab?.close(); setOpenError(cause instanceof Error ? cause.message : 'Could not open document.'); }
  }
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Compliance documents</h2><State error={error} ready={!!data} />
    {openError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{openError}</p>}
    {data && (data.items.length ? <ul className="space-y-3">{data.items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
      <div><strong>{item.type}</strong><p className="text-sm text-foreground-600">{item.filename} · {item.generatedAt?.slice(0, 10) || 'Date not recorded'} · {item.signed ? 'Signed' : 'Unsigned'}</p></div>
      <button type="button" onClick={() => open(item.id)} className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-semibold text-primary-700">View document</button>
    </li>)}</ul> : <p className="rounded-xl border bg-white p-4 text-sm">No generated compliance documents recorded for this learner.</p>)}
  </section>;
}

export function PreviewMessages({ learnerId }: { learnerId: number }) {
  const { data, error } = usePreviewData<{ items: AdvancedAdminConversation[] }>(learnerId, advancedAdminMessages);
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Messages</h2>
    <p className="text-sm text-foreground-600">Saved coach conversations. Reading this page does not mark messages as read.</p>
    <State error={error} ready={!!data} />
    {data && (data.items.length ? data.items.map(conversation => <article key={conversation.id} className="rounded-2xl border bg-white p-5">
      <h3 className="font-semibold">{conversation.coach}</h3>
      <ol className="mt-4 space-y-3">{conversation.messages.map(item => <li key={item.id} className="rounded-xl bg-foreground-50 p-3 text-sm">
        <div className="flex justify-between gap-3 text-xs text-foreground-500"><strong>{item.sender === 'learner' ? 'Learner' : 'Coach'}</strong><time dateTime={item.createdAt}>{item.createdAt.slice(0, 16).replace('T', ' ')}</time></div>
        <p className="mt-1 whitespace-pre-wrap break-words">{item.body}</p>
      </li>)}</ol>
      {!conversation.messages.length && <p className="mt-3 text-sm text-foreground-500">No visible messages in this conversation.</p>}
    </article>) : <p className="rounded-xl border bg-white p-4 text-sm">No saved conversations for this learner.</p>)}
  </section>;
}

export function PreviewMonthlyLogs({ learnerId }: { learnerId: number }) {
  const { data, error } = usePreviewData<{ months: AdvancedAdminMonthlyLog[]; totalMonths: number; completedMonths: number }>(learnerId, advancedAdminMonthlyLogs);
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Monthly Logs</h2><State error={error} ready={!!data} />
    {data && <><p className="rounded-xl border bg-white p-4 text-sm">{data.completedMonths} of {data.totalMonths} months signed by the learner</p>
      {data.months.length ? <div className="grid gap-3 md:grid-cols-2">{data.months.map(month => <article key={month.month} className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-primary-800">{month.month}</h3><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800">{month.status}</span></div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-foreground-500">Activities</dt><dd className="font-semibold">{month.row_count}</dd></div>
          <div><dt className="text-foreground-500">Actual hours</dt><dd className="font-semibold">{month.actual_hours}</dd></div>
          <div><dt className="text-foreground-500">Planned hours</dt><dd className="font-semibold">{month.planned_hours}</dd></div>
          <div><dt className="text-foreground-500">Training plan target</dt><dd className="font-semibold">{month.training_plan_target ?? 'Not recorded'}</dd></div></dl>
        <p className="mt-3 text-xs text-foreground-600">Learner signature: {month.student_signature ? 'Recorded' : 'Not recorded'} · Coach signature: {month.coach_signature ? 'Recorded' : 'Not recorded'}</p>
      </article>)}</div> : <p className="rounded-xl border bg-white p-4 text-sm">No monthly logs recorded for this learner.</p>}</>}
  </section>;
}
