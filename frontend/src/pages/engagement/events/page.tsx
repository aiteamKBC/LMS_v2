import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { useToast } from '@/hooks/useToast';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchEvents, createEvent, updateEvent, deleteEvent,
  fetchEventAttendance, saveEventAttendance,
  type EngagementEvent as Event, type AttendanceRosterEntry,
} from '@/api/engagement';
import { EventCardSkeletonGrid } from '@/pages/engagement/EngagementSkeletons';

const engagementNav = roleNavMap.engagement;

// Type drives each card's identity: medallion + a left accent strip.
// Full literal class strings so Tailwind's JIT keeps them.
const typeConfig: Record<string, { icon: string; bg: string; text: string; bar: string }> = {
  workshop: { icon: 'ri-presentation-line', bg: 'bg-primary-100', text: 'text-primary-700', bar: 'bg-primary-400' },
  social: { icon: 'ri-cake-line', bg: 'bg-accent-100', text: 'text-accent-700', bar: 'bg-accent-400' },
  networking: { icon: 'ri-group-line', bg: 'bg-secondary-100', text: 'text-secondary-700', bar: 'bg-secondary-400' },
  competition: { icon: 'ri-trophy-line', bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-400' },
  celebration: { icon: 'ri-star-line', bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-400' },
};

// The stored date is a display string ('13 Jun 2026'); convert it back to the
// yyyy-mm-dd an <input type="date"> expects so Edit can prefill it.
function toDateInputValue(display: string): string {
  const d = new Date(display);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface EventFormData {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  type: 'workshop' | 'social' | 'networking' | 'competition' | 'celebration';
  organizer: string;
}

interface FormErrors {
  title?: string;
  description?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  organizer?: string;
}

const blankForm: EventFormData = {
  title: '',
  description: '',
  date: '',
  startTime: '',
  endTime: '',
  location: '',
  type: 'workshop',
  organizer: 'Tom Harrington',
};

function EventForm({
  form,
  errors,
  setForm,
  setErrors,
}: {
  form: EventFormData;
  errors: FormErrors;
  setForm: (fn: (f: EventFormData) => EventFormData) => void;
  setErrors: (fn: (e: FormErrors) => FormErrors) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Type */}
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Event Type <span className="text-red-500">*</span></label>
        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 flex-wrap">
          {(Object.keys(typeConfig) as Array<keyof typeof typeConfig>).map(t => (
            <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t as EventFormData['type'] }))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${form.type === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <AppIcon className={`${typeConfig[t].icon} text-sm`}></AppIcon>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {/* Title */}
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Title <span className="text-red-500">*</span></label>
        <input type="text" value={form.title} onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.title; return n; }); }} placeholder="e.g. Spring Leadership Workshop" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.title ? 'border-red-300' : 'border-foreground-200/60'}`} />
        {errors.title && <p className="text-[10px] text-red-500 mt-1">{errors.title}</p>}
      </div>
      {/* Description */}
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Description <span className="text-red-500">*</span></label>
        <textarea value={form.description} onChange={e => { setForm(f => ({ ...f, description: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.description; return n; }); }} rows={3} maxLength={500} placeholder="Brief description of the event..." className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none ${errors.description ? 'border-red-300' : 'border-foreground-200/60'}`}></textarea>
        <div className="flex items-center justify-between mt-1">
          {errors.description ? <p className="text-[10px] text-red-500">{errors.description}</p> : <span></span>}
          <span className="text-[10px] text-foreground-400">{form.description.length}/500</span>
        </div>
      </div>
      {/* Date & Time */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Date <span className="text-red-500">*</span></label>
          <input type="date" value={form.date} onChange={e => { setForm(f => ({ ...f, date: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.date; return n; }); }} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.date ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.date && <p className="text-[10px] text-red-500 mt-1">{errors.date}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Start Time <span className="text-red-500">*</span></label>
          <input type="time" value={form.startTime} onChange={e => { setForm(f => ({ ...f, startTime: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.startTime; return n; }); }} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.startTime ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.startTime && <p className="text-[10px] text-red-500 mt-1">{errors.startTime}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">End Time <span className="text-red-500">*</span></label>
          <input type="time" value={form.endTime} onChange={e => { setForm(f => ({ ...f, endTime: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.endTime; return n; }); }} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.endTime ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.endTime && <p className="text-[10px] text-red-500 mt-1">{errors.endTime}</p>}
        </div>
      </div>
      {/* Location */}
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Location <span className="text-red-500">*</span></label>
        <input type="text" value={form.location} onChange={e => { setForm(f => ({ ...f, location: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.location; return n; }); }} placeholder="e.g. Teams Virtual or KBC Central London" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.location ? 'border-red-300' : 'border-foreground-200/60'}`} />
        {errors.location && <p className="text-[10px] text-red-500 mt-1">{errors.location}</p>}
      </div>
      {/* Organizer */}
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Organizer <span className="text-red-500">*</span></label>
        <input type="text" value={form.organizer} onChange={e => { setForm(f => ({ ...f, organizer: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.organizer; return n; }); }} placeholder="e.g. Tom Harrington" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.organizer ? 'border-red-300' : 'border-foreground-200/60'}`} />
        {errors.organizer && <p className="text-[10px] text-red-500 mt-1">{errors.organizer}</p>}
      </div>
    </div>
  );
}

function validateForm(form: EventFormData): FormErrors {
  const errs: FormErrors = {};
  if (!form.title.trim()) errs.title = 'Event title is required';
  else if (form.title.trim().length < 5) errs.title = 'Title must be at least 5 characters';
  if (!form.description.trim()) errs.description = 'Description is required';
  else if (form.description.trim().length < 10) errs.description = 'Description must be at least 10 characters';
  if (!form.date) errs.date = 'Date is required';
  if (!form.startTime) errs.startTime = 'Start time is required';
  if (!form.endTime) errs.endTime = 'End time is required';
  if (form.startTime && form.endTime && form.startTime >= form.endTime) errs.endTime = 'End time must be after start time';
  if (!form.location.trim()) errs.location = 'Location is required';
  if (!form.organizer.trim()) errs.organizer = 'Organizer is required';
  return errs;
}

export default function EventsPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const operator = useOperatorIdentity();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'ongoing' | 'completed'>('all');

  useEffect(() => {
    let cancelled = false;
    fetchEvents()
      .then(data => { if (!cancelled) setEvents(data); })
      .catch(err => { if (!cancelled) warning('Could not load events', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  // ADD modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<EventFormData>({ ...blankForm });
  const [addErrors, setAddErrors] = useState<FormErrors>({});
  const [addSubmitted, setAddSubmitted] = useState(false);

  // EDIT modal
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EventFormData>({ ...blankForm });
  const [editErrors, setEditErrors] = useState<FormErrors>({});
  const [editSubmitted, setEditSubmitted] = useState(false);

  // DELETE dialog
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);

  // Attendance modal — mark who showed up; 'present' awards event_attended points.
  const [attendanceEventId, setAttendanceEventId] = useState<string | null>(null);
  const [attendanceRoster, setAttendanceRoster] = useState<AttendanceRosterEntry[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceDraft, setAttendanceDraft] = useState<Record<string, 'present' | 'absent'>>({});

  const filtered = events.filter(e => {
    const matchType = typeFilter === 'all' || e.type === typeFilter;
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchType && matchStatus;
  });
  const upcomingCount = events.filter(e => e.status === 'upcoming').length;
  const totalAttendees = events.reduce((s, e) => s + e.attendees, 0);

  function openAddModal() {
    setAddForm({ ...blankForm });
    setAddErrors({});
    setAddSubmitted(false);
    setShowAddModal(true);
  }

  async function handleAdd() {
    const errs = validateForm(addForm);
    if (Object.keys(errs).length > 0) { setAddErrors(errs); return; }
    try {
      const created = await createEvent({
        title: addForm.title.trim(),
        description: addForm.description.trim(),
        date: new Date(addForm.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: `${addForm.startTime} - ${addForm.endTime}`,
        location: addForm.location.trim(),
        type: addForm.type,
        organizer: addForm.organizer.trim(),
      });
      setEvents(prev => [created, ...prev]);
      setAddSubmitted(true);
      setTimeout(() => { setShowAddModal(false); setAddSubmitted(false); }, 700);
      success(`Event "${created.title}" created`);
    } catch (err: any) {
      warning('Could not create event', err.message);
    }
  }

  function openEditModal(event: Event) {
    const [startTime, endTime] = event.time.split(' - ');
    setEditEventId(event.id);
    setEditForm({
      title: event.title,
      description: event.description,
      date: toDateInputValue(event.date),
      startTime: (startTime || '').trim(),
      endTime: (endTime || '').trim(),
      location: event.location,
      type: event.type,
      organizer: event.organizer,
    });
    setEditErrors({});
    setEditSubmitted(false);
  }

  async function handleEdit() {
    if (!editEventId) return;
    const errs = validateForm(editForm);
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    try {
      const updated = await updateEvent(editEventId, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        date: new Date(editForm.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: `${editForm.startTime} - ${editForm.endTime}`,
        location: editForm.location.trim(),
        type: editForm.type,
        organizer: editForm.organizer.trim(),
      });
      setEvents(prev => prev.map(e => e.id === editEventId ? updated : e));
      setEditSubmitted(true);
      setTimeout(() => { setEditEventId(null); setEditSubmitted(false); }, 700);
      success(`Event "${updated.title}" updated`);
    } catch (err: any) {
      warning('Could not update event', err.message);
    }
  }

  async function confirmDelete() {
    if (!deleteEventId) return;
    const removed = events.find(e => e.id === deleteEventId);
    try {
      await deleteEvent(deleteEventId);
      setEvents(prev => prev.filter(e => e.id !== deleteEventId));
      setDeleteEventId(null);
      if (removed) warning(`Event "${removed.title}" deleted`);
    } catch (err: any) {
      warning('Could not delete event', err.message);
    }
  }

  const eventToDelete = events.find(e => e.id === deleteEventId);
  const attendanceEvent = events.find(e => e.id === attendanceEventId) ?? null;

  const openAttendance = async (event: Event) => {
    setAttendanceEventId(event.id);
    setAttendanceLoading(true);
    try {
      const roster = await fetchEventAttendance(event.id);
      setAttendanceRoster(roster);
      const draft: Record<string, 'present' | 'absent'> = {};
      roster.forEach(r => { if (r.status) draft[r.learnerId] = r.status; });
      setAttendanceDraft(draft);
    } catch (err: any) {
      warning('Could not load attendance', err.message);
      setAttendanceEventId(null);
    } finally {
      setAttendanceLoading(false);
    }
  };

  const setMark = (learnerId: string, status: 'present' | 'absent') => {
    setAttendanceDraft(prev => ({ ...prev, [learnerId]: status }));
  };

  const markAll = (status: 'present' | 'absent') => {
    const draft: Record<string, 'present' | 'absent'> = {};
    attendanceRoster.forEach(r => { draft[r.learnerId] = status; });
    setAttendanceDraft(draft);
  };

  const saveAttendance = async () => {
    if (!attendanceEventId) return;
    const records = attendanceRoster
      .filter(r => attendanceDraft[r.learnerId])
      .map(r => ({ learnerId: r.learnerId, learnerName: r.learnerName, status: attendanceDraft[r.learnerId] }));
    if (records.length === 0) { warning('Mark at least one learner before saving'); return; }
    setAttendanceSaving(true);
    try {
      const roster = await saveEventAttendance(attendanceEventId, records);
      setAttendanceRoster(prev => prev.map(r => roster.find(saved => saved.learnerId === r.learnerId) ?? r));
      const presentCount = records.filter(r => r.status === 'present').length;
      success(`Attendance saved — ${presentCount} learner${presentCount === 1 ? '' : 's'} marked present`);
      setAttendanceEventId(null);
    } catch (err: any) {
      warning('Could not save attendance', err.message);
    } finally {
      setAttendanceSaving(false);
    }
  };

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Events" pageSubtitle="Schedule and manage learner events, workshops, and social activities"
      userName={operator.name} userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Events Management"
          description={`${upcomingCount} upcoming events. ${totalAttendees} total attendees across all events. ${events.filter(e => e.status === 'completed').length} completed this month.`}
          icon="ri-calendar-event-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20illustrated%20character%20flat%20vector%20art%20style%20corporate%20business%20event%20organizer%20modern%20clean%20minimal%20design%20no%20background%20isolated%20character%20soft%20warm%20tones%20geometric%20shapes%20sleek%20editorial%20illustration%20solid%20color%20blocking%20crisp%20edges&width=400&height=160&seq=events-hero-char&orientation=landscape"
          imageAlt="Events"
          stats={[{ label: 'Upcoming', value: String(upcomingCount) }, { label: 'Attendees', value: String(totalAttendees) }, { label: 'Completed', value: String(events.filter(e => e.status === 'completed').length) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/clubs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-team-line text-sm"></AppIcon> Learner Clubs
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-thumb-up-line text-sm"></AppIcon> Recognition
          </button>
        </div>

        {/* Filters & Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'upcoming', 'ongoing', 'completed'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s as 'all' | 'upcoming' | 'ongoing' | 'completed')} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === s ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'workshop', 'social', 'networking', 'competition', 'celebration'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1"></div>
          <button onClick={openAddModal} className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-add-line"></AppIcon> Add New Event
          </button>
        </div>

        {loading && <EventCardSkeletonGrid />}

        {!loading && filtered.length === 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 flex flex-col items-center justify-center text-center gap-2">
            <AppIcon className="ri-calendar-event-line text-2xl text-foreground-300"></AppIcon>
            <p className="text-sm font-semibold text-foreground-700">No events match this view</p>
            <p className="text-[11px] text-foreground-400">Try switching the status or type filter — or add a new event.</p>
          </div>
        )}

        {/* Event Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filtered.map(event => {
            const cfg = typeConfig[event.type] || { icon: 'ri-calendar-line', bg: 'bg-background-100', text: 'text-foreground-500', bar: 'bg-foreground-300' };
            return (
              <div key={event.id} className="relative bg-background-50 rounded-xl border border-foreground-200/60 p-4 pl-5 card-premium hover:border-primary-200/50 transition-smooth overflow-hidden">
                <span className={`absolute inset-y-0 left-0 w-1 ${cfg.bar}`} aria-hidden="true"></span>
                <div className="flex items-start gap-3 mb-3">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
                    <AppIcon className={`${cfg.icon} text-sm`}></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] font-semibold text-foreground-900">{event.title}</h4>
                    <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{event.type}</span>
                  </div>
                </div>
                <p className="text-[11px] text-foreground-500 mb-3">{event.description}</p>
                <div className="space-y-1 text-[10px] text-foreground-400">
                  <p><AppIcon className="ri-calendar-line mr-1 text-primary-500"></AppIcon>{event.date}</p>
                  <p><AppIcon className="ri-time-line mr-1 text-primary-500"></AppIcon>{event.time}</p>
                  <p><AppIcon className="ri-map-pin-line mr-1 text-primary-500"></AppIcon>{event.location}</p>
                  <p><AppIcon className="ri-user-line mr-1 text-primary-500"></AppIcon>{event.organizer}</p>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-foreground-600">
                  <AppIcon className="ri-group-line text-primary-500"></AppIcon>
                  <span className="font-semibold text-foreground-900">{event.attendees}</span>
                  <span className="text-foreground-400">student{event.attendees === 1 ? '' : 's'} intending to attend</span>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${event.status === 'upcoming' ? 'bg-primary-100 text-primary-700' : event.status === 'ongoing' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{event.status}</span>
                  <div className="flex-1"></div>
                  <button onClick={() => openAttendance(event)} className="flex items-center gap-1 px-2 py-1.5 bg-secondary-50 text-secondary-700 rounded-lg text-[10px] font-medium hover:bg-secondary-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-checkbox-circle-line"></AppIcon> Attendance
                  </button>
                  <button onClick={() => openEditModal(event)} className="flex items-center gap-1 px-2 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-200/50 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-edit-line"></AppIcon> Edit
                  </button>
                  <button onClick={() => setDeleteEventId(event.id)} className="flex items-center gap-1 px-2 py-1.5 bg-red-50 text-red-600 rounded-lg text-[10px] font-medium hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-delete-bin-line"></AppIcon> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ADD EVENT MODAL */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
            <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-calendar-event-line text-lg"></AppIcon></span>
                  <div>
                    <h3 className="text-base font-heading font-semibold text-foreground-900">Add New Event</h3>
                    <p className="text-[11px] text-foreground-400">Create a new event for learners</p>
                  </div>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
              </div>
              <div className="p-5 overflow-y-auto">
                <EventForm form={addForm} errors={addErrors} setForm={setAddForm} setErrors={setAddErrors} />
              </div>
              <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
                <button onClick={handleAdd} disabled={addSubmitted} className={`px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${addSubmitted ? 'bg-emerald-500 text-white' : 'bg-primary-500 text-white hover:bg-primary-600'}`}>
                  {addSubmitted ? <><AppIcon className="ri-check-line"></AppIcon> Created!</> : <><AppIcon className="ri-add-line"></AppIcon> Create Event</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EDIT EVENT MODAL */}
        {editEventId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditEventId(null)}>
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
            <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center"><AppIcon className="ri-edit-line text-lg"></AppIcon></span>
                  <div>
                    <h3 className="text-base font-heading font-semibold text-foreground-900">Edit Event</h3>
                    <p className="text-[11px] text-foreground-400">Update event details</p>
                  </div>
                </div>
                <button onClick={() => setEditEventId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
              </div>
              <div className="p-5 overflow-y-auto">
                <EventForm form={editForm} errors={editErrors} setForm={setEditForm} setErrors={setEditErrors} />
              </div>
              <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
                <button onClick={() => setEditEventId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
                <button onClick={handleEdit} disabled={editSubmitted} className={`px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${editSubmitted ? 'bg-emerald-500 text-white' : 'bg-accent-500 text-white hover:bg-accent-600'}`}>
                  {editSubmitted ? <><AppIcon className="ri-check-line"></AppIcon> Saved!</> : <><AppIcon className="ri-save-line"></AppIcon> Save Changes</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DELETE CONFIRMATION DIALOG */}
        {deleteEventId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDeleteEventId(null)}>
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
            <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-sm w-full p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <AppIcon className="ri-delete-bin-line text-xl"></AppIcon>
                </span>
                <div>
                  <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Delete Event</h3>
                  <p className="text-[12px] text-foreground-400">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-[13px] text-foreground-700">
                Are you sure you want to delete <strong className="text-foreground-900">&ldquo;{eventToDelete?.title}&rdquo;</strong>? All attendee registrations will be lost.
              </p>
              <div className="flex items-center justify-end gap-3 mt-1">
                <button onClick={() => setDeleteEventId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  Cancel
                </button>
                <button onClick={confirmDelete} className="px-5 py-2 bg-red-600 text-white rounded-lg text-[12px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2">
                  <AppIcon className="ri-delete-bin-line"></AppIcon> Delete Event
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ATTENDANCE MODAL — mark who showed up; 'present' awards points */}
        {attendanceEventId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setAttendanceEventId(null)}>
            <div className="bg-background-50 rounded-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-foreground-200/60 shrink-0">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-secondary-100 text-secondary-600 flex items-center justify-center"><AppIcon className="ri-checkbox-circle-line"></AppIcon></span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Mark attendance</h3>
                    <p className="text-[11px] text-foreground-400">{attendanceEvent?.title} · marking present awards points</p>
                  </div>
                </div>
                <button onClick={() => setAttendanceEventId(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><AppIcon className="ri-close-line"></AppIcon></button>
              </div>

              {attendanceLoading && <p className="text-[11px] text-foreground-400 text-center py-8">Loading roster…</p>}

              {!attendanceLoading && (
                <>
                  <div className="px-5 pt-3 flex items-center gap-2 shrink-0">
                    <button onClick={() => markAll('present')} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-smooth cursor-pointer">
                      <AppIcon className="ri-checkbox-circle-line"></AppIcon> Mark all present
                    </button>
                    <button onClick={() => markAll('absent')} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold text-foreground-600 bg-background-100 hover:bg-background-200/60 transition-smooth cursor-pointer">
                      <AppIcon className="ri-close-circle-line"></AppIcon> Mark all absent
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto space-y-2">
                    {attendanceRoster.length === 0 && (
                      <p className="text-[11px] text-foreground-400 text-center py-4">No learners booked onto this event yet.</p>
                    )}
                    {attendanceRoster.map(entry => {
                      const mark = attendanceDraft[entry.learnerId];
                      return (
                        <div key={entry.learnerId} className="flex items-center gap-2.5 rounded-lg border border-foreground-200/50 p-2.5">
                          <div className="w-7 h-7 rounded-full bg-secondary-100 text-secondary-700 flex items-center justify-center text-[10px] font-bold shrink-0">{entry.learnerName.charAt(0)}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-semibold text-foreground-900 truncate">{entry.learnerName}</p>
                            {entry.booked === false && <span className="text-[9px] font-semibold text-amber-600">Walk-in (not booked)</span>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setMark(entry.learnerId, 'present')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${mark === 'present' ? 'bg-emerald-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-emerald-50 hover:text-emerald-700'}`}>
                              <AppIcon className="ri-check-line"></AppIcon> Present
                            </button>
                            <button onClick={() => setMark(entry.learnerId, 'absent')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${mark === 'absent' ? 'bg-rose-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-rose-50 hover:text-rose-700'}`}>
                              <AppIcon className="ri-close-line"></AppIcon> Absent
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-foreground-200/60 shrink-0">
                    <button onClick={() => setAttendanceEventId(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">Cancel</button>
                    <button onClick={saveAttendance} disabled={attendanceSaving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                      <AppIcon className="ri-save-line"></AppIcon> {attendanceSaving ? 'Saving…' : 'Save attendance'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}