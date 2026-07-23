import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerCalendarEvents, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;

function dateOf(session?: LearnerCalendarEvent | null): string | null {
  return session?.scheduledDate || session?.targetDate || session?.date || null;
}

function formatDate(value?: string | null, long = false): string {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', long
    ? { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const [hour, minute] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status?: string): string {
  const labels: Record<string, string> = {
    'not-scheduled': 'Not Scheduled', scheduled: 'Scheduled', 'in-progress': 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
  };
  return status ? labels[status] || status : '-';
}

function initials(name?: string): string {
  return name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : '-';
}

function inWindow(value: string | undefined | null, from: Date | null, to: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && (!from || date > from) && date <= to;
}

function minutesFrom(value?: string | null): number {
  if (!value) return 0;
  const text = value.toLowerCase();
  const amount = Number.parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] || '0');
  return text.includes('hour') || text.includes('hr') ? amount * 60 : amount;
}

function hoursLabel(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-background-300 bg-background-100/50 px-5 py-7 text-center"><p className="text-xl font-bold text-foreground-300">-</p><p className="mt-1 text-xs text-foreground-400">{children}</p></div>;
}

function Accordion({ id, title, icon, status, open, onToggle, children }: { id: string; title: string; icon: string; status?: 'Complete' | 'Incomplete'; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  const steps: Record<string, number> = {
    opening: 1,
    presentation: 2,
    'ksb-reflection': 3,
    'next-month': 4,
    resources: 5,
    wellbeing: 6,
    feedback: 7,
    'confirm-next': 8,
  };
  const step = steps[id];
  const isOverview = id === 'learning' || id === 'previous-summary';
  const isSummary = id === 'meeting-summary';
  const helper = isOverview ? 'Session context' : isSummary ? 'Final record' : step ? `Agenda step ${step} of 8` : 'Session section';
  return (
    <section className={`overflow-hidden rounded-2xl border bg-background-50 transition-all duration-200 ${open ? 'border-primary-200 shadow-[0_10px_30px_rgba(69,26,128,0.08)]' : 'border-foreground-200/70 shadow-[0_3px_12px_rgba(25,12,50,0.035)] hover:border-primary-200 hover:shadow-md'}`}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4 ${open ? 'bg-gradient-to-r from-primary-50/90 to-secondary-50/30' : 'hover:bg-primary-50/35'}`}>
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${open ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20' : isSummary ? 'bg-secondary-50 text-secondary-700' : 'bg-primary-50 text-primary-700'}`}>
          <i className={`${icon} text-base`} />
          {step && <span className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white px-1 text-[8px] font-extrabold ${open ? 'bg-secondary-500 text-white' : 'bg-primary-700 text-white'}`}>{step}</span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[9px] font-bold uppercase tracking-[0.12em] ${open ? 'text-primary-600' : 'text-foreground-400'}`}>{helper}</span>
          <span className="mt-0.5 block text-sm font-bold text-foreground-900 sm:text-[15px]">{title}</span>
        </span>
        {status && <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold sm:inline-flex ${status === 'Complete' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'Complete' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>{status}</span>}
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${open ? 'rotate-180 bg-primary-100 text-primary-700' : 'bg-background-100 text-foreground-500'}`}><i className="ri-arrow-down-s-line text-lg" /></span>
      </button>
      {status && <div className="px-4 pb-3 sm:hidden"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${status === 'Complete' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'Complete' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>{status}</span></div>}
      {open && <div className="border-t border-primary-100 bg-white p-4 sm:p-6">{children}</div>}
    </section>
  );
}

function useMonthlyCoachingData() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [sessions, setSessions] = useState<LearnerCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      fetchLearnerDetail(myLearner.kind, myLearner.id),
      fetchLearnerCalendarEvents(myLearner.kind, myLearner.id),
    ])
      .then(([detail, calendar]) => {
        if (cancelled) return;
        setLearner(detail);
        setSessions(calendar.events.filter((event) => event.source === 'mcr').sort((a, b) => a.sequence - b.sequence));
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load monthly coaching sessions.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

  return { learner, sessions, loading, error };
}

export function MonthlyCoachingListPage() {
  const { learner, sessions, loading, error } = useMonthlyCoachingData();
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize));
  const visibleSessions = sessions.slice((page - 1) * pageSize, page * pageSize);
  const completedCount = sessions.filter((session) => session.status === 'completed').length;
  const scheduledCount = sessions.filter((session) => ['scheduled', 'in-progress'].includes(session.status)).length;
  const cancelledCount = sessions.filter((session) => session.status === 'cancelled').length;
  const coachName = sessions.find((session) => session.coachName)?.coachName || 'Your coach';

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Monthly Coaching" pageSubtitle="30-day coaching sessions with your coach" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}>
      <main className="w-full space-y-5 p-4 md:p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><i className="ri-error-warning-line mr-2" />{error}</div>}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#190532] via-[#32105d] to-[#602396] p-6 text-white shadow-xl shadow-primary-950/10 md:p-7">
          <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-secondary-300/15 blur-3xl"></div>
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-secondary-100"><i className="ri-user-voice-line text-secondary-300" />One-to-one support</span>
              <h1 className="mt-3 text-2xl font-bold text-white md:text-3xl">Monthly coaching</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">Your 30-day coaching sessions with {coachName}. Review progress, learning evidence and agreed next steps.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
              {[
                ['Total', sessions.length, 'ri-stack-line', 'text-secondary-300'],
                ['Scheduled', scheduledCount, 'ri-calendar-check-line', 'text-blue-300'],
                ['Completed', completedCount, 'ri-checkbox-circle-line', 'text-emerald-300'],
                ['Cancelled', cancelledCount, 'ri-close-circle-line', 'text-rose-300'],
              ].map(([label, value, icon, colour]) => <div key={String(label)} className="rounded-2xl border border-white/[0.08] bg-white/[0.07] p-3 backdrop-blur"><i className={`${icon} ${colour} text-sm`} /><p className="mt-1 text-xl font-bold">{value}</p><p className="text-[10px] text-white/50">{label}</p></div>)}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-[0_8px_30px_rgba(27,12,52,0.06)]">
          <div className="flex flex-col gap-3 border-b border-background-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><i className="ri-calendar-event-line" /></span><div><h2 className="text-base font-bold text-foreground-900">Coaching sessions</h2><p className="mt-0.5 text-xs text-foreground-500">Open a session to review its 30-day learning summary.</p></div></div>
            <Link to="/learner/calendar" className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 text-xs font-bold text-primary-700 transition hover:bg-primary-100"><i className="ri-calendar-2-line" />Open calendar</Link>
          </div>
          {loading ? <div className="p-10 text-center text-sm text-foreground-400">Loading monthly coaching sessions...</div> : sessions.length === 0 ? <div className="p-5"><Empty>No monthly coaching sessions were found.</Empty></div> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="border-b border-primary-100 bg-primary-50/70 text-[10px] font-bold uppercase tracking-wide text-primary-900/60"><tr><th className="px-5 py-3.5">Session Name / Session Type</th><th className="px-5 py-3.5">Coach</th><th className="px-5 py-3.5">Planned / Scheduled Date</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Scheduling Assistant</th><th className="px-5 py-3.5 text-right">Session Actions</th></tr></thead>
                  <tbody className="divide-y divide-background-200">
                    {visibleSessions.map((session) => {
                      const booked = Boolean(session.scheduledDate && session.scheduledTime) && !['not-scheduled', 'cancelled'].includes(session.status);
                      return (
                        <tr key={session.id} className="group transition-colors hover:bg-primary-50/35">
                          <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background-100 text-xs font-extrabold text-primary-700 transition group-hover:bg-primary-100">#{session.sequence}</span><div><p className="text-xs font-bold text-foreground-900">Monthly Coaching #{session.sequence}</p><p className="mt-1 text-[10px] text-foreground-400">30-day coaching session</p></div></div></td>
                          <td className="px-5 py-4"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-100 text-[9px] font-bold text-secondary-700">{initials(session.coachName)}</span><span className="text-xs font-semibold text-foreground-700">{session.coachName || '-'}</span></div></td>
                          <td className="px-5 py-4"><div className="flex items-center gap-2"><i className="ri-calendar-line text-primary-500" /><div><p className="text-xs font-semibold text-foreground-700">{formatDate(booked ? session.scheduledDate : session.targetDate)}</p>{booked && <p className="mt-1 text-[10px] text-foreground-400">at {formatTime(session.scheduledTime)}</p>}</div></div></td>
                          <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${session.status === 'completed' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : session.status === 'cancelled' ? 'bg-rose-50 text-rose-700 ring-rose-200' : booked ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}><i className={session.status === 'completed' ? 'ri-checkbox-circle-line' : session.status === 'cancelled' ? 'ri-close-circle-line' : 'ri-time-line'} />{statusLabel(session.status)}</span></td>
                          <td className="px-5 py-4"><Link to="/learner/calendar" className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-foreground-600 transition hover:bg-primary-50 hover:text-primary-700"><i className="ri-calendar-2-line" />{booked ? 'Reschedule' : 'Schedule'}</Link></td>
                          <td className="px-5 py-4"><div className="flex items-center justify-end"><Link to={`/learner/monthly-coaching/${encodeURIComponent(session.id)}`} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 hover:shadow-md">View <i className="ri-arrow-right-line" /></Link></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-background-200 bg-background-50 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1.5"><button type="button" onClick={() => setPage(1)} disabled={page === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-foreground-500 disabled:opacity-40"><i className="ri-skip-left-line" /></button><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-foreground-500 disabled:opacity-40"><i className="ri-arrow-left-s-line" /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 5).map((number) => <button key={number} type="button" onClick={() => setPage(number)} className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-bold ${page === number ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-300 bg-white text-foreground-600'}`}>{number}</button>)}<button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-foreground-500 disabled:opacity-40"><i className="ri-arrow-right-s-line" /></button><button type="button" onClick={() => setPage(totalPages)} disabled={page === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-300 bg-white text-foreground-500 disabled:opacity-40"><i className="ri-skip-right-line" /></button><span className="ml-2 text-[10px] text-foreground-400">10 items per page</span></div>
                <p className="text-[10px] text-foreground-500">{(page - 1) * pageSize + 1} - {Math.min(page * pageSize, sessions.length)} of {sessions.length} items</p>
              </div>
            </>
          )}
        </section>
      </main>
    </WorkspaceShell>
  );
}

export default function MonthlyCoachingPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { learner, sessions, loading, error } = useMonthlyCoachingData();
  const [openSections, setOpenSections] = useState<string[]>(['learning']);
  const selected = sessions.find((session) => session.id === sessionId) || null;
  const index = selected ? sessions.findIndex((session) => session.id === selected.id) : -1;
  const previous = index > 0 ? sessions[index - 1] : null;
  const next = index >= 0 && index < sessions.length - 1 ? sessions[index + 1] : null;

  const window = useMemo(() => {
    const previousDate = dateOf(previous);
    const selectedDate = dateOf(selected);
    const from = previousDate ? new Date(`${previousDate}T23:59:59`) : null;
    const plannedEnd = selectedDate ? new Date(`${selectedDate}T23:59:59`) : new Date();
    return { from, to: plannedEnd > new Date() ? new Date() : plannedEnd };
  }, [previous, selected]);

  const progress = useMemo(() => learner ? [
    ...learner.quizAttempts.filter((item) => item.passed),
    ...(learner.videoProgress || []),
    ...(learner.componentProgress || []),
  ].filter((item) => inWindow(item.submittedAt, window.from, window.to)) : [], [learner, window]);

  const learningItems = useMemo(() => progress.map((record) => {
    if ('quizId' in record) {
      const component = learner?.components.find((item) => item.quizMeta?.quizId === record.quizId);
      return { key: `quiz:${record.quizId}:${record.submittedAt}`, title: component?.component || `Quiz #${record.quizId}`, detail: 'Passed quiz', at: record.submittedAt };
    }
    const component = learner?.components.find((item) => item.componentId === record.componentId);
    const type = 'componentType' in record ? record.componentType : 'Video';
    return { key: `component:${record.componentId}:${record.submittedAt}`, title: component?.component || type, detail: `${type} completed${record.reportedTime ? ` · ${record.reportedTime}` : ''}`, at: record.submittedAt };
  }), [learner, progress]);
  const ksbCodes = useMemo(() => [...new Set(progress.flatMap((record) => record.ksbs || []))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [progress]);
  const learningMinutes = progress.reduce((sum, record) => sum + minutesFrom(record.reportedTime), 0);
  const toggle = (id: string) => setOpenSections((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Monthly Coaching" pageSubtitle="Your 30-day coaching session with your coach" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}>
      <div className="space-y-4 p-4 md:p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><i className="ri-error-warning-line mr-2" />{error}</div>}
        <Link to="/learner/monthly-coaching" className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:text-primary-800"><i className="ri-arrow-left-line" />Back to coaching sessions</Link>
        {loading ? <div className="rounded-xl border border-background-200 bg-white p-10 text-center text-sm text-foreground-400">Loading coaching session...</div> : !selected ? <div className="rounded-xl border border-background-200 bg-white p-5"><Empty>This monthly coaching session was not found.</Empty></div> : (
          <>
            <section className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-sm">
              <div className="bg-gradient-to-r from-primary-950 to-primary-800 p-5 text-white sm:p-6"><span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/80">{statusLabel(selected.status)}</span><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent-300">30-day coaching session</p><h1 className="mt-1 text-xl font-bold text-white">Monthly Coaching #{selected.sequence}</h1><p className="mt-1 text-sm text-white/60">{formatDate(dateOf(selected), true)} at {formatTime(selected.scheduledTime)}</p></div>{selected.meetingLink && <a href={selected.meetingLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-primary-800"><i className="ri-video-chat-line mr-1.5" />Join meeting</a>}</div></div>
              <div className="space-y-5 p-5 sm:p-6">
                <div><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">Session participants</p><div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center gap-3 rounded-xl border border-background-200 p-3.5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">{initials(learner?.name)}</span><div><p className="text-[10px] font-semibold uppercase text-foreground-400">Learner</p><p className="text-sm font-bold text-foreground-900">{learner?.name || '-'}</p></div></div><div className="flex items-center gap-3 rounded-xl border border-background-200 p-3.5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">{initials(selected.coachName)}</span><div><p className="text-[10px] font-semibold uppercase text-foreground-400">Coach</p><p className="text-sm font-bold text-foreground-900">{selected.coachName || '-'}</p></div></div></div></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Duration', `${selected.durationMinutes || 60} minutes`], ['Meeting type', selected.meetingProvider || '-'], ['Scheduled time', formatTime(selected.scheduledTime)], ['Learning window', previous ? `Since session #${previous.sequence}` : 'First 30-day period']].map(([label, value]) => <div key={label} className="rounded-xl bg-background-100 p-3.5"><p className="text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p><p className="mt-1 text-xs font-bold text-foreground-800">{value}</p></div>)}</div>
              </div>
            </section>

            <Accordion id="learning" title="30-Day Learning Progress & Summary" icon="ri-graduation-cap-line" open={openSections.includes('learning')} onToggle={toggle}>
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-primary-50 p-4"><p className="text-[10px] font-semibold uppercase text-primary-500">Completed activities</p><p className="mt-1 text-2xl font-bold text-primary-800">{progress.length}</p></div><div className="rounded-xl bg-accent-50 p-4"><p className="text-[10px] font-semibold uppercase text-accent-600">Completed activity time</p><p className="mt-1 text-2xl font-bold text-accent-800">{hoursLabel(learningMinutes)}</p></div><div className="rounded-xl bg-emerald-50 p-4"><p className="text-[10px] font-semibold uppercase text-emerald-600">KSBs evidenced</p><p className="mt-1 text-2xl font-bold text-emerald-800">{ksbCodes.length}</p></div></div>
              <div className="mt-4"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold text-foreground-800">What the learner completed</h2><span className="text-[10px] text-foreground-400">{learningItems.length} {learningItems.length === 1 ? 'record' : 'records'}</span></div>{learningItems.length === 0 ? <Empty>No completed learning was recorded in this 30-day period.</Empty> : <div className="divide-y divide-background-200 rounded-xl border border-background-200">{learningItems.map((item) => <div key={item.key} className="flex items-start gap-3 p-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><i className="ri-checkbox-circle-line" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground-800">{item.title}</p><p className="text-xs text-foreground-400">{item.detail}</p></div><span className="text-[10px] text-foreground-400">{new Date(item.at).toLocaleDateString('en-GB')}</span></div>)}</div>}</div>
            </Accordion>
            <Accordion id="previous-summary" title="Previous Meeting Summary" icon="ri-history-line" open={openSections.includes('previous-summary')} onToggle={toggle}>
              {previous ? <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase text-foreground-400">Previous session</p><p className="mt-1 text-sm font-bold text-foreground-900">Monthly Coaching #{previous.sequence}</p></div><div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase text-foreground-400">Date</p><p className="mt-1 text-sm font-bold text-foreground-900">{formatDate(dateOf(previous))}</p></div><div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase text-foreground-400">Status</p><p className="mt-1 text-sm font-bold text-foreground-900">{statusLabel(previous.status)}</p></div>{previous.notes && <p className="sm:col-span-3 whitespace-pre-wrap rounded-xl border border-background-200 p-4 text-sm text-foreground-700">{previous.notes}</p>}</div> : <Empty>This is the first monthly coaching session, so there is no previous meeting summary.</Empty>}
            </Accordion>
            <Accordion id="opening" title="Opening the Meeting (5 minutes)" icon="ri-play-circle-line" status={selected.status === 'completed' ? 'Complete' : 'Incomplete'} open={openSections.includes('opening')} onToggle={toggle}>
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase text-foreground-400">Learner</p><p className="mt-1 text-sm font-bold text-foreground-900">{learner?.name || '-'}</p></div><div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase text-foreground-400">Coach</p><p className="mt-1 text-sm font-bold text-foreground-900">{selected.coachName || '-'}</p></div><div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase text-foreground-400">Session status</p><p className="mt-1 text-sm font-bold text-foreground-900">{statusLabel(selected.status)}</p></div></div>
            </Accordion>
            <Accordion id="presentation" title="Learner Presentation & Review (15 minutes)" icon="ri-presentation-line" status={learningItems.length ? 'Complete' : 'Incomplete'} open={openSections.includes('presentation')} onToggle={toggle}>
              {learningItems.length ? <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-primary-50 p-4"><p className="text-[10px] font-semibold uppercase text-primary-500">Activities presented</p><p className="mt-1 text-xl font-bold text-primary-800">{learningItems.length}</p></div><div className="rounded-xl bg-accent-50 p-4"><p className="text-[10px] font-semibold uppercase text-accent-600">Learning time</p><p className="mt-1 text-xl font-bold text-accent-800">{hoursLabel(learningMinutes)}</p></div><div className="rounded-xl bg-emerald-50 p-4"><p className="text-[10px] font-semibold uppercase text-emerald-600">KSBs</p><p className="mt-1 text-xl font-bold text-emerald-800">{ksbCodes.length}</p></div></div> : <Empty>No learner presentation information has been recorded for this session.</Empty>}
            </Accordion>
            <Accordion id="ksb-reflection" title="Reflection on Knowledge, Skills, and Behaviours (10 minutes)" icon="ri-lightbulb-line" status={ksbCodes.length ? 'Complete' : 'Incomplete'} open={openSections.includes('ksb-reflection')} onToggle={toggle}>
              {ksbCodes.length ? <div className="flex flex-wrap gap-2">{ksbCodes.map((code) => <span key={code} className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700">{code}</span>)}</div> : <Empty>No KSB reflection has been recorded for this session.</Empty>}
            </Accordion>
            <Accordion id="next-month" title="Preparing for Next Month (10 minutes)" icon="ri-calendar-todo-line" status="Incomplete" open={openSections.includes('next-month')} onToggle={toggle}><Empty>No targets or actions for next month have been recorded.</Empty></Accordion>
            <Accordion id="resources" title="Learning Resources – Coach Guidance (5 minutes)" icon="ri-book-open-line" status="Incomplete" open={openSections.includes('resources')} onToggle={toggle}><Empty>No coach learning resources or guidance have been recorded.</Empty></Accordion>
            <Accordion id="wellbeing" title="Wellbeing & Safeguarding Check (5 minutes)" icon="ri-shield-check-line" status="Incomplete" open={openSections.includes('wellbeing')} onToggle={toggle}><Empty>No wellbeing or safeguarding response has been recorded.</Empty></Accordion>
            <Accordion id="feedback" title="Learner Feedback on Teaching & Curriculum (5 minutes)" icon="ri-feedback-line" status="Incomplete" open={openSections.includes('feedback')} onToggle={toggle}><Empty>No learner feedback has been recorded.</Empty></Accordion>
            <Accordion id="confirm-next" title="Confirm Next Meeting & Close (5 minutes)" icon="ri-calendar-check-line" status={next ? 'Complete' : 'Incomplete'} open={openSections.includes('confirm-next')} onToggle={toggle}>
              {next ? <div className="flex items-center justify-between rounded-xl bg-background-100 p-4"><div><p className="text-[10px] font-semibold uppercase text-foreground-400">Next monthly coaching session</p><p className="mt-1 text-sm font-bold text-foreground-900">Monthly Coaching #{next.sequence} · {formatDate(dateOf(next))}</p></div><span className="rounded-full bg-background-200 px-2.5 py-1 text-[10px] font-semibold text-foreground-600">{statusLabel(next.status)}</span></div> : <Empty>The next monthly coaching meeting has not been created.</Empty>}
            </Accordion>
            <Accordion id="meeting-summary" title="Meeting Summary" icon="ri-file-text-line" status={selected.notes ? 'Complete' : 'Incomplete'} open={openSections.includes('meeting-summary')} onToggle={toggle}>{selected.notes ? <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.notes}</p> : <Empty>No meeting summary has been recorded.</Empty>}</Accordion>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
