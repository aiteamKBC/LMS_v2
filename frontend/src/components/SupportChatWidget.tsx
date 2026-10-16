/**
 * Floating support assistant for the learner portal.
 *
 * Talks straight to the Kent Support Desk assistant API. The bot answers from
 * the support knowledge base and, when it cannot resolve the question, opens a
 * ticket in the support system without the learner ever leaving the LMS.
 *
 * Both addresses below are the deployed support portal. Override them per
 * environment with VITE_SUPPORT_API_BASE / VITE_SUPPORT_PORTAL_BASE — a local
 * backend during development, for instance. The portal must also list this
 * site's origin in its CORS_ALLOWED_ORIGINS, or the browser blocks the call.
 */
import { useEffect, useRef, useState } from 'react';
import { Lottie } from 'lottie-react';
import { useAuth } from '@/hooks/useAuth';
import robotAnimation from '@/assets/support-robot.lottie.json';

const SUPPORT_PORTAL_DEFAULT = 'https://technicalsupport.kentbusinesscollege.net';
const SUPPORT_API_BASE = import.meta.env.VITE_SUPPORT_API_BASE || SUPPORT_PORTAL_DEFAULT;
const SUPPORT_PORTAL_BASE = import.meta.env.VITE_SUPPORT_PORTAL_BASE || SUPPORT_PORTAL_DEFAULT;

type Sender = 'bot' | 'user';

interface Msg {
  id: string;
  sender: Sender;
  text: string;
  time: string;
}

interface AssistantReply {
  ok?: boolean;
  reply?: string;
  escalate?: boolean;
  assistantAction?: string;
  canCreateTicket?: boolean;
  offerActions?: string[];
  actionUrl?: string;
  actionLabel?: string;
  ticket?: { id: string; status?: string };
  message?: string;
}

/** What the learner asked for when they pressed one of the offer buttons. */
type EscalationChoice = 'ticket' | 'live_chat' | 'book_meeting';

/**
 * Pressing a button sends the choice as an action, not as a sentence. The
 * backend carries it out and reports what it did, so the assistant can no
 * longer mistake "book a session" for the LMS's own coach booking.
 */
const CHOICE_LABEL: Record<EscalationChoice, string> = {
  ticket: 'Open a ticket',
  live_chat: 'Live agent',
  book_meeting: 'Book a session',
};

/** Shown as the learner's own message so the transcript reads naturally. */
const CHOICE_ECHO: Record<EscalationChoice, string> = {
  ticket: 'Open a ticket for this, please.',
  live_chat: "I'd like a live agent, please.",
  book_meeting: "I'd like to book a session, please.",
};

/**
 * The launcher mascot: a waving support robot, animated with Lottie.
 *
 * The artwork is a licensed LottieFiles asset and is raster underneath — eight
 * PNG layers moved by the animation rather than vector shapes — so its colours
 * cannot be themed from here. It is used in its original palette by design; see
 * SupportChatWidget.md for the source and licence.
 *
 * It floats free rather than sitting in a brand-coloured disc: the character
 * fills a square frame with its own soft glow, and boxing it would crop it.
 */
function RobotMascot({ size }: { size: number }) {
  // Honour the system's reduced-motion setting. Paused, the robot still renders
  // — Lottie holds the first frame — so the launcher never comes up empty.
  const [still, setStill] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return (
    <Lottie
      src={robotAnimation}
      loop={!still}
      autoplay={!still}
      style={{ width: size, height: size, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}

/**
 * Friendly robot mascot. Cream face on the purple launcher, with a gold antenna
 * picking up the college's second brand colour. It blinks every few seconds so
 * the closed launcher still feels alive.
 */
const RobotFace = ({ size = 32, idle = true }: { size?: number; idle?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    {/* antenna */}
    <path d="M24 13V8" stroke="#E8C87A" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="24" cy="5.4" r="2.9" fill="#E8C87A">
      {idle && (
        <animate
          attributeName="opacity"
          values="1;0.45;1"
          dur="2.4s"
          repeatCount="indefinite"
        />
      )}
    </circle>

    {/* ears */}
    <rect x="3.5" y="23" width="5" height="10" rx="2.5" fill="#E8C87A" />
    <rect x="39.5" y="23" width="5" height="10" rx="2.5" fill="#E8C87A" />

    {/* head */}
    <rect x="8.5" y="13" width="31" height="27" rx="9.5" fill="#FFFDF8" />

    {/* cheeks */}
    <circle cx="14.6" cy="31.6" r="2.1" fill="#E8C87A" opacity=".5" />
    <circle cx="33.4" cy="31.6" r="2.1" fill="#E8C87A" opacity=".5" />

    {/* eyes — the blink is a vertical squash, so it reads as a wink not a fade */}
    <g className={idle ? 'kbc-bot-eyes' : undefined}>
      <circle cx="18.4" cy="24.4" r="3.2" fill="#3C1361" />
      <circle cx="29.6" cy="24.4" r="3.2" fill="#3C1361" />
      <circle cx="19.5" cy="23.3" r="1.05" fill="#FFFDF8" />
      <circle cx="30.7" cy="23.3" r="1.05" fill="#FFFDF8" />
    </g>

    {/* smile */}
    <path
      d="M18 30.4c1.9 2.6 4 3.9 6 3.9s4.1-1.3 6-3.9"
      stroke="#3C1361"
      strokeWidth="2.4"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const mkMsg = (sender: Sender, text: string): Msg => ({
  id: Math.random().toString(36).slice(2),
  sender,
  text,
  time: now(),
});

/**
 * The widget only lives on the Home page, so it unmounts — and used to lose
 * everything — the moment a learner clicked through to anywhere else and came
 * back. Keep the conversation in localStorage, keyed per learner, so reopening
 * it shows where they left off instead of a fresh greeting.
 */
const STORAGE_VERSION = 1;
const MAX_STORED_MESSAGES = 60;

interface StoredChatState {
  v: number;
  msgs: Msg[];
  ticketId: string | null;
  booted: boolean;
  offer: EscalationChoice[];
  action: { url: string; label: string } | null;
}

function storageKey(email: string) {
  return `kbc_support_chat:${email || 'anon'}`;
}

function loadStoredChat(email: string): StoredChatState | null {
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredChatState>;
    if (parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.msgs)) return null;
    return {
      v: STORAGE_VERSION,
      msgs: parsed.msgs,
      ticketId: parsed.ticketId ?? null,
      booted: Boolean(parsed.booted),
      offer: Array.isArray(parsed.offer) ? parsed.offer : [],
      action: parsed.action ?? null,
    };
  } catch {
    return null;
  }
}

function saveStoredChat(email: string, state: StoredChatState) {
  try {
    const trimmed = { ...state, msgs: state.msgs.slice(-MAX_STORED_MESSAGES) };
    localStorage.setItem(storageKey(email), JSON.stringify(trimmed));
  } catch {
    // Private browsing / storage full / disabled — the chat still works for
    // this page view, it just won't survive navigating away.
  }
}

export function SupportChatWidget() {
  const { auth } = useAuth();
  const email = auth?.account?.email || '';

  const [open, setOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [offer, setOffer] = useState<EscalationChoice[]>([]);
  const [action, setAction] = useState<{ url: string; label: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<Msg[]>([]);
  const ticketIdRef = useRef<string | null>(null);

  // Grow the composer with the text, up to the max height set on the element.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { ticketIdRef.current = ticketId; }, [ticketId]);

  // Rehydrate once we know which learner this is — email arrives a tick after
  // first render, so this can't just run on mount with an empty key.
  const restoredForEmailRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredForEmailRef.current === email) return;
    restoredForEmailRef.current = email;
    const stored = loadStoredChat(email);
    if (!stored) return;
    setMsgs(stored.msgs);
    setTicketId(stored.ticketId);
    setBooted(stored.booted);
    setOffer(stored.offer);
    setAction(stored.action);
  }, [email]);

  // Persist on every change. Skipped until boot so a page that never opens the
  // chat doesn't write an empty record over a real saved conversation.
  useEffect(() => {
    if (!booted) return;
    saveStoredChat(email, { v: STORAGE_VERSION, msgs, ticketId, booted, offer, action });
  }, [email, msgs, ticketId, booted, offer, action]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  /**
   * Greet instantly from the signed-in learner's name. The greeting is a fixed
   * sentence the server derives the same way, so asking it for one only made
   * the learner watch a typing indicator before their first word.
   */
  useEffect(() => {
    if (!open || booted) return;
    setBooted(true);
    const firstName = (auth?.account?.displayName || '').trim().split(/\s+/)[0];
    setMsgs([mkMsg('bot', firstName ? `Hi ${firstName}! How can I help?` : 'Hi! How can I help?')]);
  }, [open, booted, auth]);

  /**
   * Sends either a typed message or, when `choice` is set, the learner's chosen
   * support action. Actions skip the assistant's reasoning entirely — the
   * backend performs them and tells us what it did.
   */
  const send = async (text: string, choice?: EscalationChoice) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setMsgs((prev) => [...prev, mkMsg('user', trimmed)]);
    setInput('');
    setOffer([]);
    setAction(null);
    setBusy(true);

    try {
      const res = await fetch(`${SUPPORT_API_BASE}/api/support/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(choice ? { action: choice } : { message: trimmed }),
          messages: msgsRef.current.map((m) => ({ sender: m.sender, text: m.text })),
          createTicket: choice ? 'true' : 'false',
          // Tells the assistant this conversation has already escalated, so it
          // answers follow-ups instead of offering to escalate all over again.
          ...(ticketIdRef.current ? { ticketId: ticketIdRef.current } : {}),
          ...(email ? { email } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as AssistantReply | null;

      if (!res.ok || !data) {
        setMsgs((prev) => [...prev, mkMsg('bot', data?.message || 'Something went wrong. Please try again.')]);
        return;
      }
      setFailed(false);
      if (data.ticket?.id) setTicketId(data.ticket.id);
      setMsgs((prev) => [...prev, mkMsg('bot', data.reply || '')]);

      if (data.actionUrl) {
        setAction({ url: data.actionUrl, label: data.actionLabel || 'Open support portal' });
      }
      if (data.assistantAction === 'escalate_offer_ticket') {
        const actions = (data.offerActions || []).filter(
          (a): a is EscalationChoice => a in CHOICE_LABEL,
        );
        setOffer(actions.length ? actions : ['ticket', 'live_chat', 'book_meeting']);
      }
    } catch {
      // Only a real failed request marks the header offline; the greeting is
      // local now, so nothing else can tell us about connectivity.
      setFailed(true);
      setMsgs((prev) => [...prev, mkMsg('bot', 'I could not reach the support service. Please try again.')]);
    } finally {
      setBusy(false);
    }
  };

  const chooseEscalation = (choice: EscalationChoice) => {
    void send(CHOICE_ECHO[choice], choice);
  };

  /**
   * Wipes the thread and the saved copy, then greets again. The ticket link is
   * dropped too: clearing is about this conversation, and a learner who starts
   * over should not have their next question silently filed under a ticket they
   * think they have left behind. The ticket itself is untouched in the support
   * system — only this widget forgets it.
   */
  const clearChat = () => {
    if (busy) return;
    try {
      localStorage.removeItem(storageKey(email));
    } catch {
      // Nothing saved to remove; the in-memory reset below still applies.
    }
    const firstName = (auth?.account?.displayName || '').trim().split(/\s+/)[0];
    setMsgs([mkMsg('bot', firstName ? `Hi ${firstName}! How can I help?` : 'Hi! How can I help?')]);
    setTicketId(null);
    setOffer([]);
    setAction(null);
    setFailed(false);
    setInput('');
  };

  const panel = {
    position: 'fixed' as const,
    bottom: '96px',
    right: '24px',
    width: 'min(380px, calc(100vw - 32px))',
    height: 'min(560px, calc(100vh - 140px))',
    background: '#fff',
    borderRadius: '18px',
    boxShadow: '0 20px 60px rgba(44,20,70,.28)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    zIndex: 2147483000,
    border: '1px solid rgba(90,42,125,.14)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  };

  return (
    <>
      {open && (
        <div style={panel} role="dialog" aria-label="Support assistant">
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg,#3C1361 0%,#5A2A7D 100%)',
            color: '#fff', padding: '14px 16px', display: 'flex',
            alignItems: 'center', gap: '10px',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'rgba(255,255,255,.14)',
              border: '1px solid rgba(232,200,122,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <RobotFace size={24} idle={!busy} />
            </div>
            <div style={{ lineHeight: 1.25, flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Kent Support</div>
              <div style={{ fontSize: 11, opacity: .75 }}>
                {failed ? 'Offline' : busy ? 'Typing…' : 'Online'}
              </div>
            </div>
            {msgs.length > 1 && (
              <button
                onClick={clearChat}
                disabled={busy}
                aria-label="Clear this conversation"
                title="Clear this conversation"
                style={{
                  background: 'rgba(255,255,255,.14)', border: 0, color: '#fff',
                  height: 26, borderRadius: 13, padding: '0 10px',
                  cursor: busy ? 'default' : 'pointer', opacity: busy ? .4 : 1,
                  fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
                Clear
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: 'rgba(255,255,255,.14)', border: 0, color: '#fff',
                width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                fontSize: 15, lineHeight: 1, flexShrink: 0,
              }}
            >×</button>
          </div>

          {/* Ticket banner */}
          {ticketId && (
            <div style={{
              background: '#F6F1FB', borderBottom: '1px solid rgba(90,42,125,.12)',
              padding: '8px 14px', fontSize: 12, color: '#3C1361',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>✅ Ticket <strong>{ticketId}</strong> opened</span>
              <a
                href={`${SUPPORT_PORTAL_BASE}/support/status`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#5A2A7D', fontWeight: 600, whiteSpace: 'nowrap' }}
              >Open →</a>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} style={{
            flex: 1, overflowY: 'auto', padding: '14px',
            background: '#FAFAFC', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            {msgs.map((m) => (
              <div key={m.id} style={{
                alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}>
                <div style={{
                  background: m.sender === 'user'
                    ? 'linear-gradient(135deg,#5A2A7D,#3C1361)' : '#fff',
                  color: m.sender === 'user' ? '#fff' : '#2A2A33',
                  padding: '9px 13px', borderRadius: 14,
                  borderTopRightRadius: m.sender === 'user' ? 4 : 14,
                  borderTopLeftRadius: m.sender === 'user' ? 14 : 4,
                  fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                  border: m.sender === 'bot' ? '1px solid rgba(0,0,0,.06)' : 0,
                  boxShadow: '0 1px 3px rgba(0,0,0,.05)',
                }}>{m.text}</div>
                <div style={{
                  fontSize: 10, color: '#9A9AA8', marginTop: 3,
                  textAlign: m.sender === 'user' ? 'right' : 'left',
                }}>{m.time}</div>
              </div>
            ))}
            {busy && (
              <div style={{
                alignSelf: 'flex-start', background: '#fff', padding: '11px 15px',
                borderRadius: 14, borderTopLeftRadius: 4, border: '1px solid rgba(0,0,0,.06)',
                display: 'flex', gap: 4,
              }}>
                {[0, .15, .3].map((d) => (
                  <span key={d} style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#5A2A7D',
                    animation: `kbcPulse 1s ${d}s infinite`,
                  }} />
                ))}
              </div>
            )}

            {/* Where the action actually takes them, once one has been carried out. */}
            {!busy && action && (
              <a
                href={action.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  alignSelf: 'flex-start',
                  background: 'linear-gradient(135deg,#5A2A7D,#3C1361)', color: '#fff',
                  borderRadius: 18, padding: '8px 16px', fontSize: 12.5, fontWeight: 600,
                  textDecoration: 'none', boxShadow: '0 4px 12px rgba(60,19,97,.3)',
                }}
              >{action.label} →</a>
            )}

            {/* The learner chooses how to escalate; nothing is opened until they do. */}
            {!busy && offer.length > 0 && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {offer.map((choice) => (
                  <button
                    key={choice}
                    onClick={() => chooseEscalation(choice)}
                    style={{
                      background: '#fff', color: '#3C1361',
                      border: '1.5px solid rgba(90,42,125,.35)', borderRadius: 18,
                      padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >{CHOICE_LABEL[choice]}</button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{
            padding: 10, borderTop: '1px solid rgba(0,0,0,.07)',
            // flex-end so the send button stays put as the composer grows.
            background: '#fff', display: 'flex', gap: 8, alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Shift+Enter breaks the line; plain Enter sends.
                if (e.shiftKey) return;
                e.preventDefault();
                void send(input);
              }}
              // Kept short: the longer hint wrapped onto a second line and made
              // the empty composer look cluttered.
              placeholder="Type your message…"
              title="Enter to send, Shift+Enter for a new line"
              disabled={busy}
              rows={1}
              style={{
                flex: 1, border: '1px solid rgba(0,0,0,.13)', borderRadius: 10,
                padding: '9px 12px', fontSize: 13.5, outline: 'none', minWidth: 0,
                font: 'inherit', fontFamily: 'inherit', lineHeight: 1.45,
                resize: 'none', maxHeight: 120, overflowY: 'auto',
              }}
            />
            <button
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
              aria-label="Send"
              style={{
                background: 'linear-gradient(135deg,#5A2A7D,#3C1361)', color: '#fff',
                border: 0, borderRadius: 10, width: 40, height: 38, cursor: 'pointer',
                opacity: busy || !input.trim() ? .45 : 1, fontSize: 15, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >➤</button>
          </div>
        </div>
      )}

      {/* Launcher. Hidden while the panel is open — the panel has its own close
          button, and the launcher's anchor would otherwise sit over the panel on
          shorter screens. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open support chat"
          className="kbc-bot-launcher"
          style={{
            width: 104, height: 104,
            border: 'none', background: 'transparent',
            cursor: 'pointer', zIndex: 2147483000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, lineHeight: 1,
          }}
        >
          <RobotMascot size={104} />
        </button>
      )}

      <style>{`
        @keyframes kbcPulse{0%,100%{opacity:.3}50%{opacity:1}}

        /* Blink: a quick vertical squash, with a long pause between blinks. */
        @keyframes kbcBlink{
          0%,94%,100%{transform:scaleY(1)}
          96.5%{transform:scaleY(.12)}
        }
        .kbc-bot-eyes{
          transform-box:fill-box;
          transform-origin:center;
          animation:kbcBlink 5.5s infinite;
        }

        /* Parked above the "Inclusion & Safeguarding" tab, which the learner home
           pins to the right edge: its container sits at top:41% and the tab stacks
           12px above that. The tab measures 84px tall in practice, not the 52px
           minimum the stylesheet declares, so this clears 96px of tab, a 28px
           gap and the launcher's own 104px box. The mascot is drawn inset within
           that box, so the gap reads a little wider than the arithmetic implies
           and the offset is pulled back accordingly. Measured across 1200-1920px
           wide, and the right edge is likewise tightened for the same inset. */
        .kbc-bot-launcher{
          position:fixed;
          right:12px;
          top:calc(41% - 210px);
          transition:transform .25s cubic-bezier(.34,1.56,.64,1);
        }
        /* Under 1150px the page drops that tab into normal flow, so the anchor is
           gone — fall back to the ordinary bottom-right corner. */
        @media (max-width:1150px){
          .kbc-bot-launcher{top:auto;bottom:24px}
        }
        /* No shadow on hover: the button is transparent, so a shadow would draw
           a square behind a character that has none. Scale alone reads as lift. */
        .kbc-bot-launcher:hover{transform:translateY(-3px) scale(1.06)}
        .kbc-bot-launcher:active{transform:translateY(-1px) scale(.98)}

        @media (prefers-reduced-motion:reduce){
          .kbc-bot-eyes{animation:none}
          .kbc-bot-launcher{transition:none}
          .kbc-bot-launcher:hover{transform:none}
        }
      `}</style>
    </>
  );
}
