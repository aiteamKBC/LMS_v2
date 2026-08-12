import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { EventRow } from '@/pages/learner/clubs/components/EventRow';
import {
  CLUBS,
  EVENTS,
  getEventsByClubId,
  getMembersByClub,
  getDiscussionsByClubId,
  getResourcesByClubId,
  CLUB_DISCUSSIONS,
  type CommunityClub,
  type ClubDiscussion,
  type ClubResource,
  EVENT_FEEDBACKS,
  getFeedbackByEventId,
  getAverageRating,
  type EventFeedback,
} from '@/pages/learner/clubs/data';
import { downloadICS, type ICSEvent } from '@/utils/ics-generator';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

type DetailTab = 'discussions' | 'members' | 'resources' | 'events';

const DETAIL_TABS: { key: DetailTab; label: string; icon: string }[] = [
  { key: 'discussions', label: 'Discussions', icon: 'ri-chat-1-line' },
  { key: 'members', label: 'Members', icon: 'ri-team-line' },
  { key: 'resources', label: 'Resources', icon: 'ri-folder-upload-line' },
  { key: 'events', label: 'Events', icon: 'ri-calendar-event-line' },
];

const discussionCategoryColors: Record<string, string> = {
  Strategy: 'bg-primary-100 text-primary-700',
  'Best Practice': 'bg-accent-100 text-accent-700',
  Trends: 'bg-secondary-100 text-secondary-700',
  Tools: 'bg-amber-100 text-amber-700',
  Announcement: 'bg-emerald-100 text-emerald-700',
  Theory: 'bg-primary-100 text-primary-700',
  'Workshop Follow-up': 'bg-accent-100 text-accent-700',
  Debate: 'bg-red-100 text-red-600',
  Ethics: 'bg-secondary-100 text-secondary-700',
};

const resourceTypeIcons: Record<string, string> = {
  Template: 'ri-file-text-line',
  Tool: 'ri-file-excel-2-line',
  Guide: 'ri-book-open-line',
  Assessment: 'ri-psychotherapy-line',
  Workbook: 'ri-edit-box-line',
  Report: 'ri-survey-line',
  Presentation: 'ri-slideshow-line',
  Framework: 'ri-scales-line',
};

const socialPlatforms = [
  { name: 'LinkedIn', icon: 'ri-linkedin-box-fill', cls: 'bg-blue-700 text-white' },
  { name: 'Twitter', icon: 'ri-twitter-x-fill', cls: 'bg-foreground-900 text-white' },
  { name: 'WhatsApp', icon: 'ri-whatsapp-line', cls: 'bg-emerald-600 text-white' },
  { name: 'Copy Link', icon: 'ri-link', cls: 'bg-foreground-200 text-foreground-700' },
];

export default function ClubDetailPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DetailTab>('discussions');
  const [expandedDiscussion, setExpandedDiscussion] = useState<string | null>(null);
  const [newReply, setNewReply] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // New Discussion Modal
  const [showNewDiscussionModal, setShowNewDiscussionModal] = useState(false);
  const [newDiscTitle, setNewDiscTitle] = useState('');
  const [newDiscContent, setNewDiscContent] = useState('');
  const [newDiscCategory, setNewDiscCategory] = useState('Strategy');
  const [discussions, setDiscussions] = useState<ClubDiscussion[]>([]);

  // Add to Calendar
  const [calendarToast, setCalendarToast] = useState<string | null>(null);
  const [savedEvents, setSavedEvents] = useState<Set<string>>(new Set());

  // Feed Composer for discussion tab
  const [feedPostText, setFeedPostText] = useState('');
  const [showFeedComposer, setShowFeedComposer] = useState(false);

  // Share modal
  const [shareModalFor, setShareModalFor] = useState<string | null>(null);
  const [sharePointsToast, setSharePointsToast] = useState(false);

  // RSVP / Waitlist
  const [eventWaitlists, setEventWaitlists] = useState<Record<string, string[]>>({});
  const [eventRsvpCounts, setEventRsvpCounts] = useState<Record<string, number>>({});

  // QR Code modal
  const [qrModalEvent, setQrModalEvent] = useState<typeof EVENTS[0] | null>(null);

  // Feedback system
  const [feedbackModalEvent, setFeedbackModalEvent] = useState<typeof EVENTS[0] | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackHoverRating, setFeedbackHoverRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [eventFeedbacks, setEventFeedbacks] = useState<EventFeedback[]>(EVENT_FEEDBACKS);
  const [showFeedbackList, setShowFeedbackList] = useState<string | null>(null);
  const [feedbackSubmittedToast, setFeedbackSubmittedToast] = useState(false);

  const club = CLUBS.find((c) => c.id === clubId);

  const [joinedEventIds, setJoinedEventIds] = useState<Set<string>>(new Set(EVENTS.filter((e) => e.joined).map((e) => e.id)));

  // Sync with localStorage on mount
  useEffect(() => {
    const savedCalendar = JSON.parse(localStorage.getItem('kbc_calendar_events') || '[]');
    const savedJoined = JSON.parse(localStorage.getItem('kbc_joined_events') || '[]');
    if (savedCalendar.length > 0) {
      setSavedEvents((prev) => new Set([...prev, ...savedCalendar]));
    }
    if (savedJoined.length > 0) {
      setJoinedEventIds((prev) => new Set([...prev, ...savedJoined]));
    }
  }, []);

  // Save to localStorage on changes
  useEffect(() => {
    localStorage.setItem('kbc_calendar_events', JSON.stringify([...savedEvents]));
  }, [savedEvents]);

  useEffect(() => {
    localStorage.setItem('kbc_joined_events', JSON.stringify([...joinedEventIds]));
  }, [joinedEventIds]);

  // Discussion likes state
  const [discussionLikes, setDiscussionLikes] = useState<Record<string, boolean>>({});
  const [discussionLikeCounts, setDiscussionLikeCounts] = useState<Record<string, number>>({});

  // Active viewers simulation per discussion
  const [activeViewersMap, setActiveViewersMap] = useState<Record<string, number>>({});

  useState(() => {
    if (clubId) {
      setDiscussions(getDiscussionsByClubId(clubId));
    }
  });

  // WebSocket simulation — rotate active viewers every 30s for active discussions
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveViewersMap((prev) => {
        const next: Record<string, number> = {};
        discussions.forEach((disc) => {
          if (disc.replies >= 5) {
            const current = prev[disc.id] || (disc.replies >= 10 ? Math.floor(Math.random() * 3) + 5 : Math.floor(Math.random() * 2) + 2);
            const delta = Math.random() > 0.5 ? 1 : -1;
            next[disc.id] = Math.max(2, Math.min(9, current + delta));
          }
        });
        return { ...prev, ...next };
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [discussions]);

  const handleLikeDiscussion = (discId: string) => {
    setDiscussionLikes((prev) => {
      const isLiked = prev[discId] || false;
      setDiscussionLikeCounts((counts) => ({
        ...counts,
        [discId]: (counts[discId] || 0) + (isLiked ? -1 : 1),
      }));
      return { ...prev, [discId]: !isLiked };
    });
  };

  if (!club) {
    return (
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Club Not Found" pageSubtitle="The club you are looking for does not exist"
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-6 flex flex-col items-center justify-center py-24">
          <span className="w-20 h-20 rounded-3xl bg-foreground-100 flex items-center justify-center mb-6">
            <AppIcon className="ri-emotion-sad-line text-foreground-300 text-3xl"></AppIcon>
          </span>
          <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">Club Not Found</h2>
          <p className="text-sm text-foreground-500 mb-6">We couldn&apos;t find a club with that identifier.</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all whitespace-nowrap"
          >
            <AppIcon className="ri-arrow-left-line mr-1.5"></AppIcon> Back to Clubs
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const members = getMembersByClub(club);
  const resources = getResourcesByClubId(club.id);
  const events = getEventsByClubId(club.id);

  const handleReply = (discussionId: string) => {
    if (!newReply.trim()) return;
    setNewReply('');
    setReplyingTo(null);
  };

  const handleCreateDiscussion = () => {
    if (!newDiscTitle.trim() || !newDiscContent.trim()) return;
    const newDiscussion: ClubDiscussion = {
      id: `disc-new-${Date.now()}`,
      clubId: club.id,
      title: newDiscTitle,
      author: 'Sophie Williams',
      authorAvatar: 'SW',
      date: '13 Jun 2026',
      timeAgo: 'Just now',
      content: newDiscContent,
      replies: 0,
      likes: 0,
      category: newDiscCategory,
    };
    setDiscussions((prev) => [newDiscussion, ...prev]);
    setNewDiscTitle('');
    setNewDiscContent('');
    setNewDiscCategory('Strategy');
    setShowNewDiscussionModal(false);
  };

  const handleShare = (discId: string) => {
    setShareModalFor(null);
    setSharePointsToast(true);
    setTimeout(() => setSharePointsToast(false), 3000);
  };

  const handleFeedPost = () => {
    if (!feedPostText.trim()) return;
    const newPost: ClubDiscussion = {
      id: `disc-feed-${Date.now()}`,
      clubId: club.id,
      title: feedPostText.slice(0, 80) + (feedPostText.length > 80 ? '...' : ''),
      author: 'Sophie Williams',
      authorAvatar: 'SW',
      date: '13 Jun 2026',
      timeAgo: 'Just now',
      content: feedPostText,
      replies: 0,
      likes: 0,
      category: 'Announcement',
    };
    setDiscussions((prev) => [newPost, ...prev]);
    setFeedPostText('');
    setShowFeedComposer(false);
  };

  const handleAddToCalendar = (ev: typeof EVENTS[0]) => {
    if (savedEvents.has(ev.id)) {
      setCalendarToast(`${ev.title} is already in your calendar`);
    } else {
      setSavedEvents((prev) => new Set(prev).add(ev.id));
      setCalendarToast(`"${ev.title}" added to your calendar · ${ev.date} at ${ev.time}`);
    }
    setTimeout(() => setCalendarToast(null), 2500);
  };

  const handleJoinEvent = (ev: typeof EVENTS[0]) => {
    setJoinedEventIds((prev) => new Set(prev).add(ev.id));
    setSavedEvents((prev) => new Set(prev).add(ev.id));
    setCalendarToast(`You joined "${ev.title}"! Added to your calendar.`);
    setTimeout(() => setCalendarToast(null), 3000);
  };

  const handleExportEventICS = (ev: typeof EVENTS[0]) => {
    const icsEvent: ICSEvent = {
      title: ev.title,
      description: ev.description,
      date: ev.date,
      time: ev.time,
      location: ev.location,
    };
    downloadICS(icsEvent);
    setCalendarToast(`"${ev.title}" exported to your calendar app!`);
    setTimeout(() => setCalendarToast(null), 2500);
  };

  const handleJoinWaitlist = (ev: typeof EVENTS[0]) => {
    const currentWaitlist = eventWaitlists[ev.id] || ev.waitlist;
    if (currentWaitlist.includes('Sophie Williams')) {
      setCalendarToast(`You are already on the waitlist for "${ev.title}"`);
    } else {
      const updated = [...currentWaitlist, 'Sophie Williams'];
      setEventWaitlists((prev) => ({ ...prev, [ev.id]: updated }));
      setCalendarToast(`Added to waitlist for "${ev.title}" — you are #${updated.length} in line`);
    }
    setTimeout(() => setCalendarToast(null), 3000);
  };

  const handleRSVP = (ev: typeof EVENTS[0]) => {
    const currentCount = eventRsvpCounts[ev.id] || ev.rsvpCount;
    const isFull = currentCount >= ev.capacity;
    if (isFull) {
      handleJoinWaitlist(ev);
      return;
    }
    const newCount = currentCount + 1;
    setEventRsvpCounts((prev) => ({ ...prev, [ev.id]: newCount }));
    setJoinedEventIds((prev) => new Set(prev).add(ev.id));
    setSavedEvents((prev) => new Set(prev).add(ev.id));
    const spotsLeft = ev.capacity - newCount;
    const msg = spotsLeft <= 2
      ? `You joined "${ev.title}"! Only ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left — hurry!`
      : `You joined "${ev.title}"! Added to your calendar.`;
    setCalendarToast(msg);
    setTimeout(() => setCalendarToast(null), 3000);
  };

  const handleShowQRCode = (ev: typeof EVENTS[0]) => {
    setQrModalEvent(ev);
  };

  const handleOpenFeedback = (ev: typeof EVENTS[0]) => {
    setFeedbackModalEvent(ev);
    setFeedbackRating(0);
    setFeedbackHoverRating(0);
    setFeedbackComment('');
  };

  const handleSubmitFeedback = () => {
    if (!feedbackModalEvent || feedbackRating === 0) return;
    const newFeedback: EventFeedback = {
      id: `fb-${Date.now()}`,
      eventId: feedbackModalEvent.id,
      eventTitle: feedbackModalEvent.title,
      clubName: feedbackModalEvent.club,
      eventDate: `${feedbackModalEvent.date} 2026`,
      rating: feedbackRating,
      comment: feedbackComment.trim() || 'No written feedback provided.',
      submittedBy: 'Sophie Williams',
      submittedDate: '13 Jun 2026',
      timeAgo: 'Just now',
    };
    setEventFeedbacks((prev) => [newFeedback, ...prev]);
    setFeedbackModalEvent(null);
    setFeedbackSubmittedToast(true);
    setTimeout(() => setFeedbackSubmittedToast(false), 3000);
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={club.title} pageSubtitle={`${club.category} — ${club.members} members — Ambassador: ${club.ambassador}`}
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      {/* Share Points Toast */}
      {sharePointsToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-accent-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center">
            <AppIcon className="ri-coins-line"></AppIcon>
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground-900">+25 Points!</p>
            <p className="text-xs text-foreground-500">Earned for sharing a discussion</p>
          </div>
        </div>
      )}

      {/* Add to Calendar Toast */}
      {calendarToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-emerald-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <AppIcon className="ri-calendar-check-line"></AppIcon>
          </span>
          <p className="text-sm font-semibold text-foreground-900">{calendarToast}</p>
        </div>
      )}

      {/* Feedback Submitted Toast */}
      {feedbackSubmittedToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-accent-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center">
            <AppIcon className="ri-star-fill"></AppIcon>
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground-900">Feedback Submitted!</p>
            <p className="text-xs text-foreground-500">Thank you for your review — +25 points earned</p>
          </div>
        </div>
      )}

      {/* New Discussion Modal */}
      {showNewDiscussionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowNewDiscussionModal(false)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-heading font-bold text-foreground-900">Start New Discussion</h3>
              <button onClick={() => setShowNewDiscussionModal(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer">
                <AppIcon className="ri-close-line"></AppIcon>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Category</label>
                <div className="flex flex-wrap gap-1.5">
                  {['Strategy', 'Best Practice', 'Trends', 'Tools', 'Announcement', 'Debate', 'Ethics'].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setNewDiscCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                        newDiscCategory === cat
                          ? 'bg-primary-500 text-white'
                          : 'bg-background-100 text-foreground-500 hover:bg-background-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Title</label>
                <input
                  type="text"
                  value={newDiscTitle}
                  onChange={(e) => setNewDiscTitle(e.target.value)}
                  placeholder="e.g. What marketing trends are you most excited about in 2026?"
                  className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all"
                  maxLength={120}
                />
                <span className="text-[10px] text-foreground-400 mt-0.5 block">{newDiscTitle.length}/120</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Content</label>
                <textarea
                  value={newDiscContent}
                  onChange={(e) => setNewDiscContent(e.target.value)}
                  placeholder="Share your thoughts, questions, or insights with the club..."
                  maxLength={1000}
                  rows={5}
                  className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all resize-none"
                />
                <span className="text-[10px] text-foreground-400 mt-0.5 block">{newDiscContent.length}/1000</span>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowNewDiscussionModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDiscussion}
                disabled={!newDiscTitle.trim() || !newDiscContent.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AppIcon className="ri-add-line mr-1"></AppIcon> Create Discussion
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Back + Club Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-foreground-500 hover:text-foreground-700 transition-all cursor-pointer whitespace-nowrap"
          >
            <AppIcon className="ri-arrow-left-line"></AppIcon>
            Back to Clubs
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-foreground-400 bg-background-100 px-2.5 py-1 rounded-full">
              <AppIcon className="ri-user-line mr-1"></AppIcon>{club.members} members
            </span>
            <span className="text-xs font-medium text-primary-600 bg-primary-100 px-2.5 py-1 rounded-full">
              <AppIcon className="ri-coins-line mr-1"></AppIcon>{club.pointsEarned || 0} club points
            </span>
          </div>
        </div>

        {/* Club Info Card */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
          <div className="flex items-start gap-4 mb-4">
            <span className="w-16 h-16 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
              <AppIcon className={`${club.icon} text-2xl`}></AppIcon>
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-lg font-heading font-bold text-foreground-900">{club.title}</h2>
                {club.badge && (
                  <span className="text-[9px] font-bold bg-accent-100 text-accent-700 px-1.5 py-0.5 rounded-full uppercase">{club.badge}</span>
                )}
              </div>
              <p className="text-sm text-foreground-500 leading-relaxed mb-3">{club.desc}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-foreground-400">
                <span><AppIcon className="ri-shield-star-line mr-1 text-primary-500"></AppIcon>Ambassador: <strong className="text-foreground-600">{club.ambassador}</strong></span>
                <span><AppIcon className="ri-calendar-line mr-1"></AppIcon>Est. {club.foundedDate}</span>
                <span><AppIcon className="ri-price-tag-3-line mr-1"></AppIcon>{club.category}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto sticky top-0 z-10">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-background-50 text-foreground-900 shadow-sm'
                  : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <AppIcon className={`${tab.icon} text-sm`}></AppIcon>
              {tab.label}
              {tab.key === 'discussions' && discussions.length > 0 && (
                <span className="bg-primary-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">{discussions.length}</span>
              )}
              {tab.key === 'members' && (
                <span className="bg-foreground-200 text-foreground-600 text-xs px-1.5 py-0.5 rounded-full leading-none">{members.length}</span>
              )}
              {tab.key === 'resources' && resources.length > 0 && (
                <span className="bg-secondary-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">{resources.length}</span>
              )}
              {tab.key === 'events' && events.length > 0 && (
                <span className="bg-accent-500 text-foreground-950 text-xs px-1.5 py-0.5 rounded-full leading-none">{events.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ==================== DISCUSSIONS ==================== */}
        {activeTab === 'discussions' && (
          <section className="space-y-4">
            {/* Feed Post Composer */}
            {!showFeedComposer ? (
              <button
                onClick={() => setShowFeedComposer(true)}
                className="w-full bg-background-50 rounded-xl border border-background-200/50 p-4 flex items-center gap-3 hover:border-primary-200/50 transition-smooth cursor-pointer text-left"
              >
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">SW</div>
                <span className="text-sm text-foreground-400">Share an update or quick thought with {club.title}...</span>
                <span className="ml-auto px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap">Post</span>
              </button>
            ) : (
              <div className="bg-background-50 rounded-xl border border-primary-200/50 p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">SW</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground-900 mb-1">Sophie Williams</p>
                    <textarea
                      value={feedPostText}
                      onChange={(e) => setFeedPostText(e.target.value)}
                      placeholder={`Share something with ${club.title}...`}
                      maxLength={500}
                      rows={2}
                      className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all resize-none"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground-400">{feedPostText.length}/500</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowFeedComposer(false); setFeedPostText(''); }}
                      className="px-4 py-1.5 text-xs font-semibold text-foreground-500 hover:text-foreground-700 cursor-pointer whitespace-nowrap"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleFeedPost}
                      disabled={!feedPostText.trim()}
                      className="px-4 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AppIcon className="ri-send-plane-line mr-1"></AppIcon> Post
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Start Discussion Button */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Discussions</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Conversations, questions, and insights from the club</p>
              </div>
              <button
                onClick={() => setShowNewDiscussionModal(true)}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <AppIcon className="ri-add-line mr-1"></AppIcon> Start New Discussion
              </button>
            </div>

            {discussions.length === 0 ? (
              <div className="text-center py-16 bg-background-50 rounded-xl border border-background-200/50">
                <span className="w-16 h-16 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-4">
                  <AppIcon className="ri-chat-1-line text-foreground-300 text-2xl"></AppIcon>
                </span>
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">No Discussions Yet</h3>
                <p className="text-xs text-foreground-400 mb-4">Be the first to start a discussion in this club</p>
                <button
                  onClick={() => setShowNewDiscussionModal(true)}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <AppIcon className="ri-add-line mr-1"></AppIcon> Start Discussion
                </button>
              </div>
            ) : (
              discussions.map((disc) => {
                const isExpanded = expandedDiscussion === disc.id;
                const catColor = discussionCategoryColors[disc.category] || 'bg-background-200 text-foreground-500';
                return (
                  <div key={disc.id} className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium hover:border-primary-200/50 transition-smooth">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">
                        {disc.authorAvatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-semibold text-foreground-900">{disc.author}</span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${catColor}`}>{disc.category}</span>
                          <span className="text-xs text-foreground-400">{disc.timeAgo}</span>
                        </div>
                        <Link
                          to={`/learner/clubs/discussion/${disc.id}`}
                          className="text-sm font-heading font-semibold text-foreground-900 hover:text-primary-600 transition-smooth mb-1.5 block"
                        >
                          {disc.title}
                        </Link>
                        <p className={`text-sm text-foreground-600 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                          {disc.content}
                        </p>
                        {disc.content.length > 150 && (
                          <button
                            onClick={() => setExpandedDiscussion(isExpanded ? null : disc.id)}
                            className="text-xs font-semibold text-primary-600 hover:text-primary-700 mt-1 cursor-pointer whitespace-nowrap"
                          >
                            {isExpanded ? 'Show less' : 'Read more'}
                          </button>
                        )}

                        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-background-200/40">
                          <button
                            onClick={() => handleLikeDiscussion(disc.id)}
                            className={`text-xs transition-smooth cursor-pointer flex items-center gap-1 ${discussionLikes[disc.id] ? 'text-red-500 font-semibold' : 'text-foreground-400 hover:text-red-500'}`}
                          >
                            <AppIcon className={`${discussionLikes[disc.id] ? 'ri-heart-fill' : 'ri-heart-line'}`}></AppIcon> {disc.likes + (discussionLikeCounts[disc.id] || 0)}
                          </button>
                          <Link
                            to={`/learner/clubs/discussion/${disc.id}`}
                            className="text-xs text-foreground-400 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1"
                          >
                            <AppIcon className="ri-chat-1-line"></AppIcon> {disc.replies} replies
                          </Link>
                          {/* Active viewers indicator — WebSocket simulation */}
                          {disc.replies >= 5 && (
                            <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                              </span>
                              {activeViewersMap[disc.id] || (disc.replies >= 10 ? '5+' : '2–3')} viewing
                            </span>
                          )}
                          {/* Share button */}
                          <div className="relative ml-auto">
                            <button
                              onClick={() => setShareModalFor(shareModalFor === disc.id ? null : disc.id)}
                              className="text-xs text-foreground-400 hover:text-accent-600 transition-smooth cursor-pointer flex items-center gap-1"
                            >
                              <AppIcon className="ri-share-forward-line"></AppIcon> Share
                            </button>
                            {shareModalFor === disc.id && (
                              <div className="absolute right-0 top-full mt-2 bg-background-50 rounded-xl border border-background-200/60 shadow-lg p-2 z-20 min-w-[170px] animate-in slide-in-from-top-2 duration-200">
                                {socialPlatforms.map((platform) => (
                                  <button
                                    key={platform.name}
                                    onClick={() => handleShare(disc.id)}
                                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                                  >
                                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${platform.cls}`}>
                                      <AppIcon className={`${platform.icon} text-xs`}></AppIcon>
                                    </span>
                                    {platform.name === 'Copy Link' ? platform.name : `Share on ${platform.name}`}
                                    <span className="ml-auto text-accent-600 text-[10px] font-bold">+25</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Inline reply box */}
                        {replyingTo === disc.id && (
                          <div className="mt-3 flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-background-200 text-foreground-500 flex items-center justify-center shrink-0 text-[10px] font-bold">
                              SW
                            </div>
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                value={newReply}
                                onChange={(e) => setNewReply(e.target.value)}
                                placeholder="Write a reply..."
                                className="flex-1 bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all"
                              />
                              <button
                                onClick={() => handleReply(disc.id)}
                                disabled={!newReply.trim()}
                                className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Reply
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}

        {/* ==================== MEMBERS ==================== */}
        {activeTab === 'members' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Club Members</h3>
                <p className="text-xs text-foreground-400 mt-0.5">{members.length} members including {members.filter((m) => m.isAmbassador).length} ambassador{members.filter((m) => m.isAmbassador).length > 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center gap-4 p-4 hover:bg-background-100/50 transition-smooth">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                      member.isAmbassador
                        ? 'bg-accent-100 text-accent-700 ring-2 ring-accent-300/50'
                        : 'bg-background-200 text-foreground-600'
                    }`}>
                      {member.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{member.name}</p>
                        {member.isAmbassador && (
                          <span className="text-[9px] font-bold bg-accent-100 text-accent-700 px-1.5 py-0.5 rounded-full uppercase flex items-center gap-1">
                            <AppIcon className="ri-shield-star-line text-[9px]"></AppIcon> Ambassador
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground-400">{member.role}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-foreground-600">{member.contributions} contributions</p>
                      <p className="text-xs text-foreground-400">Joined {member.joinedDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ==================== RESOURCES ==================== */}
        {activeTab === 'resources' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Resource Library</h3>
                <p className="text-xs text-foreground-400 mt-0.5">{resources.length} resources shared by club members</p>
              </div>
              <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-upload-line mr-1"></AppIcon> Upload Resource
              </button>
            </div>
            {resources.length === 0 ? (
              <div className="text-center py-16 bg-background-50 rounded-xl border border-background-200/50">
                <span className="w-16 h-16 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-4">
                  <AppIcon className="ri-folder-open-line text-foreground-300 text-2xl"></AppIcon>
                </span>
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">No Resources Yet</h3>
                <p className="text-xs text-foreground-400">Upload templates, guides, and tools to help fellow club members</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {resources.map((res) => (
                  <div key={res.id} className="bg-background-50 rounded-xl border border-background-200/50 p-4 card-premium hover:border-primary-200/50 transition-smooth">
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-xl bg-secondary-100 text-secondary-600 flex items-center justify-center shrink-0">
                        <AppIcon className={`${resourceTypeIcons[res.type] || 'ri-file-line'} text-lg`}></AppIcon>
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-foreground-900 mb-0.5">{res.title}</h4>
                        <p className="text-xs text-foreground-500 leading-relaxed mb-2 line-clamp-2">{res.description}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-400">
                          <span className="font-medium text-secondary-600 bg-secondary-100/50 px-1.5 py-0.5 rounded-full">{res.type}</span>
                          <span>{res.fileSize}</span>
                          <span className="text-foreground-300">·</span>
                          <span><AppIcon className="ri-download-line mr-0.5"></AppIcon>{res.downloads}</span>
                          <span className="text-foreground-300">·</span>
                          <span>by {res.uploadedBy}</span>
                        </div>
                      </div>
                      <button className="px-3 py-1.5 bg-secondary-100 text-secondary-700 rounded-lg text-xs font-semibold hover:bg-secondary-200 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                        <AppIcon className="ri-download-line mr-1"></AppIcon> Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ==================== EVENTS ==================== */}
        {activeTab === 'events' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Club Events</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Upcoming sessions and workshops for {club.title}</p>
              </div>
              <Link
                to="/learner/clubs/events"
                className="text-xs font-semibold text-primary-600 hover:text-primary-700 transition-smooth cursor-pointer flex items-center gap-1"
              >
                View All Events <AppIcon className="ri-arrow-right-line"></AppIcon>
              </Link>
            </div>
            {events.length === 0 ? (
              <div className="text-center py-16 bg-background-50 rounded-xl border border-background-200/50">
                <span className="w-16 h-16 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-4">
                  <AppIcon className="ri-calendar-event-line text-foreground-300 text-2xl"></AppIcon>
                </span>
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">No Upcoming Events</h3>
                <p className="text-xs text-foreground-400">Check back soon for new events in this club</p>
              </div>
            ) : (
              <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
                <div className="divide-y divide-background-200/30">
                  {events.map((ev) => {
                    const effectiveRsvp = eventRsvpCounts[ev.id] || ev.rsvpCount;
                    const effectiveWaitlist = eventWaitlists[ev.id] || ev.waitlist;
                    const isFull = effectiveRsvp >= ev.capacity;
                    const spotsLeft = ev.capacity - effectiveRsvp;
                    const fillPercent = Math.min(100, (effectiveRsvp / ev.capacity) * 100);
                    const avgRating = getAverageRating(ev.id);
                    const feedbackCount = getFeedbackByEventId(ev.id).length;
                    const userAlreadyJoined = joinedEventIds.has(ev.id) || ev.joined;

                    return (
                    <div key={ev.id} className="flex items-center">
                      <div className="flex-1">
                        <EventRow event={ev} />
                      </div>
                      <div className="px-4 py-3 shrink-0 flex flex-col items-end gap-2">
                        {/* Capacity bar */}
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1 h-1 bg-background-200 rounded-full overflow-hidden min-w-[60px]">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-rose-400' : spotsLeft <= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                              style={{ width: `${fillPercent}%` }}
                            ></div>
                          </div>
                          <span className={`text-[10px] font-semibold whitespace-nowrap ${isFull ? 'text-rose-600' : spotsLeft <= 3 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {isFull ? 'Full' : `${effectiveRsvp}/${ev.capacity}`}
                          </span>
                          {effectiveWaitlist.length > 0 && (
                            <span className="text-[10px] text-amber-600 font-medium whitespace-nowrap">
                              <AppIcon className="ri-hourglass-line mr-0.5"></AppIcon>{effectiveWaitlist.length}
                            </span>
                          )}
                        </div>
                        {/* Rating display */}
                        {avgRating > 0 && (
                          <div className="flex items-center gap-1">
                            <div className="flex">
                              {[1,2,3,4,5].map((s) => (
                                <AppIcon key={s} className={`text-[9px] ${s <= Math.round(avgRating) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></AppIcon>
                              ))}
                            </div>
                            <span className="text-[10px] font-semibold text-foreground-500">{avgRating}</span>
                            <button
                              onClick={() => setShowFeedbackList(showFeedbackList === ev.id ? null : ev.id)}
                              className="text-[10px] text-primary-500 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                            >
                              ({feedbackCount})
                            </button>
                          </div>
                        )}
                        {/* Action buttons row */}
                        <div className="flex items-center gap-1.5">
                          {/* QR Code for in-person events */}
                          {ev.hasQrCode && (
                            <button
                              onClick={() => handleShowQRCode(ev)}
                              className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-200 transition-smooth cursor-pointer"
                              title="Check-in QR Code"
                            >
                              <AppIcon className="ri-qr-code-line text-sm"></AppIcon>
                            </button>
                          )}
                          {/* Export ICS */}
                          <button
                            onClick={() => handleExportEventICS(ev)}
                            className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 transition-smooth cursor-pointer"
                            title="Export to Calendar"
                          >
                            <AppIcon className="ri-download-line text-sm"></AppIcon>
                          </button>
                          {/* Add to Calendar */}
                          <button
                            onClick={() => handleAddToCalendar(ev)}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                              savedEvents.has(ev.id)
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-background-100 text-foreground-500 hover:bg-emerald-50 hover:text-emerald-600'
                            }`}
                          >
                            <AppIcon className={`${savedEvents.has(ev.id) ? 'ri-calendar-check-fill' : 'ri-calendar-2-line'} mr-1`}></AppIcon>
                            {savedEvents.has(ev.id) ? 'In Calendar' : 'Calendar'}
                          </button>
                          {/* RSVP / Join / Waitlist */}
                          {userAlreadyJoined ? (
                            <div className="flex items-center gap-1.5">
                              <span className="px-3 py-2 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold whitespace-nowrap">
                                <AppIcon className="ri-check-line mr-1"></AppIcon> Joined
                              </span>
                              <button
                                onClick={() => handleOpenFeedback(ev)}
                                className="px-3 py-2 bg-accent-100 text-accent-700 rounded-lg text-xs font-semibold hover:bg-accent-200 transition-smooth cursor-pointer whitespace-nowrap"
                              >
                                <AppIcon className="ri-star-line mr-1"></AppIcon> Rate
                              </button>
                            </div>
                          ) : isFull ? (
                            <button
                              onClick={() => handleJoinWaitlist(ev)}
                              className="px-3 py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap"
                            >
                              <AppIcon className="ri-hourglass-line mr-1"></AppIcon> Join Waitlist
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRSVP(ev)}
                              className="px-3 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                            >
                              <AppIcon className="ri-add-line mr-1"></AppIcon> RSVP
                            </button>
                          )}
                        </div>
                        {/* Feedback list expandable */}
                        {showFeedbackList === ev.id && (
                          <div className="w-full bg-background-100 rounded-xl p-3 mt-1 space-y-2 max-h-[200px] overflow-y-auto">
                            <p className="text-xs font-semibold text-foreground-700">Feedback ({feedbackCount})</p>
                            {getFeedbackByEventId(ev.id).map((fb) => (
                              <div key={fb.id} className="bg-background-50 rounded-lg p-2">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[10px] font-semibold text-foreground-700">{fb.submittedBy}</span>
                                  <div className="flex">
                                    {[1,2,3,4,5].map((s) => (
                                      <AppIcon key={s} className={`text-[8px] ${s <= fb.rating ? 'ri-star-fill text-amber-400' : 'ri-star-line text-foreground-300'}`}></AppIcon>
                                    ))}
                                  </div>
                                </div>
                                <p className="text-[10px] text-foreground-500 leading-relaxed">{fb.comment}</p>
                                <span className="text-[9px] text-foreground-400">{fb.timeAgo}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

      </div>

      {/* QR Code Modal */}
      {qrModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setQrModalEvent(null)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-heading font-bold text-foreground-900 flex items-center gap-2">
                <AppIcon className="ri-qr-code-line text-emerald-600"></AppIcon>
                Check-in QR Code
              </h3>
              <button onClick={() => setQrModalEvent(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer">
                <AppIcon className="ri-close-line"></AppIcon>
              </button>
            </div>
            <p className="text-xs text-foreground-500 mb-1">{qrModalEvent.title}</p>
            <p className="text-xs text-foreground-400 mb-4">{qrModalEvent.date}, {qrModalEvent.time} · {qrModalEvent.location}</p>
            <div className="bg-white rounded-xl p-4 inline-block mb-4 border border-background-200/50">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`KBC-EVENT:${qrModalEvent.id}|${qrModalEvent.title}|${qrModalEvent.date}|${qrModalEvent.location}`)}`}
                alt="Event Check-in QR Code"
                className="w-[180px] h-[180px]"
              />
            </div>
            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200/50 mb-4">
              <p className="text-xs text-emerald-700 flex items-start gap-2">
                <AppIcon className="ri-information-line mt-0.5"></AppIcon>
                <span>Present this QR code at the venue entrance for contactless check-in. This code is unique to your registration.</span>
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const canvas = document.createElement('canvas');
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`KBC-EVENT:${qrModalEvent.id}|${qrModalEvent.title}|${qrModalEvent.date}|${qrModalEvent.location}`)}`;
                  img.onload = () => {
                    const link = document.createElement('a');
                    link.download = `checkin-${qrModalEvent.id}.png`;
                    link.href = img.src;
                    link.click();
                  };
                  setCalendarToast('QR code downloaded!');
                  setTimeout(() => setCalendarToast(null), 2500);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <AppIcon className="ri-download-line mr-1"></AppIcon> Download QR
              </button>
              <button
                onClick={() => setQrModalEvent(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {feedbackModalEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setFeedbackModalEvent(null)}>
          <div className="bg-background-50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-heading font-bold text-foreground-900 flex items-center gap-2">
                <AppIcon className="ri-star-line text-accent-500"></AppIcon>
                Rate This Event
              </h3>
              <button onClick={() => setFeedbackModalEvent(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer">
                <AppIcon className="ri-close-line"></AppIcon>
              </button>
            </div>

            <div className="bg-background-100 rounded-xl p-3 mb-4">
              <p className="text-sm font-semibold text-foreground-900">{feedbackModalEvent.title}</p>
              <p className="text-xs text-foreground-400 mt-0.5">{feedbackModalEvent.club} · {feedbackModalEvent.date}</p>
            </div>

            {/* Star Rating */}
            <div className="text-center mb-4">
              <p className="text-xs font-semibold text-foreground-500 mb-2">How would you rate this event?</p>
              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setFeedbackRating(star)}
                    onMouseEnter={() => setFeedbackHoverRating(star)}
                    onMouseLeave={() => setFeedbackHoverRating(0)}
                    className="cursor-pointer transition-transform hover:scale-110"
                  >
                    <AppIcon
                      className={`text-2xl ${
                        star <= (feedbackHoverRating || feedbackRating)
                          ? 'ri-star-fill text-amber-400'
                          : 'ri-star-line text-foreground-300'
                      }`}
                    ></AppIcon>
                  </button>
                ))}
              </div>
              {feedbackRating > 0 && (
                <p className="text-xs text-foreground-500 mt-1.5">
                  {feedbackRating === 5 ? 'Excellent!' : feedbackRating === 4 ? 'Very good!' : feedbackRating === 3 ? 'Good' : feedbackRating === 2 ? 'Okay' : 'Poor'}
                </p>
              )}
            </div>

            {/* Comment */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-foreground-500 mb-1.5 block">Your feedback (optional)</label>
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="Share your experience — what worked well? What could be improved?"
                maxLength={500}
                rows={4}
                className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-accent-400/40 focus:border-accent-300/50 transition-all resize-none"
              />
              <span className="text-[10px] text-foreground-400 mt-0.5 block">{feedbackComment.length}/500</span>
            </div>

            <div className="bg-accent-50 rounded-xl p-3 border border-accent-200/50 mb-4">
              <p className="text-xs text-accent-700 flex items-center gap-2">
                <AppIcon className="ri-coins-line"></AppIcon>
                <span>Submitting feedback earns you <strong>+25 community points</strong></span>
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setFeedbackModalEvent(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFeedback}
                disabled={feedbackRating === 0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <AppIcon className="ri-send-plane-line mr-1"></AppIcon> Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
