import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import {
  ChatApiError,
  type ChatConversation,
  type ChatMessage,
  type ChatSocketMessage,
  chatSocketUrl,
  createChatMessage,
  fetchChatConversations,
  fetchChatMessages,
  markChatMessageRead,
} from '@/api/chat';

const categoryColors: Record<string, string> = {
  Coaching: 'bg-primary-100 text-primary-700',
  Learner: 'bg-secondary-100 text-secondary-700',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || '?';
}

function avatarColor(type: 'coach' | 'learner'): string {
  return type === 'coach' ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-700';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatListTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(value);
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

export default function MessagesPage() {
  const { auth } = useAuth();
  const role = auth.roles[0]?.slug || 'learner';
  const nav = roleNavMap[role] || roleNavMap.learner;
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'offline'>('offline');
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConversation = useMemo(
    () => conversations.find(conversation => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const data = await fetchChatConversations();
      setConversations(data);
      setActiveConversationId(current => current ?? data[0]?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load conversations.');
    } finally {
      setLoadingConversations(false);
    }
  }, []);

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

        const socket = new WebSocket(chatSocketUrl(activeConversationId));
        socketRef.current = socket;
        socket.onopen = () => { if (!cancelled) setSocketState('connected'); };
        socket.onmessage = event => {
          if (cancelled) return;
          try {
            const payload = JSON.parse(event.data) as { type?: string; message?: ChatSocketMessage; detail?: string };
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
        socket.onclose = () => { if (!cancelled) setSocketState('offline'); };
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter(conversation => (
      conversation.participant.name.toLowerCase().includes(query)
      || conversation.participant.type.includes(query)
      || conversation.latest_message?.body.toLowerCase().includes(query)
    ));
  }, [conversations, searchQuery]);

  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);

  const handleSelectConversation = (conversationId: number) => {
    setActiveConversationId(conversationId);
    setConversations(current => current.map(conversation => (
      conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation
    )));
  };

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

  const metaName = auth.user?.fullName || 'User';
  const metaRole = role === 'coach' ? 'Coach' : role === 'learner' ? 'Learner' : nav.label;

  return (
    <WorkspaceShell
      role={role}
      roleLabel={nav.label}
      navItems={nav.items}
      workspaceLabel={nav.workspaceLabel || 'Messages'}
      pageTitle="Messages"
      pageSubtitle="Private conversations with your coaching participants"
      userName={metaName}
      userRole={metaRole}
    >
      <div className="flex h-[calc(100vh-140px)]">
        <div className="w-full lg:w-[360px] border-r border-background-200/50 bg-background-50 flex flex-col shrink-0">
          <div className="p-4 border-b border-foreground-300/50">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
              <input
                type="text"
                placeholder="Search messages..."
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-100 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
              />
            </div>
          </div>
          <div className="px-4 py-2 border-b border-foreground-300/50 bg-background-100/50 flex items-center justify-between">
            <p className="text-xs text-foreground-400">
              {searchQuery ? `${filteredConversations.length} result${filteredConversations.length !== 1 ? 's' : ''}` : `${totalUnread} unread`}
            </p>
            <Link to="/starred-messages" className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-star-line text-xs"></i> Starred
            </Link>
          </div>
          {totalUnread > 0 && (
            <div className="px-4 py-2 border-b border-foreground-300/50 bg-primary-50/50">
              <p className="text-xs text-primary-700 font-medium">
                <i className="ri-mail-unread-line mr-1"></i>{totalUnread} unread from {conversations.filter(item => item.unread_count > 0).length} conversations
              </p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {loadingConversations && <p className="p-5 text-sm text-foreground-400">Loading conversations...</p>}
            {!loadingConversations && filteredConversations.length === 0 && (
              <p className="p-5 text-sm text-foreground-400">{error || 'No conversations available.'}</p>
            )}
            {filteredConversations.map(conversation => {
              const participant = conversation.participant;
              const category = participant.type === 'coach' ? 'Coaching' : 'Learner';
              return (
                <button
                  key={conversation.id}
                  onClick={() => handleSelectConversation(conversation.id)}
                  className={`w-full flex items-start gap-3 p-4 text-left transition-smooth cursor-pointer border-b border-background-200/20 hover:bg-background-100/50 ${activeConversationId === conversation.id ? 'bg-primary-50/60 border-l-2 border-l-primary-400' : ''}`}
                >
                  <div className="relative shrink-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${avatarColor(participant.type)}`}>
                      {initials(participant.name)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-semibold truncate ${conversation.unread_count > 0 ? 'text-foreground-900' : 'text-foreground-600'}`}>{participant.name}</p>
                      <span className="text-xs text-foreground-300 shrink-0 ml-2">{formatListTime(conversation.updated_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${categoryColors[category]}`}>{category}</span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${conversation.unread_count > 0 ? 'text-foreground-700 font-medium' : 'text-foreground-400'}`}>
                      {conversation.latest_message?.body || 'No messages yet'}
                    </p>
                  </div>
                  {conversation.unread_count > 0 && <span className="bg-primary-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0 mt-1">{conversation.unread_count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 min-w-0 bg-white flex flex-col">
          {activeConversation ? (
            <>
              <div className="px-6 py-4 border-b border-background-200/50 bg-primary-50/40 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${avatarColor(activeConversation.participant.type)}`}>
                    {initials(activeConversation.participant.name)}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground-800">{activeConversation.participant.name}</h2>
                    <p className="text-xs text-foreground-400 capitalize">{activeConversation.participant.type}</p>
                  </div>
                </div>
                <span className={`text-[10px] flex items-center gap-1 ${socketState === 'connected' ? 'text-emerald-600' : 'text-foreground-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${socketState === 'connected' ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                  {socketState === 'connected' ? 'Live' : 'Offline'}
                </span>
              </div>
              {error && <div className="px-6 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {loadingMessages && <p className="text-sm text-foreground-400 text-center">Loading messages...</p>}
                {!loadingMessages && messages.length === 0 && <p className="text-sm text-foreground-400 text-center mt-10">No messages yet. Send the first message.</p>}
                {messages.map(message => (
                  <div key={message.id} className={`flex ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] ${message.is_mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`px-4 py-2.5 rounded-2xl ${message.is_mine ? 'bg-primary-500 text-white rounded-br-md' : 'bg-background-100 text-foreground-700 rounded-bl-md'}`}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.is_deleted ? 'Message deleted' : message.body}</p>
                      </div>
                      <div className={`flex items-center gap-1 mt-1 text-[10px] text-foreground-300 ${message.is_mine ? 'justify-end' : 'justify-start'}`}>
                        <span>{formatTime(message.created_at)}</span>
                        {message.is_mine && <i className={`${message.read_at ? 'ri-check-double-line text-primary-500' : 'ri-check-line'} text-xs`}></i>}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="px-6 py-4 border-t border-background-200/30 shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={5000}
                    placeholder={`Message ${activeConversation.participant.name.split(' ')[0]}...`}
                    value={newMessage}
                    onChange={event => setNewMessage(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 bg-background-100 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
                  />
                  <button
                    onClick={() => void handleSend()}
                    disabled={!newMessage.trim() || sending}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-smooth ${newMessage.trim() && !sending ? 'bg-primary-500 text-white hover:bg-primary-600 cursor-pointer' : 'bg-background-100 text-foreground-300 cursor-not-allowed'}`}
                  >
                    <i className={sending ? 'ri-loader-4-line animate-spin text-sm' : 'ri-send-plane-fill text-sm'}></i>
                  </button>
                </div>
                <p className="text-[10px] text-foreground-300 mt-2 text-right">Messages are stored securely in PostgreSQL</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <span className="w-20 h-20 rounded-2xl bg-background-100 flex items-center justify-center mb-5"><i className="ri-mail-line text-3xl text-foreground-300"></i></span>
              <h3 className="text-base font-heading font-semibold text-foreground-400 mb-2">Your Messages</h3>
              <p className="text-sm text-foreground-300 max-w-sm leading-relaxed">Select a conversation from the left to view your messages.</p>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
