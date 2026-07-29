import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
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
  fetchChatMessages,
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = auth.roles[0]?.slug || 'learner';
  const nav = roleNavMap[role] || roleNavMap.learner;
  const isCoach = role === 'coach';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find(conversation => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      // The app login is local-demo auth, so ensure the protected Django chat
      // session is ready before loading the PostgreSQL conversations.
      if (auth.user?.email && (role === 'coach' || role === 'learner')) {
        await bootstrapChatSession(auth.user.email);
      }
      const data = await fetchChatConversations();
      setConversations(data);

      const requestedConversation = Number(searchParams.get('conversation'));
      setActiveConversationId(current => (
        current ?? (Number.isFinite(requestedConversation) && data.some(item => item.id === requestedConversation)
          ? requestedConversation
          : data[0]?.id ?? null)
      ));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load conversations.');
    } finally {
      setLoadingConversations(false);
    }
  }, [auth.user?.email, role, searchParams]);

  useEffect(() => {
    if (auth.isAuthenticated) void loadConversations();
    else setLoadingConversations(false);
  }, [auth.isAuthenticated, loadConversations]);

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
        const page = await fetchChatMessages(activeConversationId);
        if (cancelled) return;
        setMessages(page.results);

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
    if (!auth.isAuthenticated || activeConversationId === null) return;

    const syncMessages = async () => {
      try {
        const page = await fetchChatMessages(activeConversationId);
        const unread = page.results.filter(message => !message.is_mine && !message.read_at);
        setMessages(page.results);

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
      }
    };

    const pollTimer = window.setInterval(() => { void syncMessages(); }, 2000);
    return () => window.clearInterval(pollTimer);
  }, [activeConversationId, auth.isAuthenticated]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
  }, [activeFilter, conversations, role, searchQuery]);

  const unreadCount = conversations.reduce((sum, item) => sum + item.unread_count, 0);
  const needReplyCount = conversations.filter(item => item.latest_message?.sender.type !== role).length;
  const atRiskCount = conversations.filter(item => item.participant.type === 'learner').length;

  const handleSend = async () => {
    const body = newMessage.trim();
    if (!body || activeConversationId === null || sending) return;
    setSending(true);
    setNewMessage('');
    try {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'send_message', body }));
      } else {
        const saved = await createChatMessage(activeConversationId, body);
        setMessages(current => mergeMessage(current, saved));
        await loadConversations();
      }
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
    >
      <div className="min-h-[calc(100vh-140px)] bg-background-100 px-4 pb-6 md:px-6">
        <div className="flex items-center gap-2 py-3 text-xs text-foreground-400">
          <i className="ri-home-4-line" />
          <i className="ri-arrow-right-s-line text-foreground-300" />
          <span>{isCoach ? 'Coach Workspace' : nav.label}</span>
          <i className="ri-arrow-right-s-line text-foreground-300" />
          <span className="font-medium text-foreground-700">{isCoach ? 'Learner Messages' : 'Messages'}</span>
        </div>

        <section className="rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm overflow-hidden">
          <div className="px-5 py-5 md:px-7 md:py-6 border-b border-foreground-200/70">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.2em] text-primary-600 uppercase mb-2">{inboxCopy.eyebrow}</p>
                <h1 className="text-2xl md:text-[28px] font-heading font-semibold tracking-tight text-foreground-950">
                  {inboxCopy.title}
                </h1>
                <p className="text-sm text-foreground-500 mt-1">{inboxCopy.description}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 xl:min-w-[520px]">
                {[
                  { label: isCoach ? 'Learners' : 'Conversations', value: conversations.length, icon: 'ri-group-line', tone: 'text-foreground-900', iconTone: 'text-primary-600 bg-primary-50' },
                  { label: 'Unread', value: unreadCount, icon: 'ri-mail-unread-line', tone: 'text-foreground-900', iconTone: 'text-secondary-600 bg-secondary-50' },
                  { label: 'Need Reply', value: needReplyCount, icon: 'ri-reply-line', tone: 'text-foreground-900', iconTone: 'text-accent-600 bg-accent-50' },
                  { label: isCoach ? 'At Risk' : 'Active', value: isCoach ? atRiskCount : conversations.length, icon: isCoach ? 'ri-alarm-warning-line' : 'ri-chat-check-line', tone: isCoach ? 'text-red-600' : 'text-emerald-600', iconTone: isCoach ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-xl border border-foreground-200 bg-background-100/60 px-3 py-2.5 flex items-center gap-2.5">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${stat.iconTone}`}>
                      <i className={`${stat.icon} text-sm`} />
                    </span>
                    <div>
                      <p className="text-[10px] text-foreground-400 leading-tight">{stat.label}</p>
                      <p className={`text-xl font-heading font-semibold leading-tight ${stat.tone}`}>{stat.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative mt-5">
              <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-300" />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={inboxCopy.searchPlaceholder}
                className="w-full h-10 rounded-xl border border-foreground-200 bg-background-100 pl-10 pr-4 text-sm text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth"
              />
            </div>

            <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1">
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

          <div className="flex h-[min(700px,calc(100vh-330px))] min-h-[500px]">
            <aside className="w-full md:w-[300px] lg:w-[330px] shrink-0 border-r border-foreground-200 bg-background-50 flex flex-col">
              <div className="px-4 py-3 border-b border-foreground-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground-800">{inboxCopy.listTitle}</p>
                  <p className="text-[10px] text-foreground-400">{filteredConversations.length} visible conversation{filteredConversations.length === 1 ? '' : 's'}</p>
                </div>
                <span className="text-[10px] font-medium text-primary-600 bg-primary-50 px-2 py-1 rounded-full">{activeFilter === 'all' ? 'All' : activeFilter.replace('-', ' ')}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
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
                        <span className="inline-flex mt-2 text-[10px] font-medium text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">At Risk</span>
                        <p className="text-xs text-foreground-500 truncate mt-2">{conversation.latest_message ? (conversation.latest_message.is_deleted ? 'Message deleted' : conversation.latest_message.body) : 'No messages yet'}</p>
                      </div>
                      {conversation.unread_count > 0 && <span className="bg-primary-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">{conversation.unread_count}</span>}
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="hidden md:flex flex-1 min-w-0 bg-background-50 flex-col">
              {activeConversation && participant ? (
                <>
                  <div className="px-5 lg:px-6 py-4 border-b border-foreground-200 bg-background-50 flex items-start justify-between gap-4 shrink-0">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center font-bold">{initials(participant.name)}</div>
                        <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background-50" />
                      </div>
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
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => navigate(-1)} className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-foreground-200 text-xs font-medium text-foreground-600 hover:border-primary-300 hover:text-primary-700 transition-smooth cursor-pointer">
                        <i className="ri-arrow-left-line" /> Back
                      </button>
                      <button onClick={() => navigate(`/learner/profile?learner=${participant.id}`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-smooth cursor-pointer">
                        <i className="ri-user-line" /> Open Profile
                      </button>
                    </div>
                  </div>

                  {error && <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>}

                  <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-5 bg-background-50">
                    <div className="flex justify-center mb-5">
                      <span className="text-[10px] text-foreground-500 border border-foreground-200 bg-background-100 px-2.5 py-1 rounded-full">
                        {messages[0] ? formatDateLabel(messages[0].created_at) : 'Conversation'}
                      </span>
                    </div>
                    {loadingMessages && <p className="text-sm text-foreground-400 text-center">Loading messages...</p>}
                    {!loadingMessages && messages.length === 0 && <p className="text-sm text-foreground-400 text-center mt-12">No messages yet. Send the first message.</p>}
                    <div className="space-y-5">
                      {messages.map((message, index) => {
                        const previous = messages[index - 1];
                        const showDate = Boolean(previous && formatDateLabel(previous.created_at) !== formatDateLabel(message.created_at));
                        return (
                          <div key={message.id}>
                            {showDate && <div className="flex justify-center my-5"><span className="text-[10px] text-foreground-500 border border-foreground-200 bg-background-100 px-2.5 py-1 rounded-full">{formatDateLabel(message.created_at)}</span></div>}
                            <div className={`flex ${message.is_mine ? 'justify-end' : 'justify-start'} group`}>
                              <div className="max-w-[78%] flex flex-col">
                                <span className={`text-[10px] text-foreground-400 mb-1 ${message.is_mine ? 'text-right' : 'text-left'}`}>{message.is_mine ? 'You' : participant.name}</span>
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
                                      className="w-full min-w-[220px] resize-none bg-transparent outline-none text-sm text-foreground-700"
                                    />
                                    <div className="flex justify-end gap-2 mt-2">
                                      <button onClick={cancelEdit} disabled={savingEdit} className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-foreground-500 hover:bg-background-100 cursor-pointer disabled:opacity-50">Cancel</button>
                                      <button onClick={() => void handleEdit()} disabled={!editingBody.trim() || savingEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-600 text-white text-[11px] font-semibold hover:bg-primary-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                                        <i className={savingEdit ? 'ri-loader-4-line animate-spin' : 'ri-check-line'} /> Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className={`flex items-end gap-2 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`px-4 py-3 rounded-2xl shadow-sm ${message.is_mine ? 'bg-primary-600 text-white rounded-br-md' : 'bg-background-100 text-foreground-700 border border-foreground-200 rounded-bl-md'}`}>
                                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.is_deleted ? 'Message deleted' : message.body}</p>
                                    </div>
                                    <div className={`relative mb-1 ${messageMenuId === message.id ? 'z-20' : ''}`}>
                                      <button
                                        onClick={() => setMessageMenuId(current => current === message.id ? null : message.id)}
                                        title="Message actions"
                                        aria-label="Message actions"
                                        className="w-7 h-7 rounded-lg border border-foreground-200 bg-background-50 text-foreground-400 hover:text-primary-600 hover:border-primary-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-smooth cursor-pointer flex items-center justify-center"
                                      >
                                        <i className={deletingMessageId === message.id ? 'ri-loader-4-line animate-spin text-xs' : 'ri-more-2-fill text-xs'} />
                                      </button>
                                      {messageMenuId === message.id && deletingMessageId !== message.id && (
                                        <div className={`absolute bottom-9 w-44 rounded-xl border border-foreground-200 bg-background-50 p-1.5 shadow-lg ${message.is_mine ? 'right-0' : 'left-0'}`}>
                                          {message.is_mine && !message.is_deleted && isWithinMessageActionWindow(message) && (
                                            <button onClick={() => beginEdit(message)} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground-600 hover:bg-primary-50 hover:text-primary-700 cursor-pointer">
                                              <i className="ri-edit-line" /> Edit message
                                            </button>
                                          )}
                                          <button onClick={() => void handleDelete(message, 'me')} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground-600 hover:bg-background-100 cursor-pointer">
                                            <i className="ri-delete-bin-line" /> Delete for me
                                          </button>
                                          {message.is_mine && !message.is_deleted && isWithinMessageActionWindow(message) && (
                                            <button onClick={() => void handleDelete(message, 'everyone')} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-600 hover:bg-red-50 cursor-pointer">
                                              <i className="ri-delete-bin-6-line" /> Delete for everyone
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
                                <div className={`flex items-center gap-1 mt-1 text-[10px] text-foreground-400 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                                  <span>{formatTime(message.created_at)}{message.edited_at && <span> · edited</span>}</span>
                                  {message.is_mine && <i className={`${message.read_at ? 'ri-check-double-line text-primary-500' : 'ri-check-line'} text-xs`} />}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="px-5 lg:px-6 py-3 border-t border-foreground-200 bg-background-50 shrink-0">
                    <div className="rounded-2xl border border-foreground-200 bg-background-100/70 p-3 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-smooth">
                      <textarea
                        value={newMessage}
                        onChange={event => setNewMessage(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }}
                        maxLength={5000}
                        rows={2}
                        placeholder={`Message ${participant.name.split(' ')[0]}...`}
                        className="w-full resize-none bg-transparent outline-none text-sm text-foreground-700 placeholder:text-foreground-400"
                      />
                      <div className="flex items-center justify-between gap-3 mt-2">
                        <p className="text-[10px] text-foreground-400">Press Enter to send, Shift + Enter for a new line.</p>
                        <button
                          onClick={() => void handleSend()}
                          disabled={!newMessage.trim() || sending}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-smooth ${newMessage.trim() && !sending ? 'bg-primary-600 text-white hover:bg-primary-700 cursor-pointer' : 'bg-background-200 text-foreground-400 cursor-not-allowed'}`}
                        >
                          <i className={sending ? 'ri-loader-4-line animate-spin' : 'ri-send-plane-fill'} /> Send
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-foreground-300 mt-2 text-right">Messages are stored securely in PostgreSQL</p>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-center px-6">
                  <div>
                    <span className="w-20 h-20 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-5"><i className="ri-mail-line text-3xl text-foreground-300" /></span>
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
}
