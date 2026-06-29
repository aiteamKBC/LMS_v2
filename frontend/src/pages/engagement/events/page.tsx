import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  type: 'workshop' | 'social' | 'networking' | 'competition' | 'celebration';
  attendees: number;
  capacity: number;
  status: 'upcoming' | 'ongoing' | 'completed';
  organizer: string;
}

const INITIAL_EVENTS: Event[] = [
  { id: 'ev-01', title: 'Marketing Club Monthly Showcase', description: 'Present your marketing campaigns and get feedback from peers and ambassadors.', date: '13 Jun 2026', time: '13:00 - 15:00', location: 'Teams Virtual', type: 'workshop', attendees: 28, capacity: 35, status: 'upcoming', organizer: 'Rebecca Okonkwo' },
  { id: 'ev-02', title: 'Summer Apprentice Social', description: 'End of year social event for all apprentices. Food, games, and networking.', date: '20 Jun 2026', time: '16:00 - 19:00', location: 'KBC Central London', type: 'social', attendees: 45, capacity: 60, status: 'upcoming', organizer: 'Tom Harrington' },
  { id: 'ev-03', title: 'Leadership Workshop', description: 'Develop leadership skills with guest speaker Dr. Amara Okafor.', date: '15 Jun 2026', time: '10:00 - 12:00', location: 'Teams Virtual', type: 'workshop', attendees: 22, capacity: 30, status: 'upcoming', organizer: 'Sarah Chen' },
  { id: 'ev-04', title: 'Coding Competition', description: 'Monthly coding challenge with prizes for top performers.', date: '10 Jun 2026', time: '09:00 - 17:00', location: 'Online Platform', type: 'competition', attendees: 18, capacity: 25, status: 'ongoing', organizer: 'James Harrington' },
  { id: 'ev-05', title: 'Employer Networking Night', description: 'Connect with employers and explore career opportunities.', date: '25 Jun 2026', time: '18:00 - 20:00', location: 'KBC Manchester Office', type: 'networking', attendees: 30, capacity: 40, status: 'upcoming', organizer: 'Tom Harrington' },
  { id: 'ev-06', title: 'Quarterly Awards Ceremony', description: 'Celebrate top learners and achievements across all programmes.', date: '28 Jun 2026', time: '14:00 - 16:00', location: 'KBC Central London', type: 'celebration', attendees: 50, capacity: 80, status: 'upcoming', organizer: 'Tom Harrington' },
  { id: 'ev-07', title: 'AI in Marketing Deep Dive', description: 'Advanced workshop on AI tools for marketing professionals.', date: '5 Jun 2026', time: '10:00 - 12:00', location: 'Teams Virtual', type: 'workshop', attendees: 24, capacity: 25, status: 'completed', organizer: 'Tom Whitfield' },
  { id: 'ev-08', title: 'Project Controls Masterclass', description: 'Master project management tools and techniques with industry experts.', date: '2 Jun 2026', time: '14:00 - 16:00', location: 'Teams Virtual', type: 'workshop', attendees: 20, capacity: 25, status: 'completed', organizer: 'James Harrington' },
];

const typeConfig: Record<string, { icon: string; bg: string; text: string }> = {
  workshop: { icon: 'ri-presentation-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  social: { icon: 'ri-cake-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  networking: { icon: 'ri-group-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
  competition: { icon: 'ri-trophy-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  celebration: { icon: 'ri-star-line', bg: 'bg-amber-100', text: 'text-amber-700' },
};

interface EventFormData {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  type: 'workshop' | 'social' | 'networking' | 'competition' | 'celebration';
  capacity: number;
  organizer: string;
}

interface FormErrors {
  title?: string;
  description?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  capacity?: string;
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
  capacity: 30,
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
            <button key={t} type="button" onClick={() => setForm(f => ({ ...f, type: t as EventFormData['type'] }))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${form.type === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${typeConfig[t].icon} text-sm`}></i>
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
      {/* Capacity & Organizer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Capacity <span className="text-red-500">*</span></label>
          <input type="number" value={form.capacity} onChange={e => { setForm(f => ({ ...f, capacity: parseInt(e.target.value) || 0 })); setErrors(errs => { const n = { ...errs }; delete n.capacity; return n; }); }} min={5} max={500} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.capacity ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.capacity && <p className="text-[10px] text-red-500 mt-1">{errors.capacity}</p>}
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Organizer <span className="text-red-500">*</span></label>
          <input type="text" value={form.organizer} onChange={e => { setForm(f => ({ ...f, organizer: e.target.value })); setErrors(errs => { const n = { ...errs }; delete n.organizer; return n; }); }} placeholder="e.g. Tom Harrington" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${errors.organizer ? 'border-red-300' : 'border-foreground-200/60'}`} />
          {errors.organizer && <p className="text-[10px] text-red-500 mt-1">{errors.organizer}</p>}
        </div>
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
  if (!form.capacity || form.capacity < 5) errs.capacity = 'Minimum 5 capacity';
  else if (form.capacity > 500) errs.capacity = 'Maximum 500 capacity';
  if (!form.organizer.trim()) errs.organizer = 'Organizer is required';
  return errs;
}

export default function EventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>(INITIAL_EVENTS);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'ongoing' | 'completed'>('all');

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

  function handleAdd() {
    const errs = validateForm(addForm);
    if (Object.keys(errs).length > 0) { setAddErrors(errs); return; }
    const newEvent: Event = {
      id: `ev-${String(events.length + 1).padStart(2, '0')}`,
      title: addForm.title.trim(),
      description: addForm.description.trim(),
      date: new Date(addForm.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      time: `${addForm.startTime} - ${addForm.endTime}`,
      location: addForm.location.trim(),
      type: addForm.type,
      attendees: 0,
      capacity: addForm.capacity,
      status: 'upcoming',
      organizer: addForm.organizer.trim(),
    };
    setEvents(prev => [newEvent, ...prev]);
    setAddSubmitted(true);
    setTimeout(() => { setShowAddModal(false); setAddSubmitted(false); }, 700);
  }

  function openEditModal(event: Event) {
    const [startTime, endTime] = event.time.split(' - ');
    setEditEventId(event.id);
    setEditForm({
      title: event.title,
      description: event.description,
      date: '',
      startTime: startTime || '',
      endTime: endTime || '',
      location: event.location,
      type: event.type,
      capacity: event.capacity,
      organizer: event.organizer,
    });
    setEditErrors({});
    setEditSubmitted(false);
  }

  function handleEdit() {
    if (!editEventId) return;
    const errs = validateForm(editForm);
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    setEvents(prev => prev.map(e => {
      if (e.id !== editEventId) return e;
      return {
        ...e,
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        time: `${editForm.startTime} - ${editForm.endTime}`,
        location: editForm.location.trim(),
        type: editForm.type,
        capacity: editForm.capacity,
        organizer: editForm.organizer.trim(),
      };
    }));
    setEditSubmitted(true);
    setTimeout(() => { setEditEventId(null); setEditSubmitted(false); }, 700);
  }

  function confirmDelete() {
    if (!deleteEventId) return;
    setEvents(prev => prev.filter(e => e.id !== deleteEventId));
    setDeleteEventId(null);
  }

  const eventToDelete = events.find(e => e.id === deleteEventId);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Events" pageSubtitle="Schedule and manage learner events, workshops, and social activities"
      userName="Tom Harrington" userRole="Engagement Manager"
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
            <i className="ri-team-line text-sm"></i> Learner Clubs
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-thumb-up-line text-sm"></i> Recognition
          </button>
          <button onClick={() => navigate('/engagement/communication')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-message-2-line text-sm"></i> Communication
          </button>
        </div>

        {/* Filters & Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'upcoming', 'ongoing', 'completed'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s as 'all' | 'upcoming' | 'ongoing' | 'completed')} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'workshop', 'social', 'networking', 'competition', 'celebration'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1"></div>
          <button onClick={openAddModal} className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-add-line"></i> Add New Event
          </button>
        </div>

        {/* Event Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(event => {
            const cfg = typeConfig[event.type] || { icon: 'ri-calendar-line', bg: 'bg-background-100', text: 'text-foreground-500' };
            const pct = Math.round((event.attendees / event.capacity) * 100);
            return (
              <div key={event.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium hover:border-primary-200/50 transition-smooth">
                <div className="flex items-start gap-3 mb-3">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
                    <i className={`${cfg.icon} text-sm`}></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] font-semibold text-foreground-900">{event.title}</h4>
                    <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{event.type}</span>
                  </div>
                </div>
                <p className="text-[11px] text-foreground-500 mb-3">{event.description}</p>
                <div className="space-y-1 text-[10px] text-foreground-400">
                  <p><i className="ri-calendar-line mr-1 text-primary-500"></i>{event.date}</p>
                  <p><i className="ri-time-line mr-1 text-primary-500"></i>{event.time}</p>
                  <p><i className="ri-map-pin-line mr-1 text-primary-500"></i>{event.location}</p>
                  <p><i className="ri-user-line mr-1 text-primary-500"></i>{event.organizer}</p>
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-foreground-400">{event.attendees} / {event.capacity}</span>
                    <span className={`font-bold ${pct >= 80 ? 'text-red-600' : pct >= 60 ? 'text-amber-600' : 'text-primary-600'}`}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${event.status === 'upcoming' ? 'bg-primary-100 text-primary-700' : event.status === 'ongoing' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>{event.status}</span>
                  <div className="flex-1"></div>
                  <button onClick={() => openEditModal(event)} className="px-2 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-200/50 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-edit-line mr-0.5"></i> Edit
                  </button>
                  <button onClick={() => setDeleteEventId(event.id)} className="px-2 py-1.5 bg-red-50 text-red-600 rounded-lg text-[10px] font-medium hover:bg-red-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-delete-bin-line mr-0.5"></i> Delete
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
                  <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-calendar-event-line text-lg"></i></span>
                  <div>
                    <h3 className="text-base font-heading font-semibold text-foreground-900">Add New Event</h3>
                    <p className="text-[11px] text-foreground-400">Create a new event for learners</p>
                  </div>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
              </div>
              <div className="p-5 overflow-y-auto">
                <EventForm form={addForm} errors={addErrors} setForm={setAddForm} setErrors={setAddErrors} />
              </div>
              <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
                <button onClick={handleAdd} disabled={addSubmitted} className={`px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${addSubmitted ? 'bg-emerald-500 text-white' : 'bg-primary-500 text-white hover:bg-primary-600'}`}>
                  {addSubmitted ? <><i className="ri-check-line"></i> Created!</> : <><i className="ri-add-line"></i> Create Event</>}
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
                  <span className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center"><i className="ri-edit-line text-lg"></i></span>
                  <div>
                    <h3 className="text-base font-heading font-semibold text-foreground-900">Edit Event</h3>
                    <p className="text-[11px] text-foreground-400">Update event details</p>
                  </div>
                </div>
                <button onClick={() => setEditEventId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
              </div>
              <div className="p-5 overflow-y-auto">
                <EventForm form={editForm} errors={editErrors} setForm={setEditForm} setErrors={setEditErrors} />
              </div>
              <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
                <button onClick={() => setEditEventId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
                <button onClick={handleEdit} disabled={editSubmitted} className={`px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${editSubmitted ? 'bg-emerald-500 text-white' : 'bg-accent-500 text-white hover:bg-accent-600'}`}>
                  {editSubmitted ? <><i className="ri-check-line"></i> Saved!</> : <><i className="ri-save-line"></i> Save Changes</>}
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
                  <i className="ri-delete-bin-line text-xl"></i>
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
                  <i className="ri-delete-bin-line"></i> Delete Event
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}