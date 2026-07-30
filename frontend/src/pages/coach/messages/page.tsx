import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchCoachMessageThread,
  fetchCoachMessageThreads,
  sendCoachMessage,
  type CoachMessage,
  type CoachMessageThread,
} from '@/api/coachMessages';

const coachNav = roleNavMap.coach;
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'at-risk', label: 'At Risk' },
  { id: 'needs-reply', label: 'Needs Reply' },
  { id: 'recent', label: 'Recent' },
] as const;

type ThreadFilter = typeof FILTERS[number]['id'];

function formatRelativeTime(value: string | null) {
  if (!value) return 'No messages yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recent';
  const diff = Date.now() - parsed.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function isRecent(value: string | null) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() - parsed.getTime() <= 1000 * 60 * 60 * 24 * 7;
}

function statusMeta(thread: CoachMessageThread) {
  const rag = thread.coachRag.toLowerCase();
  if (thread.status === 'at-risk' || rag === 'red') {
    return {
      pill: 'bg-red-50 text-red-700 border-red-200/60',
      label: 'At Risk',
    };
  }
  if (thread.status === 'high') {
    return {
      pill: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
      label: 'High Progress',
    };
  }
  if (thread.status === 'new-starter') {
    return {
      pill: 'bg-primary-50 text-primary-700 border-primary-200/60',
      label: 'New Starter',
    };
  }
  return {
    pill: 'bg-background-100 text-foreground-600 border-foreground-200/60',
    label: 'On Track',
  };
}

function messageStatusIcon(status: CoachMessage['status']) {
  if (status === 'read') return 'ri-check-double-line';
  if (status === 'delivered') return 'ri-check-double-line';
  return 'ri-check-line';
}

function messageStatusTone(status: CoachMessage['status']) {
  if (status === 'read') return 'text-primary-100';
  if (status === 'delivered') return 'text-white/70';
  return 'text-white/50';
}

function bubbleDateLabel(previous: CoachMessage | null, current: CoachMessage) {
  return !previous || previous.dateLabel !== current.dateLabel;
}

function mergeCoachMessages(current: CoachMessage[], fetched: CoachMessage[]): CoachMessage[] {
  const fetchedIds = new Set(fetched.map(message => message.id));
  const newestFetchedId = fetched.reduce((latest, message) => Math.max(latest, Number(message.id) || 0), 0);
  const liveMessages = current.filter(message => (
    !fetchedIds.has(message.id) && (Number(message.id) || 0) > newestFetchedId
  ));
  return [...fetched, ...liveMessages].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
}

// Refreshing the inbox should update card content without moving cards that
// the coach may be reading. The initial API response provides the first order;
// later refreshes preserve that order and only append genuinely new learners.
function mergeCoachThreads(current: CoachMessageThread[], incoming: CoachMessageThread[]): CoachMessageThread[] {
  if (!current.length) return incoming;

  const incomingById = new Map(incoming.map(thread => [thread.learnerId, thread]));
  const merged = current.map(thread => incomingById.get(thread.learnerId) || thread);
  const currentIds = new Set(current.map(thread => thread.learnerId));

  return [
    ...merged,
    ...incoming.filter(thread => !currentIds.has(thread.learnerId)),
  ];
}

export default function CoachMessagesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialLearnerIdRef = useRef(searchParams.get('learner'));
  const [ownerName, setOwnerName] = useState('Progress Coach');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [threads, setThreads] = useState<CoachMessageThread[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(searchParams.get('learner'));
  const [activeThread, setActiveThread] = useState<CoachMessageThread | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const upsertThread = (nextThread: CoachMessageThread) => {
    setThreads((current) => {
      const index = current.findIndex((thread) => thread.learnerId === nextThread.learnerId);
      if (index < 0) return [...current, nextThread];

      return current.map((thread, threadIndex) => (
        threadIndex === index ? nextThread : thread
      ));
    });
  };

  useEffect(() => {
    const controller = new AbortController();

    async function loadThreads() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchCoachMessageThreads();
        if (controller.signal.aborted) return;
        setOwnerName(response.owner.name || 'Progress Coach');
        setOwnerEmail(response.owner.email || '');
        setThreads(current => mergeCoachThreads(current, response.threads || []));
        const requestedLearner = initialLearnerIdRef.current;
        const fallbackLearner = response.threads[0]?.learnerId || null;
        const nextLearner = response.threads.some((thread) => thread.learnerId === requestedLearner)
          ? requestedLearner
          : fallbackLearner;
        setSelectedLearnerId(nextLearner);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Unable to load coach message threads', err);
        setError(err instanceof Error ? err.message : 'Unable to load learner messages right now.');
        setThreads([]);
        setSelectedLearnerId(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadThreads();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const requestedLearner = searchParams.get('learner');
    if (requestedLearner && requestedLearner !== selectedLearnerId && threads.some((thread) => thread.learnerId === requestedLearner)) {
      setSelectedLearnerId(requestedLearner);
    }
  }, [searchParams, selectedLearnerId, threads]);

  // Keep the coach inbox current when the learner sends a message. This page
  // uses the coach_api endpoints, so it needs its own live refresh loop.
  useEffect(() => {
    let cancelled = false;

    const syncThreads = async () => {
      try {
        const response = await fetchCoachMessageThreads(ownerEmail || undefined);
        if (cancelled) return;
        setOwnerName(response.owner.name || 'Progress Coach');
        setOwnerEmail(response.owner.email || '');
        setThreads(current => mergeCoachThreads(current, response.threads || []));
        if (selectedLearnerId) {
          const refreshedThread = response.threads.find(thread => thread.learnerId === selectedLearnerId);
          if (refreshedThread) setActiveThread(refreshedThread);
        }
      } catch {
        // The initial request displays errors; background refreshes stay quiet.
      }
    };

    const timer = window.setInterval(() => { void syncThreads(); }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ownerEmail, selectedLearnerId]);

  useEffect(() => {
    if (!selectedLearnerId) {
      setActiveThread(null);
      setMessages([]);
      return;
    }

    shouldStickToBottomRef.current = true;

    const controller = new AbortController();

    async function loadThread() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await fetchCoachMessageThread(selectedLearnerId);
        if (controller.signal.aborted) return;
        setOwnerName((current) => response.owner.name || current);
        setOwnerEmail((current) => response.owner.email || current);
        setActiveThread(response.thread);
        setMessages(response.messages || []);
        upsertThread(response.thread);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Unable to load coach message thread', err);
        setDetailError(err instanceof Error ? err.message : 'Unable to load this conversation.');
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    }

    loadThread();
    return () => controller.abort();
  }, [selectedLearnerId]);

  useEffect(() => {
    if (!selectedLearnerId) return;
    let cancelled = false;

    const syncActiveThread = async () => {
      try {
        const response = await fetchCoachMessageThread(selectedLearnerId, ownerEmail || undefined);
        if (cancelled) return;
        setActiveThread(response.thread);
        setMessages(current => mergeCoachMessages(current, response.messages || []));
        upsertThread(response.thread);
      } catch {
        // WebSocket/live refresh failures should not interrupt composing.
      }
    };

    void syncActiveThread();
    const timer = window.setInterval(() => { void syncActiveThread(); }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedLearnerId, ownerEmail]);

  const latestMessageId = messages[messages.length - 1]?.id ?? null;

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 96;
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || detailLoading || !messages.length || !shouldStickToBottomRef.current) return;

    // Keep new messages visible without starting a long animation that can
    // be restarted by a background refresh.
    container.scrollTop = container.scrollHeight;
  }, [detailLoading, latestMessageId, messages.length, selectedLearnerId]);

  const counts = useMemo(() => ({
    all: threads.length,
    unread: threads.filter((thread) => thread.unreadCount > 0).length,
    'at-risk': threads.filter((thread) => thread.status === 'at-risk' || thread.coachRag.toLowerCase() === 'red').length,
    'needs-reply': threads.filter((thread) => thread.needsReply).length,
    recent: threads.filter((thread) => isRecent(thread.lastMessageAt)).length,
  }), [threads]);

  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      const searchText = `${thread.learnerName} ${thread.learnerEmail} ${thread.programme} ${thread.lastMessage}`.toLowerCase();
      const searchPass = !search.trim() || searchText.includes(search.trim().toLowerCase());
      if (!searchPass) return false;

      if (filter === 'unread') return thread.unreadCount > 0;
      if (filter === 'at-risk') return thread.status === 'at-risk' || thread.coachRag.toLowerCase() === 'red';
      if (filter === 'needs-reply') return thread.needsReply;
      if (filter === 'recent') return isRecent(thread.lastMessageAt);
      return true;
    });
  }, [filter, search, threads]);

  const handleSelectThread = (learnerId: string) => {
    setSelectedLearnerId(learnerId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('learner', learnerId);
      return next;
    });
  };

  const leaveThread = () => {
    setSelectedLearnerId(null);
    setActiveThread(null);
    setMessages([]);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('learner');
      return next;
    }, { replace: true });
  };

  const openLearnerProfile = () => {
    if (activeThread) {
      navigate(`/coach/learner-case-file?id=${encodeURIComponent(activeThread.learnerId)}`);
    }
  };

  const handleSend = async () => {
    if (!activeThread || !newMessage.trim() || sending) return;
    setSending(true);
    setDetailError(null);
    try {
      const response = await sendCoachMessage(activeThread.learnerId, newMessage.trim(), ownerEmail || undefined);
      setOwnerName(response.owner.name || ownerName);
      setOwnerEmail(response.owner.email || ownerEmail);
      setMessages((current) => [...current, response.message]);
      setActiveThread(response.thread);
      upsertThread(response.thread);
      setNewMessage('');
    } catch (err) {
      console.error('Unable to send coach message', err);
      setDetailError(err instanceof Error ? err.message : 'Unable to send the message right now.');
    } finally {
      setSending(false);
    }
  };

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Learner Messages"
      pageSubtitle="Communicate directly with learners in your caseload."
      userName={ownerName}
      userRole="Progress Coach"
      showBackButton={false}
    >
      <div className={`w-full min-w-0 ${activeThread ? 'min-h-[calc(100vh-100px)] lg:min-h-[calc(100vh-140px)]' : 'min-h-[calc(100vh-100px)] lg:min-h-[calc(100vh-140px)]'}`}>
        <section className="h-full min-w-0 rounded-2xl md:rounded-[24px] border border-foreground-200/60 bg-background-50 shadow-sm overflow-hidden">
          <div className={`${activeThread ? 'hidden lg:flex' : 'flex'} px-3 sm:px-5 md:px-6 py-3 md:py-4 border-b border-foreground-200/60 flex-col gap-3`}>
            <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
              <div className="lg:flex-1 min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-500">Learner Inbox</p>
                <h1 className="text-lg sm:text-xl md:text-2xl font-heading font-semibold text-foreground-900 mt-1 md:mt-1.5">Conversations with your learners</h1>
                <p className="text-xs sm:text-sm text-foreground-500 mt-1 break-words">Only learners assigned to <span className="font-medium text-foreground-700">{ownerEmail || ownerName}</span> appear here.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 lg:shrink-0">
                <SummaryCard label="Learners" icon="ri-group-line" />
                <SummaryCard label="Unread" icon="ri-mail-unread-line" tone="primary" />
                <SummaryCard label="Need Reply" icon="ri-reply-line" tone="amber" />
                <SummaryCard label="At Risk" icon="ri-alarm-warning-line" tone="red" />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="relative w-full sm:w-[320px] shrink-0">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search learners or messages..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-foreground-200/60 bg-background-100 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
                />
              </div>
              <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5 sm:gap-2 sm:ml-auto">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setFilter(item.id)}
                    className={`px-2.5 md:px-3 py-1.5 md:py-2 rounded-full text-[11px] md:text-xs font-semibold transition-smooth cursor-pointer border ${
                      filter === item.id
                        ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
                        : 'bg-background-50 text-foreground-500 border-foreground-200/60 hover:border-primary-200 hover:text-primary-600'
                    }`}
                  >
                    {item.label} <span className={`ml-1 ${filter === item.id ? 'text-white/80' : 'text-foreground-300'}`}>({counts[item.id]})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={`${activeThread ? 'h-[calc(100vh-120px)] lg:h-[calc(100vh-350px)] lg:min-h-[460px]' : 'lg:h-[calc(100vh-350px)] lg:min-h-[460px]'} grid min-w-0 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]`}>
            <aside className={`${activeThread ? 'hidden lg:flex' : 'flex'} border-r border-foreground-200/60 bg-background-50 flex-col lg:min-h-0`}>
              <div className="px-4 py-3 border-b border-foreground-200/60 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground-700">Learners</p>
                  <p className="text-[11px] text-foreground-400">{filteredThreads.length} visible conversation{filteredThreads.length === 1 ? '' : 's'}</p>
                </div>
                {filter !== 'all' && (
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-primary-50 text-primary-700 border border-primary-200/60">
                    Filter: {FILTERS.find((item) => item.id === filter)?.label}
                  </span>
                )}
              </div>

              <div className="max-h-[420px] md:max-h-[520px] overflow-y-auto overscroll-contain lg:flex-1 lg:min-h-0 lg:max-h-none">
                {loading ? (
                  <div className="p-6 space-y-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="rounded-2xl border border-foreground-200/40 bg-background-100/60 p-4 animate-pulse">
                        <div className="h-4 w-28 rounded bg-background-200 mb-3"></div>
                        <div className="h-3 w-full rounded bg-background-200 mb-2"></div>
                        <div className="h-3 w-3/4 rounded bg-background-200"></div>
                      </div>
                    ))}
                  </div>
                ) : error ? (
                  <div className="p-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-3">
                      <i className="ri-error-warning-line text-xl"></i>
                    </div>
                    <p className="text-sm font-semibold text-foreground-800">Unable to load learner messages</p>
                    <p className="text-xs text-red-500 mt-2">{error}</p>
                  </div>
                ) : filteredThreads.length === 0 ? (
                  <div className="p-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-background-100 text-foreground-300 flex items-center justify-center mb-3">
                      <i className="ri-message-3-line text-xl"></i>
                    </div>
                    <p className="text-sm font-semibold text-foreground-700">No learner conversations match</p>
                    <p className="text-xs text-foreground-400 mt-2">Try clearing the search or switching filters.</p>
                  </div>
                ) : (
                  filteredThreads.map((thread) => {
                    const meta = statusMeta(thread);
                    return (
                      <button
                        key={thread.learnerId}
                        onClick={() => handleSelectThread(thread.learnerId)}
                        className={`w-full text-left px-3.5 py-3 border-b border-foreground-200/50 transition-smooth cursor-pointer ${
                          selectedLearnerId === thread.learnerId ? 'bg-primary-50/60' : 'hover:bg-background-100/60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl shrink-0 bg-primary-100 text-primary-700 font-semibold flex items-center justify-center">
                            {thread.learnerInitials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className={`text-sm font-semibold truncate ${thread.unreadCount > 0 ? 'text-foreground-900' : 'text-foreground-700'}`}>
                                  {thread.learnerName}
                                </p>
                                <p className="text-[11px] text-foreground-400 truncate mt-0.5">
                                  {thread.cohortName} · {thread.group}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[11px] font-medium text-foreground-400">{formatRelativeTime(thread.lastMessageAt)}</p>
                                {thread.unreadCount > 0 && (
                                  <span className="inline-flex mt-2 min-w-[22px] h-[22px] items-center justify-center rounded-full bg-primary-500 px-1.5 text-[11px] font-bold text-white">
                                    {thread.unreadCount}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${meta.pill}`}>
                                {meta.label}
                              </span>
                              {thread.needsReply && (
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200/60">
                                  Needs Reply
                                </span>
                              )}
                              {thread.lastSenderType === 'learner' && thread.lastMessage && (
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-primary-50 text-primary-700 border-primary-200/60">
                                  Learner latest
                                </span>
                              )}
                            </div>

                            <p className={`text-xs mt-2 line-clamp-2 ${thread.unreadCount > 0 ? 'text-foreground-700 font-medium' : 'text-foreground-500'}`}>
                              {thread.lastMessage || 'No messages yet. Start the conversation.'}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <section className={`flex w-full min-w-0 flex-col bg-background-50 ${activeThread ? 'h-full min-h-0 lg:justify-self-stretch' : 'min-h-[360px] md:min-h-[420px] lg:min-h-0'}`}>
              {activeThread ? (
                <>
                  <div className="px-3 sm:px-5 md:px-6 py-3 md:py-4 border-b border-foreground-200/60 bg-background-50 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={leaveThread}
                        title="Back to messages"
                        aria-label="Back to messages"
                        className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-full border border-foreground-200 text-foreground-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-smooth cursor-pointer"
                      >
                        <i className="ri-arrow-left-line text-base"></i>
                      </button>
                      <button
                        onClick={openLearnerProfile}
                        title="Open learner profile"
                        aria-label={`Open ${activeThread.learnerName}'s profile`}
                        className="w-11 h-11 rounded-2xl shrink-0 bg-primary-100 text-primary-700 font-semibold flex items-center justify-center hover:bg-primary-200 transition-smooth cursor-pointer"
                      >
                        {activeThread.learnerInitials}
                      </button>
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-foreground-900 truncate">{activeThread.learnerName}</h2>
                        <p className="text-xs text-foreground-500 truncate mt-0.5">{activeThread.learnerEmail}</p>
                      </div>
                        <button
                        onClick={openLearnerProfile}
                        className="ml-auto inline-flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-xl bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-user-3-line"></i><span className="hidden sm:inline">Open Profile</span>
                      </button>
                    </div>
                  </div>
                  <div className="hidden">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      {false && <div className="flex items-start gap-4 min-w-0">
                        <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-700 font-semibold text-lg shrink-0 flex items-center justify-center">
                          {activeThread.learnerInitials}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-heading font-semibold text-foreground-900">{activeThread.learnerName}</h2>
                            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${statusMeta(activeThread).pill}`}>
                              {statusMeta(activeThread).label}
                            </span>
                            {activeThread.coachRag && (
                              <span className="text-[10px] font-semibold px-2 py-1 rounded-full border bg-background-100 text-foreground-600 border-foreground-200/60">
                                Coach RAG: {activeThread.coachRag}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-foreground-500 mt-1">{activeThread.learnerEmail || 'No learner email available'}</p>
                          <p className="text-[12px] text-foreground-400 mt-1">
                            {activeThread.programme} · {activeThread.cohortName} · {activeThread.group}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-background-100 text-foreground-600 border-foreground-200/60">
                              Progress {activeThread.overallProgress}%
                            </span>
                            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200/60">
                              OTJH {activeThread.otjhCompleted}/{activeThread.otjhTarget}
                            </span>
                            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-background-100 text-foreground-600 border-foreground-200/60">
                              {activeThread.programStatus}
                            </span>
                          </div>
                        </div>
                      </div>
                      }
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(activeThread.learnerId)}`)}
                          className="px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                        >
                          <i className="ri-user-3-line mr-1.5"></i> Open Profile
                        </button>
                      </div>
                    </div>

                    {false && activeThread.riskFlags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {activeThread.riskFlags.map((flag) => (
                          <span key={flag} className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200/60">
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 md:px-6 py-3 md:py-4 bg-background-100/40"
                  >
                    {detailLoading ? (
                      <div className="space-y-4">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={index} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[70%] rounded-2xl px-4 py-3 animate-pulse ${index % 2 === 0 ? 'bg-background-50' : 'bg-primary-100'}`}>
                              <div className="h-3 w-48 rounded bg-background-200 mb-2"></div>
                              <div className="h-3 w-28 rounded bg-background-200"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : detailError ? (
                      <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center">
                        <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-3">
                          <i className="ri-error-warning-line text-xl"></i>
                        </div>
                        <p className="text-sm font-semibold text-foreground-800">Unable to load the conversation</p>
                        <p className="text-xs text-red-500 mt-2">{detailError}</p>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 rounded-2xl bg-primary-50 text-primary-500 flex items-center justify-center mb-4">
                          <i className="ri-message-3-line text-2xl"></i>
                        </div>
                        <p className="text-sm font-semibold text-foreground-800">Start the first conversation</p>
                        <p className="text-xs text-foreground-400 mt-2 max-w-sm">
                          This learner does not have a message history yet. Send a short note here and the thread will be created automatically.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {messages.map((message, index) => {
                          const showDate = bubbleDateLabel(index > 0 ? messages[index - 1] : null, message);
                          const isCoachMessage = message.from === 'me';
                          return (
                            <div key={message.id}>
                              {showDate && (
                                <div className="flex justify-center my-2.5">
                                  <span className="px-2.5 py-0.5 rounded-full bg-background-50 border border-foreground-200/60 text-[10px] font-medium text-foreground-400">
                                    {message.dateLabel}
                                  </span>
                                </div>
                              )}
                              <div className={`flex items-end gap-1.5 ${isCoachMessage ? 'justify-end pl-2 sm:pl-12' : 'justify-start pr-2 sm:pr-12'}`}>
                                {!isCoachMessage && (
                                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 text-[11px] font-semibold flex items-center justify-center shrink-0">
                                    {activeThread.learnerInitials}
                                  </div>
                                )}
                              <div className={`flex max-w-[88%] sm:max-w-[min(68%,620px)] flex-col ${isCoachMessage ? 'items-end' : 'items-start'}`}>
                                  <span className="mb-1 text-[10px] font-semibold text-foreground-400">
                                    {isCoachMessage ? 'You' : activeThread.learnerName}
                                  </span>
                                  <div className={`rounded-xl px-3 py-2 shadow-sm ${
                                    isCoachMessage
                                      ? 'bg-primary-500 text-white rounded-br-md'
                                      : 'bg-white text-foreground-800 rounded-bl-md border border-foreground-200/70'
                                  }`}>
                                    <p className={`text-[13px] leading-relaxed ${message.isDeleted ? 'italic' : ''}`}>{message.body}</p>
                                    <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${
                                      isCoachMessage ? 'justify-end text-white/80' : 'text-foreground-400'
                                    }`}>
                                      <span>{message.timeLabel}</span>
                                      {message.editedAt && <span>Edited</span>}
                                      {isCoachMessage && (
                                        <span className={`inline-flex items-center ${messageStatusTone(message.status)}`}>
                                          <i className={`${messageStatusIcon(message.status)} text-xs`}></i>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef}></div>
                      </div>
                    )}
                  </div>

                  <div className="px-3 sm:px-4 md:px-5 py-2.5 md:py-3 border-t border-foreground-200/60 bg-background-50 shrink-0">
                    <div className="rounded-2xl border border-foreground-200/60 bg-background-100 p-2.5">
                      <textarea
                        value={newMessage}
                        onChange={(event) => setNewMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            handleSend();
                          }
                        }}
                        placeholder={`Message ${activeThread.learnerName.split(' ')[0]}...`}
                        rows={2}
                        className="w-full resize-none border-0 bg-transparent text-sm text-foreground-700 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 placeholder:text-foreground-300"
                      />
                      <div className="mt-2 flex items-center justify-end gap-3">
                        <button
                          onClick={handleSend}
                          disabled={!newMessage.trim() || sending}
                          className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth ${
                            newMessage.trim() && !sending
                              ? 'bg-primary-500 text-white hover:bg-primary-600 cursor-pointer'
                              : 'bg-background-200 text-foreground-300 cursor-not-allowed'
                          }`}
                        >
                          <i className="ri-send-plane-fill mr-1.5"></i>
                          {sending ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 min-h-[500px] flex flex-col items-center justify-center text-center px-6">
                  <div className="w-20 h-20 rounded-3xl bg-background-100 text-foreground-300 flex items-center justify-center mb-4">
                    <i className="ri-mail-open-line text-3xl"></i>
                  </div>
                  <h2 className="text-lg font-heading font-semibold text-foreground-800">Select a learner conversation</h2>
                  <p className="text-sm text-foreground-400 mt-2 max-w-md">
                    Pick a learner from the left to read the thread, mark new messages as read, and send a direct reply.
                  </p>
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}

function SummaryCard({
  label,
  icon,
  tone = 'foreground',
}: {
  label: string;
  icon: string;
  tone?: 'foreground' | 'primary' | 'amber' | 'red';
}) {
  const toneMap = {
    foreground: 'bg-background-100 text-foreground-600',
    primary: 'bg-primary-50 text-primary-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="rounded-xl border border-foreground-200/60 bg-background-100 px-2.5 py-2 min-w-[104px]">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${toneMap[tone]}`}>
          <i className={`${icon} text-lg`}></i>
        </div>
        <p className="text-[10px] font-semibold leading-tight text-foreground-500">{label}</p>
      </div>
    </div>
  );
}
