import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerCalendarEvents, type LearnerCalendarEvent } from '@/api/learnerCalendar';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;

function formatDate(value?: string | null, long = false): string {
  if (!value) return '-';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', long
    ? { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const [hour, minute] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
}

function reviewDate(review?: LearnerCalendarEvent | null): string | null {
  return review?.scheduledDate || review?.targetDate || review?.date || null;
}

function statusLabel(status?: string): string {
  const labels: Record<string, string> = {
    'not-scheduled': 'Planning required',
    scheduled: 'Scheduled',
    'in-progress': 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return status ? labels[status] || status : '-';
}

function statusStyle(status?: string): string {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'scheduled') return 'border-primary-200 bg-primary-50 text-primary-700';
  if (status === 'in-progress') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'cancelled') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function initials(value?: string | null): string {
  if (!value) return '-';
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function asNumber(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportedMinutes(value?: string | null): number {
  if (!value) return 0;
  const text = value.trim().toLowerCase();
  const number = Number.parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] || '0');
  return text.includes('hour') || text.includes('hr') ? number * 60 : number;
}

function formatMinutes(minutes: number): string {
  if (!minutes) return '0 hrs';
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

function withinWindow(value: string | null | undefined, from: Date | null, to: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && (!from || date > from) && date <= to;
}

function Empty({ children = 'No information has been recorded for this review.' }: { children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-background-300 bg-background-100/50 px-5 py-7 text-center">
      <p className="text-xl font-bold text-foreground-300">-</p>
      <p className="mt-1 text-xs text-foreground-400">{children}</p>
    </div>
  );
}

function PersonCard({ role, name, icon, tone }: { role: string; name?: string; icon: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-50 p-3.5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone}`}>
        {name ? initials(name) : <i className={icon} />}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{role}</p>
        <p className="truncate text-sm font-bold text-foreground-900">{name || '-'}</p>
      </div>
    </div>
  );
}

function Accordion({
  id, title, icon, open, onToggle, children,
}: {
  id: string; title: string; icon: string; open: boolean; onToggle: (id: string) => void; children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-sm">
      <button type="button" onClick={() => onToggle(id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-background-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className={icon} /></span>
        <span className="flex-1 text-sm font-bold text-foreground-800">{title}</span>
        <i className={`ri-arrow-down-s-line text-lg text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-background-200 p-4 sm:p-5">{children}</div>}
    </section>
  );
}

export function ProgressReviewsListPage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [reviews, setReviews] = useState<LearnerCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

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
        setReviews(calendar.events.filter((event) => event.source === 'progress-review').sort((a, b) => a.sequence - b.sequence));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load progress reviews.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(reviews.length / pageSize));
  const visibleReviews = reviews.slice((page - 1) * pageSize, page * pageSize);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Progress Reviews"
      pageSubtitle="Your planned and completed progress review sessions"
      userName={learner?.name || 'Learner'}
      userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}
    >
      <div className="space-y-5 p-4 md:p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><i className="ri-error-warning-line mr-2" />{error}</div>}

        <section className="overflow-hidden rounded-xl border border-background-300 bg-background-50 shadow-sm">
          <div className="border-b border-background-200 px-5 py-4">
            <h1 className="text-base font-bold text-foreground-900">Progress Reviews</h1>
            <p className="mt-1 text-xs text-foreground-500">View scheduled reviews, check their status and open each full PR record.</p>
          </div>
          {loading ? <div className="p-10 text-center text-sm text-foreground-400">Loading progress reviews...</div> : reviews.length === 0 ? <div className="p-5"><Empty>No progress review sessions were found.</Empty></div> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="border-b border-background-300 bg-[#f1f4f8] text-[10px] font-semibold text-foreground-500">
                    <tr><th className="px-4 py-3">Review Name / Review Type</th><th className="px-4 py-3">Reviewer</th><th className="px-4 py-3">Planned / Scheduled Date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Scheduling Assistant</th><th className="px-4 py-3 text-right">Review Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-background-300">
                  {visibleReviews.map((review) => {
                    const isBooked = Boolean(review.scheduledDate && review.scheduledTime) && !['not-scheduled', 'cancelled'].includes(review.status);
                    return (
                      <tr key={review.id} className="transition hover:bg-primary-50/30">
                        <td className="px-4 py-3.5"><p className="text-xs font-bold text-foreground-800">Progress Review #{review.sequence}</p><p className="mt-1 text-[10px] text-foreground-500">Progress Review</p></td>
                        <td className="px-4 py-3.5 text-xs font-medium text-foreground-600">{review.coachName || '-'}</td>
                        <td className="px-4 py-3.5"><p className="text-xs font-medium text-foreground-600">{formatDate(isBooked ? review.scheduledDate : review.targetDate)}</p>{isBooked && <p className="mt-1 text-[10px] text-foreground-400">at {formatTime(review.scheduledTime)}</p>}</td>
                        <td className="px-4 py-3.5"><span className={`inline-flex rounded px-2 py-1 text-[10px] font-semibold ${review.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : isBooked ? 'bg-blue-100 text-blue-700' : 'bg-background-200 text-foreground-600'}`}>{review.status === 'not-scheduled' ? 'Not Scheduled' : statusLabel(review.status)}</span></td>
                        <td className="px-4 py-3.5"><Link to="/learner/calendar" className="inline-flex items-center gap-2 text-xs font-medium text-foreground-600 hover:text-primary-700"><i className="ri-calendar-2-line" />{isBooked ? 'Reschedule' : 'Schedule'}</Link></td>
                        <td className="px-4 py-3.5"><div className="flex items-center justify-end gap-3"><Link to={`/learner/progress-reviews/${encodeURIComponent(review.id)}`} className="rounded-full bg-primary-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-primary-700">View</Link><i className="ri-more-2-fill text-lg text-foreground-500" /></div></td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-background-300 bg-[#f1f4f8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(1)} disabled={page === 1} className="flex h-7 w-7 items-center justify-center border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><i className="ri-skip-left-line" /></button>
                  <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="flex h-7 w-7 items-center justify-center border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><i className="ri-arrow-left-s-line" /></button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 5).map((number) => <button key={number} type="button" onClick={() => setPage(number)} className={`h-7 min-w-7 border px-2 text-xs ${page === number ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-300 bg-white text-foreground-600'}`}>{number}</button>)}
                  <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="flex h-7 w-7 items-center justify-center border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><i className="ri-arrow-right-s-line" /></button>
                  <button type="button" onClick={() => setPage(totalPages)} disabled={page === totalPages} className="flex h-7 w-7 items-center justify-center border border-background-300 bg-white text-xs text-foreground-500 disabled:opacity-40"><i className="ri-skip-right-line" /></button>
                  <span className="ml-3 text-[10px] text-foreground-500">10 items per page</span>
                </div>
                <p className="text-[10px] text-foreground-500">{(page - 1) * pageSize + 1} - {Math.min(page * pageSize, reviews.length)} of {reviews.length} items</p>
              </div>
            </>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}

export default function ProgressReviewsPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [events, setEvents] = useState<LearnerCalendarEvent[]>([]);
  const [selectedId, setSelectedId] = useState(reviewId || '');
  const [openSections, setOpenSections] = useState<string[]>(['learning']);
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
        setEvents(calendar.events);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load progress reviews.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

  const reviews = useMemo(
    () => events.filter((event) => event.source === 'progress-review').sort((a, b) => a.sequence - b.sequence),
    [events],
  );
  const completed = useMemo(() => reviews.filter((review) => review.status === 'completed'), [reviews]);
  const planned = useMemo(() => reviews.filter((review) => !['completed', 'cancelled'].includes(review.status)), [reviews]);

  useEffect(() => {
    if (reviewId) setSelectedId(reviewId);
  }, [reviewId]);

  useEffect(() => {
    if (!reviews.length || reviews.some((review) => review.id === selectedId)) return;
    setSelectedId((planned[0] || completed.at(-1) || reviews[0]).id);
  }, [reviews, planned, completed, selectedId]);

  const selected = reviews.find((review) => review.id === selectedId) || planned[0] || completed.at(-1) || reviews[0] || null;
  const selectedIndex = selected ? reviews.findIndex((review) => review.id === selected.id) : -1;
  const previousReview = selectedIndex > 0 ? reviews[selectedIndex - 1] : null;

  const learningWindow = useMemo(() => {
    const previousValue = reviewDate(previousReview);
    const selectedValue = reviewDate(selected);
    const from = previousValue ? new Date(`${previousValue}T23:59:59`) : null;
    const reviewEnd = selectedValue ? new Date(`${selectedValue}T23:59:59`) : new Date();
    const to = reviewEnd > new Date() ? new Date() : reviewEnd;
    return { from, to };
  }, [previousReview, selected]);

  const progressRecords = useMemo(() => {
    if (!learner) return [];
    return [
      ...learner.quizAttempts.filter((item) => item.passed),
      ...(learner.videoProgress || []),
      ...(learner.componentProgress || []),
    ].filter((item) => withinWindow(item.submittedAt, learningWindow.from, learningWindow.to));
  }, [learner, learningWindow]);

  const learnedKsbCodes = useMemo(() => {
    const values = new Set<string>();
    progressRecords.forEach((record) => (record.ksbs || []).forEach((code) => values.add(code)));
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [progressRecords]);
  const loggedMinutes = progressRecords.reduce((sum, record) => sum + reportedMinutes(record.reportedTime), 0);
  const completedActivityIds = new Set(progressRecords.map((record) => 'quizId' in record ? `quiz:${record.quizId}` : `component:${record.componentId}`));
  const learningItems = useMemo(() => progressRecords.map((record) => {
    if ('quizId' in record) {
      const component = learner?.components.find((item) => item.quizMeta?.quizId === record.quizId);
      return {
        key: `quiz:${record.quizId}:${record.submittedAt}`,
        title: component?.component || `Quiz #${record.quizId}`,
        detail: record.totalScore ? `Passed quiz · ${record.achievedScore || 0}/${record.totalScore}` : 'Passed quiz',
        at: record.submittedAt,
      };
    }
    const component = learner?.components.find((item) => item.componentId === record.componentId);
    const type = 'componentType' in record ? record.componentType : 'Video';
    return {
      key: `component:${record.componentId}:${record.submittedAt}`,
      title: component?.component || type,
      detail: `${type} completed${record.reportedTime ? ` · ${record.reportedTime}` : ''}`,
      at: record.submittedAt,
    };
  }), [learner, progressRecords]);
  const totalActivities = learner?.components.length || 0;
  const overallLearningPercent = totalActivities ? Math.round((completedActivityIds.size / totalActivities) * 100) : null;
  const progressVariance = asNumber(learner?.progressVariance);

  const toggleSection = (id: string) => {
    setOpenSections((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const addToCalendar = () => {
    if (!selected?.scheduledDate || !selected.scheduledTime) return;
    const start = `${selected.scheduledDate.replaceAll('-', '')}T${selected.scheduledTime.replace(':', '')}00`;
    const startDate = new Date(`${selected.scheduledDate}T${selected.scheduledTime}:00`);
    const endDate = new Date(startDate.getTime() + selected.durationMinutes * 60_000);
    const pad = (value: number) => String(value).padStart(2, '0');
    const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:Progress Review #${selected.sequence}`, selected.meetingLink ? `URL:${selected.meetingLink}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `progress-review-${selected.sequence}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Progress Reviews"
      pageSubtitle="Formal reviews with your coach and line manager"
      userName={learner?.name || 'Learner'}
      userRole={learner?.programme ? `${learner.programme} Learner` : 'Learner'}
    >
      <div className="space-y-5 p-4 md:p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><i className="ri-error-warning-line mr-2" />{error}</div>}

        <Link to="/learner/progress-reviews" className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-600 transition hover:text-primary-800">
          <i className="ri-arrow-left-line" /> Back to PR sessions
        </Link>

        <section className="rounded-2xl border border-background-200 bg-background-50 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-xl text-white shadow-lg shadow-primary-600/20"><i className="ri-team-line" /></span>
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Formal progress review</span>
                  <span className="rounded-full bg-accent-50 px-2.5 py-1 text-[10px] font-bold text-accent-700">{loading ? 'Loading...' : learner?.programme || '-'}</span>
                </div>
                <h1 className="font-heading text-xl font-bold text-foreground-950 sm:text-2xl">Your progress review record</h1>
                <p className="mt-1 max-w-2xl text-sm text-foreground-500">Each PR brings together you, your coach and your line manager to review learning, progress and next actions.</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[390px]">
              {[
                ['Completed', loading ? '-' : completed.length, 'text-emerald-600', 'ri-checkbox-circle-line'],
                ['Planned', loading ? '-' : planned.length, 'text-primary-600', 'ri-calendar-event-line'],
                ['All PRs', loading ? '-' : reviews.length, 'text-foreground-900', 'ri-stack-line'],
              ].map(([label, value, color, icon]) => (
                <div key={label} className="rounded-xl border border-background-200 bg-background-100 px-3 py-3 text-center">
                  <i className={`${icon} ${color} text-sm`} />
                  <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {loading ? (
          <section className="rounded-2xl border border-background-200 bg-background-50 p-10 text-center text-sm text-foreground-400">Loading progress reviews...</section>
        ) : reviews.length === 0 ? (
          <section className="rounded-2xl border border-background-200 bg-background-50 p-6"><Empty>No progress reviews have been created for this learner.</Empty></section>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-background-200 bg-background-50 p-3 shadow-sm lg:sticky lg:top-4">
              <div className="px-2 pb-3 pt-1">
                <h2 className="text-sm font-bold text-foreground-900">All progress reviews</h2>
                <p className="mt-0.5 text-xs text-foreground-400">Completed and planned sessions</p>
              </div>
              <div className="space-y-2">
                {reviews.map((review) => {
                  const active = selected?.id === review.id;
                  return (
                    <button key={review.id} type="button" onClick={() => { setSelectedId(review.id); setOpenSections(['learning']); }} className={`w-full rounded-xl border p-3.5 text-left transition ${active ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-background-200 bg-background-50 hover:bg-background-100'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-foreground-900">Progress Review #{review.sequence}</span>
                        <i className={`ri-arrow-right-s-line ${active ? 'text-primary-600' : 'text-foreground-300'}`} />
                      </div>
                      <p className="mt-1 text-xs text-foreground-500">{formatDate(reviewDate(review))}</p>
                      <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusStyle(review.status)}`}>{statusLabel(review.status)}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="space-y-4">
              <section className="overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-sm">
                <div className="border-b border-background-200 bg-gradient-to-r from-primary-950 to-primary-800 p-5 text-white sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span className={`inline-flex rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/80`}>{statusLabel(selected?.status)}</span>
                      <h2 className="mt-2 text-xl font-bold text-white">Progress Review #{selected?.sequence}</h2>
                      <p className="mt-1 text-sm text-white/60">{formatDate(reviewDate(selected), true)} at {formatTime(selected?.scheduledTime)}</p>
                    </div>
                    <div className="flex gap-2">
                      {selected?.meetingLink && <a href={selected.meetingLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white px-3.5 py-2 text-xs font-bold text-primary-800"><i className="ri-video-chat-line mr-1.5" />Join meeting</a>}
                      <button type="button" onClick={addToCalendar} disabled={!selected?.scheduledDate || !selected.scheduledTime} className="rounded-lg border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><i className="ri-calendar-check-line mr-1.5" />Add to calendar</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">Review participants</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <PersonCard role="Learner" name={learner?.name} icon="ri-user-line" tone="bg-primary-100 text-primary-700" />
                      <PersonCard role="Coach" name={selected?.coachName} icon="ri-user-star-line" tone="bg-accent-100 text-accent-700" />
                      <PersonCard role="Line manager" name={learner?.lineManager} icon="ri-briefcase-line" tone="bg-emerald-100 text-emerald-700" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Duration', selected?.durationMinutes ? `${selected.durationMinutes} minutes` : '-', 'ri-time-line'],
                      ['Meeting type', selected?.meetingProvider || '-', 'ri-video-chat-line'],
                      ['Scheduled time', formatTime(selected?.scheduledTime), 'ri-calendar-schedule-line'],
                      ['Review window', previousReview ? `Since PR #${previousReview.sequence}` : 'Programme to date', 'ri-history-line'],
                    ].map(([label, value, icon]) => (
                      <div key={label} className="rounded-xl bg-background-100 p-3.5">
                        <i className={`${icon} text-primary-500`} />
                        <p className="mt-2 text-[9px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
                        <p className="mt-0.5 text-xs font-bold text-foreground-800">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <Accordion id="learning" title="Learning Progress & Summary" icon="ri-graduation-cap-line" open={openSections.includes('learning')} onToggle={toggleSection}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-primary-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-primary-500">Completed activities</p><p className="mt-1 text-2xl font-bold text-primary-800">{completedActivityIds.size}</p><p className="text-xs text-primary-600/70">during this review period</p></div>
                  <div className="rounded-xl bg-accent-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-accent-600">Completed activity time</p><p className="mt-1 text-2xl font-bold text-accent-800">{formatMinutes(loggedMinutes)}</p><p className="text-xs text-accent-600/70">during this review period</p></div>
                  <div className="rounded-xl bg-emerald-50 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">KSBs evidenced</p><p className="mt-1 text-2xl font-bold text-emerald-800">{learnedKsbCodes.length}</p><p className="text-xs text-emerald-600/70">during this review period</p></div>
                </div>

                <div className="mt-4 rounded-xl border border-background-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="text-sm font-bold text-foreground-900">Overall learning plan</p><p className="text-xs text-foreground-400">Successful unique activities against the current plan</p></div>
                    <span className="text-sm font-bold text-primary-700">{overallLearningPercent === null ? '-' : `${overallLearningPercent}%`}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-background-200"><div className="h-full rounded-full bg-primary-500" style={{ width: `${overallLearningPercent || 0}%` }} /></div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold text-foreground-800">What the learner completed</h3><span className="text-[10px] text-foreground-400">{learningItems.length} {learningItems.length === 1 ? 'record' : 'records'}</span></div>
                  {learningItems.length === 0 ? <Empty>No completed learning was recorded in this review period.</Empty> : (
                    <div className="divide-y divide-background-200 rounded-xl border border-background-200">
                      {learningItems.slice(0, 8).map((activity) => (
                        <div key={activity.key} className="flex items-start gap-3 p-3.5">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><i className="ri-checkbox-circle-line" /></span>
                          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground-800">{activity.title}</p><p className="mt-0.5 text-xs text-foreground-400">{activity.detail}</p></div>
                          <span className="shrink-0 text-[10px] text-foreground-400">{new Date(activity.at).toLocaleDateString('en-GB')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {learnedKsbCodes.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-bold text-foreground-800">KSBs covered</p><div className="flex flex-wrap gap-1.5">{learnedKsbCodes.map((code) => <span key={code} className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{code}</span>)}</div></div>}
              </Accordion>

              <Accordion id="notes" title="Progress Review Notes" icon="ri-file-text-line" open={openSections.includes('notes')} onToggle={toggleSection}>
                {selected?.notes ? <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-700">{selected.notes}</p> : <Empty>No notes have been saved against this PR.</Empty>}
              </Accordion>
              <Accordion id="learner-reflection" title="Learner Reflections & Ratings" icon="ri-user-heart-line" open={openSections.includes('learner-reflection')} onToggle={toggleSection}><Empty>Learner reflection data is not available for this PR.</Empty></Accordion>
              <Accordion id="manager-reflection" title="Manager Reflections & Ratings" icon="ri-briefcase-line" open={openSections.includes('manager-reflection')} onToggle={toggleSection}><Empty>Manager reflection data is not available for this PR.</Empty></Accordion>
              <Accordion id="coach-reflection" title="Coach Reflections & Ratings" icon="ri-user-star-line" open={openSections.includes('coach-reflection')} onToggle={toggleSection}><Empty>Coach reflection data is not available for this PR.</Empty></Accordion>
              <Accordion id="actions" title="Progress Targets & Actions" icon="ri-focus-3-line" open={openSections.includes('actions')} onToggle={toggleSection}><Empty>No targets or actions have been recorded for this PR.</Empty></Accordion>
              <Accordion id="rag" title="RAG Status" icon="ri-traffic-light-line" open={openSections.includes('rag')} onToggle={toggleSection}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">OTJH status</p><p className="mt-1 text-base font-bold text-foreground-900">{learner?.otjhStatus || '-'}</p></div>
                  <div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Progress variance</p><p className="mt-1 text-base font-bold text-foreground-900">{progressVariance === null ? '-' : `${Math.round(progressVariance * 100)}%`}</p></div>
                  <div className="rounded-xl bg-background-100 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">Coach RAG</p><p className="mt-1 text-base font-bold text-foreground-900">-</p></div>
                </div>
              </Accordion>
            </main>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
