import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  avatarClass,
  eventIdentity,
  eventPeriodLabel,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isCancelledEvent,
  isAtRiskProgressReview,
  isDueSoonEvent,
  isEventThisMonth,
  isInProgressEvent,
  isScheduledEvent,
  initialsFor,
  isCompletedEvent,
  meetingUrl,
  needsScheduling,
  runCoachCalendarAction,
  scheduleCoachCalendarEvent,
  scheduleDefaults,
  sortEvents,
  statusLabel,
  statusPillClass,
} from '../shared/calendarEvents';

const coachNav = roleNavMap.coach;

type ReviewTab = 'this-month' | 'overdue' | 'due-soon' | 'needs-schedule' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled' | 'prep-forms' | 'all';

const FILTER_COPY: Record<ReviewTab, { label: string; description: string }> = {
  'this-month': {
    label: 'This Month',
    description: 'Progress reviews with a target or scheduled date inside the current month, excluding completed reviews.',
  },
  overdue: {
    label: 'Overdue',
    description: 'Progress reviews where the target date has passed and the review is still not scheduled.',
  },
  'due-soon': {
    label: 'Due Soon',
    description: 'Progress reviews not scheduled yet and due within the next 14 days.',
  },
  'needs-schedule': {
    label: 'Needs Schedule',
    description: 'Progress reviews that still need a first calendar booking.',
  },
  scheduled: {
    label: 'Scheduled',
    description: 'Progress reviews that are booked and waiting to start.',
  },
  'in-progress': {
    label: 'In Progress',
    description: 'Progress reviews that have already been started by the coach.',
  },
  completed: {
    label: 'Completed',
    description: 'Progress reviews marked as completed or confirmed.',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'Progress reviews that were cancelled and can be scheduled again if needed.',
  },
  'prep-forms': {
    label: 'Preparation Forms',
    description: 'Preparation form records. This is ready for a live source when that data is connected.',
  },
  all: {
    label: 'All',
    description: 'Every generated progress review for this coach across the learner programme dates.',
  },
};

const EMPTY_SCHEDULE_FORM: ScheduleFormState = {
  date: '',
  time: '09:00',
  durationMinutes: 60,
};

export default function CoachProgressReviews() {
  const [tab, setTab] = useState<ReviewTab>('this-month');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<CoachCalendarEvent[]>([]);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const loadReviews = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCoachCalendarEvents(controller.signal);
        const reviews = sortEvents((data.events || []).filter(event => event.source === 'progress-review'));
        setEvents(reviews);
        setOwnerName(data.owner?.name || 'Med Maher');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load progress reviews.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadReviews();
    return () => controller.abort();
  }, []);

  const thisMonthEvents = events.filter(event => isEventThisMonth(event));
  const overdueEvents = events.filter(event => isAtRiskProgressReview(event));
  const dueSoonEvents = events.filter(event => isDueSoonEvent(event));
  const scheduledEvents = events.filter(event => isScheduledEvent(event));
  const inProgressEvents = events.filter(event => isInProgressEvent(event));
  const completedEvents = events.filter(event => isCompletedEvent(event));
  const cancelledEvents = events.filter(event => isCancelledEvent(event));
  const needsScheduleEvents = events.filter(needsScheduling);
  const thisMonth = thisMonthEvents.length;
  const overdue = overdueEvents.length;
  const dueSoon = dueSoonEvents.length;
  const pendingSchedule = needsScheduleEvents.length;
  const prepForms = 0;
  const data = tab === 'this-month'
    ? thisMonthEvents
    : tab === 'overdue'
      ? overdueEvents
      : tab === 'due-soon'
        ? dueSoonEvents
        : tab === 'needs-schedule'
          ? needsScheduleEvents
          : tab === 'scheduled'
            ? scheduledEvents
            : tab === 'in-progress'
              ? inProgressEvents
            : tab === 'completed'
              ? completedEvents
              : tab === 'cancelled'
                ? cancelledEvents
                : tab === 'all'
                  ? events
                  : [];

  const updateEvent = (updatedEvent: CoachCalendarEvent) => {
    setEvents(prevEvents => sortEvents(prevEvents.map(event => (
      eventIdentity(event) === eventIdentity(updatedEvent) ? updatedEvent : event
    ))));
    setExpanded(eventIdentity(updatedEvent));
    setScheduleForm(scheduleDefaults(updatedEvent));
  };

  const toggleExpanded = (event: CoachCalendarEvent) => {
    const id = eventIdentity(event);
    setExpanded(expanded === id ? null : id);
    setScheduleForm(scheduleDefaults(event));
    setActionError(null);
    setActionNotice(event.syncWarning || null);
  };

  const handleSchedule = async (event: CoachCalendarEvent) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await scheduleCoachCalendarEvent(event, scheduleForm);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to schedule review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleAction = async (event: CoachCalendarEvent, action: CalendarAction) => {
    setBusyEventId(eventIdentity(event));
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await runCoachCalendarAction(event, action);
      updateEvent(data.event);
      if (data.warning) setActionNotice(data.warning);
      const url = meetingUrl(data.event);
      if (action === 'start' && url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update review.');
    } finally {
      setBusyEventId(null);
    }
  };

  const handleJoin = async (event: CoachCalendarEvent) => {
    if (event.status === 'scheduled') {
      await handleAction(event, 'start');
      return;
    }
    const url = meetingUrl(event);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Progress Reviews" pageSubtitle="Manage learner progress reviews and sign-offs" userName={ownerName} userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-file-chart-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Progress Reviews</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{events.length} generated</strong> reviews. {thisMonth} this month, {overdue} overdue, {dueSoon} due soon, {pendingSchedule} need scheduling, {inProgressEvents.length} in progress.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-start sm:justify-end gap-3 shrink-0">
              <MetricCard value={thisMonth} label="This Month" />
              <MetricCard value={overdue} label="Overdue" tone="text-red-300" />
              <MetricCard value={dueSoon} label="Due Soon" tone="text-amber-300" />
              <MetricCard value={pendingSchedule} label="Needs Schedule" tone="text-amber-300" />
              <MetricCard value={scheduledEvents.length} label="Scheduled" />
              <MetricCard value={inProgressEvents.length} label="In Progress" tone="text-primary-200" />
              <MetricCard value={completedEvents.length} label="Completed" tone="text-emerald-300" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit flex-wrap">
          <TabButton active={tab === 'this-month'} onClick={() => setTab('this-month')} label={FILTER_COPY['this-month'].label} count={thisMonth} description={FILTER_COPY['this-month'].description} />
          <TabButton active={tab === 'overdue'} onClick={() => setTab('overdue')} label={FILTER_COPY.overdue.label} count={overdue} description={FILTER_COPY.overdue.description} />
          <TabButton active={tab === 'due-soon'} onClick={() => setTab('due-soon')} label={FILTER_COPY['due-soon'].label} count={dueSoon} description={FILTER_COPY['due-soon'].description} />
          <TabButton active={tab === 'needs-schedule'} onClick={() => setTab('needs-schedule')} label={FILTER_COPY['needs-schedule'].label} count={pendingSchedule} description={FILTER_COPY['needs-schedule'].description} />
          <TabButton active={tab === 'scheduled'} onClick={() => setTab('scheduled')} label={FILTER_COPY.scheduled.label} count={scheduledEvents.length} description={FILTER_COPY.scheduled.description} />
          <TabButton active={tab === 'in-progress'} onClick={() => setTab('in-progress')} label={FILTER_COPY['in-progress'].label} count={inProgressEvents.length} description={FILTER_COPY['in-progress'].description} />
          <TabButton active={tab === 'completed'} onClick={() => setTab('completed')} label={FILTER_COPY.completed.label} count={completedEvents.length} description={FILTER_COPY.completed.description} />
          <TabButton active={tab === 'cancelled'} onClick={() => setTab('cancelled')} label={FILTER_COPY.cancelled.label} count={cancelledEvents.length} description={FILTER_COPY.cancelled.description} />
          <TabButton active={tab === 'prep-forms'} onClick={() => setTab('prep-forms')} label={FILTER_COPY['prep-forms'].label} count={prepForms} description={FILTER_COPY['prep-forms'].description} />
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} label={FILTER_COPY.all.label} count={events.length} description={FILTER_COPY.all.description} />
        </div>
        <div className="rounded-xl border border-background-200/70 bg-background-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">{FILTER_COPY[tab].label}</p>
          <p className="mt-1 text-[12px] text-foreground-500">{FILTER_COPY[tab].description}</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {tab === 'prep-forms' && (
          <EmptyState icon="ri-file-list-3-line" title="No live preparation forms source is connected yet." />
        )}

        {tab !== 'prep-forms' && (
          <div className="space-y-3">
            {loading && <EmptyState icon="ri-loader-4-line" title="Loading progress reviews..." />}
            {!loading && !error && data.length === 0 && <EmptyState icon="ri-file-chart-line" title="No progress reviews found." />}

            {!loading && data.map(review => {
              const isOpen = expanded === eventIdentity(review);
              const isBusy = busyEventId === eventIdentity(review);
              const url = meetingUrl(review);
              return (
                <div key={eventIdentity(review)} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => toggleExpanded(review)}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${avatarClass(review)}`}>
                      <span className="text-sm font-bold">{initialsFor(review.learner)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{review.learner || 'Unknown learner'}</p>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusPillClass(review.status)}`}>{statusLabel(review.status)}</span>
                        {isAtRiskProgressReview(review) && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Overdue</span>}
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{eventPeriodLabel(review)}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">
                        {review.programme || '--'} - target {formatDateLabel(review.targetDate)} - {formatTimeLabel(review)}
                      </p>
                    </div>
                    <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                      <span>Scheduled: {review.scheduledDate ? formatDateLabel(review.scheduledDate) : '--'}</span>
                      <span>Target: {formatDateLabel(review.targetDate)}</span>
                      {url && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleJoin(review); }} disabled={isBusy} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 transition-smooth cursor-pointer whitespace-nowrap">
                          Join Teams
                        </button>
                      )}
                    </div>
                    <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                  </div>

                  {isOpen && (
                    <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-3" onClick={(e) => e.stopPropagation()}>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <InfoBox label="Programme" value={review.programme || '--'} />
                        <InfoBox label="Target date" value={formatDateLabel(review.targetDate)} />
                        <InfoBox label="Scheduled date" value={review.scheduledDate ? formatDateLabel(review.scheduledDate) : '--'} />
                        <InfoBox label="Status" value={statusLabel(review.status)} />
                        {isAtRiskProgressReview(review) && <InfoBox label="Risk" value="Target date passed and not scheduled" />}
                      </div>
                      {review.notes && (
                        <div className="bg-background-100/60 rounded-lg p-3">
                          <p className="text-[11px] font-semibold text-foreground-700 mb-1">Coach Notes</p>
                          <p className="text-[12px] text-foreground-600">{review.notes}</p>
                        </div>
                      )}
                      {(actionError || actionNotice) && (
                        <div className={`rounded-lg border px-3 py-2 text-[11px] ${actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                          {actionError || actionNotice}
                        </div>
                      )}
                      {review.status !== 'completed' && (
                        <div className="rounded-xl border border-background-200/60 bg-background-100/60 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500 mb-3">Schedule Review</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <ScheduleInput label="Date" type="date" value={scheduleForm.date} onChange={(value) => setScheduleForm(prev => ({ ...prev, date: value }))} />
                            <ScheduleInput label="Time" type="time" value={scheduleForm.time} onChange={(value) => setScheduleForm(prev => ({ ...prev, time: value }))} />
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">Duration</span>
                              <select value={scheduleForm.durationMinutes} onChange={(e) => setScheduleForm(prev => ({ ...prev, durationMinutes: Number(e.target.value) }))} className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300">
                                {[30, 45, 60, 90].map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <button type="button" onClick={() => handleSchedule(review)} disabled={isBusy} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <i className="ri-calendar-check-line mr-1"></i>{review.status === 'cancelled' ? 'Schedule Again' : review.status === 'scheduled' || review.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                            </button>
                            {(review.status === 'scheduled' || review.status === 'in-progress') && (
                              <button type="button" onClick={() => handleAction(review, 'start')} disabled={isBusy || !url} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                                <i className="ri-play-circle-line mr-1"></i>Start
                              </button>
                            )}
                            {review.status === 'in-progress' && (
                              <button type="button" onClick={() => handleAction(review, 'complete')} disabled={isBusy} className="px-3 py-2 bg-secondary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-secondary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                                <i className="ri-check-double-line mr-1"></i>Complete
                              </button>
                            )}
                            {(review.status === 'scheduled' || review.status === 'in-progress') && (
                              <button type="button" onClick={() => handleAction(review, 'cancel')} disabled={isBusy} className="px-3 py-2 bg-background-50 border border-red-200 text-red-700 rounded-lg text-[11px] font-medium hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                                <i className="ri-close-circle-line mr-1"></i>Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function MetricCard({ value, label, tone = 'text-white' }: { value: number; label: string; tone?: string }) {
  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] text-white/70 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function TabButton({ active, onClick, label, count, description }: { active: boolean; onClick: () => void; label: string; count: number; description: string }) {
  return (
    <button type="button" onClick={onClick} title={description} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${active ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
      {label} <span className="text-[10px] opacity-60">({count})</span>
    </button>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background-100/50 rounded-lg p-3">
      <p className="text-[10px] text-foreground-400 mb-1 uppercase font-semibold">{label}</p>
      <p className="text-[12px] text-foreground-700 font-medium">{value}</p>
    </div>
  );
}

function ScheduleInput({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[11px] text-foreground-900 focus:outline-none focus:ring-2 focus:ring-primary-300" />
    </label>
  );
}

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-8 text-center">
      <i className={`${icon} text-2xl text-foreground-300`}></i>
      <p className="text-sm font-semibold text-foreground-500 mt-2">{title}</p>
    </div>
  );
}
