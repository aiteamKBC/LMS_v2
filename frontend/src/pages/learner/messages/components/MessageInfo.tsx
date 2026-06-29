import { useEffect, useRef } from 'react';

interface MessageInfoProps {
  isOpen: boolean;
  onClose: () => void;
  messageText: string;
  sentTime: string;
  deliveredTime: string | null;
  readTime: string | null;
  readBy: string;
  isMyMessage: boolean;
}

export default function MessageInfo({ isOpen, onClose, messageText, sentTime, deliveredTime, readTime, readBy, isMyMessage }: MessageInfoProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const timeline = [
    {
      label: 'Sent',
      time: sentTime,
      icon: 'ri-check-line',
      color: 'bg-primary-500',
      active: true,
      description: 'Message was sent from your device',
    },
    {
      label: 'Delivered',
      time: deliveredTime,
      icon: 'ri-check-double-line',
      color: 'bg-secondary-500',
      active: !!deliveredTime,
      description: 'Message was delivered to the recipient',
    },
    {
      label: 'Read',
      time: readTime,
      icon: 'ri-eye-line',
      color: 'bg-emerald-500',
      active: !!readTime,
      description: readTime ? `Read by ${readBy}` : 'Message has not been read yet',
    },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={modalRef}
        className="bg-background-50 rounded-2xl shadow-2xl border border-background-200 w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-background-200/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center text-primary-500">
              <i className="ri-information-line text-sm"></i>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground-800">Message Info</h3>
              <p className="text-[10px] text-foreground-400">Message details and status</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
          >
            <i className="ri-close-line text-sm"></i>
          </button>
        </div>

        {/* Message preview */}
        <div className="px-5 py-3 bg-background-100/50">
          <div className={`inline-block max-w-full rounded-xl px-3.5 py-2 ${isMyMessage ? 'bg-primary-500 text-white' : 'bg-background-100 border border-background-200 text-foreground-800'}`}>
            <p className="text-sm leading-relaxed truncate max-w-[280px]">{messageText}</p>
          </div>
        </div>

        {/* Timeline */}
        <div className="px-5 py-4 space-y-0">
          {timeline.map((item, index) => (
            <div key={item.label} className="flex gap-3">
              {/* Timeline line */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-smooth ${item.active ? item.color : 'bg-background-200'}`}>
                  <i className={`${item.icon} text-sm ${item.active ? 'text-white' : 'text-foreground-400'}`}></i>
                </div>
                {index < timeline.length - 1 && (
                  <div className={`w-0.5 h-10 mt-1 ${item.active && timeline[index + 1].active ? 'bg-primary-300' : 'bg-background-200'}`}></div>
                )}
              </div>
              {/* Info */}
              <div className="pb-4">
                <p className={`text-sm font-semibold ${item.active ? 'text-foreground-800' : 'text-foreground-400'}`}>
                  {item.label}
                </p>
                {item.active && item.time ? (
                  <p className="text-xs text-foreground-500 mt-0.5 font-mono">{item.time}</p>
                ) : (
                  <p className="text-xs text-foreground-400 mt-0.5">Pending</p>
                )}
                <p className="text-[10px] text-foreground-400 mt-0.5">{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-background-200/70 bg-background-100/30 flex items-center justify-center gap-2">
          <i className="ri-shield-check-line text-[10px] text-foreground-400"></i>
          <p className="text-[10px] text-foreground-400">End-to-end encrypted</p>
        </div>
      </div>
    </div>
  );
}