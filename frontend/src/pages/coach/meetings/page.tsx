import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  type CalendarAction,
  type CoachCalendarEvent,
  type ScheduleFormState,
  avatarClass,
  eventDisplayDate,
  eventIdentity,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  initialsFor,
  isConfirmedEvent,
  isUrgentEvent,
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

type MeetingFilter = 'all' | 'confirmed' | 'urgent' | 'needs-schedule';

const EMPTY_SCHEDULE_FORM: ScheduleFormState = {
  date: '',
  time: '09:00',
  durationMinutes: 60,
};

export default function CoachMeetings() {
  const [filter, setFilter] = useState<MeetingFilter>('all');
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

    const loadEvents = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCoachCalendarEvents(controller.signal);
        const mcrEvents = sortEvents((data.events || []).filter(event => event.source === 'mcr'));
        setEvents(mcrEvents);
        setOwnerName(data.owner?.name || 'Med Maher');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Unable to load coaching meetings.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadEvents();
    return () => controller.abort();
  }, []);

  const confirmed = events.filter(isConfirmedEvent).length;
  const urgent = events.filter(isUrgentEvent).length;
  const pendingSchedule = events.filter(needsScheduling).length;
  const filtered = events.filter(event => {
    if (filter === 'confirmed') return isConfirmedEvent(event);
    if (filter === 'urgent') return isUrgentEvent(event);
    if (filter === 'needs-schedule') return needsScheduling(event);
    return true;
  });

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
      setActionError(err instanceof Error ? err.message : 'Unable to schedule meeting.');
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
      setActionError(err instanceof Error ? err.message : 'Unable to update meeting.');
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
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Coaching Meetings" pageSubtitle="Schedule and manage coaching sessions" userName={ownerName} userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-calendar-check-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Coaching Meetings</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{events.length} meetings</strong> generated from {ownerName}'s active learners. {confirmed} confirmed, {urgent} urgent, {pendingSchedule} need scheduling.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <MetricCard value={events.length} label="Total" />
              <MetricCard value={urgent} label="Urgent" tone="text-red-300" />
              <MetricCard value={confirmed} label="Confirmed" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit flex-wrap">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={events.length} />
          <FilterButton active={filter === 'confirmed'} onClick={() => setFilter('confirmed')} label="Confirmed" count={confirmed} />
          <FilterButton active={filter === 'urgent'} onClick={() => setFilter('urgent')} label="Urgent" count={urgent} />
          <FilterButton active={filter === 'needs-schedule'} onClick={() => setFilter('needs-schedule')} label="Needs Schedule" count={pendingSchedule} />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {loading && <EmptyState icon="ri-loader-4-line" title="Loading coaching meetings..." />}
          {!loading && !error && filtered.length === 0 && <EmptyState icon="ri-calendar-check-line" title="No coaching meetings found." />}

          {!loading && filtered.map(event => {
            const isOpen = expanded === eventIdentity(event);
            const isBusy = busyEventId === eventIdentity(event);
            const url = meetingUrl(event);
            return (
              <div key={eventIdentity(event)} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => toggleExpanded(event)}>
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${avatarClass(event)}`}>
                    <span className="text-sm font-bold">{initialsFor(event.learner)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground-900">{event.learner || 'Unknown learner'}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusPillClass(event.status)}`}>{statusLabel(event.status)}</span>
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">Monthly Coaching</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">
                      {formatDateLabel(eventDisplayDate(event))} - {formatTimeLabel(event)} - {event.platform || 'Microsoft Teams'}
                    </p>
                  </div>
                  <div className="hidden lg:flex items-center gap-3 shrink-0">
                    {url && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleJoin(event); }} disabled={isBusy} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 transition-smooth cursor-pointer whitespace-nowrap">
                        Join Teams
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(event); }} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      {needsScheduling(event) ? 'Schedule' : 'Reschedule'}
                    </button>
                  </div>
                  <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                </div>

                {isOpen && (
                  <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <InfoBox label="Target date" value={formatDateLabel(event.targetDate)} />
                      <InfoBox label="Scheduled date" value={event.scheduledDate ? formatDateLabel(event.scheduledDate) : '--'} />
                      <InfoBox label="Cohort" value={event.cohort || '--'} />
                    </div>
                    {event.notes && (
                      <div className="bg-background-100/60 rounded-lg p-3">
                        <p className="text-[11px] font-semibold text-foreground-700 mb-1">Notes</p>
                        <p className="text-[12px] text-foreground-600">{event.notes}</p>
                      </div>
                    )}
                    {(actionError || actionNotice) && (
                      <div className={`rounded-lg border px-3 py-2 text-[11px] ${actionError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                        {actionError || actionNotice}
                      </div>
                    )}
                    {event.status !== 'completed' && (
                      <div className="rounded-xl border border-background-200/60 bg-background-100/60 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500 mb-3">Schedule Meeting</p>
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
                          <button type="button" onClick={() => handleSchedule(event)} disabled={isBusy} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                            <i className="ri-calendar-check-line mr-1"></i>{event.status === 'cancelled' ? 'Schedule Again' : event.status === 'scheduled' || event.status === 'in-progress' ? 'Reschedule' : 'Schedule'}
                          </button>
                          {(event.status === 'scheduled' || event.status === 'in-progress') && (
                            <button type="button" onClick={() => handleAction(event, 'start')} disabled={isBusy || !url} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <i className="ri-play-circle-line mr-1"></i>Start
                            </button>
                          )}
                          {event.status === 'in-progress' && (
                            <button type="button" onClick={() => handleAction(event, 'complete')} disabled={isBusy} className="px-3 py-2 bg-secondary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-secondary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
                              <i className="ri-check-double-line mr-1"></i>Complete
                            </button>
                          )}
                          {(event.status === 'scheduled' || event.status === 'in-progress') && (
                            <button type="button" onClick={() => handleAction(event, 'cancel')} disabled={isBusy} className="px-3 py-2 bg-background-50 border border-red-200 text-red-700 rounded-lg text-[11px] font-medium hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap">
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

function FilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${active ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
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
