import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

// Clubs are organised by location (city/region). KBC does not provide
// transport, so each club groups the learners who live near each other and
// meets locally. Clubs exist mainly to build community and networking through
// meetings — some are scheduled during the learning period, others are held
// ad-hoc, so meetings are UNSCHEDULED by default with the option to add a date.
interface ClubMeeting {
  id: string;
  title: string;
  scheduled: boolean;   // false by default — no schedule until an ambassador sets one
  date?: string;        // set only once scheduled
  time?: string;
  venue?: string;
  attendees: number;
}

interface Club {
  id: string;
  name: string;
  location: string;
  description: string;
  ambassador: string;
  ambassadorRole: string;
  members: number;          // joined learners — no capacity limit
  sampleMembers: string[];  // initials for the joined-members indicator stack
  active: boolean;
  meetings: ClubMeeting[];
}

const CLUBS: Club[] = [
  {
    id: 'cl-london', name: 'London Club', location: 'London',
    description: 'Where KBC learners across London meet, network, and build community — organised locally so getting together is easy.',
    ambassador: 'Rebecca Okonkwo', ambassadorRole: 'London Ambassador', members: 34,
    sampleMembers: ['SW', 'OP', 'LF', 'MK', 'DC'], active: true,
    meetings: [
      { id: 'm-ldn-1', title: 'Summer networking meetup', scheduled: true, date: '2026-06-18', time: '17:30', venue: 'KBC London Campus', attendees: 22 },
      { id: 'm-ldn-2', title: 'Peer support & study social', scheduled: false, attendees: 0 },
    ],
  },
  {
    id: 'cl-kent', name: 'Kent Club', location: 'Kent',
    description: 'A local community for Kent-based apprentices to connect, share experiences, and support each other through their programmes.',
    ambassador: 'David Thompson', ambassadorRole: 'Kent Ambassador', members: 21,
    sampleMembers: ['AP', 'JO', 'EW'], active: true,
    meetings: [
      { id: 'm-kent-1', title: 'Coffee & connect morning', scheduled: false, attendees: 0 },
      { id: 'm-kent-2', title: 'Careers chat with local employers', scheduled: false, attendees: 0 },
    ],
  },
  {
    id: 'cl-nottingham', name: 'Nottingham Club', location: 'Nottingham',
    description: 'Bringing Nottingham learners together for informal meetups, networking, and getting to know one another beyond the screen.',
    ambassador: 'Priya Patel', ambassadorRole: 'Nottingham Ambassador', members: 17,
    sampleMembers: ['MK', 'OP', 'ZM'], active: true,
    meetings: [
      { id: 'm-nott-1', title: 'Welcome social for new starters', scheduled: true, date: '2026-06-25', time: '18:00', venue: 'City centre — venue TBC', attendees: 9 },
      { id: 'm-nott-2', title: 'Study group & networking', scheduled: false, attendees: 0 },
    ],
  },
  {
    id: 'cl-birmingham', name: 'Birmingham Club', location: 'Birmingham',
    description: 'A hub for Birmingham apprentices to meet peers nearby, network, and build friendships across programmes.',
    ambassador: 'Sarah Chen', ambassadorRole: 'Birmingham Ambassador', members: 26,
    sampleMembers: ['EW', 'DC', 'LF', 'SW'], active: true,
    meetings: [
      { id: 'm-birm-1', title: 'Monthly community meetup', scheduled: false, attendees: 0 },
    ],
  },
  {
    id: 'cl-manchester', name: 'Manchester Club', location: 'Manchester',
    description: 'Manchester-based learners connecting locally for networking, peer support, and community events.',
    ambassador: 'Tom Whitfield', ambassadorRole: 'Manchester Ambassador', members: 19,
    sampleMembers: ['LF', 'SW', 'MK'], active: true,
    meetings: [
      { id: 'm-manc-1', title: 'Networking & pizza evening', scheduled: true, date: '2026-06-20', time: '18:30', venue: 'KBC Manchester Hub', attendees: 14 },
      { id: 'm-manc-2', title: 'Peer mentoring drop-in', scheduled: false, attendees: 0 },
    ],
  },
  {
    id: 'cl-leeds', name: 'Leeds Club', location: 'Leeds',
    description: 'A new local club for Leeds apprentices to get to know each other, network, and grow together.',
    ambassador: 'James Harrington', ambassadorRole: 'Leeds Ambassador', members: 12,
    sampleMembers: ['DC', 'EW'], active: false,
    meetings: [
      { id: 'm-leeds-1', title: 'First meetup — say hello', scheduled: false, attendees: 0 },
    ],
  },
];

function formatMeetingDate(date?: string) {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Human "time remaining until the meeting starts" — used in the email reminder.
function remainingLabel(date?: string, time?: string) {
  if (!date) return 'Not scheduled yet';
  const dt = new Date(`${date}T${time || '00:00'}:00`);
  if (isNaN(dt.getTime())) return '';
  const diff = dt.getTime() - Date.now();
  if (diff <= 0) return 'Already started or passed';
  const mins = Math.floor(diff / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `in ${days} day${days > 1 ? 's' : ''}${hours ? ` ${hours}h` : ''}`;
  if (hours > 0) return `in ${hours}h${rem ? ` ${rem}m` : ''}`;
  return `in ${rem} minute${rem === 1 ? '' : 's'}`;
}

export default function EngagementClubsPage() {
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<Club[]>(CLUBS);
  const [customLocations, setCustomLocations] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(true);

  // Ambassadors can create new meetings on a club (each club makes its own).
  // Meetings live inside their club (single source of truth) and start
  // UNSCHEDULED — a date can be added later via the meeting manager.
  const [addingClubId, setAddingClubId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  // Per-meeting manager modal — edit details, schedule, delete, or email students.
  const [meetingCtx, setMeetingCtx] = useState<{ clubId: string; meetingId: string } | null>(null);
  const [meetingForm, setMeetingForm] = useState({ title: '', date: '', time: '', venue: '' });
  const [emailMsg, setEmailMsg] = useState('');

  // Lightweight confirmation toast.
  const [toast, setToast] = useState<string | null>(null);

  // Add a new location/city to the filter (works even before a club exists there).
  const [addingLocation, setAddingLocation] = useState(false);
  const [draftLocation, setDraftLocation] = useState('');

  // Create a new club.
  const emptyClubForm = { name: '', location: '', description: '', ambassador: '', ambassadorRole: '' };
  const [creatingClub, setCreatingClub] = useState(false);
  const [clubForm, setClubForm] = useState(emptyClubForm);

  // Manage (edit / activate / delete) an existing club.
  const [managingClubId, setManagingClubId] = useState<string | null>(null);
  const [manageForm, setManageForm] = useState({ description: '', ambassador: '', ambassadorRole: '' });

  const locations = ['all', ...Array.from(new Set([...clubs.map(c => c.location), ...customLocations]))];

  const filtered = clubs.filter(c => {
    const matchLoc = locationFilter === 'all' || c.location === locationFilter;
    const matchActive = !activeOnly || c.active;
    return matchLoc && matchActive;
  });

  const totalMembers = clubs.reduce((s, c) => s + c.members, 0);
  const liveMeetings = clubs.flatMap(c => c.meetings);
  const scheduledCount = liveMeetings.filter(m => m.scheduled).length;
  const unscheduledCount = liveMeetings.length - scheduledCount;

  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 3500); };

  const addMeeting = (clubId: string) => {
    const title = draftTitle.trim();
    if (!title) return;
    const newMeeting: ClubMeeting = { id: `m-${clubId}-${Date.now()}`, title, scheduled: false, attendees: 0 };
    setClubs(prev => prev.map(c => (c.id === clubId ? { ...c, meetings: [...c.meetings, newMeeting] } : c)));
    setDraftTitle('');
    setAddingClubId(null);
  };

  const openMeeting = (club: Club, m: ClubMeeting) => {
    setMeetingCtx({ clubId: club.id, meetingId: m.id });
    setMeetingForm({ title: m.title, date: m.date ?? '', time: m.time ?? '', venue: m.venue ?? '' });
    setEmailMsg(`Hi everyone,\n\nA quick reminder about our upcoming "${m.title}" meetup for ${club.name}. Hope to see you there!\n\n${club.ambassador}`);
  };
  const saveMeeting = () => {
    if (!meetingCtx) return;
    const title = meetingForm.title.trim() || 'Untitled meeting';
    const scheduled = !!meetingForm.date;
    setClubs(prev => prev.map(c => c.id === meetingCtx.clubId
      ? { ...c, meetings: c.meetings.map(m => m.id === meetingCtx.meetingId
          ? { ...m, title, scheduled, date: meetingForm.date || undefined, time: meetingForm.time || undefined, venue: meetingForm.venue.trim() || undefined }
          : m) }
      : c));
    setMeetingCtx(null);
    showToast('Meeting saved');
  };
  const deleteMeeting = () => {
    if (!meetingCtx) return;
    setClubs(prev => prev.map(c => c.id === meetingCtx.clubId
      ? { ...c, meetings: c.meetings.filter(m => m.id !== meetingCtx.meetingId) }
      : c));
    setMeetingCtx(null);
    showToast('Meeting deleted');
  };
  const sendMeetingEmail = (recipients: number, clubName: string) => {
    setMeetingCtx(null);
    showToast(`Reminder emailed to ${recipients} learner${recipients === 1 ? '' : 's'} in ${clubName}`);
  };

  const addLocation = () => {
    const loc = draftLocation.trim();
    if (!loc) return;
    if (!locations.includes(loc)) setCustomLocations(prev => [...prev, loc]);
    setLocationFilter(loc);
    setDraftLocation('');
    setAddingLocation(false);
  };

  const createClub = () => {
    const name = clubForm.name.trim();
    const location = clubForm.location.trim();
    if (!name || !location) return;
    const slug = location.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const newClub: Club = {
      id: `cl-${slug}-${Date.now()}`,
      name,
      location,
      description: clubForm.description.trim() || `A local community for ${location} learners to meet, network, and connect.`,
      ambassador: clubForm.ambassador.trim() || 'Unassigned',
      ambassadorRole: clubForm.ambassadorRole.trim() || `${location} Ambassador`,
      members: 0,
      sampleMembers: [],
      active: true,
      meetings: [],
    };
    setClubs(prev => [...prev, newClub]);
    setLocationFilter(location);
    setClubForm(emptyClubForm);
    setCreatingClub(false);
  };

  const openManage = (club: Club) => {
    setManagingClubId(club.id);
    setManageForm({ description: club.description, ambassador: club.ambassador, ambassadorRole: club.ambassadorRole });
  };
  const saveManage = () => {
    if (!managingClubId) return;
    setClubs(prev => prev.map(c => (c.id === managingClubId ? { ...c, ...manageForm } : c)));
    setManagingClubId(null);
  };
  const toggleActive = (clubId: string) => {
    setClubs(prev => prev.map(c => (c.id === clubId ? { ...c, active: !c.active } : c)));
  };
  const deleteClub = (clubId: string) => {
    setClubs(prev => prev.filter(c => c.id !== clubId));
    setManagingClubId(null);
  };

  const managingClub = clubs.find(c => c.id === managingClubId) ?? null;
  const managingMeeting = (() => {
    if (!meetingCtx) return null;
    const club = clubs.find(c => c.id === meetingCtx.clubId);
    const meeting = club?.meetings.find(m => m.id === meetingCtx.meetingId);
    return club && meeting ? { club, meeting } : null;
  })();

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Learner Clubs" pageSubtitle="Local community clubs that bring nearby learners together to meet, network, and connect"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Learner Clubs"
          description={`${CLUBS.length} location-based clubs. ${totalMembers} learners joined. ${scheduledCount} meetings scheduled, ${unscheduledCount} awaiting a date. Clubs are grouped by where learners live so meeting up locally is easy — no travel required.`}
          icon="ri-team-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20learner%20clubs%20group%20collaboration%20teamwork%20warm%20modern%20office%20professional&width=400&height=160&seq=clubs-01&orientation=landscape"
          imageAlt="Learner Clubs"
          stats={[{ label: 'Clubs', value: String(CLUBS.length) }, { label: 'Members', value: String(totalMembers) }, { label: 'Scheduled', value: String(scheduledCount) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/events')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-calendar-event-line text-sm"></i> Events
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-thumb-up-line text-sm"></i> Recognition
          </button>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-gift-2-line text-sm"></i> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Location filter + create actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {locations.map(loc => (
              <button key={loc} onClick={() => setLocationFilter(loc)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${locationFilter === loc ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {loc === 'all' ? 'All locations' : loc}
              </button>
            ))}
          </div>

          {/* Add a new location/city to the filter */}
          {addingLocation ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draftLocation}
                onChange={e => setDraftLocation(e.target.value)}
                placeholder="City or region"
                maxLength={40}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addLocation(); if (e.key === 'Escape') { setAddingLocation(false); setDraftLocation(''); } }}
                className="px-2.5 py-1.5 rounded-lg border border-foreground-200/60 bg-background-50 text-[11px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40"
              />
              <button onClick={addLocation} disabled={!draftLocation.trim()} className="px-2.5 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Add</button>
              <button onClick={() => { setAddingLocation(false); setDraftLocation(''); }} className="px-2 py-1.5 text-[11px] font-semibold text-foreground-500 hover:text-foreground-700 cursor-pointer">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setAddingLocation(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-dashed border-foreground-300/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-300/60 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-map-pin-line text-sm"></i> Add location
            </button>
          )}

          <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
            Active only
          </label>

          <button onClick={() => { setClubForm(emptyClubForm); setCreatingClub(true); }} className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shadow-sm">
            <i className="ri-add-line text-sm"></i> Create club
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(club => (
            <div key={club.id} className={`rounded-xl border p-4 card-premium transition-smooth flex flex-col ${club.active ? 'bg-background-50 border-foreground-200/60 hover:border-primary-200/50' : 'bg-background-100/70 border-foreground-200/50 grayscale opacity-70'}`}>
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                  <i className="ri-map-pin-2-line text-sm"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] font-semibold text-foreground-900">{club.name}</h4>
                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">
                    <i className="ri-map-pin-line"></i> {club.location}
                  </span>
                </div>
                {!club.active && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-background-200 text-foreground-500">Inactive</span>}
              </div>

              <p className="text-[11px] text-foreground-500 mb-3">{club.description}</p>

              <div className="text-[10px] text-foreground-400 mb-3">
                <p><i className="ri-shield-star-line mr-1 text-secondary-500"></i>Ambassador: {club.ambassador} ({club.ambassadorRole})</p>
              </div>

              {/* Joined members indicator — no capacity limit */}
              <div className="flex items-center justify-between mb-3 p-2 rounded-lg bg-background-100/60">
                <div className="flex items-center">
                  <div className="flex -space-x-2">
                    {club.sampleMembers.slice(0, 4).map((initials, i) => (
                      <span key={i} className="w-6 h-6 rounded-full bg-secondary-100 text-secondary-700 border-2 border-background-50 flex items-center justify-center text-[8px] font-bold">{initials}</span>
                    ))}
                  </div>
                  {club.members > 4 && <span className="ml-1 text-[10px] font-semibold text-foreground-500">+{club.members - 4}</span>}
                </div>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-primary-600">
                  <i className="ri-group-line"></i> {club.members} joined
                </span>
              </div>

              {/* Meetings — scheduled or awaiting a date */}
              <div className="space-y-2 mb-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-foreground-500 uppercase tracking-wide">Meetings</p>
                  <button onClick={() => { setAddingClubId(addingClubId === club.id ? null : club.id); setDraftTitle(''); }} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold text-primary-600 hover:bg-primary-50 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-add-line"></i> Add meeting
                  </button>
                </div>

                {/* Inline new-meeting form — created unscheduled by default */}
                {addingClubId === club.id && (
                  <div className="rounded-lg border border-primary-200/60 bg-primary-50/40 p-2.5 flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={e => setDraftTitle(e.target.value)}
                      placeholder="Meeting name (e.g. Coffee & connect)"
                      maxLength={80}
                      onKeyDown={e => { if (e.key === 'Enter') addMeeting(club.id); }}
                      className="flex-1 min-w-[140px] px-2 py-1 rounded-md border border-foreground-200/60 bg-background-50 text-[10px] text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40"
                    />
                    <button onClick={() => addMeeting(club.id)} disabled={!draftTitle.trim()} className="px-2.5 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Add</button>
                    <button onClick={() => { setAddingClubId(null); setDraftTitle(''); }} className="px-2 py-1 text-[10px] font-semibold text-foreground-500 hover:text-foreground-700 cursor-pointer">Cancel</button>
                  </div>
                )}

                {club.meetings.length === 0 && (
                  <p className="text-[10px] text-foreground-400 italic">No meetings yet — add one to get started.</p>
                )}
                {club.meetings.map(m => (
                  <div key={m.id} className="rounded-lg border border-foreground-200/50 p-2.5">
                    <div className="flex items-start gap-2">
                      <i className={`${m.scheduled ? 'ri-calendar-check-line text-primary-500' : 'ri-calendar-todo-line text-foreground-400'} text-sm mt-0.5`}></i>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-foreground-800">{m.title}</p>
                        {m.scheduled ? (
                          <p className="text-[10px] text-foreground-500">
                            {formatMeetingDate(m.date)}{m.time ? ` · ${m.time}` : ''}{m.venue ? ` · ${m.venue}` : ''}
                          </p>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 mt-0.5">
                            <i className="ri-time-line"></i> Not scheduled
                          </span>
                        )}
                      </div>
                      <button onClick={() => openMeeting(club, m)} className="shrink-0 px-2 py-1 rounded-md text-[9px] font-semibold text-primary-600 hover:bg-primary-50 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-edit-line mr-0.5"></i> Manage
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-foreground-200/40">
                <div className="flex-1"></div>
                <button onClick={() => openManage(club)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-edit-line mr-1"></i> Manage
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Create club modal */}
        {creatingClub && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { setCreatingClub(false); setClubForm(emptyClubForm); }}>
            <div className="bg-background-50 rounded-2xl max-w-md w-full shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-foreground-200/60">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-add-circle-line"></i></span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Create a club</h3>
                    <p className="text-[11px] text-foreground-400">Start a new location-based community club</p>
                  </div>
                </div>
                <button onClick={() => { setCreatingClub(false); setClubForm(emptyClubForm); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
              </div>

              <div className="px-5 py-4 space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-foreground-600">Club name <span className="text-rose-500">*</span></label>
                  <input value={clubForm.name} onChange={e => setClubForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Bristol Club" className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-foreground-600">Location / city <span className="text-rose-500">*</span></label>
                  <input list="club-locations" value={clubForm.location} onChange={e => setClubForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Bristol" className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                  <datalist id="club-locations">
                    {locations.filter(l => l !== 'all').map(l => <option key={l} value={l} />)}
                  </datalist>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Pick an existing location or type a new one — it's added to the filter automatically.</p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-foreground-600">Description</label>
                  <textarea value={clubForm.description} onChange={e => setClubForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="What is this club about?" className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-foreground-600">Ambassador</label>
                    <input value={clubForm.ambassador} onChange={e => setClubForm(f => ({ ...f, ambassador: e.target.value }))} placeholder="Name" className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-foreground-600">Ambassador role</label>
                    <input value={clubForm.ambassadorRole} onChange={e => setClubForm(f => ({ ...f, ambassadorRole: e.target.value }))} placeholder="e.g. Bristol Ambassador" className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-foreground-200/60">
                <button onClick={() => { setCreatingClub(false); setClubForm(emptyClubForm); }} className="px-4 py-2 rounded-lg text-xs font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">Cancel</button>
                <button onClick={createClub} disabled={!clubForm.name.trim() || !clubForm.location.trim()} className="px-4 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"><i className="ri-add-line mr-1"></i>Create club</button>
              </div>
            </div>
          </div>
        )}

        {/* Manage club modal */}
        {managingClub && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setManagingClubId(null)}>
            <div className="bg-background-50 rounded-2xl max-w-md w-full shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-foreground-200/60">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-settings-3-line"></i></span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Manage {managingClub.name}</h3>
                    <p className="text-[11px] text-foreground-400"><i className="ri-map-pin-line mr-0.5"></i>{managingClub.location} · {managingClub.members} joined</p>
                  </div>
                </div>
                <button onClick={() => setManagingClubId(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
              </div>

              <div className="px-5 py-4 space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-foreground-600">Description</label>
                  <textarea value={manageForm.description} onChange={e => setManageForm(f => ({ ...f, description: e.target.value }))} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-foreground-600">Ambassador</label>
                    <input value={manageForm.ambassador} onChange={e => setManageForm(f => ({ ...f, ambassador: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-foreground-600">Ambassador role</label>
                    <input value={manageForm.ambassadorRole} onChange={e => setManageForm(f => ({ ...f, ambassadorRole: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-background-100/60">
                  <div>
                    <p className="text-[12px] font-semibold text-foreground-700">Club status</p>
                    <p className="text-[10px] text-foreground-400">{managingClub.active ? 'Active and visible to learners' : 'Inactive — hidden when "Active only" is on'}</p>
                  </div>
                  <button onClick={() => toggleActive(managingClub.id)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-smooth ${managingClub.active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    {managingClub.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-foreground-200/60">
                <button onClick={() => deleteClub(managingClub.id)} className="px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-smooth cursor-pointer"><i className="ri-delete-bin-line mr-1"></i>Delete</button>
                <div className="flex items-center gap-2">
                  <button onClick={() => setManagingClubId(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">Cancel</button>
                  <button onClick={saveManage} className="px-4 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer"><i className="ri-save-line mr-1"></i>Save changes</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Meeting manager modal — edit details, schedule, delete, email students */}
        {managingMeeting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setMeetingCtx(null)}>
            <div className="bg-background-50 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 rounded-t-2xl flex items-center justify-between px-5 py-4 border-b border-foreground-200/60 z-10">
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-calendar-event-line"></i></span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Manage meeting</h3>
                    <p className="text-[11px] text-foreground-400"><i className="ri-map-pin-line mr-0.5"></i>{managingMeeting.club.name} · {managingMeeting.club.location}</p>
                  </div>
                </div>
                <button onClick={() => setMeetingCtx(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"><i className="ri-close-line"></i></button>
              </div>

              {/* Details / scheduling form */}
              <div className="px-5 py-4 space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-foreground-600">Meeting name</label>
                  <input value={meetingForm.title} onChange={e => setMeetingForm(f => ({ ...f, title: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-foreground-600">Date</label>
                    <input type="date" value={meetingForm.date} onChange={e => setMeetingForm(f => ({ ...f, date: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-700 focus:outline-none focus:ring-1 focus:ring-primary-400/40 cursor-pointer" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-foreground-600">Time</label>
                    <input type="time" value={meetingForm.time} onChange={e => setMeetingForm(f => ({ ...f, time: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-700 focus:outline-none focus:ring-1 focus:ring-primary-400/40 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-foreground-600">Place / venue</label>
                  <input value={meetingForm.venue} onChange={e => setMeetingForm(f => ({ ...f, venue: e.target.value }))} placeholder="e.g. KBC London Campus" className="mt-1 w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                </div>
                <p className="text-[10px] text-foreground-400">
                  {meetingForm.date
                    ? <><i className="ri-time-line mr-0.5"></i>Starts {remainingLabel(meetingForm.date, meetingForm.time)}</>
                    : <><i className="ri-information-line mr-0.5"></i>Leave the date empty to keep this meeting unscheduled.</>}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={saveMeeting} className="px-4 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer"><i className="ri-save-line mr-1"></i>Save meeting</button>
                  <button onClick={deleteMeeting} className="px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-smooth cursor-pointer"><i className="ri-delete-bin-line mr-1"></i>Delete meeting</button>
                </div>
              </div>

              {/* Email students */}
              <div className="px-5 py-4 border-t border-foreground-200/60 space-y-2">
                <div className="flex items-center gap-2">
                  <i className="ri-mail-send-line text-primary-500"></i>
                  <p className="text-[12px] font-semibold text-foreground-700">Email students a reminder</p>
                </div>
                <div className="rounded-lg bg-background-100/60 p-2.5 text-[10px] text-foreground-500 space-y-0.5">
                  <p><i className="ri-group-line mr-1"></i>To: {managingMeeting.club.members} joined learner{managingMeeting.club.members === 1 ? '' : 's'}</p>
                  <p><i className="ri-time-line mr-1"></i>When: {meetingForm.date ? `${formatMeetingDate(meetingForm.date)}${meetingForm.time ? ` · ${meetingForm.time}` : ''} (${remainingLabel(meetingForm.date, meetingForm.time)})` : 'Not scheduled yet'}</p>
                  <p><i className="ri-map-pin-line mr-1"></i>Place: {meetingForm.venue.trim() || 'To be confirmed'}</p>
                </div>
                <textarea value={emailMsg} onChange={e => setEmailMsg(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-lg border border-foreground-200/60 bg-background-50 text-sm text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40 resize-none" />
                <p className="text-[10px] text-foreground-400">The meeting's remaining time and place are included automatically.</p>
                <button
                  onClick={() => sendMeetingEmail(managingMeeting.club.members, managingMeeting.club.name)}
                  disabled={!emailMsg.trim()}
                  className="w-full px-4 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <i className="ri-mail-send-line mr-1"></i> Send reminder now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 bg-foreground-900 text-white px-4 py-2.5 rounded-xl shadow-lg animate-in slide-in-from-bottom-4 duration-300">
            <i className="ri-checkbox-circle-line text-emerald-400"></i>
            <span className="text-[12px] font-medium">{toast}</span>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
