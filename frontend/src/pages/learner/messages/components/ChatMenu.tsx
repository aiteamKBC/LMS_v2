import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatMenuProps {
  contactName: string;
  onClearChat: () => void;
  onMuteChat: () => void;
  onBlockChat: () => void;
  onReportChat: () => void;
}

export default function ChatMenu({ contactName, onClearChat, onMuteChat, onBlockChat, onReportChat }: ChatMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [showToast, setShowToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => setIsOpen(prev => !prev);

  const closeMenu = useCallback(() => setIsOpen(false), []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, closeMenu]);

  const showToastMsg = (msg: string) => {
    setShowToast(msg);
    setTimeout(() => setShowToast(null), 2500);
  };

  const handleMute = () => {
    setMuted(prev => !prev);
    setIsOpen(false);
    showToastMsg(muted ? 'Notifications unmuted' : 'Notifications muted');
    onMuteChat();
  };

  const handleClear = () => {
    setIsOpen(false);
    showToastMsg('Chat cleared');
    onClearChat();
  };

  const handleBlock = () => {
    setBlocked(prev => !prev);
    setIsOpen(false);
    showToastMsg(blocked ? `Unblocked ${contactName.split(' ')[0]}` : `Blocked ${contactName.split(' ')[0]}`);
    onBlockChat();
  };

  const handleReport = () => {
    setIsOpen(false);
    showToastMsg('Report submitted — we will review shortly');
    onReportChat();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
      >
        <AppIcon className="ri-more-2-fill text-sm"></AppIcon>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-10 w-56 bg-background-50 rounded-xl shadow-xl border border-background-200 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="px-3 py-1.5 border-b border-background-200/50 mb-1">
            <p className="text-xs font-semibold text-foreground-400">{contactName}</p>
          </div>

          <button
            onClick={handleMute}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground-600 hover:bg-background-100 transition-smooth text-left cursor-pointer"
          >
            <AppIcon className={`${muted ? 'ri-notification-off-line' : 'ri-notification-3-line'} text-foreground-400 text-sm w-4 flex items-center justify-center`}></AppIcon>
            {muted ? 'Unmute Notifications' : 'Mute Notifications'}
          </button>

          <button
            onClick={handleClear}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground-600 hover:bg-background-100 transition-smooth text-left cursor-pointer"
          >
            <AppIcon className="ri-delete-bin-line text-foreground-400 text-sm w-4 flex items-center justify-center"></AppIcon>
            Clear Chat
          </button>

          <div className="border-t border-background-200/50 my-1" />

          <button
            onClick={handleBlock}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground-600 hover:bg-background-100 transition-smooth text-left cursor-pointer"
          >
            <AppIcon className={`${blocked ? 'ri-user-add-line' : 'ri-user-forbid-line'} text-foreground-400 text-sm w-4 flex items-center justify-center`}></AppIcon>
            {blocked ? 'Unblock' : 'Block'}
          </button>

          <button
            onClick={handleReport}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50/50 transition-smooth text-left cursor-pointer"
          >
            <AppIcon className="ri-flag-line text-red-400 text-sm w-4 flex items-center justify-center"></AppIcon>
            Report
          </button>
        </div>
      )}

      {/* Toast */}
      {showToast && (
        <div className="absolute right-0 top-14 w-56 bg-foreground-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <AppIcon className="ri-check-line mr-1 text-emerald-400"></AppIcon>
          {showToast}
        </div>
      )}
    </div>
  );
}