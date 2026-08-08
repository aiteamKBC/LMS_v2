import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import {
  cancelEventBooking,
  createEventBooking,
  fetchClubs,
  fetchEventBookings,
  fetchEvents,
  type EngagementClub,
  type EngagementClubMeeting,
  type EngagementEvent,
  type EventBooking,
} from '@/api/engagement';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;
type SectionKey = 'clubs' | 'meetings' | 'events' | 'ambassadors';

const tabs: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'clubs', label: 'Clubs', icon: 'ri-community-line' },
  { key: 'meetings', label: 'Meetings', icon: 'ri-calendar-event-line' },
  { key: 'events', label: 'Events', icon: 'ri-calendar-check-line' },
  { key: 'ambassadors', label: 'Ambassadors', icon: 'ri-shield-star-line' },
];

function initials(name?: string) {
  return name ? name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : '–';
}

function ClubCard({ club }: { club: EngagementClub }) {
  const nextMeeting = club.meetings.find((meeting) => meeting.scheduled) || club.meetings[0];
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-foreground-200/70 bg-white p-5 shadow-[0_5px_24px_rgba(28,10,55,0.05)] transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_16px_38px_rgba(68,30,115,0.12)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-600 via-secondary-500 to-accent-400 opacity-70 transition group-hover:opacity-100"></div>
      <div className="flex items-start gap-3 pt-1">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-secondary-100 text-primary-700 ring-1 ring-primary-100"><AppIcon className="ri-community-line text-xl"></AppIcon></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground-900">{club.name}</h3>
          <p className="mt-1 flex items-center gap-1 text-xs text-foreground-400"><AppIcon className="ri-map-pin-2-line text-primary-500"></AppIcon>{club.location || 'Location not set'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ring-inset ${club.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-background-100 text-foreground-500 ring-background-300'}`}>{club.active ? 'Active' : 'Inactive'}</span>
      </div>

      <p className="mt-4 min-h-[48px] flex-1 text-sm leading-6 text-foreground-600">{club.description || 'No club description has been added yet.'}</p>

      <div className="mt-4 flex items-center gap-5 rounded-2xl bg-background-100/70 px-4 py-3">
        <Metric icon="ri-group-line" value={club.members} label="Members" colour="text-primary-600" />
        <span className="h-8 w-px bg-background-300"></span>
        <Metric icon="ri-calendar-event-line" value={club.meetings.length} label="Meetings" colour="text-secondary-600" />
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary-100 text-[10px] font-bold text-secondary-700 ring-2 ring-white">{initials(club.ambassador)}</span>
        <div className="min-w-0 flex-1"><p className="text-[9px] font-bold uppercase tracking-wider text-foreground-400">Club ambassador</p><p className="truncate text-xs font-semibold text-foreground-700">{club.ambassador || 'Not assigned'}{club.ambassadorRole ? ` · ${club.ambassadorRole}` : ''}</p></div>
      </div>

      {nextMeeting && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 to-secondary-50/60 p-3 text-xs">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-primary-600 shadow-sm"><AppIcon className="ri-calendar-check-line"></AppIcon></span>
          <div className="min-w-0 flex-1"><p className="truncate font-semibold text-primary-900">{nextMeeting.title}</p><p className="mt-0.5 text-[10px] text-primary-700/70">{nextMeeting.date || 'Date TBC'}{nextMeeting.time ? ` · ${nextMeeting.time}` : ''}</p></div>
        </div>
      )}
    </article>
  );
}

function Metric({ icon, value, label, colour }: { icon: string; value: number; label: string; colour: string }) {
  return <div className="flex items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm ${colour}`}><AppIcon className={icon}></AppIcon></span><div><p className="text-sm font-bold text-foreground-900">{value}</p><p className="text-[9px] text-foreground-400">{label}</p></div></div>;
}

function MeetingRow({ meeting, club }: { meeting: EngagementClubMeeting; club: EngagementClub }) {
  return (
    <div className="grid gap-3 px-4 py-4 transition hover:bg-primary-50/30 sm:grid-cols-[48px_minmax(200px,1.5fr)_minmax(150px,1fr)_minmax(180px,1fr)_110px] sm:items-center sm:px-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><AppIcon className="ri-calendar-event-line"></AppIcon></span>
      <div><p className="text-sm font-bold text-foreground-900">{meeting.title}</p><p className="mt-1 text-xs text-primary-600">{club.name}</p></div>
      <div className="text-xs text-foreground-600"><AppIcon className="ri-map-pin-line mr-1.5 text-primary-500"></AppIcon>{meeting.venue || 'Venue TBC'}</div>
      <div className="text-xs text-foreground-600"><AppIcon className="ri-calendar-line mr-1.5 text-primary-500"></AppIcon>{meeting.date || 'Date TBC'}{meeting.time ? ` · ${meeting.time}` : ''}</div>
      <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold ${meeting.scheduled ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{meeting.scheduled ? 'Scheduled' : 'Date TBC'}</span>
    </div>
  );
}

function EventCard({ event, booking, busy, onBook, onCancel }: { event: EngagementEvent; booking?: EventBooking; busy: boolean; onBook: () => void; onCancel: () => void }) {
  const statusClass = event.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : event.status === 'ongoing' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700';
  return (
    <article className="rounded-3xl border border-foreground-200/70 bg-white p-5 shadow-[0_5px_24px_rgba(28,10,55,0.05)] transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary-100 text-secondary-700"><AppIcon className="ri-calendar-event-line text-lg"></AppIcon></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${statusClass}`}>{event.status}</span></div>
      <p className="mt-4 text-[9px] font-bold uppercase tracking-widest text-primary-600">{event.type}</p>
      <h3 className="mt-1 text-base font-bold text-foreground-900">{event.title}</h3>
      <p className="mt-2 line-clamp-2 min-h-[40px] text-xs leading-5 text-foreground-500">{event.description || 'No event description yet.'}</p>
      <div className="mt-4 space-y-2.5 rounded-2xl bg-background-100/70 p-3 text-xs text-foreground-500"><p><AppIcon className="ri-calendar-line mr-2 text-primary-500"></AppIcon>{event.date} · {event.time}</p><p><AppIcon className="ri-map-pin-line mr-2 text-primary-500"></AppIcon>{event.location}</p><p><AppIcon className="ri-user-star-line mr-2 text-primary-500"></AppIcon>{event.organizer}</p><p><AppIcon className="ri-group-line mr-2 text-primary-500"></AppIcon>{event.attendees} attendees</p></div>
      {booking ? <div className="mt-4 flex items-center gap-2"><span className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200"><AppIcon className="ri-checkbox-circle-fill"></AppIcon>Place booked</span><button onClick={onCancel} disabled={busy} className="h-10 rounded-xl border border-foreground-200 px-3 text-[10px] font-semibold text-foreground-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">{busy ? <AppIcon className="ri-loader-4-line animate-spin"></AppIcon> : 'Cancel'}</button></div> : <button onClick={onBook} disabled={busy || event.status === 'completed'} className="mt-4 h-10 w-full rounded-xl bg-primary-700 text-xs font-bold text-white shadow-md shadow-primary-700/20 transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-background-200 disabled:text-foreground-400 disabled:shadow-none">{busy ? <AppIcon className="ri-loader-4-line animate-spin"></AppIcon> : event.status === 'completed' ? 'Booking closed' : 'Book place'}</button>}
    </article>
  );
}

function AmbassadorCard({ name, clubs }: { name: string; clubs: EngagementClub[] }) {
  return <article className="rounded-3xl border border-background-200 bg-white p-5 shadow-[0_5px_24px_rgba(28,10,55,0.05)]"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-secondary-100 to-primary-100 text-sm font-bold text-secondary-700">{initials(name)}</span><div><h3 className="text-sm font-bold text-foreground-900">{name}</h3><p className="mt-1 text-xs text-foreground-400">{clubs[0].ambassadorRole || 'Club ambassador'}</p></div></div><div className="mt-4 border-t border-background-200 pt-4"><p className="text-[9px] font-bold uppercase tracking-wider text-foreground-400">Assigned clubs</p><div className="mt-2 flex flex-wrap gap-1.5">{clubs.map((club) => <span key={club.id} className="rounded-lg bg-primary-50 px-2.5 py-1.5 text-[10px] font-semibold text-primary-700">{club.name}</span>)}</div></div></article>;
}

export default function ClubsPage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [clubs, setClubs] = useState<EngagementClub[]>([]);
  const [events, setEvents] = useState<EngagementEvent[]>([]);
  const [bookings, setBookings] = useState<EventBooking[]>([]);
  const [activeSection, setActiveSection] = useState<SectionKey>('clubs');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyEventId, setBusyEventId] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([fetchLearnerDetail(myLearner.kind, myLearner.id), fetchClubs(), fetchEvents(), fetchEventBookings(myLearner.id)])
      .then(([detail, clubRows, eventRows, bookingRows]) => { if (!cancelled) { setLearner(detail); setClubs(clubRows); setEvents(eventRows); setBookings(bookingRows); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load community data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.kind, myLearner.id]);

  const meetings = useMemo(() => clubs.flatMap((club) => club.meetings.map((meeting) => ({ club, meeting }))), [clubs]);
  const ambassadors = useMemo(() => {
    const unique = new Map<string, EngagementClub[]>();
    clubs.forEach((club) => { if (club.ambassador) unique.set(club.ambassador, [...(unique.get(club.ambassador) || []), club]); });
    return Array.from(unique.entries());
  }, [clubs]);
  const filteredClubs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? clubs.filter((club) => [club.name, club.location, club.description, club.ambassador].some((value) => value.toLowerCase().includes(needle))) : clubs;
  }, [clubs, query]);
  const totalMembers = clubs.reduce((sum, club) => sum + club.members, 0);
  const activeClubs = clubs.filter((club) => club.active).length;
  const counts: Record<SectionKey, number> = { clubs: clubs.length, meetings: meetings.length, events: events.length, ambassadors: ambassadors.length };
  const activeBookings = useMemo(() => new Map(bookings.filter((booking) => booking.status === 'booked').map((booking) => [booking.eventId, booking])), [bookings]);

  async function bookEvent(event: EngagementEvent) {
    if (!learner) return;
    setBusyEventId(event.id); setError(''); setNotice('');
    try {
      const result = await createEventBooking({ eventId: event.id, learnerId: myLearner.id, learnerName: learner.name, learnerEmail: learner.email });
      setBookings((current) => [result.booking, ...current.filter((booking) => booking.eventId !== event.id)]);
      setEvents((current) => current.map((item) => item.id === event.id ? result.event : item));
      setNotice(`Your place at “${event.title}” is booked.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not book this event.'); }
    finally { setBusyEventId(''); }
  }

  async function cancelBooking(event: EngagementEvent, booking: EventBooking) {
    setBusyEventId(event.id); setError(''); setNotice('');
    try {
      const result = await cancelEventBooking(booking.id);
      setBookings((current) => current.map((item) => item.id === booking.id ? result.booking : item));
      setEvents((current) => current.map((item) => item.id === event.id ? result.event : item));
      setNotice(`Your booking for “${event.title}” was cancelled.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel this booking.'); }
    finally { setBusyEventId(''); }
  }

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Clubs" pageSubtitle="Connect, learn and grow with fellow apprentices" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <main className="w-full space-y-4 p-3 sm:p-4 md:space-y-5 md:p-6">
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#17032d] via-[#33105e] to-[#6a2ca0] p-4 text-white shadow-[0_18px_50px_rgba(39,12,73,0.18)] sm:rounded-3xl sm:p-6 md:p-7">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-fuchsia-300/15 blur-3xl"></div><div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-64 rounded-full bg-primary-300/10 blur-3xl"></div>
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-end">
            <div><span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-secondary-100"><AppIcon className="ri-community-line text-secondary-300"></AppIcon>Learner community</span><h1 className="mt-3 text-[22px] font-bold leading-tight text-white sm:text-2xl md:text-3xl">Find your community at KBC</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/70">Explore active clubs, meet other learners and keep up with community meetings and events.</p><div className="mt-4 flex flex-wrap gap-2 sm:mt-5"><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80"><AppIcon className="ri-checkbox-circle-line mr-1.5 text-emerald-300"></AppIcon>{activeClubs} active clubs</span><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80"><AppIcon className="ri-group-line mr-1.5 text-blue-300"></AppIcon>{totalMembers} members</span></div></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">{[
              ['Clubs', clubs.length, 'ri-community-line', 'text-violet-200'], ['Meetings', meetings.length, 'ri-calendar-event-line', 'text-amber-300'], ['Events', events.length, 'ri-calendar-check-line', 'text-pink-300'], ['Ambassadors', ambassadors.length, 'ri-shield-star-line', 'text-emerald-300'],
            ].map(([label, value, icon, colour]) => <div key={String(label)} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.09] bg-white/[0.08] p-3 backdrop-blur-sm sm:rounded-2xl sm:p-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08]"><AppIcon className={`${icon} ${colour}`}></AppIcon></span><div className="min-w-0"><p className="text-lg font-bold text-white sm:text-xl">{loading ? '–' : value}</p><p className="truncate text-[10px] text-white/60">{label}</p></div></div>)}</div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}</div>}
        {notice && <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><span><AppIcon className="ri-checkbox-circle-line mr-2"></AppIcon>{notice}</span><button onClick={() => setNotice('')}><AppIcon className="ri-close-line"></AppIcon></button></div>}

        <section className="rounded-2xl border border-foreground-200/70 bg-white/95 p-2.5 shadow-[0_8px_30px_rgba(31,14,59,0.08)] backdrop-blur-xl md:sticky md:top-2 md:z-10">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between"><div className="grid grid-cols-2 gap-1.5 sm:flex">{tabs.map((tab) => <button key={tab.key} onClick={() => setActiveSection(tab.key)} className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2.5 text-[11px] font-semibold transition-all sm:gap-2 sm:px-4 sm:text-xs ${activeSection === tab.key ? 'bg-primary-700 text-white shadow-md shadow-primary-700/20' : 'text-foreground-500 hover:bg-primary-50 hover:text-primary-700'}`}><AppIcon className={`${tab.icon} shrink-0`}></AppIcon><span className="truncate">{tab.label}</span><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${activeSection === tab.key ? 'bg-white/15 text-white' : 'bg-background-100 text-foreground-400'}`}>{counts[tab.key]}</span></button>)}</div>{activeSection === 'clubs' && <label className="relative block lg:w-72"><AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by club, place or ambassador…" className="h-10 w-full rounded-xl border border-foreground-200 bg-background-50 pl-9 pr-3 text-xs outline-none transition focus:border-primary-400 focus:bg-white focus:ring-4 focus:ring-primary-100" /></label>}</div>
        </section>

        {loading ? <Loading /> : activeSection === 'clubs' ? <ContentHeader title="Explore clubs" subtitle="Community clubs available across KBC" count={filteredClubs.length}>{filteredClubs.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredClubs.map((club) => <ClubCard key={club.id} club={club} />)}</div> : <EmptyState message="No clubs match your search." />}</ContentHeader>
        : activeSection === 'meetings' ? <ContentHeader title="Club meetings" subtitle="Upcoming and unscheduled community meetups" count={meetings.length}>{meetings.length ? <div className="divide-y divide-background-200 overflow-hidden rounded-3xl border border-background-200 bg-white shadow-sm">{meetings.map(({ meeting, club }) => <MeetingRow key={`${club.id}:${meeting.id}`} meeting={meeting} club={club} />)}</div> : <EmptyState message="No club meetings have been added yet." />}</ContentHeader>
        : activeSection === 'events' ? <ContentHeader title="Community events" subtitle="Choose an event and book your place" count={events.length}>{events.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{events.map((event) => { const booking = activeBookings.get(event.id); return <EventCard key={event.id} event={event} booking={booking} busy={busyEventId === event.id} onBook={() => bookEvent(event)} onCancel={() => booking && cancelBooking(event, booking)} />; })}</div> : <EmptyState message="No community events have been added yet." />}</ContentHeader>
        : <ContentHeader title="Club ambassadors" subtitle="People leading KBC learner communities" count={ambassadors.length}>{ambassadors.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{ambassadors.map(([name, assignedClubs]) => <AmbassadorCard key={name} name={name} clubs={assignedClubs} />)}</div> : <EmptyState message="No ambassadors have been assigned yet." />}</ContentHeader>}
      </main>
    </WorkspaceShell>
  );
}

function ContentHeader({ title, subtitle, count, children }: { title: string; subtitle: string; count: number; children: React.ReactNode }) {
  return <section><div className="mb-4 flex items-start justify-between gap-3 sm:items-end"><div className="min-w-0"><h2 className="text-lg font-bold text-foreground-900">{title}</h2><p className="mt-1 text-xs leading-5 text-foreground-500">{subtitle}</p></div><span className="shrink-0 rounded-full border border-background-200 bg-white px-3 py-1 text-[10px] font-semibold text-foreground-500">{count} {count === 1 ? 'record' : 'records'}</span></div>{children}</section>;
}

function Loading() { return <div className="rounded-2xl border border-background-200 bg-white px-4 py-10 text-center text-sm text-foreground-400 sm:rounded-3xl sm:p-14"><AppIcon className="ri-loader-4-line mr-2 animate-spin text-primary-600"></AppIcon>Loading clubs from the database…</div>; }
function EmptyState({ message }: { message: string }) { return <div className="rounded-2xl border border-dashed border-foreground-300 bg-white px-4 py-10 text-center sm:rounded-3xl sm:px-6 sm:py-14"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-500"><AppIcon className="ri-inbox-line text-xl"></AppIcon></span><p className="mt-3 text-sm font-semibold text-foreground-700">{message}</p></div>; }
