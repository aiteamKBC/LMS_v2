import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { useAuth } from '@/hooks/useAuth';
import { getRememberedLearner } from '@/hooks/useMyLearner';
import { roleNavMap } from '@/mocks/navigation';
import {
  bootstrapChatSession,
  ChatApiError,
  type ChatConversation,
  type ChatMessage,
  type ChatSocketMessage,
  chatSocketUrl,
  createChatMessage,
  deleteChatMessage,
  fetchChatConversations,
  fetchAllChatMessages,
  markChatMessageRead,
  updateChatMessage,
} from '@/api/chat';

type InboxFilter = 'all' | 'unread' | 'at-risk' | 'needs-reply' | 'recent';
const MESSAGE_ACTION_WINDOW_MS = 15 * 60 * 1000;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || '?';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function canGroupMessages(previous: ChatMessage | undefined, current: ChatMessage | undefined): boolean {
  if (!previous || !current || previous.is_mine !== current.is_mine) return false;
  if (formatDateLabel(previous.created_at) !== formatDateLabel(current.created_at)) return false;

  const previousTime = new Date(previous.created_at).getTime();
  const currentTime = new Date(current.created_at).getTime();
  return Number.isFinite(previousTime) && Number.isFinite(currentTime)
    && currentTime - previousTime <= 5 * 60 * 1000;
}

function formatListTime(value: string): string {
  const date = new Date(value);
  const ageHours = Math.max(0, (Date.now() - date.getTime()) / 3_600_000);
  if (ageHours < 1) return `${Math.max(1, Math.floor(ageHours * 60))}m ago`;
  if (ageHours < 24) return `${Math.floor(ageHours)}h ago`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function mergeMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex(message => message.id === next.id);
  if (existingIndex === -1) return [...messages, next].sort((a, b) => a.id - b.id);
  const copy = [...messages];
  copy[existingIndex] = next;
  return copy;
}

function mergeFetchedMessages(current: ChatMessage[], fetched: ChatMessage[], hiddenIds: Set<number>): ChatMessage[] {
  const fetchedIds = new Set(fetched.map(message => message.id));
  const newestFetchedId = fetched.reduce((latest, message) => Math.max(latest, message.id), 0);

  // Keep a message that arrived through the socket while this HTTP request was
  // in flight. Older messages omitted by the server response are still
  // removed, including messages deleted for this participant.
  const liveMessages = current.filter(message => (
    !fetchedIds.has(message.id)
    && !hiddenIds.has(message.id)
    && message.id > newestFetchedId
  ));

  return [...fetched, ...liveMessages].sort((a, b) => a.id - b.id);
}

function socketMessageToChatMessage(message: ChatSocketMessage, role: string): ChatMessage {
  return {
    ...message,
    is_mine: message.sender.type === role,
    read_at: null,
  };
}

function isRecent(value: string): boolean {
  return Date.now() - new Date(value).getTime() < 7 * 24 * 60 * 60 * 1000;
}

function isWithinMessageActionWindow(message: ChatMessage): boolean {
  const age = Date.now() - new Date(message.created_at).getTime();
  return age >= 0 && age <= MESSAGE_ACTION_WINDOW_MS;
}

export default function MessagesPage() {
  const { auth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const authenticatedRole = auth.roles[0]?.slug || 'learner';
  const role = location.pathname.startsWith('/learner/messages')
    ? 'learner'
    : authenticatedRole;
  const nav = roleNavMap[role] || roleNavMap.learner;
  const isCoach = role === 'coach';
  // A fresh localhost origin has no mock-login localStorage yet. Keep the
  // learner inbox usable in development while production still requires the
  // normal authenticated app session.
  const canUseDemoLearnerChat = role === 'learner' && import.meta.env.DEV;
  const chatReady = auth.isAuthenticated || canUseDemoLearnerChat;
  const rememberedLearnerId = role === 'learner' ? getRememberedLearner()?.id : undefined;
  const chatSessionEmail = role === 'learner'
    ? (authenticatedRole !== 'learner' ? 'learner@kbc.test' : (auth.user?.email || 'learner@kbc.test'))
    : auth.user?.email;

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [messageMenuId, setMessageMenuId] = useState<number | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<InboxFilter>('all');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'offline'>('offline');
  const socketRef = useRef<WebSocket | null>(null);
  const hiddenMessageIdsRef = useRef<Set<number>>(new Set());
  const conversationSyncInFlightRef = useRef(false);
  const messageSyncInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const activeConversation = useMemo(
    () => conversations.find(conversation => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const leaveConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.delete('conversation');
      next.delete('contact');
      return next;
    }, { replace: true });
  };

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      // The app login is local-demo auth, so ensure the protected Django chat
      // session is ready before loading the PostgreSQL conversations.
      if (chatSessionEmail && (role === 'coach' || role === 'learner')) {
        try {
          await bootstrapChatSession(chatSessionEmail, {
            learnerSourceId: rememberedLearnerId,
          });
        } catch (cause) {
          // A 404 means production demo bootstrapping is disabled and the real
          // Django login owns the session. Other failures must stop here so a
          // stale learner session can never display or send another learner's chat.
          if (!(cause instanceof ChatApiError) || cause.status !== 404) throw cause;
        }
      }
      const data = await fetchChatConversations();
      setConversations(data);

      // Keep the inbox closed on first load. A learner or coach must select
      // a conversation from the list before its messages are fetched.
      setActiveConversationId(current => (
        current !== null && data.some(item => item.id === current) ? current : null
      ));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load conversations.');
    } finally {
      setLoadingConversations(false);
    }
  }, [chatSessionEmail, rememberedLearnerId, role]);

  useEffect(() => {
    if (chatReady) void loadConversations();
    else setLoadingConversations(false);
  }, [chatReady, loadConversations]);

  // Keep the inbox list and unread badges current even when the production
  // WebSocket proxy is unavailable.
  useEffect(() => {
    if (!chatReady) return;

    let cancelled = false;

    const syncConversationList = async () => {
      if (cancelled || document.visibilityState === 'hidden' || conversationSyncInFlightRef.current) return;
      conversationSyncInFlightRef.current = true;
      try {
        const data = await fetchChatConversations();
        if (cancelled) return;
        if (!Array.isArray(data)) return;
        setConversations(data);
        setActiveConversationId(current => (
          current !== null && !data.some(item => item.id === current) ? null : current
        ));
      } catch {
        // The initial load displays the error; background refreshes stay quiet.
      } finally {
        conversationSyncInFlightRef.current = false;
      }
    };

    // The active WebSocket updates open conversations immediately. The inbox
    // fallback only needs a modest cadence and must not load the API while the
    // tab is in the background.
    const conversationTimer = window.setInterval(() => { void syncConversationList(); }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(conversationTimer);
    };
  }, [chatReady]);

  useEffect(() => {
    if (activeConversationId === null) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setSocketState('connecting');
    setMessages([]);
    setError(null);

    const loadMessagesAndConnect = async () => {
      try {
        const page = await fetchAllChatMessages(activeConversationId);
        if (cancelled) return;
        setMessages(current => mergeFetchedMessages(current, page.results, hiddenMessageIdsRef.current));

        const unread = page.results.filter(message => !message.is_mine && !message.read_at);
        await Promise.allSettled(unread.map(message => markChatMessageRead(message.id)));
        if (unread.length) {
          setMessages(current => current.map(message => (
            unread.some(item => item.id === message.id)
              ? { ...message, read_at: new Date().toISOString() }
              : message
          )));
          setConversations(current => current.map(conversation => (
            conversation.id === activeConversationId ? { ...conversation, unread_count: 0 } : conversation
          )));
        }

        let reconnectTimer: number | null = null;
        const connectSocket = () => {
          if (cancelled) return;
          const socket = new WebSocket(chatSocketUrl(activeConversationId));
          socketRef.current = socket;
          socket.onopen = () => { if (!cancelled) setSocketState('connected'); };
          socket.onmessage = event => {
            if (cancelled) return;
            try {
              const payload = JSON.parse(event.data) as { type?: string; message?: ChatSocketMessage; detail?: string };
              if (payload.type === 'message_updated' && payload.message) {
                const next = socketMessageToChatMessage(payload.message, role);
                setMessages(current => mergeMessage(current, next));
                setConversations(current => current.map(conversation => (
                  conversation.id === activeConversationId && conversation.latest_message?.id === next.id
                    ? { ...conversation, latest_message: { ...conversation.latest_message, body: next.body, edited_at: next.edited_at } }
                    : conversation
                )));
              }
              if (payload.type === 'message_deleted' && payload.message) {
                const next = socketMessageToChatMessage(payload.message, role);
                if (hiddenMessageIdsRef.current.has(next.id)) return;
                setMessages(current => mergeMessage(current, next));
                setConversations(current => current.map(conversation => (
                  conversation.id === activeConversationId && conversation.latest_message?.id === next.id
                    ? { ...conversation, latest_message: { ...conversation.latest_message, body: next.body, edited_at: next.edited_at, is_deleted: true } }
                    : conversation
                )));
              }
              if (payload.type === 'new_message' && payload.message) {
                const next = socketMessageToChatMessage(payload.message, role);
                setMessages(current => mergeMessage(current, next));
                setConversations(current => current.map(conversation => (
                  conversation.id === activeConversationId
                    ? {
                      ...conversation,
                      latest_message: { ...next, sender: next.sender },
                      updated_at: next.created_at,
                      unread_count: next.is_mine ? conversation.unread_count : 0,
                    }
                    : conversation
                )));
                if (!next.is_mine) void markChatMessageRead(next.id);
              }
              if (payload.type === 'error') setError(payload.detail || 'Chat delivery error.');
            } catch {
              setError('Received an invalid message from the chat server.');
            }
          };
          socket.onerror = () => { if (!cancelled) setSocketState('offline'); };
          socket.onclose = () => {
            if (cancelled) return;
            setSocketState('offline');
            reconnectTimer = window.setTimeout(connectSocket, 2000);
          };
        };
        connectSocket();
        return () => {
          if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        };
      } catch (cause) {
        if (!cancelled) {
          setSocketState('offline');
          setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
        }
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    };

    void loadMessagesAndConnect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      setSocketState('offline');
    };
  }, [activeConversationId, role]);

  // Keep the conversation current even while a browser proxy or WebSocket
  // briefly drops. This is a lightweight fallback; the WebSocket remains the
  // primary delivery path when it is connected.
  useEffect(() => {
    if (!chatReady || activeConversationId === null || socketState === 'connected') return;

    let cancelled = false;
    shouldStickToBottomRef.current = true;

    const syncMessages = async () => {
      if (cancelled || document.visibilityState === 'hidden' || messageSyncInFlightRef.current) return;
      messageSyncInFlightRef.current = true;
      try {
        const page = await fetchAllChatMessages(activeConversationId);
        if (cancelled) return;
        const unread = page.results.filter(message => !message.is_mine && !message.read_at);
        setMessages(current => mergeFetchedMessages(current, page.results, hiddenMessageIdsRef.current));

        const latest = page.results[page.results.length - 1];
        if (latest) {
          setConversations(current => current.map(conversation => (
            conversation.id === activeConversationId
              ? { ...conversation, latest_message: latest, updated_at: latest.created_at, unread_count: unread.length ? 0 : conversation.unread_count }
              : conversation
          )));
        }

        if (unread.length) {
          await Promise.allSettled(unread.map(message => markChatMessageRead(message.id)));
          setMessages(current => current.map(message => (
            unread.some(item => item.id === message.id)
              ? { ...message, read_at: new Date().toISOString() }
              : message
          )));
        }
      } catch {
        // The WebSocket and the initial request still handle the normal path.
      } finally {
        messageSyncInFlightRef.current = false;
      }
    };

    // Poll only while the WebSocket is unavailable; once connected, socket
    // events are the single source of live updates.
    const pollTimer = window.setInterval(() => { void syncMessages(); }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [activeConversationId, chatReady, socketState]);

  const latestMessageId = messages[messages.length - 1]?.id ?? null;

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 96;
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !messages.length || !shouldStickToBottomRef.current) return;

    // Keep new messages visible without starting a long animation that can
    // be restarted by a background refresh.
    container.scrollTop = container.scrollHeight;
  }, [activeConversationId, latestMessageId, messages.length]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return conversations.filter(conversation => {
      const latestBody = conversation.latest_message?.body.toLowerCase() || '';
      const matchesQuery = !query
        || conversation.participant.name.toLowerCase().includes(query)
        || conversation.participant.type.includes(query)
        || latestBody.includes(query);
      const needsReply = Boolean(conversation.latest_message && conversation.latest_message.sender.type !== role);
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'unread' && conversation.unread_count > 0)
        || (activeFilter === 'at-risk' && (isCoach ? conversation.participant.type === 'learner' : true))
        || (activeFilter === 'needs-reply' && needsReply)
        || (activeFilter === 'recent' && isRecent(conversation.updated_at));
      return matchesQuery && matchesFilter;
    });
  }, [activeFilter, conversations, isCoach, role, searchQuery]);

  const unreadCount = conversations.reduce((sum, item) => sum + item.unread_count, 0);
  const needReplyCount = conversations.filter(item => item.latest_message?.sender.type !== role).length;
  const atRiskCount = conversations.filter(item => item.participant.type === 'learner').length;

  const handleSend = async () => {
    const body = newMessage.trim();
    if (!body || activeConversationId === null || sending) return;
    setSending(true);
    setNewMessage('');
    try {
      // Persist through REST and merge the confirmed record immediately. The
      // WebSocket remains responsible for messages sent by the other side.
      const saved = await createChatMessage(activeConversationId, body);
      setMessages(current => mergeMessage(current, saved));
      await loadConversations();
      setError(null);
    } catch (cause) {
      setNewMessage(body);
      setError(cause instanceof ChatApiError ? cause.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const beginEdit = (message: ChatMessage) => {
    if (!message.is_mine || message.is_deleted || !isWithinMessageActionWindow(message)) return;
    setMessageMenuId(null);
    setEditingMessageId(message.id);
    setEditingBody(message.body);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingBody('');
  };

  const handleEdit = async () => {
    const body = editingBody.trim();
    if (editingMessageId === null || !body || savingEdit) return;
    setSavingEdit(true);
    try {
      const saved = await updateChatMessage(editingMessageId, body);
      setMessages(current => mergeMessage(current, saved));
      setConversations(current => current.map(conversation => (
        conversation.id === activeConversationId && conversation.latest_message?.id === saved.id
          ? { ...conversation, latest_message: { ...conversation.latest_message, body: saved.body, edited_at: saved.edited_at } }
          : conversation
      )));
      cancelEdit();
      setError(null);
    } catch (cause) {
      setError(cause instanceof ChatApiError ? cause.message : 'Unable to edit message.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (message: ChatMessage, scope: 'me' | 'everyone') => {
    if (deletingMessageId !== null) return;
    if (scope === 'everyone' && (!message.is_mine || !isWithinMessageActionWindow(message))) return;

    setDeletingMessageId(message.id);
    setMessageMenuId(null);
    try {
      const result = await deleteChatMessage(message.id, scope);
      if (scope === 'me') {
        hiddenMessageIdsRef.current.add(message.id);
        setMessages(current => current.filter(item => item.id !== message.id));
      } else if ('is_deleted' in result) {
        setMessages(current => mergeMessage(current, result));
      }
      if (editingMessageId === message.id) cancelEdit();
      await loadConversations();
      setError(null);
    } catch (cause) {
      setError(cause instanceof ChatApiError ? cause.message : 'Unable to delete message.');
    } finally {
      setDeletingMessageId(null);
    }
  };

  const metaName = auth.user?.fullName || 'User';
  const metaRole = isCoach ? 'Coach' : role === 'learner' ? 'Learner' : nav.label;
  const participant = activeConversation?.participant;
  const inboxCopy = isCoach
    ? {
      eyebrow: 'Learner inbox',
      title: 'Conversations with your learners',
      description: 'Only learners assigned to Med.Maher@kentbusinesscollege.com appear here.',
      searchPlaceholder: 'Search learner name, programme, or message preview...',
      listTitle: 'Learners',
    }
    : {
      eyebrow: 'Your inbox',
      title: 'Conversations with your coach',
      description: 'Your conversations with your coach appear here.',
      searchPlaceholder: 'Search your messages...',
      listTitle: 'Conversations',
    };

  return (
    <WorkspaceShell
      role={role}
      roleLabel={nav.label}
      navItems={nav.items}
      workspaceLabel={isCoach ? 'Coach Workspace' : nav.workspaceLabel || 'Messages'}
      pageTitle="Messages"
      pageSubtitle={isCoach ? 'Private conversations with your coaching participants' : 'Private conversations with your coach'}
      userName={metaName}
      userRole={metaRole}
      showBackButton={false}
    >
      <div className="w-full min-w-0 min-h-[calc(100vh-140px)] bg-background-100 px-4 pb-6 md:px-6">
        <div className="flex items-center gap-2 py-3 text-xs text-foreground-400">
          <AppIcon className="ri-home-4-line" />
          <AppIcon className="ri-arrow-right-s-line text-foreground-300" />
          <span>{isCoach ? 'Coach Workspace' : nav.label}</span>
          <AppIcon className="ri-arrow-right-s-line text-foreground-300" />
          <span className="font-medium text-foreground-700">{isCoach ? 'Learner Messages' : 'Messages'}</span>
        </div>

        <section className="h-full min-w-0 rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm overflow-hidden">
          <div className={`${activeConversationId !== null ? 'hidden lg:flex' : 'flex'} px-3 sm:px-5 md:px-6 py-3 md:py-4 border-b border-foreground-200/70 flex-col gap-3`}>
            <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
              <div className="lg:flex-1 min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.2em] text-primary-600 uppercase mb-2">{inboxCopy.eyebrow}</p>
                <h1 className="text-2xl md:text-[28px] font-heading font-semibold tracking-tight text-foreground-950">
                  {inboxCopy.title}
                </h1>
                <p className="text-sm text-foreground-500 mt-1">{inboxCopy.description}</p>
              </div>

              <div className="xl:min-w-[520px] lg:shrink-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: isCoach ? 'Learners' : 'Conversations', icon: 'ri-group-line', iconTone: 'text-primary-600 bg-primary-50' },
                  { label: 'Unread', icon: 'ri-mail-unread-line', iconTone: 'text-secondary-600 bg-secondary-50' },
                  { label: 'Need Reply', icon: 'ri-reply-line', iconTone: 'text-accent-600 bg-accent-50' },
                  { label: isCoach ? 'At Risk' : 'Active', icon: isCoach ? 'ri-alarm-warning-line' : 'ri-chat-check-line', iconTone: isCoach ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50' },
                ].map(stat => (
                  <div key={stat.label} className="min-h-[58px] rounded-xl border border-foreground-200 bg-background-100/60 px-3 py-2.5 flex items-center gap-2.5">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${stat.iconTone}`}>
                      <AppIcon className={`${stat.icon} text-sm`} />
                    </span>
                    <p className="text-[11px] font-medium text-foreground-600 leading-tight">{stat.label}</p>
                  </div>
                ))}
                </div>
                <div className="flex items-center justify-start xl:justify-end gap-2 mt-3 overflow-x-auto pb-1">
                  {[
                    { id: 'all' as const, label: `All (${conversations.length})` },
                    { id: 'unread' as const, label: `Unread (${unreadCount})` },
                    { id: 'at-risk' as const, label: isCoach ? `At Risk (${atRiskCount})` : `Active (${conversations.length})` },
                    { id: 'needs-reply' as const, label: `Needs Reply (${needReplyCount})` },
                    { id: 'recent' as const, label: 'Recent' },
                  ].map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => setActiveFilter(filter.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-full border text-[11px] font-medium transition-smooth cursor-pointer ${activeFilter === filter.id ? 'border-primary-500 bg-primary-600 text-white shadow-sm shadow-primary-500/20' : 'border-foreground-200 bg-background-50 text-foreground-500 hover:border-primary-300 hover:text-primary-700'}`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative mt-5">
              <AppIcon className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-300" />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={inboxCopy.searchPlaceholder}
                className="w-full h-10 rounded-xl border border-foreground-200 bg-background-100 pl-10 pr-4 text-sm text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth"
              />
            </div>

          </div>

          <div className={`${activeConversationId !== null ? 'h-[calc(100vh-120px)] lg:h-[calc(100vh-350px)] lg:min-h-[460px]' : 'min-h-[360px] md:min-h-[420px] lg:h-[calc(100vh-350px)] lg:min-h-[460px]'} grid min-w-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]`}>
            <aside className={`${activeConversationId !== null ? 'hidden md:flex' : 'flex'} border-r border-foreground-200 bg-background-50 flex-col md:min-h-0`}>
              <div className="px-4 py-3 border-b border-foreground-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground-800">{inboxCopy.listTitle}</p>
                  <p className="text-[10px] text-foreground-400">{filteredConversations.length} visible conversation{filteredConversations.length === 1 ? '' : 's'}</p>
                </div>
                <span className="text-[10px] font-medium text-primary-600 bg-primary-50 px-2 py-1 rounded-full">{activeFilter === 'all' ? 'All' : activeFilter.replace('-', ' ')}</span>
              </div>
              <div className="max-h-[420px] md:max-h-[520px] overflow-y-auto overscroll-contain md:flex-1 md:min-h-0 md:max-h-none">
                {loadingConversations && <p className="p-5 text-sm text-foreground-400">Loading conversations...</p>}
                {!loadingConversations && filteredConversations.length === 0 && (
                  <p className="p-5 text-sm text-foreground-400">{error || 'No conversations available.'}</p>
                )}
                {filteredConversations.map(conversation => {
                  const item = conversation.participant;
                  const selected = activeConversationId === conversation.id;
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => setActiveConversationId(conversation.id)}
                      className={`w-full flex items-start gap-3 p-4 text-left border-b border-foreground-100 transition-smooth cursor-pointer ${selected ? 'bg-primary-50/70 border-l-2 border-l-primary-500' : 'hover:bg-background-100'}`}
                    >
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold">
                          {initials(item.name)}
                        </div>
                        <span className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background-50" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground-800 truncate">{item.name}</p>
                          <span className="text-[10px] text-foreground-400 shrink-0">{formatListTime(conversation.updated_at)}</span>
                        </div>
                        <p className="text-[11px] text-foreground-400 truncate mt-0.5">{item.type === 'learner' ? 'Learner' : 'Progress Coach'}</p>
                        {isCoach && <span className="inline-flex mt-2 text-[10px] font-medium text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">At Risk</span>}
                        <p className="text-xs text-foreground-500 truncate mt-2">{conversation.latest_message ? (conversation.latest_message.is_deleted ? 'Message deleted' : conversation.latest_message.body) : 'No messages yet'}</p>
                      </div>
                      {conversation.unread_count > 0 && <span className="bg-primary-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">{conversation.unread_count}</span>}
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className={`${activeConversationId !== null ? 'flex' : 'hidden md:flex'} w-full min-w-0 min-h-0 bg-background-50 flex-col`}>
              {activeConversation && participant ? (
                <>
                  <div className="px-3 sm:px-5 md:px-6 py-3 md:py-4 border-b border-foreground-200/70 bg-background-50 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={leaveConversation}
                      title="Back"
                      aria-label="Back"
                      className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-full border border-foreground-200 text-foreground-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-smooth cursor-pointer"
                    >
                      <AppIcon className="ri-arrow-left-line text-base" />
                    </button>
                    <button
                      onClick={() => navigate(isCoach ? `/coach/learner-case-file?id=${encodeURIComponent(participant.id)}` : `/learner/profile?learner=${encodeURIComponent(participant.id)}`)}
                      title="Open profile"
                      aria-label={`Open ${participant.name}'s profile`}
                      className="w-11 h-11 rounded-2xl shrink-0 bg-primary-100 text-primary-700 font-semibold flex items-center justify-center hover:bg-primary-200 transition-smooth cursor-pointer"
                    >
                      {initials(participant.name)}
                    </button>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-foreground-900 truncate">{participant.name}</h2>
                      <p className="text-xs text-foreground-500 truncate mt-0.5">{participant.email}</p>
                    </div>
                    <div className="ml-auto shrink-0">
                      <button onClick={() => navigate(isCoach ? `/coach/learner-case-file?id=${encodeURIComponent(participant.id)}` : `/learner/profile?learner=${encodeURIComponent(participant.id)}`)} className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-smooth cursor-pointer whitespace-nowrap">
                        <AppIcon className="ri-user-line" /><span className="hidden sm:inline">Open Profile</span>
                      </button>
                    </div>
                    </div>
                  </div>
                  {error && <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>}

                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 md:px-8 py-4 md:py-5 bg-background-100/40"
                  >
                    {loadingMessages && (
                      <div className="w-full space-y-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div key={index} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[min(72%,520px)] rounded-2xl px-3.5 py-2.5 animate-pulse ${index % 2 === 0 ? 'bg-background-50' : 'bg-primary-100'}`}>
                              <div className="h-3 w-48 rounded bg-background-200 mb-2" />
                              <div className="h-3 w-28 rounded bg-background-200" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!loadingMessages && messages.length === 0 && (
                      <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 rounded-2xl bg-primary-50 text-primary-500 flex items-center justify-center mb-4">
                          <AppIcon className="ri-message-3-line text-2xl" />
                        </div>
                        <p className="text-sm font-semibold text-foreground-800">Start the first conversation</p>
                        <p className="text-xs text-foreground-400 mt-2 max-w-sm">Send a message to start the conversation with your coach.</p>
                      </div>
                    )}
                    {!loadingMessages && messages.length > 0 && (
                      <div className="w-full space-y-1.5">
                        {messages.map((message, index) => {
                          const previous = messages[index - 1];
                          const next = messages[index + 1];
                          const showDate = !previous || formatDateLabel(previous.created_at) !== formatDateLabel(message.created_at);
                          const isFirstInGroup = !canGroupMessages(previous, message);
                          const isLastInGroup = !canGroupMessages(message, next);
                          return (
                            <div key={message.id} className={isLastInGroup ? 'pb-4' : 'pb-0.5'}>
                              {showDate && <div className="flex justify-center my-2.5"><span className="px-2.5 py-0.5 rounded-full bg-background-50 border border-foreground-200/60 text-[10px] font-medium text-foreground-400">{formatDateLabel(message.created_at)}</span></div>}
                              <div className={`flex items-end gap-2 ${message.is_mine ? 'justify-end pl-2 sm:pl-10' : 'justify-start pr-2 sm:pr-10'} group`}>
                                {!message.is_mine && (
                                  <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-[10px] font-semibold flex items-center justify-center shrink-0">
                                    {initials(participant.name)}
                                  </div>
                                )}
                                <div className={`flex max-w-[min(78%,560px)] xl:max-w-[min(72%,700px)] flex-col ${message.is_mine ? 'items-end' : 'items-start'}`}>
                                  {isFirstInGroup && <span className="mb-0.5 text-[10px] font-semibold text-foreground-400">{message.is_mine ? 'You' : participant.name}</span>}
                                  {editingMessageId === message.id ? (
                                    <div className="rounded-2xl border border-primary-300 bg-background-50 p-3 shadow-sm">
                                      <textarea
                                        value={editingBody}
                                        onChange={event => setEditingBody(event.target.value)}
                                        onKeyDown={event => {
                                          if (event.key === 'Escape') cancelEdit();
                                          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void handleEdit(); }
                                        }}
                                        maxLength={5000}
                                        rows={3}
                                        autoFocus
                                        className="w-full min-w-[220px] resize-none border-0 bg-transparent outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 text-sm text-foreground-700"
                                      />
                                      <div className="flex justify-end gap-2 mt-2">
                                        <button onClick={cancelEdit} disabled={savingEdit} className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-foreground-500 hover:bg-background-100 cursor-pointer disabled:opacity-50">Cancel</button>
                                        <button onClick={() => void handleEdit()} disabled={!editingBody.trim() || savingEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                                          <AppIcon className={savingEdit ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} /> Save
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={`flex items-end gap-2 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`rounded-2xl px-3 py-2 shadow-sm ${message.is_mine ? 'bg-primary-600 text-white rounded-br-md' : 'bg-background-50 text-foreground-800 rounded-bl-md border border-foreground-200/70'}`}>
                                        <p className={`text-[13px] leading-snug break-words whitespace-pre-wrap ${message.is_deleted ? 'italic' : ''}`}>{message.is_deleted ? 'Message deleted' : message.body}</p>
                                        <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${message.is_mine ? 'justify-end text-white/80' : 'text-foreground-400'}`}>
                                          <span>{formatTime(message.created_at)}{message.edited_at && <span> · Edited</span>}</span>
                                          {message.is_mine && <AppIcon className={`${message.read_at ? 'ri-check-double-line text-primary-100' : 'ri-check-line'} text-xs`} />}
                                        </div>
                                      </div>
                                      <div className={`relative mb-1 ${messageMenuId === message.id ? 'z-20' : ''}`}>
                                        <button
                                          onClick={() => setMessageMenuId(current => current === message.id ? null : message.id)}
                                          title="Message actions"
                                          aria-label="Message actions"
                                          className="w-7 h-7 rounded-lg border border-foreground-200 bg-background-50 text-foreground-400 hover:text-primary-600 hover:border-primary-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-smooth cursor-pointer flex items-center justify-center"
                                        >
                                          <AppIcon className={deletingMessageId === message.id ? 'ri-loader-4-line animate-spin text-xs' : 'ri-more-2-fill text-xs'} />
                                        </button>
                                        {messageMenuId === message.id && deletingMessageId !== message.id && (
                                          <div className={`absolute bottom-9 w-44 rounded-xl border border-foreground-200 bg-background-50 p-1.5 shadow-lg ${message.is_mine ? 'right-0' : 'left-0'}`}>
                                            {message.is_mine && !message.is_deleted && isWithinMessageActionWindow(message) && (
                                              <button onClick={() => beginEdit(message)} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground-600 hover:bg-primary-50 hover:text-primary-700 cursor-pointer"><AppIcon className="ri-edit-line" /> Edit message</button>
                                            )}
                                            <button onClick={() => void handleDelete(message, 'me')} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground-600 hover:bg-background-100 cursor-pointer"><AppIcon className="ri-delete-bin-line" /> Delete for me</button>
                                            {message.is_mine && !message.is_deleted && isWithinMessageActionWindow(message) && (
                                              <button onClick={() => void handleDelete(message, 'everyone')} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-600 hover:bg-red-50 cursor-pointer"><AppIcon className="ri-delete-bin-6-line" /> Delete for everyone</button>
                                            )}
                                            {message.is_mine && !message.is_deleted && !isWithinMessageActionWindow(message) && <p className="px-2.5 py-1.5 text-[10px] leading-snug text-foreground-400">Edit and delete for everyone expire after 15 minutes.</p>}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </div>

                  <div className="px-3 sm:px-5 md:px-8 py-2.5 md:py-3 border-t border-foreground-200/70 bg-background-50 shrink-0">
                    <div className="w-full rounded-2xl border border-foreground-200/70 bg-background-100 p-2.5 shadow-sm focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-smooth">
                      <textarea
                        value={newMessage}
                        onChange={event => setNewMessage(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }}
                        maxLength={5000}
                        rows={2}
                        placeholder={`Message ${participant.name.split(' ')[0]}...`}
                        className="w-full resize-none border-0 bg-transparent text-sm text-foreground-700 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 placeholder:text-foreground-300"
                      />
                      <div className="mt-2 flex items-center justify-end gap-3">
                        <button
                          onClick={() => void handleSend()}
                          disabled={!newMessage.trim() || sending}
                          className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth ${newMessage.trim() && !sending ? 'bg-primary-600 text-white hover:bg-primary-700 cursor-pointer' : 'bg-background-200 text-foreground-300 cursor-not-allowed'}`}
                        >
                          <AppIcon className={sending ? 'ri-loader-4-line animate-spin mr-1.5' : 'ri-send-plane-fill mr-1.5'} />{sending ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 min-h-[360px] flex flex-col items-center justify-center text-center px-6">
                  <div className="w-20 h-20 rounded-3xl bg-background-100 text-foreground-300 flex items-center justify-center mb-4">
                    <AppIcon className="ri-mail-open-line text-3xl" />
                  </div>
                  <h2 className="text-lg font-heading font-semibold text-foreground-800">Select a conversation</h2>
                  <p className="text-sm text-foreground-400 mt-2 max-w-md">Choose a conversation from the left to read the thread and send a message.</p>
                </div>
              )}
            </main>
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
/*
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-semibold text-foreground-900 truncate">{participant.name}</h2>
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">At Risk</span>
                          <span className="text-[10px] font-semibold text-foreground-500 bg-background-100 border border-foreground-200 px-1.5 py-0.5 rounded-full">Coach RAG: Red</span>
                        </div>
                        <p className="text-xs text-foreground-500 mt-1">{participant.email}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[10px] text-foreground-500 border border-foreground-200 bg-background-100 px-2 py-1 rounded-full">Progress 0%</span>
                          <span className="text-[10px] text-amber-700 border border-amber-200 bg-amber-50 px-2 py-1 rounded-full">OTJH 0/1</span>
                          <span className="text-[10px] text-foreground-500 border border-foreground-200 bg-background-100 px-2 py-1 rounded-full">Active</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <button onClick={() => navigate(`/learner/profile?learner=${participant.id}`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-smooth cursor-pointer">
                        <AppIcon className="ri-user-line" /> Open Profile
                      </button>
                    </div>
                  </div>

                  {error && <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>}

                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 lg:px-8 py-5 bg-background-50"
                  >
                    <div className="flex justify-center mb-5">
                      <span className="text-[10px] text-foreground-500 border border-foreground-200 bg-background-100 px-2.5 py-1 rounded-full">
                        {messages[0] ? formatDateLabel(messages[0].created_at) : 'Conversation'}
                      </span>
                    </div>
                    {loadingMessages && <p className="text-sm text-foreground-400 text-center">Loading messages...</p>}
                    {!loadingMessages && messages.length === 0 && <p className="text-sm text-foreground-400 text-center mt-12">No messages yet. Send the first message.</p>}
                    <div className="space-y-0.5">
                      {messages.map((message, index) => {
                        const previous = messages[index - 1];
                        const next = messages[index + 1];
                        const showDate = Boolean(previous && formatDateLabel(previous.created_at) !== formatDateLabel(message.created_at));
                        const isFirstInGroup = !canGroupMessages(previous, message);
                        const isLastInGroup = !canGroupMessages(message, next);
                        return (
                          <div key={message.id} className={isLastInGroup ? 'pb-4' : 'pb-0.5'}>
                            {showDate && <div className="flex justify-center my-5"><span className="text-[10px] text-foreground-500 border border-foreground-200 bg-background-100 px-2.5 py-1 rounded-full">{formatDateLabel(message.created_at)}</span></div>}
                            <div className={`flex ${message.is_mine ? 'justify-end' : 'justify-start'} group`}>
                              <div className="max-w-[70%] flex flex-col">
                                {isFirstInGroup && <span className={`text-[10px] text-foreground-400 mb-1 ${message.is_mine ? 'text-right' : 'text-left'}`}>{message.is_mine ? 'You' : participant.name}</span>}
                                {editingMessageId === message.id ? (
                                  <div className="rounded-2xl border border-primary-300 bg-background-50 p-3 shadow-sm">
                                    <textarea
                                      value={editingBody}
                                      onChange={event => setEditingBody(event.target.value)}
                                      onKeyDown={event => {
                                        if (event.key === 'Escape') cancelEdit();
                                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void handleEdit(); }
                                      }}
                                      maxLength={5000}
                                      rows={3}
                                      autoFocus
                                      className="w-full min-w-[220px] resize-none border-0 bg-transparent outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 text-sm text-foreground-700"
                                    />
                                    <div className="flex justify-end gap-2 mt-2">
                                      <button onClick={cancelEdit} disabled={savingEdit} className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-foreground-500 hover:bg-background-100 cursor-pointer disabled:opacity-50">Cancel</button>
                                      <button onClick={() => void handleEdit()} disabled={!editingBody.trim() || savingEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                                        <AppIcon className={savingEdit ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} /> Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className={`flex items-end gap-2 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`px-3.5 py-2.5 shadow-sm ${message.is_mine
                                      ? `bg-primary-600 text-white ${isFirstInGroup ? 'rounded-t-2xl' : 'rounded-t-md'} ${isLastInGroup ? 'rounded-br-md rounded-b-2xl' : 'rounded-r-md rounded-b-md'}`
                                      : `bg-background-100 text-foreground-700 border border-foreground-200 ${isFirstInGroup ? 'rounded-t-2xl' : 'rounded-t-md'} ${isLastInGroup ? 'rounded-bl-md rounded-b-2xl' : 'rounded-l-md rounded-b-md'}`}`}>
                                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{message.is_deleted ? 'Message deleted' : message.body}</p>
                                    </div>
                                    <div className={`relative mb-1 ${messageMenuId === message.id ? 'z-20' : ''}`}>
                                      <button
                                        onClick={() => setMessageMenuId(current => current === message.id ? null : message.id)}
                                        title="Message actions"
                                        aria-label="Message actions"
                                        className="w-7 h-7 rounded-lg border border-foreground-200 bg-background-50 text-foreground-400 hover:text-primary-600 hover:border-primary-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-smooth cursor-pointer flex items-center justify-center"
                                      >
                                        <AppIcon className={deletingMessageId === message.id ? 'ri-loader-4-line animate-spin text-xs' : 'ri-more-2-fill text-xs'} />
                                      </button>
                                      {messageMenuId === message.id && deletingMessageId !== message.id && (
                                        <div className={`absolute bottom-9 w-44 rounded-xl border border-foreground-200 bg-background-50 p-1.5 shadow-lg ${message.is_mine ? 'right-0' : 'left-0'}`}>
                                          {message.is_mine && !message.is_deleted && isWithinMessageActionWindow(message) && (
                                            <button onClick={() => beginEdit(message)} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground-600 hover:bg-primary-50 hover:text-primary-700 cursor-pointer">
                                              <AppIcon className="ri-edit-line" /> Edit message
                                            </button>
                                          )}
                                          <button onClick={() => void handleDelete(message, 'me')} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground-600 hover:bg-background-100 cursor-pointer">
                                            <AppIcon className="ri-delete-bin-line" /> Delete for me
                                          </button>
                                          {message.is_mine && !message.is_deleted && isWithinMessageActionWindow(message) && (
                                            <button onClick={() => void handleDelete(message, 'everyone')} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-600 hover:bg-red-50 cursor-pointer">
                                              <AppIcon className="ri-delete-bin-6-line" /> Delete for everyone
                                            </button>
                                          )}
                                          {message.is_mine && !message.is_deleted && !isWithinMessageActionWindow(message) && (
                                            <p className="px-2.5 py-1.5 text-[10px] leading-snug text-foreground-400">Edit and delete for everyone expire after 15 minutes.</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {isLastInGroup && <div className={`flex items-center gap-1 mt-1 text-[9px] text-foreground-400 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                                  <span>{formatTime(message.created_at)}{message.edited_at && <span> · edited</span>}</span>
                                  {message.is_mine && <AppIcon className={`${message.read_at ? 'ri-check-double-line text-primary-500' : 'ri-check-line'} text-xs`} />}
                                </div>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="px-4 lg:px-5 py-2.5 border-t border-foreground-200 bg-background-50 shrink-0">
                    <div className="rounded-xl border border-foreground-200 bg-background-100/70 p-2.5 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-smooth">
                      <textarea
                        value={newMessage}
                        onChange={event => setNewMessage(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }}
                        maxLength={5000}
                        rows={2}
                        placeholder={`Message ${participant.name.split(' ')[0]}...`}
                        className="w-full resize-none border-0 bg-transparent outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 text-sm text-foreground-700 placeholder:text-foreground-400"
                      />
                      <div className="flex items-center justify-end gap-3 mt-1.5">
                        <button
                          onClick={() => void handleSend()}
                          disabled={!newMessage.trim() || sending}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-smooth ${newMessage.trim() && !sending ? 'bg-primary-600 text-white hover:bg-primary-700 cursor-pointer' : 'bg-background-200 text-foreground-400 cursor-not-allowed'}`}
                        >
                          <AppIcon className={sending ? 'ri-loader-4-line animate-spin' : 'ri-send-plane-fill'} /> Send
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center px-6">
                  <div>
                    <span className="w-20 h-20 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-5"><AppIcon className="ri-mail-line text-3xl text-foreground-300" /></span>
                    <h3 className="text-base font-heading font-semibold text-foreground-500 mb-2">Select a conversation</h3>
                    <p className="text-sm text-foreground-400 max-w-sm">Choose a learner or coach from the list to view the conversation.</p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}*/
