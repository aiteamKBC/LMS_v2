import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import {
  cancelEventBooking,
  createEventBooking,
  fetchEventBookings,
  fetchEvents,
  type EngagementEvent,
  type EventBooking,
} from '@/api/engagement';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;
type StatusFilter = 'all' | EngagementEvent['status'];

const statusStyle: Record<EngagementEvent['status'], { label: string; cls: string; icon: string }> = {
  upcoming: { label: 'Upcoming', cls: 'bg-amber-50 text-amber-700 ring-amber-200', icon: 'ri-calendar-schedule-line' },
  ongoing: { label: 'Live now', cls: 'bg-blue-50 text-blue-700 ring-blue-200', icon: 'ri-live-line' },
  completed: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: 'ri-checkbox-circle-line' },
};

const typeIcon: Record<string, string> = {
  workshop: 'ri-tools-line', social: 'ri-group-line', networking: 'ri-links-line',
  competition: 'ri-trophy-line', celebration: 'ri-sparkling-line',
};

function dateParts(value: string) {
  const parts = value.trim().split(/\s+/);
  return parts.length >= 2 ? { day: parts[0], month: parts[1] } : { day: '–', month: 'TBC' };
}

function EventRow({ event, booking, busy, onBook, onCancel }: { event: EngagementEvent; booking?: EventBooking; busy: boolean; onBook: () => void; onCancel: () => void }) {
  const status = statusStyle[event.status];
  const date = dateParts(event.date);
  return (
    <article className="group relative overflow-hidden rounded-3xl border border-foreground-200/70 bg-white shadow-[0_5px_24px_rgba(28,10,55,0.05)] transition-all duration-300 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-[0_14px_36px_rgba(68,30,115,0.11)]">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary-600 via-secondary-500 to-accent-400"></div>
      <div className="grid gap-5 p-5 pl-6 lg:grid-cols-[82px_minmax(0,1fr)_minmax(250px,0.7fr)_130px] lg:items-center">
        <div className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-secondary-100 ring-1 ring-primary-100">
          <span className="text-2xl font-bold leading-none text-primary-800">{date.day}</span><span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-primary-500">{date.month}</span>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><i className={typeIcon[event.type] || 'ri-calendar-event-line'}></i></span><span className="text-[9px] font-bold uppercase tracking-[0.15em] text-primary-600">{event.type}</span></div>
          <h2 className="mt-2 text-lg font-bold text-foreground-900">{event.title}</h2>
          <p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-6 text-foreground-500">{event.description || 'No event description has been added yet.'}</p>
        </div>

        <div className="grid gap-2.5 rounded-2xl bg-background-100/70 p-3.5 text-xs text-foreground-600 sm:grid-cols-2 lg:grid-cols-1">
          <p className="flex items-start gap-2"><i className="ri-time-line mt-0.5 text-primary-500"></i><span>{event.date || 'Date TBC'}{event.time ? ` · ${event.time}` : ''}</span></p>
          <p className="flex items-start gap-2"><i className="ri-map-pin-2-line mt-0.5 text-primary-500"></i><span>{event.location || 'Location TBC'}</span></p>
          <p className="flex items-start gap-2"><i className="ri-user-star-line mt-0.5 text-primary-500"></i><span>{event.organizer || 'Organizer TBC'}</span></p>
        </div>

        <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-stretch">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold ring-1 ring-inset ${status.cls}`}><i className={status.icon}></i>{status.label}</span>
          <div className="text-left lg:text-center"><p className="text-sm font-bold text-foreground-800">{event.attendees}</p><p className="text-[9px] uppercase tracking-wider text-foreground-400">Attendees</p></div>
          {booking ? <div className="flex items-center gap-2 lg:flex-col"><span className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200"><i className="ri-checkbox-circle-fill"></i>Booked</span><button onClick={onCancel} disabled={busy} className="text-[10px] font-semibold text-foreground-400 transition hover:text-red-600 disabled:opacity-50">{busy ? 'Updating…' : 'Cancel booking'}</button></div> : <button onClick={onBook} disabled={busy || event.status === 'completed'} className="h-10 rounded-xl bg-primary-700 px-4 text-xs font-bold text-white shadow-md shadow-primary-700/20 transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-background-200 disabled:text-foreground-400 disabled:shadow-none">{busy ? <i className="ri-loader-4-line animate-spin"></i> : event.status === 'completed' ? 'Booking closed' : 'Book place'}</button>}
        </div>
      </div>
    </article>
  );
}

export default function LearnerEventsPage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [events, setEvents] = useState<EngagementEvent[]>([]);
  const [bookings, setBookings] = useState<EventBooking[]>([]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyEventId, setBusyEventId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchLearnerDetail(myLearner.kind, myLearner.id), fetchEvents(), fetchEventBookings(myLearner.id)])
      .then(([detail, rows, bookingRows]) => { if (!cancelled) { setLearner(detail); setEvents(rows); setBookings(bookingRows); setError(''); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load events.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const types = useMemo(() => Array.from(new Set(events.map((event) => event.type))).sort(), [events]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (status !== 'all' && event.status !== status) return false;
      if (type !== 'all' && event.type !== type) return false;
      return !needle || [event.title, event.description, event.location, event.organizer].some((value) => value.toLowerCase().includes(needle));
    });
  }, [events, query, status, type]);

  const counts = {
    upcoming: events.filter((event) => event.status === 'upcoming').length,
    ongoing: events.filter((event) => event.status === 'ongoing').length,
    completed: events.filter((event) => event.status === 'completed').length,
    attendees: events.reduce((sum, event) => sum + event.attendees, 0),
  };

  const activeBookings = useMemo(() => new Map(bookings.filter((booking) => booking.status === 'booked').map((booking) => [booking.eventId, booking])), [bookings]);

  async function bookEvent(event: EngagementEvent) {
    if (!learner) return;
    setBusyEventId(event.id); setError(''); setNotice('');
    try {
      const result = await createEventBooking({ eventId: event.id, learnerId: myLearner.id, learnerName: learner.name, learnerEmail: learner.email });
      setBookings((current) => [result.booking, ...current.filter((booking) => booking.eventId !== event.id)]);
      setEvents((current) => current.map((item) => item.id === event.id ? result.event : item));
      setNotice(`Your place at “${event.title}” is booked.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not book this event.');
    } finally { setBusyEventId(''); }
  }

  async function cancelBooking(event: EngagementEvent, booking: EventBooking) {
    setBusyEventId(event.id); setError(''); setNotice('');
    try {
      const result = await cancelEventBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      setEvents((current) => current.map((item) => item.id === event.id ? result.event : item));
      setNotice(`Your booking for “${event.title}” was cancelled.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel this booking.');
    } finally { setBusyEventId(''); }
  }

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Events" pageSubtitle="Community workshops, networking and celebrations" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <main className="w-full space-y-5 p-4 md:p-6">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#17032d] via-[#33105e] to-[#6a2ca0] p-6 text-white shadow-[0_18px_50px_rgba(39,12,73,0.18)] md:p-7">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-fuchsia-300/15 blur-3xl"></div>
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_500px] lg:items-end">
            <div><span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-secondary-100"><i className="ri-calendar-event-line text-secondary-300"></i>Community calendar</span><h1 className="mt-3 text-2xl font-bold text-white md:text-3xl">Connect beyond the classroom</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/65">Find workshops, networking sessions and community events, with all the details you need in one place.</p></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">{[
              ['All events', events.length, 'ri-calendar-2-line', 'text-violet-200'], ['Upcoming', counts.upcoming, 'ri-calendar-schedule-line', 'text-amber-300'], ['Live now', counts.ongoing, 'ri-live-line', 'text-blue-300'], ['Attendances', counts.attendees, 'ri-group-line', 'text-pink-300'],
            ].map(([label, value, icon, colour]) => <div key={String(label)} className="flex items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.08] p-3.5 backdrop-blur-sm"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08]"><i className={`${icon} ${colour}`}></i></span><div><p className="text-xl font-bold text-white">{loading ? '–' : value}</p><p className="text-[10px] text-white/50">{label}</p></div></div>)}</div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><i className="ri-error-warning-line mr-2"></i>{error}</div>}
        {notice && <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><span><i className="ri-checkbox-circle-line mr-2"></i>{notice}</span><button onClick={() => setNotice('')}><i className="ri-close-line"></i></button></div>}

        <section className="sticky top-2 z-10 rounded-2xl border border-foreground-200/70 bg-white/95 p-2.5 shadow-[0_8px_30px_rgba(31,14,59,0.08)] backdrop-blur-xl">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between"><div className="flex gap-1.5 overflow-x-auto">{(['all', 'upcoming', 'ongoing', 'completed'] as StatusFilter[]).map((item) => { const count = item === 'all' ? events.length : item === 'upcoming' ? counts.upcoming : item === 'ongoing' ? counts.ongoing : counts.completed; return <button key={item} onClick={() => setStatus(item)} className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition ${status === item ? 'bg-primary-700 text-white shadow-md shadow-primary-700/20' : 'text-foreground-500 hover:bg-primary-50 hover:text-primary-700'}`}>{item === 'all' ? 'All events' : statusStyle[item].label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] ${status === item ? 'bg-white/15 text-white' : 'bg-background-100 text-foreground-400'}`}>{count}</span></button>; })}</div><div className="flex flex-col gap-2 sm:flex-row"><select value={type} onChange={(event) => setType(event.target.value)} className="h-10 rounded-xl border border-foreground-200 bg-background-50 px-3 text-xs font-semibold text-foreground-600 outline-none focus:border-primary-400"><option value="all">All event types</option>{types.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select><label className="relative sm:w-72"><i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></i><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events…" className="h-10 w-full rounded-xl border border-foreground-200 bg-background-50 pl-9 pr-3 text-xs outline-none transition focus:border-primary-400 focus:bg-white focus:ring-4 focus:ring-primary-100" /></label></div></div>
        </section>

        {loading ? <Loading /> : filtered.length ? <section><div className="mb-4 flex items-end justify-between"><div><h2 className="text-lg font-bold text-foreground-900">Community events</h2><p className="mt-1 text-xs text-foreground-500">Choose an event and book your place instantly</p></div><span className="rounded-full border border-background-200 bg-white px-3 py-1 text-[10px] font-semibold text-foreground-500">{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</span></div><div className="space-y-3">{filtered.map((event) => { const booking = activeBookings.get(event.id); return <EventRow key={event.id} event={event} booking={booking} busy={busyEventId === event.id} onBook={() => bookEvent(event)} onCancel={() => booking && cancelBooking(event, booking)} />; })}</div></section> : <Empty />}
      </main>
    </WorkspaceShell>
  );
}

function Loading() { return <div className="rounded-3xl border border-background-200 bg-white p-14 text-center text-sm text-foreground-400"><i className="ri-loader-4-line mr-2 animate-spin text-primary-600"></i>Loading events from the database…</div>; }
function Empty() { return <div className="rounded-3xl border border-dashed border-foreground-300 bg-white px-6 py-16 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-500"><i className="ri-calendar-close-line text-xl"></i></span><h2 className="mt-3 text-sm font-bold text-foreground-800">No events found</h2><p className="mt-1 text-xs text-foreground-400">Try changing the filters, or check back when new events are published.</p></div>; }
