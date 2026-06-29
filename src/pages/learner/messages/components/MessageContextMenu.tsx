import { useEffect, useRef } from 'react';

interface ContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  onReply: () => void;
  onForward: () => void;
  onPin: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDeleteForEveryone: () => void;
  onMessageInfo: () => void;
  onStar?: () => void;
  isMyMessage: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  isStarred?: boolean;
}

export default function MessageContextMenu({
  isOpen,
  onClose,
  position,
  onReply,
  onForward,
  onPin,
  onCopy,
  onDelete,
  onDeleteForEveryone,
  onMessageInfo,
  isMyMessage,
  isPinned,
  isDeleted,
  isStarred,
  onStar,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  // Ensure menu stays within viewport
  const menuWidth = 200;
  const menuHeight = 280;
  const x = Math.min(position.x, window.innerWidth - menuWidth - 16);
  const y = Math.min(position.y, window.innerHeight - menuHeight - 16);

  if (!isOpen) return null;

  const menuItems = [
    // Group 1: Actions
    { id: 'reply', label: 'Reply', icon: 'ri-reply-line', color: 'text-foreground-700', onClick: onReply, visible: !isDeleted },
    { id: 'forward', label: 'Forward', icon: 'ri-share-forward-line', color: 'text-foreground-700', onClick: onForward, visible: !isDeleted },
    { id: 'copy', label: 'Copy text', icon: 'ri-file-copy-line', color: 'text-foreground-700', onClick: onCopy, visible: !isDeleted },
    // Divider
    { id: 'divider1', label: '', icon: '', color: '', onClick: () => {}, visible: !isDeleted },
    // Group 2: Pin + Star + Info
    { id: 'pin', label: isPinned ? 'Unpin' : 'Pin message', icon: isPinned ? 'ri-pushpin-fill' : 'ri-pushpin-line', color: 'text-foreground-700', onClick: onPin, visible: !isDeleted },
    { id: 'star', label: isStarred ? 'Unstar message' : 'Star message', icon: isStarred ? 'ri-star-fill' : 'ri-star-line', color: isStarred ? 'text-amber-500' : 'text-foreground-700', onClick: onStar || (() => {}), visible: !isDeleted },
    { id: 'info', label: 'Message info', icon: 'ri-information-line', color: 'text-foreground-700', onClick: onMessageInfo, visible: !isDeleted },
    // Divider
    { id: 'divider2', label: '', icon: '', color: '', onClick: () => {}, visible: true },
    // Group 3: Delete
    { id: 'delete', label: 'Delete for me', icon: 'ri-delete-bin-line', color: 'text-red-500', onClick: onDelete, visible: true },
    { id: 'delete-everyone', label: 'Delete for everyone', icon: 'ri-delete-bin-2-line', color: 'text-red-500', onClick: onDeleteForEveryone, visible: isMyMessage && !isDeleted },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[300] bg-background-50 rounded-xl shadow-2xl border border-background-200/80 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      style={{ top: Math.max(8, y), left: Math.max(8, x), width: menuWidth, minWidth: 180 }}
    >
      {menuItems.map((item) => {
        if (!item.visible) return null;
        if (item.id.startsWith('divider')) {
          return <div key={item.id} className="mx-3 my-1 h-px bg-background-200/60" />;
        }
        return (
          <button
            key={item.id}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-background-100 transition-colors duration-100 cursor-pointer"
          >
            <div className={`w-5 h-5 flex items-center justify-center ${item.color}`}>
              <i className={`${item.icon} text-sm`}></i>
            </div>
            <span className={`text-sm ${item.color}`}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}