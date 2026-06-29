import { useState, useRef, useCallback, useEffect } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import TypingIndicator from '@/components/feature/TypingIndicator';
import { highlightText } from '@/components/feature/HighlightText';
import CallModal from '@/pages/learner/messages/components/CallModal';
import ChatMenu from '@/pages/learner/messages/components/ChatMenu';
import EmojiPicker from '@/pages/learner/messages/components/EmojiPicker';
import MessageContextMenu from '@/pages/learner/messages/components/MessageContextMenu';
import MessageInfo from '@/pages/learner/messages/components/MessageInfo';
import FloatingFab from '@/pages/learner/messages/components/FloatingFab';

const adminNav = roleNavMap.admin;

interface Contact {
  id: string;
  name: string;
  initials: string;
  role: string;
  avatarColor: string;
  online: boolean;
  lastSeen: string;
  channel: string;
}

interface MessageThread {
  id: string;
  contact: Contact;
  lastMessage: string;
  lastTime: string;
  unread: number;
  status: 'sent' | 'scheduled' | 'draft' | 'pending';
  tags: string[];
}

interface Message {
  id: string;
  from: 'them' | 'me';
  text: string;
  time: string;
  date: string;
  fileName?: string;
  fileType?: 'image' | 'file';
  scheduled?: boolean;
  scheduledTime?: string;
  reactions?: Record<string, string[]>;
  replyTo?: string;
  replies?: Message[];
  status?: 'sent' | 'delivered' | 'read';
  voiceNote?: { url: string; duration: number };
  deletedForEveryone?: boolean;
  callType?: 'voice' | 'video';
  callDuration?: number;
  callStatus?: 'completed' | 'missed' | 'declined';
}

interface ScheduledMsg {
  id: string;
  threadId: string;
  text: string;
  sendAt: Date;
  fileName?: string;
  fileType?: 'image' | 'file';
}

const CONTACTS: Contact[] = [
  { id: 'med-maher', name: 'Med Maher', initials: 'MM', role: 'Progress Coach', avatarColor: 'bg-primary-100 text-primary-700', online: true, lastSeen: 'Active now', channel: 'email' },
  { id: 'qa-officer', name: 'Tom Bradley', initials: 'TB', role: 'QA Officer', avatarColor: 'bg-accent-100 text-accent-700', online: false, lastSeen: 'Last seen 3h ago', channel: 'email' },
  { id: 'learner-support', name: 'Learner Support', initials: 'LS', role: 'KBC Support Team', avatarColor: 'bg-secondary-100 text-secondary-700', online: true, lastSeen: 'Active now', channel: 'in-app' },
  { id: 'engagement-bot', name: 'Engagement Bot', initials: 'EB', role: 'Automation', avatarColor: 'bg-amber-100 text-amber-700', online: true, lastSeen: 'Active now', channel: 'whatsapp' },
  { id: 'finance-team', name: 'Lisa Nguyen', initials: 'LN', role: 'Finance Officer', avatarColor: 'bg-emerald-100 text-emerald-700', online: false, lastSeen: 'Last seen 1d ago', channel: 'email' },
  { id: 'compliance-bot', name: 'Compliance Bot', initials: 'CB', role: 'Automation', avatarColor: 'bg-amber-100 text-amber-700', online: true, lastSeen: 'Active now', channel: 'in-app' },
  { id: 'crispin-jones', name: 'Crispin Jones', initials: 'CJ', role: 'Curriculum Tutor', avatarColor: 'bg-primary-100 text-primary-700', online: true, lastSeen: 'Active now', channel: 'in-app' },
  { id: 'dr-karen', name: 'Dr. Karen Ashby', initials: 'KA', role: 'CEO / SLT', avatarColor: 'bg-accent-100 text-accent-700', online: false, lastSeen: 'Last seen 5h ago', channel: 'email' },
  { id: 'security-alert', name: 'System Security', initials: 'SS', role: 'Security Alert', avatarColor: 'bg-red-100 text-red-700', online: true, lastSeen: 'Active now', channel: 'in-app' },
];

const THREADS: MessageThread[] = [
  { id: 'th-01', contact: CONTACTS[0], lastMessage: 'Please find attached the monthly coaching summary for Cohort A and C learners. All sessions logged.', lastTime: 'Yesterday', unread: 0, status: 'sent', tags: ['Coaching', 'Monthly'] },
  { id: 'th-02', contact: CONTACTS[1], lastMessage: 'Evidence Pack #EV-2024-442 failed QA review. 3 items rejected for insufficient KSB mapping. Urgent action needed.', lastTime: '2h ago', unread: 2, status: 'sent', tags: ['QA', 'Urgent'] },
  { id: 'th-03', contact: CONTACTS[2], lastMessage: 'Welcome to KBC LearningOS! Here is everything you need to know to get started with your apprenticeship journey.', lastTime: '6d ago', unread: 0, status: 'sent', tags: ['Onboarding'] },
  { id: 'th-04', contact: CONTACTS[3], lastMessage: 'Your attendance has dropped to 82%, below the 85% minimum. Please contact your coach for a catch-up plan.', lastTime: '4d ago', unread: 1, status: 'sent', tags: ['Attendance', 'Alert'] },
  { id: 'th-05', contact: CONTACTS[4], lastMessage: 'Q2 2026 DAS payment statement attached. Payments totalling £45,200 credited to your account.', lastTime: '10d ago', unread: 0, status: 'sent', tags: ['Finance', 'DAS'] },
  { id: 'th-06', contact: CONTACTS[5], lastMessage: 'Your June monthly cycle checklist is now live. 14 coaching sessions to log, 8 reviews due.', lastTime: '10d ago', unread: 0, status: 'sent', tags: ['Monthly Cycle'] },
  { id: 'th-07', contact: CONTACTS[6], lastMessage: 'I have published the new Data Cleaning module for Data Analyst L4. KSB mapping complete for K4, K7, S3, B2.', lastTime: '2d ago', unread: 1, status: 'sent', tags: ['Curriculum'] },
  { id: 'th-08', contact: CONTACTS[7], lastMessage: 'June ILR deadline 14 June. Please confirm the export is ready and funding reconciliation complete.', lastTime: '5d ago', unread: 0, status: 'sent', tags: ['Compliance'] },
  { id: 'th-09', contact: CONTACTS[8], lastMessage: 'Multiple failed login attempts detected from IP 203.45.67.89. IP has been temporarily blocked.', lastTime: '2d ago', unread: 3, status: 'sent', tags: ['Security', 'Alert'] },
];

const SAMPLE_MESSAGES: Record<string, Message[]> = {
  'th-01': [
    { id: 'm01', from: 'them', text: 'Hi Admin, please find attached the monthly coaching summary for Cohort A and C learners. All sessions have been logged and evidence validated. 2 learners are flagged as at risk for July review.', time: '09:30', date: '10 Jun 2026', status: 'read' },
    { id: 'm02', from: 'me', text: 'Thanks Med. I have reviewed the summary and forwarded it to QA. Can you provide more detail on the 2 at-risk learners so we can flag them in the leadership dashboard?', time: '10:00', date: '10 Jun 2026', status: 'read' },
    { id: 'm03', from: 'them', text: 'Of course — Sophie Williams (OTJH behind, 74 hours vs 100 target) and Finn Murphy (attendance 71%, 4 missed sessions). Both have catch-up plans in place.', time: '10:15', date: '10 Jun 2026', status: 'read', reactions: { '👍': ['Alex'] } },
    { id: 'cl-am01', from: 'me', text: 'Video call • 30 min', time: '3:00 PM', date: '8 Jun 2026', callType: 'video', callDuration: 1800, callStatus: 'completed', status: 'read' },
    { id: 'cl-am02', from: 'them', text: 'Missed video call', time: '11:45 AM', date: '6 Jun 2026', callType: 'video', callStatus: 'missed', status: 'read' },
  ],
  'th-02': [
    { id: 'm04', from: 'them', text: 'Evidence Pack #EV-2024-442 has failed QA review. 3 items have been rejected due to insufficient mapping to KSB criteria. Immediate action required from the coach to resubmit corrected evidence within 48 hours.', time: '11:20', date: '10 Jun 2026', status: 'read' },
    { id: 'm05', from: 'me', text: 'Acknowledged Tom. Notifying Med Maher now. I will set the 48-hour countdown in the system and flag the learner on the admin dashboard.', time: '11:30', date: '10 Jun 2026', status: 'read' },
    { id: 'm06', from: 'them', text: 'Thanks. Please also mark this as urgent in the audit trail. We have Ofsted readiness checks coming up and cannot have unresolved QA failures.', time: '11:35', date: '10 Jun 2026', status: 'read', reactions: { '🔥': ['Alex'] } },
    { id: 'cl-am03', from: 'me', text: 'Voice call • 10 min', time: '2:30 PM', date: '5 Jun 2026', callType: 'voice', callDuration: 600, callStatus: 'completed', status: 'read' },
  ],
  'th-07': [
    { id: 'm07', from: 'them', text: 'Hi, I have published the new Data Cleaning module for Data Analyst L4 learners. The module includes 6 lessons, 2 assessments, and a portfolio assignment. KSB mapping has been completed for K4, K7, S3, and B2.', time: '14:15', date: '9 Jun 2026', status: 'read' },
    { id: 'm08', from: 'me', text: 'Great work Crispin! I will assign this module to the Data Analyst L4 cohorts. Can you confirm this is ready for the April 2026 intake?', time: '14:30', date: '9 Jun 2026', status: 'read' },
    { id: 'm09', from: 'them', text: 'Yes, fully QA-approved and ready for April 2026 intake. Module dates are in the session calendar.', time: '14:45', date: '9 Jun 2026', status: 'read' },
  ],
  'th-09': [
    { id: 'm10', from: 'them', text: 'Multiple failed login attempts have been detected from IP address 203.45.67.89 targeting the account david.chen@kbc.ac.uk at 08:12 on 9 Jun 2026. This IP has been temporarily blocked. Please review audit logs.', time: '08:13', date: '9 Jun 2026', status: 'read' },
    { id: 'm11', from: 'me', text: 'Investigating now. I have checked the audit logs — 6 failed attempts from that IP within 10 minutes. Blocking the IP range and notifying David to reset his password.', time: '08:20', date: '9 Jun 2026', status: 'read' },
    { id: 'm12', from: 'me', text: 'Update: David confirmed it was not him. A phishing attempt was likely the cause. I have enabled MFA on his account and added the IP to the permanent blocklist.', time: '08:45', date: '9 Jun 2026', status: 'read', reactions: { '👏': ['System Security'] } },
  ],
};

const AUTO_REPLIES: Record<string, string[]> = {
  'th-01': [
    'Will do — I will prepare the detailed breakdown for the dashboard. Thanks Alex!',
    'Great, I will have the full report by end of day.',
  ],
  'th-02': [
    'Perfect, thanks for the quick action. I will monitor the 48-hour window.',
    'Noted. I will update the audit trail accordingly.',
  ],
  'th-07': [
    'Thanks Alex! Let me know if there are any issues with the cohort assignment.',
    'Appreciate the quick turnaround. Looking forward to seeing it live.',
  ],
  'th-09': [
    'Understood. Logging this incident in the security report. Thanks for the swift response.',
    'Good call on the MFA and blocklist. I will add a note for the next security audit.',
  ],
  default: [
    'Thanks Alex, I appreciate the quick response.',
    'Got it, will follow up on this.',
    'Acknowledged. Let me know if you need anything else.',
  ],
};

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch { /* AudioContext not available */ }
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatVoiceDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getHeaderBg(avatarColor: string): string {
  if (avatarColor.includes('primary-100')) return 'bg-primary-50';
  if (avatarColor.includes('accent-100')) return 'bg-accent-50';
  if (avatarColor.includes('secondary-100')) return 'bg-secondary-50';
  if (avatarColor.includes('amber-100')) return 'bg-amber-50';
  if (avatarColor.includes('emerald-100')) return 'bg-emerald-50';
  if (avatarColor.includes('red-100')) return 'bg-red-50';
  return 'bg-background-50';
}

function VoiceNotePlayer({ url, duration, isFromMe }: { url: string; duration: number; isFromMe: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener('loadedmetadata', () => setAudioReady(true));
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('ended', () => { setPlaying(false); setCurrentTime(0); });
    audio.addEventListener('error', () => setAudioReady(false));
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [url]);

  const togglePlay = () => {
    if (!audioRef.current || !audioReady) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const barCount = 16;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={togglePlay}
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-smooth ${
          isFromMe ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-primary-500 text-white hover:bg-primary-600'
        }`}
      >
        <i className={`${playing ? 'ri-pause-fill' : 'ri-play-fill'} text-sm`}></i>
      </button>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: barCount }).map((_, i) => {
          const barProgress = i / barCount;
          const isActive = barProgress <= progress;
          const heights = [8, 14, 22, 16, 24, 18, 28, 20, 26, 16, 22, 14, 20, 18, 12, 8];
          return (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-all duration-100 ${
                isActive
                  ? isFromMe ? 'bg-white' : 'bg-primary-500'
                  : isFromMe ? 'bg-white/50' : 'bg-primary-200'
              }`}
              style={{ height: `${heights[i]}px` }}
            ></div>
          );
        })}
      </div>
      <span className={`text-xs whitespace-nowrap ${isFromMe ? 'text-white/80' : 'text-foreground-400'}`}>
        {playing ? formatVoiceDuration(Math.floor(currentTime)) : formatVoiceDuration(duration)}
      </span>
    </div>
  );
}

export default function AdminMessagesPage() {
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversationMessages, setConversationMessages] = useState<Record<string, Message[]>>({});
  const [callOpen, setCallOpen] = useState(false);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showChatSearch, setShowChatSearch] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');

  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMsg[]>([]);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleMinutes, setScheduleMinutes] = useState(5);
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});

  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const [pinnedMessages, setPinnedMessages] = useState<Record<string, string | null>>({});

  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null);

  const [deletedMessages, setDeletedMessages] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // Emoji picker and Message info
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiPickerPosition, setEmojiPickerPosition] = useState({ top: 0, left: 0 });
  const [emojiPickerTargetId, setEmojiPickerTargetId] = useState<string | null>(null);
  const [messageInfoOpen, setMessageInfoOpen] = useState(false);
  const [messageInfoId, setMessageInfoId] = useState<string | null>(null);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msgId: string | null }>({ x: 0, y: 0, msgId: null });

  // Starred messages
  const [starredMessageIds, setStarredMessageIds] = useState<Set<string>>(new Set());

  const handleStarMessage = (msgId: string) => {
    const msg = getMessageById(msgId);
    if (!msg || msg.deletedForEveryone) return;
    const now = new Date();
    const starredAt = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const STARRED_KEY = 'kbc_starred_messages';
    const existing = JSON.parse(localStorage.getItem(STARRED_KEY) || '[]');
    if (starredMessageIds.has(msgId)) {
      setStarredMessageIds(prev => { const n = new Set(prev); n.delete(msgId); return n; });
      localStorage.setItem(STARRED_KEY, JSON.stringify(existing.filter((s: { id: string }) => s.id !== `admin-${msgId}`)));
    } else {
      setStarredMessageIds(prev => new Set([...prev, msgId]));
      const starredEntry = {
        id: `admin-${msgId}`,
        threadId: activeThread || '',
        contactName: activeThreadData?.contact.name || '',
        contactInitials: activeThreadData?.contact.initials || '',
        contactColor: activeThreadData?.contact.avatarColor || 'bg-primary-100 text-primary-700',
        contactRole: activeThreadData?.contact.role || '',
        text: msg.text,
        time: msg.time,
        date: msg.date,
        isFromMe: msg.from === 'me',
        starredAt,
        role: 'admin',
      };
      localStorage.setItem(STARRED_KEY, JSON.stringify([...existing.filter((s: { id: string }) => s.id !== starredEntry.id), starredEntry]));
    }
  };

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const activeThreadData = activeThread ? THREADS.find(t => t.id === activeThread) : null;
  const baseMessages = activeThread ? (SAMPLE_MESSAGES[activeThread] || []) : [];
  const appendedMessages = activeThread ? (conversationMessages[activeThread] || []) : [];
  const messages = [...baseMessages, ...appendedMessages];
  const filteredThreads = searchQuery
    ? THREADS.filter(t =>
        t.contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : THREADS;

  const chatFilteredMessages = (chatSearchQuery.trim()
    ? messages.filter(m => m.text.toLowerCase().includes(chatSearchQuery.toLowerCase()))
    : messages).filter(m => !deletedMessages.has(m.id));

  const totalUnread = THREADS.reduce((sum, t) => sum + t.unread, 0);
  const scheduledCount = THREADS.filter(t => t.status === 'scheduled').length;

  const getAutoReply = useCallback((threadId: string): string => {
    const replies = AUTO_REPLIES[threadId] || AUTO_REPLIES.default;
    return replies[Math.floor(Math.random() * replies.length)];
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (scheduledMessages.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const newCountdowns: Record<string, number> = {};
      scheduledMessages.forEach(sm => {
        const remaining = sm.sendAt.getTime() - now;
        newCountdowns[sm.id] = Math.max(0, remaining);
      });
      setCountdowns(newCountdowns);
    }, 1000);
    return () => clearInterval(interval);
  }, [scheduledMessages]);

  useEffect(() => {
    if (scheduledMessages.length === 0) return;
    const now = Date.now();
    const due = scheduledMessages.filter(sm => sm.sendAt.getTime() <= now);
    if (due.length === 0) return;

    due.forEach(sm => {
      const timeStr = sm.sendAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const dateStr = sm.sendAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const msg: Message = {
        id: `sch-${sm.id}`,
        from: 'me',
        text: sm.text,
        time: timeStr,
        date: dateStr,
        fileName: sm.fileName,
        fileType: sm.fileType,
      };
      setConversationMessages(prev => ({
        ...prev,
        [sm.threadId]: [...(prev[sm.threadId] || []), msg],
      }));
    });

    setScheduledMessages(prev => prev.filter(sm => sm.sendAt.getTime() > now));
  }, [scheduledMessages, countdowns]);

  useEffect(() => {
    if (!activeThread) return;
    const msgs = conversationMessages[activeThread] || [];
    const activeContact = activeThreadData?.contact;
    const isOnline = activeContact?.online;

    const timers: ReturnType<typeof setTimeout>[] = [];
    msgs.forEach(msg => {
      if (msg.from !== 'me') return;
      if (msg.status === 'sent') {
        const t = setTimeout(() => {
          setConversationMessages(prev => {
            const updated = [...(prev[activeThread!] || [])];
            const found = updated.find(m => m.id === msg.id);
            if (found && found.status === 'sent') found.status = 'delivered';
            return { ...prev, [activeThread!]: updated };
          });
        }, 2000 + Math.random() * 1500);
        timers.push(t);
      }
      if (msg.status === 'delivered' && isOnline) {
        const t = setTimeout(() => {
          setConversationMessages(prev => {
            const updated = [...(prev[activeThread!] || [])];
            const found = updated.find(m => m.id === msg.id);
            if (found && found.status === 'delivered') found.status = 'read';
            return { ...prev, [activeThread!]: updated };
          });
        }, 3000 + Math.random() * 3000);
        timers.push(t);
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [conversationMessages, activeThread, activeThreadData?.contact?.online]);

  const handleSend = () => {
    if ((!newMessage.trim() && attachedFiles.length === 0) || !activeThread) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const msgs: Message[] = [];
    if (newMessage.trim()) {
      msgs.push({
        id: `u-${Date.now()}-txt`,
        from: 'me',
        text: newMessage.trim(),
        time: timeStr,
        date: dateStr,
        status: 'sent',
        replyTo: replyToId || undefined,
      });
    }
    attachedFiles.forEach((f, i) => {
      msgs.push({
        id: `u-${Date.now()}-f${i}`,
        from: 'me',
        text: f,
        time: timeStr,
        date: dateStr,
        fileName: f,
        fileType: f.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? 'image' : 'file',
        status: 'sent',
        replyTo: replyToId || undefined,
      });
    });
    setConversationMessages(prev => ({
      ...prev,
      [activeThread]: [...(prev[activeThread] || []), ...msgs],
    }));
    setNewMessage('');
    setAttachedFiles([]);
    setShowFilePicker(false);
    setReplyToId(null);

    setIsTyping(true);
    const delay = 1800 + Math.random() * 2500;
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      const replyTime = new Date();
      const replyTimeStr = replyTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const reply: Message = {
        id: `r-${Date.now()}`,
        from: 'them',
        text: getAutoReply(activeThread),
        time: replyTimeStr,
        date: dateStr,
        status: 'read',
      };
      setConversationMessages(prev => ({
        ...prev,
        [activeThread]: [...(prev[activeThread] || []), reply],
      }));
      playNotificationSound();
      window.dispatchEvent(new CustomEvent('new-message-received'));
      typingTimerRef.current = null;
    }, delay);
  };

  const handleScheduleSend = () => {
    if ((!newMessage.trim() && attachedFiles.length === 0) || !activeThread) return;
    const sendAt = new Date(Date.now() + scheduleMinutes * 60 * 1000);
    const text = newMessage.trim();
    const file = attachedFiles[0];
    const sm: ScheduledMsg = {
      id: `sch-${Date.now()}`,
      threadId: activeThread,
      text: text || file,
      sendAt,
      fileName: file,
      fileType: file ? (file.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? 'image' : 'file') : undefined,
    };
    setScheduledMessages(prev => [...prev, sm]);
    setNewMessage('');
    setAttachedFiles([]);
    setShowSchedulePicker(false);
    setShowFilePicker(false);
  };

  const cancelScheduled = (id: string) => {
    setScheduledMessages(prev => prev.filter(s => s.id !== id));
  };

  const handleSelectThread = (threadId: string) => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      setIsTyping(false);
      typingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    setActiveThread(threadId);
    setAttachedFiles([]);
    setShowFilePicker(false);
    setShowChatSearch(false);
    setChatSearchQuery('');
    setReplyToId(null);
    setShowReactionPicker(null);
  };

  const handleStartCall = (type: 'voice' | 'video') => {
    setCallType(type);
    setCallOpen(true);
  };

  const handleCallEnd = useCallback((endedCallType: 'voice' | 'video', duration: number) => {
    if (!activeThread) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const durationText = mins > 0 ? `${mins} min${secs > 0 ? ` ${secs} sec` : ''}` : `${secs} sec`;
    const callLogMsg: Message = {
      id: `call-${Date.now()}`,
      from: 'me',
      text: `${endedCallType === 'voice' ? 'Voice call' : 'Video call'} • ${durationText}`,
      time: timeStr,
      date: dateStr,
      status: 'read',
      callType: endedCallType,
      callDuration: duration,
      callStatus: 'completed',
    };
    setConversationMessages(prev => ({
      ...prev,
      [activeThread]: [...(prev[activeThread] || []), callLogMsg],
    }));
  }, [activeThread]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const names = Array.from(files).map(f => f.name);
    setAttachedFiles(prev => [...prev, ...names]);
    setShowFilePicker(false);
  };

  const handleAttachClick = () => {
    setShowFilePicker(prev => !prev);
  };

  const removeFile = (name: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== name));
  };

  const handleClearChat = () => {
    if (!activeThread) return;
    setConversationMessages(prev => ({ ...prev, [activeThread]: [] }));
  };

  const handleMuteChat = () => {};
  const handleBlockChat = () => {};
  const handleReportChat = () => {};

  const handleAddReaction = (msgId: string, emoji: string) => {
    setConversationMessages(prev => {
      const threadMsgs = [...(prev[activeThread!] || [])];
      const existing = threadMsgs.find(m => m.id === msgId);
      if (existing) {
        const currentReactions = existing.reactions || {};
        const users = currentReactions[emoji] || [];
        if (users.includes('Alex')) {
          existing.reactions = { ...currentReactions, [emoji]: users.filter(u => u !== 'Alex') };
          if (existing.reactions[emoji].length === 0) delete existing.reactions[emoji];
        } else {
          existing.reactions = { ...currentReactions, [emoji]: [...users, 'Alex'] };
        }
      }
      return { ...prev, [activeThread!]: threadMsgs };
    });
    setShowReactionPicker(null);
  };

  const getMessageById = (msgId: string): Message | undefined => {
    const allMsgs = [...(SAMPLE_MESSAGES[activeThread!] || []), ...(conversationMessages[activeThread!] || [])];
    return allMsgs.find(m => m.id === msgId);
  };

  const handleReply = (msgId: string) => {
    const targetMsg = getMessageById(msgId);
    if (targetMsg?.deletedForEveryone) return;
    setReplyToId(msgId);
  };
  const cancelReply = () => setReplyToId(null);

  const handlePinMessage = (msgId: string) => {
    const targetMsg = getMessageById(msgId);
    if (targetMsg?.deletedForEveryone) return;
    if (!activeThread) return;
    setPinnedMessages(prev => {
      const current = prev[activeThread];
      return { ...prev, [activeThread]: current === msgId ? null : msgId };
    });
  };

  const pinnedMsg = activeThread ? (pinnedMessages[activeThread] ? messages.find(m => m.id === pinnedMessages[activeThread]) : null) : null;

  const handleForwardClick = (msgId: string) => {
    const targetMsg = getMessageById(msgId);
    if (targetMsg?.deletedForEveryone) return;
    setForwardMsgId(msgId);
    setShowForwardModal(true);
  };

  const handleForwardTo = (targetThreadId: string) => {
    if (!forwardMsgId || !activeThread) return;
    const sourceMsg = messages.find(m => m.id === forwardMsgId);
    if (!sourceMsg) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const forwarded: Message = {
      id: `fwd-${Date.now()}`,
      from: 'me',
      text: sourceMsg.text,
      time: timeStr,
      date: dateStr,
      status: 'sent',
    };
    setConversationMessages(prev => ({
      ...prev,
      [targetThreadId]: [...(prev[targetThreadId] || []), forwarded],
    }));
    setShowForwardModal(false);
    setForwardMsgId(null);
    handleSelectThread(targetThreadId);
  };

  const handleDeleteMessage = (msgId: string, mode: 'me' | 'everyone') => {
    if (!activeThread) return;
    if (mode === 'me') {
      setDeletedMessages(prev => new Set([...prev, msgId]));
    } else {
      setConversationMessages(prev => {
        const threadMsgs = [...(prev[activeThread] || [])];
        const found = threadMsgs.find(m => m.id === msgId);
        if (found) {
          found.text = 'This message was deleted';
          found.deletedForEveryone = true;
          found.fileName = undefined;
          found.fileType = undefined;
          found.reactions = {};
          found.replies = [];
          found.voiceNote = undefined;
        }
        return { ...prev, [activeThread]: threadMsgs };
      });
    }
    setShowDeleteConfirm(null);
  };

  const openEmojiPicker = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      const rect = el.getBoundingClientRect();
      setEmojiPickerPosition({ top: rect.top - 410, left: rect.left });
    }
    setEmojiPickerTargetId(msgId);
    setEmojiPickerOpen(true);
    setShowReactionPicker(null);
  };

  const openMessageInfo = (msgId: string) => {
    setMessageInfoId(msgId);
    setMessageInfoOpen(true);
    setShowReactionPicker(null);
  };

  // Right-click context menu handler
  const handleContextMenu = (e: React.MouseEvent, msgId: string) => {
    e.preventDefault();
    const targetMsg = getMessageById(msgId);
    if (targetMsg?.deletedForEveryone) return;
    setContextMenu({ x: e.clientX, y: e.clientY, msgId });
    setShowReactionPicker(null);
    setShowDeleteConfirm(null);
  };

  const activeMessageInfo = (() => {
    if (!messageInfoId || !activeThread) return null;
    const m = [...(SAMPLE_MESSAGES[activeThread] || []), ...(conversationMessages[activeThread] || [])].find(msg => msg.id === messageInfoId);
    if (!m) return null;
    return {
      text: m.text,
      sentTime: m.time,
      deliveredTime: (m.status === 'delivered' || m.status === 'read') ? m.time : null,
      readTime: m.status === 'read' ? m.time : null,
      isMyMessage: m.from === 'me',
    };
  })();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch { /* AudioContext not available */ }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
  };

  const sendVoiceNote = () => {
    if (!audioUrl || !activeThread) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const msg: Message = {
      id: `vn-${Date.now()}`,
      from: 'me',
      text: '🎤 Voice note',
      time: timeStr,
      date: dateStr,
      status: 'sent',
      voiceNote: { url: audioUrl, duration: recordingTime },
    };
    setConversationMessages(prev => ({
      ...prev,
      [activeThread]: [...(prev[activeThread] || []), msg],
    }));
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
  };

  const channelColors: Record<string, string> = {
    email: 'bg-primary-100 text-primary-700',
    'in-app': 'bg-secondary-100 text-secondary-700',
    whatsapp: 'bg-emerald-100 text-emerald-700',
    sms: 'bg-accent-100 text-accent-700',
  };

  const channelIcons: Record<string, string> = {
    email: 'ri-mail-line',
    'in-app': 'ri-notification-3-line',
    whatsapp: 'ri-whatsapp-line',
    sms: 'ri-message-3-line',
  };

  return (
    <WorkspaceShell
      role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Message Centre" pageSubtitle="Unified inbox — email, in-app notifications, WhatsApp, and system alerts"
      userName="Alex Carter" userRole="System Administrator"
    >
      <div className="flex h-[calc(100vh-140px)]">
        <div className="w-full lg:w-[360px] border-r border-foreground-200/60 bg-background-50 flex flex-col shrink-0">
          <div className="p-4 border-b border-foreground-300/50">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
              <input
                type="text"
                placeholder="Search messages..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-100 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
              />
            </div>
          </div>

          <div className="px-4 py-2 border-b border-foreground-300/50 bg-primary-50/50 flex items-center gap-4">
            <p className="text-xs text-primary-700 font-medium">
              <i className="ri-mail-unread-line mr-1"></i>
              {searchQuery ? `${filteredThreads.length} result${filteredThreads.length !== 1 ? 's' : ''}` : `${totalUnread} unread`}
            </p>
            {!searchQuery && (
              <p className="text-xs text-foreground-400 font-medium">
                <i className="ri-mail-line mr-1"></i>
                {THREADS.length} total
              </p>
            )}
            {scheduledCount > 0 && !searchQuery && (
              <p className="text-xs text-secondary-600 font-medium">
                <i className="ri-time-line mr-1"></i>
                {scheduledCount} scheduled
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredThreads.map(thread => (
              <button
                key={thread.id}
                onClick={() => handleSelectThread(thread.id)}
                className={`w-full flex items-start gap-3 p-4 text-left transition-smooth cursor-pointer border-b border-background-200/20 hover:bg-background-100/50 ${
                  activeThread === thread.id ? 'bg-primary-50/60 border-l-2 border-l-primary-400' : ''
                }`}
              >
                <div className="relative shrink-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${thread.contact.avatarColor}`}>
                    {thread.contact.initials}
                  </div>
                  {thread.contact.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white"></span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-semibold truncate ${thread.unread > 0 ? 'text-foreground-900' : 'text-foreground-600'}`}>
                      {highlightText(thread.contact.name, searchQuery)}
                    </p>
                    <span className="text-xs text-foreground-300 shrink-0 ml-2">{thread.lastTime}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1 ${channelColors[thread.contact.channel]}`}>
                      <i className={`${channelIcons[thread.contact.channel]} text-[9px]`}></i>
                      {thread.contact.channel}
                    </span>
                    {thread.tags.map(tag => (
                      <span key={tag} className="text-[10px] text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded">
                        {highlightText(tag, searchQuery)}
                      </span>
                    ))}
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${thread.unread > 0 ? 'text-foreground-700 font-medium' : 'text-foreground-400'}`}>
                    {highlightText(thread.lastMessage, searchQuery)}
                  </p>
                </div>
                {thread.unread > 0 && (
                  <span className="bg-primary-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0 mt-1">{thread.unread}</span>
                )}
              </button>
            ))}
            {filteredThreads.length === 0 && searchQuery && (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <i className="ri-search-line text-2xl text-foreground-200 mb-2"></i>
                <p className="text-sm text-foreground-400">No messages match &quot;{searchQuery}&quot;</p>
              </div>
            )}
          </div>
        </div>

        <div className="hidden lg:flex flex-1 flex-col bg-background-50">
          {activeThreadData ? (
            <>
              <div className={`flex items-center justify-between px-6 py-4 border-b border-foreground-300/50 shrink-0 ${getHeaderBg(activeThreadData.contact.avatarColor)}`}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${activeThreadData.contact.avatarColor}`}>
                      {activeThreadData.contact.initials}
                    </div>
                    {activeThreadData.contact.online && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white"></span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{activeThreadData.contact.name}</p>
                    <p className="text-xs text-foreground-400">
                      {isTyping ? (
                        <span className="text-primary-500 font-medium animate-in fade-in duration-300">typing...</span>
                      ) : (
                        <>{activeThreadData.contact.online ? 'Online' : activeThreadData.contact.lastSeen} · {activeThreadData.contact.role} · <span className={channelColors[activeThreadData.contact.channel]}>{activeThreadData.contact.channel}</span></>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setShowChatSearch(prev => !prev);
                      setChatSearchQuery('');
                    }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${
                      showChatSearch ? 'bg-primary-500 text-white' : 'text-foreground-300 hover:text-primary-500 hover:bg-primary-50'
                    }`}
                    title="Search in conversation"
                  >
                    <i className="ri-search-line text-sm"></i>
                  </button>
                  <button
                    onClick={() => handleStartCall('voice')}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-primary-500 hover:bg-primary-50 transition-smooth cursor-pointer"
                  >
                    <i className="ri-phone-line text-sm"></i>
                  </button>
                  <button
                    onClick={() => handleStartCall('video')}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-primary-500 hover:bg-primary-50 transition-smooth cursor-pointer"
                  >
                    <i className="ri-video-line text-sm"></i>
                  </button>
                  <ChatMenu
                    contactName={activeThreadData.contact.name}
                    onClearChat={handleClearChat}
                    onMuteChat={handleMuteChat}
                    onBlockChat={handleBlockChat}
                    onReportChat={handleReportChat}
                  />
                </div>
              </div>

              {showChatSearch && (
                <div className="px-6 py-2 border-b border-foreground-200/60 bg-background-100/50 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center gap-2">
                    <i className="ri-search-line text-foreground-300 text-sm"></i>
                    <input
                      type="text"
                      placeholder="Search in this conversation..."
                      value={chatSearchQuery}
                      onChange={e => setChatSearchQuery(e.target.value)}
                      autoFocus
                      className="flex-1 bg-transparent text-sm text-foreground-700 outline-none placeholder:text-foreground-300"
                    />
                    {chatSearchQuery && (
                      <span className="text-xs text-foreground-400 shrink-0">
                        {chatFilteredMessages.length} result{chatFilteredMessages.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setShowChatSearch(false);
                        setChatSearchQuery('');
                      }}
                      className="w-6 h-6 flex items-center justify-center text-foreground-300 hover:text-foreground-500 transition-smooth cursor-pointer"
                    >
                      <i className="ri-close-line text-xs"></i>
                    </button>
                  </div>
                </div>
              )}

              {pinnedMsg && (
                <div className="px-6 py-2.5 border-b border-amber-200/30 bg-amber-50/60 flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                    <i className="ri-pushpin-fill text-amber-500 text-sm"></i>
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                    const el = document.getElementById(`msg-${pinnedMsg.id}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el?.classList.add('ring-2', 'ring-amber-300');
                    setTimeout(() => el?.classList.remove('ring-2', 'ring-amber-300'), 2000);
                  }}>
                    <p className="text-[10px] font-semibold text-amber-700">
                      Pinned by {pinnedMsg.from === 'me' ? 'you' : activeThreadData?.contact?.name?.split(' ')[0]}
                    </p>
                    <p className="text-xs text-foreground-500 truncate max-w-[400px]">
                      {pinnedMsg.text.slice(0, 80)}{pinnedMsg.text.length > 80 ? '...' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => { if (activeThread) setPinnedMessages(prev => ({ ...prev, [activeThread]: null })); }}
                    className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-amber-500 hover:text-amber-700 transition-smooth cursor-pointer shrink-0"
                    title="Unpin message"
                  >
                    <i className="ri-close-line text-xs"></i>
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">{/* Same message rendering as coach */}
                {chatSearchQuery.trim() && chatFilteredMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <i className="ri-search-line text-2xl text-foreground-200 mb-2"></i>
                    <p className="text-sm text-foreground-400">No messages match &quot;{chatSearchQuery}&quot;</p>
                  </div>
                )}

                {chatFilteredMessages.map((msg, i) => {
                  const showDate = i === 0 || chatFilteredMessages[i - 1].date !== msg.date;
                  const replyToMsg = msg.replyTo ? getMessageById(msg.replyTo) : null;
                  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;
                  const threadReplies = msg.replies || [];
                  const hasThreadReplies = threadReplies.length > 0;

                  // WhatsApp-style call log message
                  if (msg.callType) {
                    return (
                      <div key={msg.id} id={`msg-${msg.id}`}>
                        {showDate && (
                          <div className="flex items-center justify-center my-4">
                            <span className="text-xs text-foreground-300 bg-background-100 px-3 py-1 rounded-full">{msg.date}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-center my-2">
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${msg.callStatus === 'missed' ? 'bg-red-50' : 'bg-background-100'}`}>
                            <i className={`${msg.callType === 'video' ? 'ri-video-on-line' : 'ri-phone-line'} text-xs ${msg.callStatus === 'missed' ? 'text-red-400' : 'text-foreground-400'}`}></i>
                            <span className={`text-xs ${msg.callStatus === 'missed' ? 'text-red-500' : 'text-foreground-400'}`}>
                              {msg.callStatus === 'missed' ? `Missed ${msg.callType} call` : msg.text}
                            </span>
                            <span className="text-[10px] text-foreground-300">{msg.time}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={msg.id} id={`msg-${msg.id}`} className="group">
                      {showDate && (
                        <div className="flex items-center justify-center my-4">
                          <span className="text-xs text-foreground-300 bg-background-100 px-3 py-1 rounded-full">{msg.date}</span>
                        </div>
                      )}
                      <div className={`flex ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] ${msg.from === 'me' ? 'order-1' : ''}`}>
                          {replyToMsg && (
                            <div className={`flex items-center gap-1.5 mb-1 px-2 py-1 rounded-lg bg-background-100/80 border-l-2 border-primary-400 ${msg.from === 'me' ? 'justify-end text-right' : ''}`}>
                              <i className="ri-reply-line text-[10px] text-primary-400 shrink-0"></i>
                              <span className="text-[10px] text-foreground-400 truncate max-w-[200px]">
                                {replyToMsg.from === 'me' ? 'You' : activeThreadData?.contact?.name?.split(' ')[0]}: {replyToMsg.text.slice(0, 50)}...
                              </span>
                            </div>
                          )}
                          <div className="relative" onContextMenu={(e) => handleContextMenu(e, msg.id)}>
                            <div className={`rounded-2xl px-4 py-2.5 cursor-context-menu ${
                              msg.from === 'me'
                                ? 'bg-primary-500 text-white rounded-br-md'
                                : msg.deletedForEveryone
                                  ? 'bg-transparent text-foreground-300 italic px-2 py-1'
                                  : 'bg-background-100 text-foreground-700 rounded-bl-md'
                            }`}>
                              {msg.voiceNote ? (
                                <div className="flex items-center gap-3 py-1.5">
                                  <VoiceNotePlayer url={msg.voiceNote.url} duration={msg.voiceNote.duration} isFromMe={msg.from === 'me'} />
                                </div>
                              ) : msg.fileType === 'image' ? (
                                <div className="mb-2">
                                  <div className="w-48 h-32 rounded-lg bg-background-200/50 flex items-center justify-center mb-1">
                                    <i className="ri-image-line text-2xl text-foreground-300"></i>
                                  </div>
                                  <p className="text-xs opacity-80">{msg.fileName}</p>
                                </div>
                              ) : msg.fileType === 'file' ? (
                                <div className="flex items-center gap-2 mb-1">
                                  <i className="ri-file-line text-lg"></i>
                                  <p className="text-xs opacity-80">{msg.fileName}</p>
                                </div>
                              ) : (
                                <p className={`text-sm leading-relaxed ${msg.deletedForEveryone ? 'italic' : ''}`}>
                                  {msg.deletedForEveryone ? (
                                    <span className="flex items-center gap-1.5">
                                      <i className="ri-delete-bin-line text-xs"></i>
                                      {msg.text}
                                    </span>
                                  ) : msg.text}
                                </p>
                              )}
                            </div>

                            {!msg.deletedForEveryone && (
                            <div className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-smooth ${msg.from === 'me' ? '-left-8' : '-right-8'}`}>
                              <div className="relative">
                                <button
                                  onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                                  className="w-6 h-6 rounded-full bg-background-50 border border-background-200 shadow-sm flex items-center justify-center text-foreground-300 hover:text-primary-500 hover:border-primary-300 transition-smooth cursor-pointer"
                                >
                                  <i className="ri-emoji-sticker-line text-xs"></i>
                                </button>
                                {showReactionPicker === msg.id && (
                                  <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-background-50 rounded-xl shadow-lg border border-background-200 px-2 py-1.5 flex items-center gap-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150 whitespace-nowrap">
                                    <button
                                      onClick={() => openEmojiPicker(msg.id)}
                                      className="w-8 h-8 flex items-center justify-center text-foreground-500 hover:bg-background-100 rounded-lg transition-smooth cursor-pointer"
                                      title="Add reaction"
                                    >
                                      <i className="ri-emotion-line text-sm"></i>
                                    </button>
                                    <div className="w-px h-5 bg-background-200" />
                                    <button
                                      onClick={() => openMessageInfo(msg.id)}
                                      className="w-8 h-8 flex items-center justify-center text-foreground-500 hover:bg-background-100 rounded-lg transition-smooth cursor-pointer"
                                      title="Message info"
                                    >
                                      <i className="ri-information-line text-sm"></i>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            )}
                          </div>

                          <div className={`flex items-center gap-1 mt-0.5 ${msg.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                            <button
                              onClick={() => handleReply(msg.id)}
                              className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-foreground-300 hover:text-primary-500 transition-smooth cursor-pointer"
                              title="Reply"
                            >
                              <i className="ri-reply-line text-xs"></i>
                            </button>

                            <button
                              onClick={() => handlePinMessage(msg.id)}
                              className={`opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center transition-smooth cursor-pointer ${
                                activeThread && pinnedMessages[activeThread] === msg.id
                                  ? 'opacity-100 text-amber-500'
                                  : 'text-foreground-300 hover:text-amber-500'
                              }`}
                              title={activeThread && pinnedMessages[activeThread] === msg.id ? 'Unpin message' : 'Pin message'}
                            >
                              <i className={`${activeThread && pinnedMessages[activeThread] === msg.id ? 'ri-pushpin-fill' : 'ri-pushpin-line'} text-xs`}></i>
                            </button>

                            <button
                              onClick={() => handleForwardClick(msg.id)}
                              className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-foreground-300 hover:text-primary-500 transition-smooth cursor-pointer"
                              title="Forward message"
                            >
                              <i className="ri-share-forward-line text-xs"></i>
                            </button>

                            {!msg.deletedForEveryone && (
                              <div className="relative">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(showDeleteConfirm === msg.id ? null : msg.id); }}
                                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-foreground-300 hover:text-red-400 transition-smooth cursor-pointer"
                                  title="Delete message"
                                >
                                  <i className="ri-delete-bin-line text-xs"></i>
                                </button>
                                {showDeleteConfirm === msg.id && (
                                  <div className={`absolute -top-2 z-50 bg-background-50 rounded-xl shadow-xl border border-background-200 py-1.5 px-1 animate-in fade-in zoom-in-95 duration-150 whitespace-nowrap ${msg.from === 'me' ? 'right-0' : 'left-0'}`}>
                                    <button
                                      onClick={() => handleDeleteMessage(msg.id, 'me')}
                                      className="block w-full text-left px-3 py-1.5 rounded-lg text-xs text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                                    >
                                      <i className="ri-user-unfollow-line mr-1.5 text-foreground-400"></i>Delete for me
                                    </button>
                                    {msg.from === 'me' && (
                                      <button
                                        onClick={() => handleDeleteMessage(msg.id, 'everyone')}
                                        className="block w-full text-left px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-smooth cursor-pointer whitespace-nowrap"
                                      >
                                        <i className="ri-delete-bin-line mr-1.5"></i>Delete for everyone
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {hasReactions && (
                              <div className="flex items-center gap-0.5">
                                {Object.entries(msg.reactions!).map(([emoji, users]) => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleAddReaction(msg.id, emoji)}
                                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] transition-smooth cursor-pointer ${
                                      users.includes('Alex')
                                        ? 'bg-primary-100 text-primary-700 border border-primary-200'
                                        : 'bg-background-100 text-foreground-500 border border-background-200 hover:bg-background-200'
                                    }`}
                                    title={users.join(', ')}
                                  >
                                    <span className="text-xs">{emoji}</span>
                                    {users.length > 1 && <span className="text-[9px] font-medium">{users.length}</span>}
                                  </button>
                                ))}
                              </div>
                            )}

                            {msg.from === 'me' && (
                              <span className="text-[10px] leading-none ml-0.5">
                                {msg.status === 'read' ? (
                                  <span className="text-primary-500" title="Read"><i className="ri-check-double-line"></i></span>
                                ) : msg.status === 'delivered' ? (
                                  <span className="text-foreground-300" title="Delivered"><i className="ri-check-double-line"></i></span>
                                ) : (
                                  <span className="text-foreground-300" title="Sent"><i className="ri-check-line"></i></span>
                                )}
                              </span>
                            )}
                          </div>

                          <p className={`text-[9px] text-foreground-300 mt-0.5 ${msg.from === 'me' ? 'text-right' : 'text-left'}`}>{msg.time}</p>

                          {hasThreadReplies && (
                            <div className={`mt-1 pl-3 border-l-2 border-primary-200 ${msg.from === 'me' ? 'mr-1' : 'ml-1'}`}>
                              {threadReplies.map(reply => (
                                <div key={reply.id} className="mb-1">
                                  <div className={`flex ${reply.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                                      reply.from === 'me'
                                        ? 'bg-primary-500 text-white rounded-br-md'
                                        : 'bg-background-100 text-foreground-700 rounded-bl-md'
                                    }`}>
                                      <p className="text-xs leading-relaxed">{reply.text}</p>
                                    </div>
                                  </div>
                                  <p className={`text-[9px] text-foreground-300 mt-0.5 ${reply.from === 'me' ? 'text-right' : 'text-left'}`}>{reply.time}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isTyping && <TypingIndicator />}

                {messages.length === 0 && !isTyping && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <span className="w-16 h-16 rounded-2xl bg-background-100 flex items-center justify-center mb-4">
                      <i className="ri-chat-3-line text-2xl text-foreground-300"></i>
                    </span>
                    <p className="text-sm font-semibold text-foreground-400 mb-1">No messages yet</p>
                    <p className="text-sm text-foreground-300">Start a conversation to see messages here</p>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {scheduledMessages.filter(s => s.threadId === activeThread).length > 0 && (
                <div className="px-6 py-2 border-t border-background-200/30 bg-amber-50/50">
                  <p className="text-xs font-semibold text-amber-700 mb-1.5">
                    <i className="ri-time-line mr-1"></i>Scheduled messages
                  </p>
                  <div className="space-y-1.5">
                    {scheduledMessages.filter(s => s.threadId === activeThread).map(sm => (
                      <div key={sm.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-amber-200/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground-600 truncate">{sm.text}</p>
                          <p className="text-[10px] text-amber-600 mt-0.5">
                            Sending in {formatCountdown(countdowns[sm.id] || sm.sendAt.getTime() - Date.now())}
                          </p>
                        </div>
                        <button
                          onClick={() => cancelScheduled(sm.id)}
                          className="w-6 h-6 flex items-center justify-center text-foreground-300 hover:text-red-400 transition-smooth cursor-pointer shrink-0 ml-2"
                        >
                          <i className="ri-close-line text-xs"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-6 py-4 border-t border-background-200/30 shrink-0 relative">
                {replyToId && (() => {
                  const replyTarget = getMessageById(replyToId);
                  return replyTarget ? (
                    <div className="mb-3 flex items-center justify-between bg-background-100 rounded-lg px-3 py-2 border-l-2 border-primary-400 animate-in fade-in slide-in-from-bottom-2 duration-200">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <i className="ri-reply-line text-primary-500 text-sm shrink-0"></i>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold text-primary-600">
                            Replying to {replyTarget.from === 'me' ? 'yourself' : activeThreadData?.contact?.name?.split(' ')[0]}
                          </p>
                          <p className="text-[10px] text-foreground-400 truncate max-w-[300px]">{replyTarget.text.slice(0, 70)}...</p>
                        </div>
                      </div>
                      <button
                        onClick={cancelReply}
                        className="w-6 h-6 flex items-center justify-center text-foreground-300 hover:text-red-400 transition-smooth cursor-pointer shrink-0 ml-2"
                      >
                        <i className="ri-close-line text-xs"></i>
                      </button>
                    </div>
                  ) : null;
                })()}

                {showFilePicker && (
                  <div className="absolute bottom-full mb-2 left-6 bg-background-50 rounded-xl shadow-xl border border-background-200 p-3 z-50 w-64 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <p className="text-xs font-semibold text-foreground-400 mb-2">Attach file</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="w-full text-xs text-foreground-500 file:mr-2 file:px-2 file:py-1 file:rounded-md file:bg-primary-500 file:text-white file:border-0 file:cursor-pointer file:text-xs"
                    />
                    <p className="text-[10px] text-foreground-300 mt-2">Images, PDFs, documents up to 10MB</p>
                  </div>
                )}

                {showSchedulePicker && (
                  <div className="absolute bottom-full mb-2 right-6 bg-background-50 rounded-xl shadow-xl border border-background-200 p-4 z-50 w-64 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <p className="text-xs font-semibold text-foreground-400 mb-3">Schedule message</p>
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        onClick={() => setScheduleMinutes(Math.max(1, scheduleMinutes - 1))}
                        className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center text-foreground-500 hover:bg-background-200 transition-smooth cursor-pointer"
                      >
                        <i className="ri-subtract-line text-xs"></i>
                      </button>
                      <div className="flex-1 text-center">
                        <p className="text-sm font-semibold text-foreground-700">{scheduleMinutes} min</p>
                        <p className="text-[10px] text-foreground-400">
                          Send at {new Date(Date.now() + scheduleMinutes * 60 * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <button
                        onClick={() => setScheduleMinutes(Math.min(60, scheduleMinutes + 1))}
                        className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center text-foreground-500 hover:bg-background-200 transition-smooth cursor-pointer"
                      >
                        <i className="ri-add-line text-xs"></i>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowSchedulePicker(false)}
                        className="flex-1 py-2 rounded-lg text-xs text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleScheduleSend}
                        disabled={!newMessage.trim() && attachedFiles.length === 0}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-smooth cursor-pointer ${
                          (newMessage.trim() || attachedFiles.length > 0)
                            ? 'bg-primary-500 text-white hover:bg-primary-600'
                            : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                        }`}
                      >
                        Schedule
                      </button>
                    </div>
                  </div>
                )}

                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {attachedFiles.map(file => (
                      <div key={file} className="flex items-center gap-1.5 bg-background-100 px-2 py-1 rounded-lg border border-background-200">
                        <i className={`${file.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? 'ri-image-line' : 'ri-file-line'} text-foreground-400 text-xs`}></i>
                        <span className="text-xs text-foreground-600 max-w-[140px] truncate">{file}</span>
                        <button
                          onClick={() => removeFile(file)}
                          className="w-4 h-4 flex items-center justify-center text-foreground-300 hover:text-red-400 transition-smooth cursor-pointer"
                        >
                          <i className="ri-close-line text-xs"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {!isRecording && !audioUrl && (
                    <button
                      onClick={startRecording}
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-foreground-300 hover:text-red-400 hover:bg-red-50 transition-smooth cursor-pointer"
                      title="Record voice note"
                    >
                      <i className="ri-mic-line text-lg"></i>
                    </button>
                  )}

                  {isRecording && (
                    <div className="flex-1 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2 animate-in fade-in slide-in-from-left-2 duration-200">
                      <span className="relative flex items-center justify-center shrink-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
                      </span>
                      <span className="text-sm font-medium text-red-600 tabular-nums">
                        {formatVoiceDuration(recordingTime)}
                      </span>
                      <div className="flex-1 flex items-center gap-0.5">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <div
                            key={i}
                            className="flex-1 bg-red-300 rounded-full animate-pulse"
                            style={{
                              height: `${6 + Math.sin(i * 0.8) * 8}px`,
                              animationDelay: `${i * 0.1}s`,
                            }}
                          ></div>
                        ))}
                      </div>
                      <button
                        onClick={cancelRecording}
                        className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-500 hover:bg-red-200 transition-smooth cursor-pointer shrink-0"
                        title="Cancel recording"
                      >
                        <i className="ri-close-line text-sm"></i>
                      </button>
                      <button
                        onClick={stopRecording}
                        className="w-7 h-7 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition-smooth cursor-pointer shrink-0"
                        title="Stop recording"
                      >
                        <i className="ri-stop-fill text-xs"></i>
                      </button>
                    </div>
                  )}

                  {!isRecording && audioUrl && (
                    <div className="flex-1 flex items-center gap-3 bg-background-100 border border-primary-200 rounded-xl px-3 py-2 animate-in fade-in slide-in-from-left-2 duration-200">
                      <span className="text-[10px] text-foreground-400 font-medium shrink-0">Preview:</span>
                      <VoiceNotePlayer url={audioUrl} duration={recordingTime} isFromMe={false} />
                      <button
                        onClick={cancelRecording}
                        className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-500 hover:bg-red-200 transition-smooth cursor-pointer shrink-0 ml-auto"
                        title="Discard recording"
                      >
                        <i className="ri-delete-bin-line text-xs"></i>
                      </button>
                      <button
                        onClick={sendVoiceNote}
                        className="w-7 h-7 rounded-full bg-primary-500 flex items-center justify-center text-white hover:bg-primary-600 transition-smooth cursor-pointer shrink-0"
                        title="Send voice note"
                      >
                        <i className="ri-send-plane-fill text-xs"></i>
                      </button>
                    </div>
                  )}

                  {!isRecording && !audioUrl && (
                    <>
                      <button
                        onClick={handleAttachClick}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-smooth ${
                          showFilePicker ? 'bg-primary-500 text-white' : 'text-foreground-300 hover:text-foreground-600 hover:bg-background-100'
                        } cursor-pointer`}
                      >
                        <i className="ri-attachment-2 text-lg"></i>
                      </button>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder={`Message ${activeThreadData.contact.name.split(' ')[0]}...`}
                          value={newMessage}
                          onChange={e => setNewMessage(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                          className="w-full px-4 py-2.5 rounded-xl border border-background-200 bg-background-100 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth pr-10"
                        />
                      </div>
                      <button
                        onClick={() => setShowSchedulePicker(prev => !prev)}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-smooth cursor-pointer ${
                          showSchedulePicker ? 'bg-primary-500 text-white' : 'text-foreground-300 hover:text-foreground-600 hover:bg-background-100'
                        }`}
                        title="Schedule message"
                      >
                        <i className="ri-time-line text-lg"></i>
                      </button>
                      <button
                        onClick={handleSend}
                        disabled={!newMessage.trim() && attachedFiles.length === 0}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-smooth ${
                          (newMessage.trim() || attachedFiles.length > 0)
                            ? 'bg-primary-500 text-white hover:bg-primary-600 cursor-pointer'
                            : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                        }`}
                      >
                        <i className="ri-send-plane-fill text-sm"></i>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <span className="w-20 h-20 rounded-2xl bg-background-100 flex items-center justify-center mb-5">
                <i className="ri-mail-line text-3xl text-foreground-300"></i>
              </span>
              <h3 className="text-base font-heading font-semibold text-foreground-400 mb-2">Admin Message Centre</h3>
              <p className="text-sm text-foreground-300 max-w-sm leading-relaxed">
                Select a conversation to view messages. You have <strong className="text-primary-600">{totalUnread} unread message{totalUnread !== 1 ? 's' : ''}</strong> across {THREADS.filter(t => t.unread > 0).length} conversation{THREADS.filter(t => t.unread > 0).length !== 1 ? 's' : ''}.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {CONTACTS.slice(0, 4).map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectThread(THREADS.find(t => t.contact.id === c.id)?.id || '')}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${c.avatarColor} hover:ring-2 hover:ring-primary-300 transition-smooth cursor-pointer`}
                  >
                    {c.initials}
                  </button>
                ))}
                <span className="text-xs text-foreground-300 ml-1">Start chatting</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {activeThreadData && (
        <CallModal
          type={callType}
          contactName={activeThreadData.contact.name}
          contactInitials={activeThreadData.contact.initials}
          contactColor={activeThreadData.contact.avatarColor}
          isOpen={callOpen}
          onClose={() => setCallOpen(false)}
          onCallEnd={handleCallEnd}
        />
      )}

      {showForwardModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-foreground-950/40" onClick={() => { setShowForwardModal(false); setForwardMsgId(null); }}></div>
          <div className="relative bg-background-50 rounded-2xl w-full max-w-sm mx-4 shadow-xl border border-background-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-foreground-200/60">
              <div className="flex items-center gap-2">
                <i className="ri-share-forward-line text-primary-500 text-base"></i>
                <h3 className="text-sm font-semibold text-foreground-800">Forward Message</h3>
              </div>
              <button
                onClick={() => { setShowForwardModal(false); setForwardMsgId(null); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
              >
                <i className="ri-close-line text-sm"></i>
              </button>
            </div>

            {forwardMsgId && (() => {
              const fwdMsg = messages.find(m => m.id === forwardMsgId);
              return fwdMsg ? (
                <div className="px-5 py-3 border-b border-background-200/30 bg-background-100/50">
                  <p className="text-[10px] text-foreground-400 mb-1">Message to forward:</p>
                  <p className="text-xs text-foreground-600 italic line-clamp-2">&quot;{fwdMsg.text}&quot;</p>
                </div>
              ) : null;
            })()}

            <div className="px-2 py-2 max-h-[300px] overflow-y-auto">
              <p className="px-3 py-1.5 text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">Forward to</p>
              {THREADS.filter(t => t.id !== activeThread).map(thread => (
                <button
                  key={thread.id}
                  onClick={() => handleForwardTo(thread.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-background-100 transition-smooth text-left cursor-pointer"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold ${thread.contact.avatarColor}`}>
                    {thread.contact.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground-700">{thread.contact.name}</p>
                    <p className="text-xs text-foreground-400">{thread.contact.role}</p>
                  </div>
                  <i className="ri-arrow-right-s-line text-foreground-300 text-sm"></i>
                </button>
              ))}
              {THREADS.filter(t => t.id !== activeThread).length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <i className="ri-chat-3-line text-xl text-foreground-200 mb-2"></i>
                  <p className="text-xs text-foreground-400">No other conversations available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Emoji Picker */}
      <EmojiPicker
        isOpen={emojiPickerOpen}
        onClose={() => setEmojiPickerOpen(false)}
        onEmojiSelect={(emoji) => {
          if (emojiPickerTargetId) handleAddReaction(emojiPickerTargetId, emoji);
          setEmojiPickerOpen(false);
          setEmojiPickerTargetId(null);
        }}
        position={emojiPickerPosition}
      />

      {/* Message Info */}
      {activeMessageInfo && (
        <MessageInfo
          isOpen={messageInfoOpen}
          onClose={() => { setMessageInfoOpen(false); setMessageInfoId(null); }}
          messageText={activeMessageInfo.text}
          sentTime={activeMessageInfo.sentTime}
          deliveredTime={activeMessageInfo.deliveredTime}
          readTime={activeMessageInfo.readTime}
          readBy={activeThreadData?.contact.name || ''}
          isMyMessage={activeMessageInfo.isMyMessage}
        />
      )}

      {/* Right-click Context Menu */}
      {contextMenu.msgId && (() => {
        const ctxMsg = getMessageById(contextMenu.msgId);
        if (!ctxMsg) return null;
        const isPinned = activeThread && pinnedMessages[activeThread] === contextMenu.msgId;
        return (
          <MessageContextMenu
            isOpen={!!contextMenu.msgId}
            onClose={() => setContextMenu({ x: 0, y: 0, msgId: null })}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onReply={() => handleReply(contextMenu.msgId!)}
            onForward={() => handleForwardClick(contextMenu.msgId!)}
            onPin={() => handlePinMessage(contextMenu.msgId!)}
            onCopy={() => { if (ctxMsg.text) navigator.clipboard.writeText(ctxMsg.text); }}
            onDelete={() => handleDeleteMessage(contextMenu.msgId!, 'me')}
            onDeleteForEveryone={() => handleDeleteMessage(contextMenu.msgId!, 'everyone')}
            onMessageInfo={() => openMessageInfo(contextMenu.msgId!)}
            onStar={() => handleStarMessage(contextMenu.msgId!)}
            isMyMessage={ctxMsg.from === 'me'}
            isPinned={!!isPinned}
            isDeleted={!!ctxMsg.deletedForEveryone}
            isStarred={starredMessageIds.has(contextMenu.msgId)}
          />
        );
      })()}

      <FloatingFab
        onClick={() => handleSelectThread(THREADS[0].id)}
        icon="ri-chat-3-line"
        tooltip="Quick chat"
      />
    </WorkspaceShell>
  );
}