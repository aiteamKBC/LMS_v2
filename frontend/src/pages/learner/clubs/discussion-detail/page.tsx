import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import {
  CLUB_DISCUSSIONS,
  CLUBS,
  getDiscussionReplies,
  type DiscussionReply,
} from '@/pages/learner/clubs/data';
import { downloadICS, type ICSEvent } from '@/utils/ics-generator';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

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

const socialPlatforms = [
  { name: 'LinkedIn', icon: 'ri-linkedin-box-fill', color: 'bg-blue-700 text-white' },
  { name: 'Twitter', icon: 'ri-twitter-x-fill', color: 'bg-foreground-900 text-white' },
  { name: 'WhatsApp', icon: 'ri-whatsapp-line', color: 'bg-emerald-600 text-white' },
  { name: 'Copy Link', icon: 'ri-link', color: 'bg-foreground-200 text-foreground-700' },
];

export default function DiscussionDetailPage() {
  const { discussionId } = useParams<{ discussionId: string }>();
  const navigate = useNavigate();
  const [newReplyText, setNewReplyText] = useState('');
  const [replies, setReplies] = useState<DiscussionReply[]>([]);
  const [likedReplies, setLikedReplies] = useState<Set<string>>(new Set());
  const [discussionLiked, setDiscussionLiked] = useState(false);
  const [discussionLikes, setDiscussionLikes] = useState(0);
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharePointsEarned, setSharePointsEarned] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [exportToast, setExportToast] = useState<string | null>(null);
  // Simulated active viewers with rotating count via WebSocket simulation
  const [activeViewers, setActiveViewers] = useState(() => Math.floor(Math.random() * 8) + 2);

  const discussion = useMemo(() => CLUB_DISCUSSIONS.find((d) => d.id === discussionId), [discussionId]);
  const club = useMemo(() => CLUBS.find((c) => c.id === discussion?.clubId), [discussion]);

  useState(() => {
    if (discussionId) {
      setReplies(getDiscussionReplies(discussionId));
    }
  });

  // Set initial discussion likes
  useEffect(() => {
    if (discussion) {
      setDiscussionLikes(discussion.likes || 0);
    }
  }, [discussion]);

  // WebSocket simulation — rotate active viewers every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveViewers((prev) => {
        const delta = Math.random() > 0.5 ? 1 : -1;
        const next = prev + delta;
        return Math.max(2, Math.min(12, next));
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!discussion) {
    return (
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Discussion Not Found" pageSubtitle="The discussion thread you are looking for does not exist"
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-6 flex flex-col items-center justify-center py-24">
          <span className="w-20 h-20 rounded-3xl bg-foreground-100 flex items-center justify-center mb-6">
            <AppIcon className="ri-emotion-sad-line text-foreground-300 text-3xl"></AppIcon>
          </span>
          <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">Discussion Not Found</h2>
          <p className="text-sm text-foreground-500 mb-6">We couldn&apos;t find that discussion thread.</p>
          <Link
            to="/learner/clubs"
            className="px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all whitespace-nowrap"
          >
            <AppIcon className="ri-arrow-left-line mr-1.5"></AppIcon> Back to Clubs
          </Link>
        </div>
      </WorkspaceShell>
    );
  }

  const catColor = discussionCategoryColors[discussion.category] || 'bg-background-200 text-foreground-500';
  const totalReplies = replies.length;

  const handleSubmitReply = () => {
    if (!newReplyText.trim()) return;
    const newReply: DiscussionReply = {
      id: `rpl-new-${Date.now()}`,
      author: 'Sophie Williams',
      authorAvatar: 'SW',
      content: newReplyText,
      date: '13 Jun 2026',
      timeAgo: 'Just now',
      likes: 0,
      isLiked: false,
    };
    setReplies((prev) => [...prev, newReply]);
    setNewReplyText('');
  };

  const handleLikeDiscussion = () => {
    setDiscussionLiked((prev) => {
      if (!prev) setDiscussionLikes((l) => l + 1);
      else setDiscussionLikes((l) => l - 1);
      return !prev;
    });
  };

  const handleLikeReply = (replyId: string) => {
    setLikedReplies((prev) => {
      const next = new Set(prev);
      if (next.has(replyId)) next.delete(replyId);
      else next.add(replyId);
      return next;
    });
  };

  const handleShare = (platform: string) => {
    setShowShareModal(false);
    if (!sharePointsEarned) {
      setSharePointsEarned(true);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    }
  };

  const handleExportICS = () => {
    const icsEvent: ICSEvent = {
      title: `Discussion: ${discussion.title}`,
      description: `KBC Community Discussion: ${discussion.title}\n\nStarted by ${discussion.author} in ${club?.title || 'Club'}\n\n${discussion.content.substring(0, 200)}...`,
      date: '13 Jun',
      time: '14:00–15:00',
      location: 'KBC Learner Community',
    };
    downloadICS(icsEvent);
    setExportToast('Discussion saved to your calendar!');
    setTimeout(() => setExportToast(null), 2500);
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={discussion.title} pageSubtitle={`${discussion.category} · ${club?.title || 'Club'} · ${totalReplies} replies`}
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      {/* Confetti overlay */}
      {showConfetti && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          {Array.from({ length: 150 }).map((_, i) => {
            const colors = ['bg-accent-500', 'bg-primary-500', 'bg-secondary-500', 'bg-amber-400', 'bg-emerald-400', 'bg-rose-400'];
            const color = colors[i % colors.length];
            const left = Math.random() * 100;
            const delay = Math.random() * 2;
            const duration = 2 + Math.random() * 3;
            const size = 6 + Math.random() * 8;
            return (
              <div
                key={i}
                className={`absolute ${color} rounded-sm opacity-80`}
                style={{
                  left: `${left}%`,
                  top: '-5%',
                  width: `${size}px`,
                  height: `${size * (0.6 + Math.random() * 0.8)}px`,
                  animation: `confetti-fall ${duration}s ease-in ${delay}s forwards`,
                  transform: `rotate(${Math.random() * 360}deg)`,
                }}
              />
            );
          })}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-background-50 rounded-2xl px-8 py-5 shadow-lg border border-accent-200/60 animate-in zoom-in-50 duration-300">
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center">
                  <AppIcon className="ri-coins-line text-xl"></AppIcon>
                </span>
                <div>
                  <p className="text-sm font-heading font-bold text-foreground-900">+25 Points Earned!</p>
                  <p className="text-xs text-foreground-500">You earned points for sharing this discussion</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ICS Export Toast */}
      {exportToast && (
        <div className="fixed top-20 right-6 z-50 bg-background-50 rounded-xl border border-emerald-200/60 shadow-lg px-4 py-3 flex items-center gap-3 animate-in slide-in-from-right-4 duration-300">
          <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <AppIcon className="ri-calendar-check-line"></AppIcon>
          </span>
          <p className="text-sm font-semibold text-foreground-900">{exportToast}</p>
        </div>
      )}

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Back navigation */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-500 hover:text-foreground-700 transition-all cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-arrow-left-line"></AppIcon>
          Back to {club?.title || 'Discussions'}
        </button>

        {/* Main Discussion Card */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-sm font-bold ring-2 ring-primary-100/50">
                {discussion.authorAvatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-foreground-900">{discussion.author}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${catColor}`}>{discussion.category}</span>
                  {club && (
                    <Link
                      to={`/learner/clubs/${club.id}`}
                      className="text-xs text-foreground-400 hover:text-primary-600 transition-smooth cursor-pointer"
                    >
                      in <strong>{club.title}</strong>
                    </Link>
                  )}
                </div>
                <h1 className="text-lg font-heading font-bold text-foreground-900 mb-2">{discussion.title}</h1>
                <div className="prose prose-sm max-w-none text-foreground-600 leading-relaxed whitespace-pre-line">
                  {discussion.content}
                </div>
                <div className="flex items-center gap-1 mt-3">
                  <span className="text-xs text-foreground-400">{discussion.timeAgo}</span>
                  <span className="text-foreground-300">·</span>
                  <span className="text-xs text-foreground-400">{discussion.date}</span>
                </div>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-4 pt-4 border-t border-background-200/40 mt-4">
              <button
                onClick={handleLikeDiscussion}
                className={`text-xs transition-smooth cursor-pointer flex items-center gap-1 ${discussionLiked ? 'text-red-500 font-semibold' : 'text-foreground-400 hover:text-red-500'}`}
              >
                <AppIcon className={`${discussionLiked ? 'ri-heart-fill' : 'ri-heart-line'}`}></AppIcon> {discussionLikes} Likes
              </button>
              <button className="text-xs text-foreground-400 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1">
                <AppIcon className="ri-chat-1-line"></AppIcon> {totalReplies} Replies
              </button>
              {/* Active viewers indicator — WebSocket simulation */}
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                {activeViewers} {activeViewers === 1 ? 'person' : 'people'} viewing now
              </span>
              <div className="relative ml-auto flex items-center gap-2">
                <button
                  onClick={handleExportICS}
                  className="text-xs text-foreground-400 hover:text-emerald-600 transition-smooth cursor-pointer flex items-center gap-1"
                  title="Add to Calendar"
                >
                  <AppIcon className="ri-calendar-2-line"></AppIcon> Calendar
                </button>
                <button
                  onClick={() => setShowShareModal(!showShareModal)}
                  className="text-xs text-foreground-400 hover:text-accent-600 transition-smooth cursor-pointer flex items-center gap-1"
                >
                  <AppIcon className="ri-share-forward-line"></AppIcon> Share (+25 pts)
                </button>
                {showShareModal && (
                  <div className="absolute right-0 top-full mt-2 bg-background-50 rounded-xl border border-background-200/60 shadow-lg p-2 z-20 min-w-[180px] animate-in slide-in-from-top-2 duration-200">
                    {socialPlatforms.map((platform) => (
                      <button
                        key={platform.name}
                        onClick={() => handleShare(platform.name)}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                      >
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${platform.color}`}>
                          <AppIcon className={`${platform.icon} text-xs`}></AppIcon>
                        </span>
                        {platform.name === 'Copy Link' ? (
                          <>
                            {platform.name}
                            <span className="ml-auto text-foreground-400 text-[10px]">+25 pts</span>
                          </>
                        ) : (
                          <>
                            Share on {platform.name}
                            <span className="ml-auto text-foreground-400 text-[10px]">+25 pts</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Replies Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900">
              Replies <span className="text-foreground-400 font-normal">({totalReplies})</span>
            </h2>
          </div>

          <div className="space-y-4">
            {replies.length === 0 ? (
              <div className="text-center py-12 bg-background-50 rounded-xl border border-background-200/50">
                <span className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-chat-1-line text-foreground-300 text-lg"></AppIcon>
                </span>
                <p className="text-sm text-foreground-500">No replies yet</p>
                <p className="text-xs text-foreground-400 mt-0.5">Be the first to join the conversation</p>
              </div>
            ) : (
              replies.map((reply) => {
                const isLiked = likedReplies.has(reply.id);
                return (
                  <div key={reply.id} className="bg-background-50 rounded-xl border border-background-200/50 p-5 hover:border-primary-200/30 transition-smooth">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-background-200 text-foreground-600 flex items-center justify-center shrink-0 text-[10px] font-bold">
                        {reply.authorAvatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-foreground-900">{reply.author}</span>
                          <span className="text-[9px] text-foreground-400">{reply.timeAgo}</span>
                        </div>
                        <p className="text-sm text-foreground-600 leading-relaxed">{reply.content}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => handleLikeReply(reply.id)}
                            className={`text-xs transition-smooth cursor-pointer flex items-center gap-1 ${isLiked ? 'text-red-500 font-semibold' : 'text-foreground-400 hover:text-red-400'}`}
                          >
                            <AppIcon className={`${isLiked ? 'ri-heart-fill' : 'ri-heart-line'}`}></AppIcon> {reply.likes + (isLiked ? 1 : 0)}
                          </button>
                          <button className="text-xs text-foreground-400 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1">
                            <AppIcon className="ri-reply-line"></AppIcon> Reply
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Reply Composer */}
          <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 mt-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">
                SW
              </div>
              <div className="flex-1">
                <textarea
                  value={newReplyText}
                  onChange={(e) => setNewReplyText(e.target.value)}
                  placeholder="Share your thoughts on this discussion..."
                  maxLength={500}
                  rows={3}
                  className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all resize-none"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-foreground-400">{newReplyText.length}/500</span>
                  <button
                    onClick={handleSubmitReply}
                    disabled={!newReplyText.trim()}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AppIcon className="ri-send-plane-line mr-1"></AppIcon> Post Reply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Related Discussions */}
        {club && (
          <section className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <AppIcon className="ri-links-line text-foreground-400"></AppIcon>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">More discussions in {club.title}</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CLUB_DISCUSSIONS.filter((d) => d.clubId === club.id && d.id !== discussion.id).slice(0, 2).map((d) => (
                <Link
                  key={d.id}
                  to={`/learner/clubs/discussion/${d.id}`}
                  className="bg-background-50 rounded-xl border border-background-200/50 p-4 hover:border-primary-200/50 transition-smooth cursor-pointer"
                >
                  <p className="text-sm font-semibold text-foreground-900 mb-1 line-clamp-1">{d.title}</p>
                  <p className="text-xs text-foreground-400 line-clamp-2 mb-2">{d.content}</p>
                  <div className="flex items-center gap-3 text-xs text-foreground-400">
                    <span><AppIcon className="ri-heart-line mr-0.5"></AppIcon>{d.likes}</span>
                    <span><AppIcon className="ri-chat-1-line mr-0.5"></AppIcon>{d.replies}</span>
                    <span className="ml-auto">{d.timeAgo}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </WorkspaceShell>
  );
}