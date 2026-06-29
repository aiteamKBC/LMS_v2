import { useState } from 'react';
import { FeedItem } from '../data';

const feedTypeConfig: Record<string, { bg: string; text: string; icon: string }> = {
  achievement: { bg: 'bg-accent-100', text: 'text-accent-700', icon: 'ri-trophy-line' },
  resource: { bg: 'bg-primary-100', text: 'text-primary-700', icon: 'ri-folder-upload-line' },
  'event-recap': { bg: 'bg-secondary-100', text: 'text-secondary-700', icon: 'ri-calendar-check-line' },
  discussion: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-chat-1-line' },
  announcement: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-megaphone-line' },
  badge: { bg: 'bg-accent-100', text: 'text-accent-700', icon: 'ri-medal-line' },
};

interface FeedCardProps {
  item: FeedItem & { isLiked?: boolean; isExpanded?: boolean };
  onToggleLike: (id: string) => void;
  onToggleComments: (id: string) => void;
  onAddComment: (id: string, comment: string) => void;
  comments: { id: string; author: string; authorAvatar: string; content: string; timeAgo: string }[];
}

export function FeedCard({ item, onToggleLike, onToggleComments, onAddComment, comments }: FeedCardProps) {
  const [commentText, setCommentText] = useState('');
  const typeConfig = feedTypeConfig[item.type] || feedTypeConfig.discussion;
  const liked = (item as FeedItem & { isLiked?: boolean }).isLiked || false;
  const expanded = (item as FeedItem & { isExpanded?: boolean }).isExpanded || false;

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    onAddComment(item.id, commentText);
    setCommentText('');
  };

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium hover:border-primary-200/50 transition-smooth">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-xs font-bold">
          {item.userAvatar}
        </div>
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-sm font-semibold text-foreground-900">{item.user}</span>
            <span className="text-xs text-foreground-400">{item.userRole}</span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${typeConfig.bg} ${typeConfig.text} flex items-center gap-1`}>
              <i className={`${typeConfig.icon} text-[9px]`}></i>
              {item.type.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          </div>

          {/* Content */}
          <p className="text-sm text-foreground-600 leading-relaxed mb-3">{item.content}</p>

          {/* Club + Date */}
          <div className="flex items-center gap-4 flex-wrap mb-3">
            <span className="text-xs text-foreground-400">in <strong className="text-foreground-500">{item.club}</strong></span>
            <span className="text-xs text-foreground-300">{item.timeAgo}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => onToggleLike(item.id)}
              className={`text-xs transition-smooth cursor-pointer flex items-center gap-1 ${liked ? 'text-red-500 font-semibold' : 'text-foreground-400 hover:text-red-400'}`}
            >
              <i className={`${liked ? 'ri-heart-fill' : 'ri-heart-line'}`}></i> {item.likes + (liked ? 1 : 0)}
            </button>
            <button
              onClick={() => onToggleComments(item.id)}
              className="text-xs text-foreground-400 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1"
            >
              <i className="ri-chat-1-line"></i> {item.comments + comments.length}
            </button>
            <button className="text-xs text-foreground-400 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1 ml-auto">
              <i className="ri-share-forward-line"></i> Share
            </button>
          </div>

          {/* Comment Section */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-background-200/40 space-y-3">
              {/* Existing comments */}
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-background-200 text-foreground-500 flex items-center justify-center shrink-0 text-[9px] font-bold">
                    {c.authorAvatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="bg-background-100 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-foreground-800">{c.author}</p>
                      <p className="text-xs text-foreground-600 mt-0.5">{c.content}</p>
                    </div>
                    <p className="text-[10px] text-foreground-400 mt-0.5 ml-1">{c.timeAgo}</p>
                  </div>
                </div>
              ))}

              {/* Add comment */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-[9px] font-bold">
                  SW
                </div>
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 bg-background-100 border border-background-200/50 rounded-lg px-3 py-1.5 text-xs text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitComment();
                  }}
                />
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentText.trim()}
                  className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Post
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}