import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { CommunityHero } from './components/CommunityHero';
import { ClubCard } from './components/ClubCard';
import { EventRow } from './components/EventRow';
import { ActivityCard } from './components/ActivityCard';
import { FeedCard } from './components/FeedCard';
import { LeaderboardTab } from './components/LeaderboardTab';
import { AmbassadorsTab } from './components/AmbassadorsTab';
import { CLUBS, EVENTS, COMMUNITY_ACTIVITIES, FEED_ITEMS, type FeedItem } from './data';

const learnerNav = roleNavMap.learner;

type SectionKey = 'my-clubs' | 'available-clubs' | 'events' | 'activities' | 'leaderboard' | 'ambassadors' | 'community-feed';

const SECTION_TABS: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'my-clubs', label: 'My Clubs', icon: 'ri-star-line' },
  { key: 'available-clubs', label: 'Available Clubs', icon: 'ri-compass-line' },
  { key: 'events', label: 'Club Events', icon: 'ri-calendar-event-line' },
  { key: 'activities', label: 'Activities', icon: 'ri-flashlight-line' },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'ri-trophy-line' },
  { key: 'ambassadors', label: 'Ambassadors', icon: 'ri-shield-star-line' },
  { key: 'community-feed', label: 'Community Feed', icon: 'ri-chat-smile-2-line' },
];

interface PostComment {
  id: string;
  author: string;
  authorAvatar: string;
  content: string;
  timeAgo: string;
}

export default function ClubsPage() {
  const p = LEARNER_PROFILE;
  const [activeSection, setActiveSection] = useState<SectionKey>('my-clubs');

  // Feed interactivity state
  const [feedItems, setFeedItems] = useState<(FeedItem & { isLiked?: boolean; isExpanded?: boolean })[]>(
    FEED_ITEMS.map((item) => ({ ...item }))
  );
  const [feedComments, setFeedComments] = useState<Record<string, PostComment[]>>({});
  const [newPostText, setNewPostText] = useState('');
  const [showPostComposer, setShowPostComposer] = useState(false);

  const [joinedClubIds, setJoinedClubIds] = useState<Set<string>>(new Set(CLUBS.filter((c) => c.joined).map((c) => c.id)));
  const [joinToast, setJoinToast] = useState<string | null>(null);

  const myClubs = CLUBS.filter((c) => joinedClubIds.has(c.id));
  const availableClubs = CLUBS.filter((c) => !joinedClubIds.has(c.id));

  const handleJoinClub = (club: typeof CLUBS[0]) => {
    setJoinedClubIds((prev) => new Set(prev).add(club.id));
    setJoinToast(`Join request for "${club.title}" submitted! Pending ambassador approval.`);
    setTimeout(() => setJoinToast(null), 4000);
  };

  const handleToggleLike = (id: string) => {
    setFeedItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isLiked: !item.isLiked } : item
      )
    );
  };

  const handleToggleComments = (id: string) => {
    setFeedItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isExpanded: !item.isExpanded } : item
      )
    );
  };

  const handleAddComment = (feedId: string, comment: string) => {
    const newComment: PostComment = {
      id: `cmt-${Date.now()}`,
      author: 'Sophie Williams',
      authorAvatar: 'SW',
      content: comment,
      timeAgo: 'Just now',
    };
    setFeedComments((prev) => ({
      ...prev,
      [feedId]: [...(prev[feedId] || []), newComment],
    }));
  };

  const handleCreatePost = () => {
    if (!newPostText.trim()) return;
    const newPost: FeedItem & { isLiked?: boolean; isExpanded?: boolean } = {
      id: `feed-new-${Date.now()}`,
      type: 'discussion',
      user: 'Sophie Williams',
      userAvatar: 'SW',
      userRole: 'Marketing Apprentice',
      club: 'Marketing Club',
      clubId: 'cl-01',
      content: newPostText,
      date: '13 Jun 2026',
      timeAgo: 'Just now',
      likes: 0,
      comments: 0,
      joined: true,
      isLiked: false,
      isExpanded: false,
    };
    setFeedItems((prev) => [newPost, ...prev]);
    setNewPostText('');
    setShowPostComposer(false);
  };

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Clubs"
      pageSubtitle="Connect, learn and grow with fellow apprentices"
      userName={p.fullName}
      userRole={`${p.programme} ${p.programmeLevel} Apprentice`}
    >
      {/* Join Request Toast */}
      {joinToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-accent-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center">
            <i className="ri-check-double-line"></i>
          </span>
          <p className="text-sm font-semibold text-foreground-900">{joinToast}</p>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <CommunityHero />

        {/* Section Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto sticky top-0 z-10">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSection(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeSection === tab.key
                  ? 'bg-background-50 text-foreground-900 shadow-sm'
                  : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
              {tab.key === 'my-clubs' && (
                <span className="bg-primary-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">{myClubs.length}</span>
              )}
              {tab.key === 'available-clubs' && (
                <span className="bg-foreground-200 text-foreground-600 text-xs px-1.5 py-0.5 rounded-full leading-none">{availableClubs.length}</span>
              )}
              {tab.key === 'community-feed' && (
                <span className="bg-accent-500 text-foreground-950 text-xs px-1.5 py-0.5 rounded-full leading-none font-bold">NEW</span>
              )}
            </button>
          ))}
        </div>

        {/* ==================== MY CLUBS ==================== */}
        {activeSection === 'my-clubs' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">My Clubs</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Clubs you have joined — stay active to earn points and recognition</p>
              </div>
              <span className="text-xs text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{myClubs.reduce((s, c) => s + (c.pointsEarned || 0), 0)} total points earned</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {myClubs.map((club) => (
                <ClubCard key={club.id} club={club} joined />
              ))}
            </div>
          </section>
        )}

        {/* ==================== AVAILABLE CLUBS ==================== */}
        {activeSection === 'available-clubs' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Available Clubs</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Discover clubs that match your interests and career goals</p>
              </div>
              <span className="text-xs text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{availableClubs.length} available</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {availableClubs.map((club) => (
                <ClubCard key={club.id} club={club} joined={false} onJoin={handleJoinClub} />
              ))}
            </div>
          </section>
        )}

        {/* ==================== CLUB EVENTS ==================== */}
        {activeSection === 'events' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Club Events</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Upcoming sessions and workshops across all clubs — earn points for attending</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{EVENTS.filter((e) => e.joined).length} joined</span>
                <span className="text-xs text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{EVENTS.length} total</span>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {EVENTS.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ==================== ACTIVITIES ==================== */}
        {activeSection === 'activities' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Community Activities</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Complete activities to earn points, develop skills, and contribute to your community</p>
              </div>
              <span className="text-xs text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{COMMUNITY_ACTIVITIES.length} activities</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {COMMUNITY_ACTIVITIES.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} />
              ))}
            </div>
          </section>
        )}

        {/* ==================== LEADERBOARD ==================== */}
        {activeSection === 'leaderboard' && <LeaderboardTab />}

        {/* ==================== AMBASSADORS ==================== */}
        {activeSection === 'ambassadors' && <AmbassadorsTab />}

        {/* ==================== COMMUNITY FEED (LIVE) ==================== */}
        {activeSection === 'community-feed' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Community Feed</h3>
                <p className="text-xs text-foreground-400 mt-0.5">Stay connected — see what is happening across the KBC learner community</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-accent-600 bg-accent-100 px-2 py-0.5 rounded-full">Live</span>
              </div>
            </div>

            {/* Post Composer */}
            {!showPostComposer ? (
              <button
                onClick={() => setShowPostComposer(true)}
                className="w-full bg-background-50 rounded-xl border border-background-200/50 p-4 mb-4 flex items-center gap-3 hover:border-primary-200/50 transition-smooth cursor-pointer text-left"
              >
                <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">
                  SW
                </div>
                <span className="text-sm text-foreground-400">Share an update, achievement, or resource with the community...</span>
                <span className="ml-auto px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap">Post</span>
              </button>
            ) : (
              <div className="bg-background-50 rounded-xl border border-primary-200/50 p-4 mb-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">
                    SW
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground-900 mb-1">Sophie Williams</p>
                    <textarea
                      value={newPostText}
                      onChange={(e) => setNewPostText(e.target.value)}
                      placeholder="Share an update, achievement, or resource with the community..."
                      maxLength={500}
                      rows={3}
                      className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all resize-none"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground-400">{newPostText.length}/500</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowPostComposer(false); setNewPostText(''); }}
                      className="px-4 py-1.5 text-xs font-semibold text-foreground-500 hover:text-foreground-700 cursor-pointer whitespace-nowrap"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreatePost}
                      disabled={!newPostText.trim()}
                      className="px-4 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="ri-send-plane-line mr-1"></i> Post
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Feed Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {feedItems.map((item) => (
                <FeedCard
                  key={item.id}
                  item={item}
                  onToggleLike={handleToggleLike}
                  onToggleComments={handleToggleComments}
                  onAddComment={handleAddComment}
                  comments={feedComments[item.id] || []}
                />
              ))}
            </div>

            {/* Feed Stats */}
            <div className="mt-4 bg-background-100/50 rounded-xl border border-background-200/30 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <i className="ri-information-line text-foreground-400 text-lg"></i>
              <div className="flex-1">
                <p className="text-xs text-foreground-600">
                  <strong className="text-foreground-800">Community Feed</strong> shows achievements, shared resources, event recaps, discussions, and ambassador updates from across all clubs. Engage by liking, commenting, and sharing posts to earn community points.
                </p>
              </div>
            </div>
          </section>
        )}

      </div>
    </WorkspaceShell>
  );
}