import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import {
  EVENTS,
  CLUBS,
  getEventDetailData,
  getAverageRating,
  getFeedbackByEventId,
  type AgendaItem,
} from '@/pages/learner/clubs/data';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

type DetailTab = 'overview' | 'agenda' | 'speakers' | 'attendees';

const agendaTypeConfig: Record<AgendaItem['type'], { icon: string; color: string; bg: string }> = {
  opening: { icon: 'ri-flag-line', color: 'text-primary-600', bg: 'bg-primary-100' },
  talk: { icon: 'ri-presentation-line', color: 'text-accent-600', bg: 'bg-accent-100' },
  workshop: { icon: 'ri-tools-line', color: 'text-secondary-600', bg: 'bg-secondary-100' },
  break: { icon: 'ri-cup-line', color: 'text-foreground-400', bg: 'bg-background-100' },
  qa: { icon: 'ri-question-answer-line', color: 'text-emerald-600', bg: 'bg-emerald-100' },
  networking: { icon: 'ri-user-heart-line', color: 'text-amber-600', bg: 'bg-amber-100' },
  close: { icon: 'ri-logout-box-r-line', color: 'text-foreground-400', bg: 'bg-background-100' },
};

// Reminder options
const REMINDER_OPTIONS = [
  { value: 15, label: '15 minutes before', icon: 'ri-time-line' },
  { value: 60, label: '1 hour before', icon: 'ri-alarm-line' },
  { value: 1440, label: '1 day before', icon: 'ri-calendar-check-line' },
];

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const event = EVENTS.find((e) => e.id === eventId);
  const detail = eventId ? getEventDetailData(eventId) : null;
  const club = event ? CLUBS.find((c) => c.id === event.clubId) : null;

  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [selectedReminders, setSelectedReminders] = useState<Set<number>>(new Set([60]));
  const [reminderSaved, setReminderSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const toggleReminder = (minutes: number) => {
    setSelectedReminders((prev) => {
      const next = new Set(prev);
      if (next.has(minutes)) next.delete(minutes);
      else next.add(minutes);
      return next;
    });
    setReminderSaved(false);
  };

  const saveReminders = () => {
    setReminderSaved(true);
    const labels = REMINDER_OPTIONS.filter((o) => selectedReminders.has(o.value)).map((o) => o.label);
    const msg = labels.length > 0 ? `Reminders set: ${labels.join(', ')}` : 'All reminders cleared';
    showToast(msg);
    setTimeout(() => setNotificationPanelOpen(false), 800);
  };

  if (!event) {
    return (
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Event Not Found" pageSubtitle=""
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-8 text-center">
          <p className="text-foreground-400 text-sm">Event not found.</p>
          <button onClick={() => navigate('/learner/clubs/events')} className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap">
            Back to Events
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const avgRating = getAverageRating(event.id);
  const feedbacks = getFeedbackByEventId(event.id);
  const effectiveRsvp = event.rsvpCount;
  const isFull = effectiveRsvp >= event.capacity;
  const spotsLeft = event.capacity - effectiveRsvp;
  const fillPercent = Math.min(100, (effectiveRsvp / event.capacity) * 100);

  const tabs: { key: DetailTab; label: string; icon: string; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: 'ri-information-line' },
    { key: 'agenda', label: 'Agenda', icon: 'ri-list-ordered', count: detail?.agenda.length },
    { key: 'speakers', label: 'Speakers', icon: 'ri-mic-line', count: detail?.speakers.length },
    { key: 'attendees', label: 'Attendees', icon: 'ri-team-line', count: detail?.attendees.length ?? event.rsvpCount },
  ];

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Event Details" pageSubtitle="Full event information, agenda and speakers"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      {/* Toast */}
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-primary-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
            <i className="ri-bell-line"></i>
          </span>
          <p className="text-sm font-semibold text-foreground-900">{toast}</p>
        </div>
      )}

      {/* Notification Settings Panel (Slide-over) */}
      {notificationPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={() => setNotificationPanelOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-background-50 w-full max-w-sm h-full shadow-2xl flex flex-col animate-in slide-in-from-right-4 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel Header */}
            <div className="p-5 border-b border-background-200/50">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-heading font-bold text-foreground-900 flex items-center gap-2">
                  <i className="ri-notification-3-line text-primary-500"></i>
                  Reminder Settings
                </h3>
                <button
                  onClick={() => setNotificationPanelOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"
                >
                  <i className="ri-close-line"></i>
                </button>
              </div>
              <p className="text-xs text-foreground-400">Set when you want to be reminded about this event</p>
            </div>

            {/* Event Preview */}
            <div className="p-4 bg-primary-50/50 border-b border-primary-200/30">
              <p className="text-xs font-bold text-foreground-900 line-clamp-1">{event.title}</p>
              <p className="text-xs text-foreground-500 mt-0.5">
                <i className="ri-calendar-line mr-1"></i>{event.date} at {event.time}
              </p>
            </div>

            {/* Reminder Options */}
            <div className="flex-1 p-5 space-y-3 overflow-y-auto">
              <p className="text-xs font-semibold text-foreground-500 uppercase tracking-wide">Remind me</p>
              {REMINDER_OPTIONS.map((opt) => {
                const isActive = selectedReminders.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleReminder(opt.value)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-smooth cursor-pointer text-left ${
                      isActive
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-background-200 bg-background-50 text-foreground-600 hover:border-background-300 hover:bg-background-100'
                    }`}
                  >
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-400'}`}>
                      <i className={`${opt.icon} text-sm`}></i>
                    </span>
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {isActive && (
                      <span className="ml-auto w-5 h-5 rounded-full bg-primary-500 text-white flex items-center justify-center shrink-0">
                        <i className="ri-check-line text-xs"></i>
                      </span>
                    )}
                  </button>
                );
              })}

              <div className="mt-4 p-3 bg-accent-50 rounded-xl border border-accent-200/50">
                <p className="text-xs text-accent-700 flex items-start gap-2">
                  <i className="ri-information-line mt-0.5 shrink-0"></i>
                  <span>Reminders are sent to your notification centre and email. You can set multiple reminders for this event.</span>
                </p>
              </div>
            </div>

            {/* Panel Footer */}
            <div className="p-4 border-t border-background-200/50">
              {selectedReminders.size === 0 && (
                <p className="text-xs text-center text-amber-600 mb-3 font-medium">No reminders selected — you will not be notified</p>
              )}
              <button
                onClick={saveReminders}
                className={`w-full py-3 rounded-xl text-sm font-bold transition-smooth cursor-pointer whitespace-nowrap ${
                  reminderSaved
                    ? 'bg-emerald-500 text-white'
                    : 'bg-primary-500 text-white hover:bg-primary-600'
                }`}
              >
                {reminderSaved ? (
                  <><i className="ri-check-double-line mr-2"></i>Saved!</>
                ) : (
                  <><i className="ri-save-line mr-2"></i>Save Reminders</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Back */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/learner/clubs/events')}
            className="flex items-center gap-1.5 text-xs text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-s-line"></i> Back to Events
          </button>
          <span className="text-foreground-200">/</span>
          <span className="text-xs text-foreground-500 truncate">{event.title}</span>
        </div>

        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden">
          {event.image ? (
            <div className="w-full h-[300px] relative">
              <img src={event.image} alt={event.title} className="w-full h-full object-cover object-top" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
            </div>
          ) : (
            <div className="w-full h-[200px] bg-gradient-to-br from-primary-100 to-accent-100" />
          )}
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">{event.type}</span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">{event.format}</span>
              {event.joined && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/80 text-white backdrop-blur-sm">
                  <i className="ri-check-line mr-1"></i>Attending
                </span>
              )}
            </div>
            <h1 className="text-2xl font-heading font-bold text-white leading-tight">{event.title}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-sm text-white/80 flex items-center gap-1">
                <i className="ri-calendar-line text-xs"></i>{event.date}
              </span>
              <span className="text-white/40">·</span>
              <span className="text-sm text-white/80 flex items-center gap-1">
                <i className="ri-time-line text-xs"></i>{event.time}
              </span>
              <span className="text-white/40">·</span>
              <span className="text-sm text-white/80 flex items-center gap-1">
                <i className="ri-map-pin-line text-xs"></i>{event.location}
              </span>
              {club && (
                <>
                  <span className="text-white/40">·</span>
                  <Link to={`/learner/clubs/${club.id}`} className="text-sm text-accent-300 hover:text-accent-200 font-medium transition-smooth">
                    {club.title}
                  </Link>
                </>
              )}
            </div>
          </div>
          {/* Overlay actions */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={() => setNotificationPanelOpen(true)}
              className="px-3 py-2 bg-white/20 backdrop-blur-sm text-white rounded-lg text-xs font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            >
              <i className="ri-bell-line"></i>
              Set Reminder
              {selectedReminders.size > 0 && (
                <span className="w-4 h-4 rounded-full bg-primary-500 text-white text-[9px] font-bold flex items-center justify-center">{selectedReminders.size}</span>
              )}
            </button>
          </div>
        </div>

        {/* Key Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-accent-600">+{event.points}</p>
            <p className="text-xs text-foreground-400 mt-0.5">Points Earned</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 text-center">
            <p className="text-2xl font-heading font-bold text-foreground-700">{event.rsvpCount}</p>
            <p className="text-xs text-foreground-400 mt-0.5">Registered</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 text-center">
            <p className={`text-2xl font-heading font-bold ${isFull ? 'text-rose-600' : 'text-emerald-600'}`}>
              {isFull ? 'Full' : spotsLeft}
            </p>
            <p className="text-xs text-foreground-400 mt-0.5">{isFull ? 'Event Full' : 'Spots Left'}</p>
          </div>
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 text-center">
            {avgRating > 0 ? (
              <>
                <div className="flex items-center justify-center gap-0.5">
                  {[1,2,3,4,5].map((s) => (
                    <i key={s} className={`text-sm ${s <= Math.round(avgRating) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></i>
                  ))}
                </div>
                <p className="text-xs text-foreground-400 mt-0.5">{avgRating} avg ({feedbacks.length} reviews)</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-heading font-bold text-foreground-300">—</p>
                <p className="text-xs text-foreground-400 mt-0.5">No reviews yet</p>
              </>
            )}
          </div>
        </div>

        {/* Capacity Bar */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground-600">Capacity</span>
            <span className={`text-xs font-bold ${isFull ? 'text-rose-600' : spotsLeft <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {effectiveRsvp}/{event.capacity} registered
              {event.waitlist.length > 0 && ` · ${event.waitlist.length} on waitlist`}
            </span>
          </div>
          <div className="h-2 bg-background-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isFull ? 'bg-rose-400' : spotsLeft <= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${fillPercent}%` }}
            />
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap items-center gap-3">
          {event.joined ? (
            <span className="px-5 py-2.5 bg-emerald-100 text-emerald-700 rounded-xl text-sm font-bold whitespace-nowrap">
              <i className="ri-check-line mr-1.5"></i>You are attending
            </span>
          ) : isFull ? (
            <span className="px-5 py-2.5 bg-rose-100 text-rose-600 rounded-xl text-sm font-bold whitespace-nowrap cursor-not-allowed">
              <i className="ri-lock-line mr-1.5"></i>Event Full
            </span>
          ) : (
            <button
              onClick={() => showToast('RSVP submitted! Redirecting to events page...')}
              className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line mr-1.5"></i>RSVP Now
            </button>
          )}
          <button
            onClick={() => setNotificationPanelOpen(true)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              selectedReminders.size > 0
                ? 'bg-primary-100 text-primary-700 border border-primary-200'
                : 'bg-background-100 text-foreground-600 hover:bg-background-200 border border-background-200'
            }`}
          >
            <i className="ri-bell-line"></i>
            {selectedReminders.size > 0 ? `${selectedReminders.size} Reminder${selectedReminders.size > 1 ? 's' : ''} Set` : 'Set Reminder'}
          </button>
          <Link
            to="/learner/clubs/events/schedule"
            className="px-4 py-2.5 bg-background-100 text-foreground-600 hover:bg-background-200 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5 border border-background-200"
          >
            <i className="ri-calendar-todo-line"></i> My Schedule
          </Link>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-background-50 text-foreground-900 shadow-sm'
                  : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
              {tab.count !== undefined && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full leading-none ${activeTab === tab.key ? 'bg-primary-100 text-primary-600' : 'bg-background-200 text-foreground-500'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              {/* Description */}
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                <h3 className="text-sm font-heading font-bold text-foreground-900 mb-3">About This Event</h3>
                <p className="text-sm text-foreground-600 leading-relaxed">{event.description}</p>
              </div>

              {/* Learning Outcomes */}
              {detail?.outcomes && detail.outcomes.length > 0 && (
                <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                  <h3 className="text-sm font-heading font-bold text-foreground-900 mb-3 flex items-center gap-2">
                    <i className="ri-trophy-line text-accent-500"></i>
                    What You Will Learn
                  </h3>
                  <ul className="space-y-2">
                    {detail.outcomes.map((outcome, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground-700">
                        <span className="w-5 h-5 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">{i + 1}</span>
                        {outcome}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Prerequisites */}
              {detail?.prerequisites && detail.prerequisites.length > 0 && (
                <div className="bg-amber-50 rounded-xl border border-amber-200/50 p-4">
                  <h3 className="text-sm font-heading font-semibold text-amber-800 mb-2 flex items-center gap-2">
                    <i className="ri-information-line"></i>Prerequisites
                  </h3>
                  <ul className="space-y-1">
                    {detail.prerequisites.map((pre, i) => (
                      <li key={i} className="text-sm text-amber-700 flex items-center gap-2">
                        <i className="ri-arrow-right-s-line text-xs"></i>{pre}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tags */}
              {detail?.tags && detail.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {detail.tags.map((tag) => (
                    <span key={tag} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-background-100 text-foreground-500 border border-background-200">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Reviews */}
              {feedbacks.length > 0 && (
                <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                  <h3 className="text-sm font-heading font-bold text-foreground-900 mb-3 flex items-center gap-2">
                    <i className="ri-star-fill text-amber-400"></i>
                    Attendee Reviews
                    <span className="text-xs text-foreground-400">({feedbacks.length})</span>
                  </h3>
                  <div className="space-y-3">
                    {feedbacks.slice(0, 3).map((fb) => (
                      <div key={fb.id} className="bg-background-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-foreground-800">{fb.submittedBy}</span>
                          <div className="flex items-center gap-1">
                            {[1,2,3,4,5].map((s) => (
                              <i key={s} className={`text-[10px] ${s <= fb.rating ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></i>
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-foreground-500 leading-relaxed">{fb.comment}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              {/* Host Bio */}
              {(detail?.hostBio) && (
                <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
                  <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Hosted by</h3>
                  <div className="flex items-start gap-3 mb-3">
                    {detail.hostBio.avatarImg ? (
                      <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-background-200">
                        <img src={detail.hostBio.avatarImg} alt={detail.hostBio.name} className="w-full h-full object-cover object-top" />
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-sm font-bold">
                        {detail.hostBio.avatar}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground-900">{detail.hostBio.name}</p>
                      <p className="text-xs text-foreground-500">{detail.hostBio.role}</p>
                      <p className="text-xs text-foreground-400">{detail.hostBio.company}</p>
                    </div>
                  </div>
                  <p className="text-xs text-foreground-600 leading-relaxed mb-3">{detail.hostBio.bio}</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {detail.hostBio.expertise.map((ex) => (
                      <span key={ex} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 border border-primary-200/50">{ex}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 pt-3 border-t border-background-200/50">
                    <div className="text-center">
                      <p className="text-base font-bold text-foreground-800">{detail.hostBio.sessionsHosted}</p>
                      <p className="text-[10px] text-foreground-400">Sessions hosted</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <i className="ri-star-fill text-amber-400 text-sm"></i>
                        <span className="text-base font-bold text-foreground-800">{detail.hostBio.avgRating}</span>
                      </div>
                      <p className="text-[10px] text-foreground-400">Avg rating</p>
                    </div>
                    {detail.hostBio.linkedin && (
                      <div className="ml-auto">
                        <a
                          href={`https://${detail.hostBio.linkedin}`}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="text-xs text-primary-500 hover:text-primary-700 flex items-center gap-1 font-medium transition-smooth"
                        >
                          <i className="ri-linkedin-box-line text-base"></i> LinkedIn
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Event Details Card */}
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 space-y-3">
                <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide">Event Info</h3>
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
                    <i className="ri-calendar-line text-foreground-400 text-sm"></i>
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-foreground-800">{event.date}</p>
                    <p className="text-xs text-foreground-400">{event.dayName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
                    <i className="ri-time-line text-foreground-400 text-sm"></i>
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-foreground-800">{event.time}</p>
                    <p className="text-xs text-foreground-400">Duration</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
                    <i className="ri-map-pin-line text-foreground-400 text-sm"></i>
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-foreground-800">{event.location}</p>
                    <p className="text-xs text-foreground-400">{event.format}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
                    <i className="ri-coins-line text-foreground-400 text-sm"></i>
                  </span>
                  <div>
                    <p className="text-xs font-bold text-accent-600">+{event.points} pts</p>
                    <p className="text-xs text-foreground-400">Awarded on attendance</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── AGENDA TAB ── */}
        {activeTab === 'agenda' && (
          <div>
            {detail?.agenda && detail.agenda.length > 0 ? (
              <div className="space-y-3">
                <div className="bg-accent-50 border border-accent-200/40 rounded-xl p-4 flex items-center gap-3">
                  <i className="ri-information-line text-accent-600"></i>
                  <p className="text-xs text-accent-700 font-medium">
                    This is a provisional agenda — timings may vary on the day. All sessions start at the registered event time.
                  </p>
                </div>
                <div className="relative">
                  <div className="absolute left-[52px] top-0 bottom-0 w-px bg-background-200" />
                  <div className="space-y-4">
                    {detail.agenda.map((item, idx) => {
                      const typeStyle = agendaTypeConfig[item.type];
                      return (
                        <div key={idx} className="flex gap-4 group">
                          {/* Time */}
                          <div className="w-14 text-right shrink-0 pt-3.5">
                            <span className="text-xs font-bold text-foreground-500 tabular-nums">{item.time}</span>
                          </div>
                          {/* Dot */}
                          <div className="relative flex flex-col items-center pt-3.5">
                            <div className={`w-4 h-4 rounded-full border-2 border-background-50 ${typeStyle.bg} z-10 flex items-center justify-center`}>
                              <div className={`w-2 h-2 rounded-full ${typeStyle.color.replace('text-', 'bg-')}`} />
                            </div>
                          </div>
                          {/* Content */}
                          <div className="flex-1 pb-2">
                            <div className={`bg-background-50 rounded-xl border border-background-200/50 p-4 group-hover:border-background-300/50 transition-smooth`}>
                              <div className="flex items-start gap-3">
                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${typeStyle.bg}`}>
                                  <i className={`${typeStyle.icon} text-sm ${typeStyle.color}`}></i>
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-sm font-semibold text-foreground-900">{item.title}</h4>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize ${typeStyle.bg} ${typeStyle.color}`}>
                                      {item.type}
                                    </span>
                                  </div>
                                  {item.speaker && (
                                    <p className="text-xs text-foreground-400 mt-0.5">
                                      <i className="ri-user-line mr-1"></i>{item.speaker}
                                    </p>
                                  )}
                                  <p className="text-xs text-foreground-600 mt-1.5 leading-relaxed">{item.description}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 bg-background-50 rounded-xl border border-background-200/50">
                <span className="w-14 h-14 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-list-ordered text-foreground-300 text-xl"></i>
                </span>
                <p className="text-sm font-semibold text-foreground-600">Agenda not yet published</p>
                <p className="text-xs text-foreground-400 mt-1">The host will publish the agenda before the event</p>
              </div>
            )}
          </div>
        )}

        {/* ── SPEAKERS TAB ── */}
        {activeTab === 'speakers' && (
          <div>
            {detail?.speakers && detail.speakers.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {detail.speakers.map((speaker, idx) => (
                  <div key={idx} className="bg-background-50 rounded-xl border border-background-200/50 p-5 flex flex-col gap-4">
                    <div className="flex items-start gap-4">
                      {speaker.avatarImg ? (
                        <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-background-200/60">
                          <img src={speaker.avatarImg} alt={speaker.name} className="w-full h-full object-cover object-top" />
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-primary-100 text-primary-600 font-bold text-xl flex items-center justify-center shrink-0">
                          {speaker.avatar}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-heading font-bold text-foreground-900">{speaker.name}</h3>
                        <p className="text-sm font-medium text-primary-600">{speaker.role}</p>
                        <p className="text-xs text-foreground-400">{speaker.company}</p>
                      </div>
                    </div>
                    <p className="text-sm text-foreground-600 leading-relaxed">{speaker.bio}</p>
                    <div className="flex flex-wrap gap-1.5 pt-3 border-t border-background-200/50">
                      {speaker.topics.map((topic) => (
                        <span key={topic} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-50 text-accent-700 border border-accent-200/50">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-background-50 rounded-xl border border-background-200/50">
                <span className="w-14 h-14 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-mic-line text-foreground-300 text-xl"></i>
                </span>
                <p className="text-sm font-semibold text-foreground-600">Speaker details coming soon</p>
                <p className="text-xs text-foreground-400 mt-1">Check back closer to the event date</p>
              </div>
            )}
          </div>
        )}

        {/* ── ATTENDEES TAB ── */}
        {activeTab === 'attendees' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground-800">
                {event.rsvpCount} registered · {spotsLeft > 0 ? `${spotsLeft} spots left` : 'Full'}
              </p>
              {event.waitlist.length > 0 && (
                <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded-full border border-amber-200/50">
                  <i className="ri-hourglass-line mr-1"></i>{event.waitlist.length} on waitlist
                </span>
              )}
            </div>
            <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {detail?.attendees && detail.attendees.length > 0 ? (
                  detail.attendees.map((att, idx) => (
                    <div key={idx} className="p-3.5 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-600 text-xs font-bold flex items-center justify-center shrink-0">
                        {att.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{att.name}</p>
                        <p className="text-xs text-foreground-400">{att.role}</p>
                      </div>
                      {att.joined && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          <i className="ri-check-line mr-0.5"></i>Attending
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  Array.from({ length: Math.min(event.rsvpCount, 8) }, (_, i) => (
                    <div key={i} className="p-3.5 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-background-100 text-foreground-400 text-xs font-bold flex items-center justify-center shrink-0">
                        <i className="ri-user-line text-sm"></i>
                      </div>
                      <div className="flex-1">
                        <div className="w-24 h-3 bg-background-200 rounded animate-pulse" />
                        <div className="w-16 h-2 bg-background-100 rounded mt-1.5 animate-pulse" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {event.waitlist.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-2">Waitlist</h4>
                <div className="bg-amber-50 rounded-xl border border-amber-200/50 overflow-hidden">
                  <div className="divide-y divide-amber-200/30">
                    {event.waitlist.map((name, idx) => (
                      <div key={idx} className="p-3 flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-600 text-xs font-bold flex items-center justify-center shrink-0">
                          {name.split(' ').map((n) => n[0]).join('')}
                        </div>
                        <p className="text-sm font-medium text-amber-800">{name}</p>
                        <span className="ml-auto text-[10px] text-amber-600 font-semibold">#{idx + 1} in queue</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}