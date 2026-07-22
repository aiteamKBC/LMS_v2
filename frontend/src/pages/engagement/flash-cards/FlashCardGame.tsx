import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchDeckCards, flipFlashCard, type FlashCardDifficulty } from '@/api/engagement';

interface FlashCardGameProps {
  deckId: number;
  deckTitle?: string;
  learnerId: string;
  learnerName: string;
  /** Manager preview: read-only simulation — flips reveal locally and record
   *  nothing against the learner. Omit/false for the real learner flow. */
  preview?: boolean;
  onClose?: () => void;
}

// Internal per-card state for the game (built from a deck's saved cards).
interface GameCard {
  id: number;
  question: string;
  answer: string | null;   // null until revealed (live mode); preview has it up front
  category: string;
  difficulty: FlashCardDifficulty;
  flipped: boolean;
}

type Phase = 'loading' | 'error' | 'empty' | 'playing' | 'complete';

const DIFFICULTY: Record<FlashCardDifficulty, { label: string; hex: string }> = {
  easy: { label: 'Easy', hex: '#10B981' },
  medium: { label: 'Medium', hex: '#F59E0B' },
  hard: { label: 'Hard', hex: '#F43F5E' },
};

const CONFETTI_COLORS = ['#541EA0', '#7C3AED', '#F59E0B', '#10B981', '#EC4899', '#38BDF8'];

export function FlashCardGame({ deckId, deckTitle, learnerId, learnerName, preview = false, onClose }: FlashCardGameProps) {
  const { warning } = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pointsPerCard, setPointsPerCard] = useState(0);
  const [cards, setCards] = useState<GameCard[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sessionPoints, setSessionPoints] = useState(0);
  const [burst, setBurst] = useState<number | null>(null);
  // Points actually awarded THIS view, per card id: a fresh flip earns the rule
  // value; re-opening an already-earned card earns +0.
  const [awarded, setAwarded] = useState<Record<number, number>>({});

  async function load() {
    setPhase('loading');
    setSessionPoints(0);
    setAwarded({});
    try {
      const data = await fetchDeckCards(deckId);
      setPointsPerCard(data.pointsPerCard);
      const loaded: GameCard[] = data.cards.map(c => ({
        id: c.id,
        question: c.question,
        answer: preview ? c.answer : null,   // live mode reveals via the flip endpoint
        category: c.category,
        difficulty: c.difficulty,
        flipped: false,
      }));
      setCards(loaded);
      if (loaded.length === 0) { setPhase('empty'); return; }
      setIndex(0);
      setPhase('playing');
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not load this deck.');
      setPhase('error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, preview]);

  const current = cards[index] ?? null;
  const completedCount = cards.filter(c => c.flipped).length;

  async function handleFlip() {
    if (!current || current.flipped || busy) return;
    const cardId = current.id;

    // Preview: reveal locally, simulate the award, touch nothing on the server.
    if (preview) {
      const pts = pointsPerCard;
      setCards(prev => prev.map(c => (c.id === cardId ? { ...c, flipped: true } : c)));
      setAwarded(a => ({ ...a, [cardId]: pts }));
      if (pts > 0) { setSessionPoints(p => p + pts); setBurst(pts); setTimeout(() => setBurst(null), 1100); }
      return;
    }

    // Live: flip instantly (optimistic), award/record on the server.
    setBusy(true);
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, flipped: true } : c)));
    try {
      const res = await flipFlashCard(cardId, learnerId, learnerName);
      const earned = res.alreadyFlipped ? 0 : res.pointsAwarded;
      setCards(prev => prev.map(c => (c.id === cardId ? { ...c, flipped: true, answer: res.answer } : c)));
      setAwarded(a => ({ ...a, [cardId]: earned }));
      if (earned > 0) { setSessionPoints(p => p + earned); setBurst(earned); setTimeout(() => setBurst(null), 1100); }
    } catch (err: any) {
      setCards(prev => prev.map(c => (c.id === cardId ? { ...c, flipped: false, answer: null } : c)));
      warning('Could not flip the card', err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleNext() {
    if (index >= cards.length - 1) { setPhase('complete'); return; }
    setIndex(i => i + 1);
  }

  const label = deckTitle || 'Flash Cards';

  return (
    <div className="relative flex flex-col h-full min-h-[480px] bg-gradient-to-b from-[#1a0940] via-primary-900 to-[#2a0e52] text-white overflow-hidden rounded-2xl">
      <style>{`
        @keyframes fc-burst { 0% { opacity:0; transform:translate(-50%, 12px) scale(.7);} 18%{opacity:1;} 100% { opacity:0; transform:translate(-50%,-90px) scale(1.3);} }
        @keyframes fc-float { 0%,100% { transform:translateY(0);} 50% { transform:translateY(-10px);} }
        @keyframes fc-confetti { 0% { transform:translateY(-12vh) rotate(0); opacity:1;} 100% { transform:translateY(120vh) rotate(720deg); opacity:.85;} }
        @keyframes fc-pop-in { 0% { opacity:0; transform:scale(.6) translateY(20px);} 60%{ transform:scale(1.05);} 100% { opacity:1; transform:scale(1) translateY(0);} }
        @keyframes fc-ring { 0% { transform:scale(.8); opacity:.6;} 100% { transform:scale(1.7); opacity:0;} }
        @keyframes fc-in { from { opacity:0; transform:translateY(10px) scale(.98);} to { opacity:1; transform:translateY(0) scale(1);} }
      `}</style>

      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-28 -right-20 w-80 h-80 rounded-full bg-accent-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-20 w-80 h-80 rounded-full bg-primary-400/25 blur-3xl" />

      {/* Full-container confetti on completion */}
      {phase === 'complete' && <Confetti />}

      {/* Header */}
      <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0"><i className="ri-flashlight-line text-lg text-accent-300"></i></span>
          <div className="min-w-0">
            <p className="text-[13px] font-heading font-semibold truncate flex items-center gap-2">
              {label}
              {preview && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200">Preview</span>}
            </p>
            <p className="text-[10px] text-white/60 truncate">{learnerName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10">
            <i className="ri-copper-coin-line text-accent-300"></i>
            <span key={sessionPoints} className="text-[13px] font-bold" style={{ animation: 'fc-pop-in .4s ease-out' }}>{sessionPoints}</span>
            <span className="text-[10px] text-white/60">earned</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 text-white/70 hover:text-white hover:bg-white/20 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <i className="ri-loader-4-line text-3xl animate-spin"></i>
            <p className="text-[12px]">Dealing your cards…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <i className="ri-wifi-off-line text-3xl text-white/50"></i>
            <p className="text-[13px] font-semibold text-white">Couldn't load this deck</p>
            <p className="text-[11px] text-white/60 max-w-xs">{errorMsg}</p>
            <button onClick={load} className="mt-1 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-[12px] font-semibold transition-smooth cursor-pointer">Try again</button>
          </div>
        )}

        {phase === 'empty' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <i className="ri-inbox-line text-3xl text-white/50"></i>
            <p className="text-[13px] font-semibold text-white">This deck has no cards yet</p>
            <p className="text-[11px] text-white/60 max-w-xs">Add cards to the deck and they'll appear here.</p>
          </div>
        )}

        {phase === 'playing' && current && (
          <PlayStage
            key={current.id}
            card={current}
            index={index}
            total={cards.length}
            cards={cards}
            busy={busy}
            burst={burst}
            awardedNow={awarded[current.id] ?? 0}
            isLast={index >= cards.length - 1}
            onFlip={handleFlip}
            onNext={handleNext}
          />
        )}

        {phase === 'complete' && (
          <CompleteStage
            sessionPoints={sessionPoints}
            completedCount={completedCount || cards.length}
            total={cards.length}
            preview={preview}
            onReplay={load}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// --- Confetti (full-container) ----------------------------------------------
function Confetti() {
  const pieces = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      dur: 2 + Math.random() * 2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 7,
      round: Math.random() > 0.5,
    })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {pieces.map((c, i) => (
        <span key={i} className="absolute -top-4" style={{
          left: `${c.left}%`, width: c.size, height: c.size, background: c.color,
          borderRadius: c.round ? '50%' : '2px',
          animation: `fc-confetti ${c.dur}s linear ${c.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// --- Active card stage (landscape) ------------------------------------------
function PlayStage({ card, index, total, cards, busy, burst, awardedNow, isLast, onFlip, onNext }: {
  card: GameCard; index: number; total: number; cards: GameCard[];
  busy: boolean; burst: number | null; awardedNow: number; isLast: boolean; onFlip: () => void; onNext: () => void;
}) {
  const diff = DIFFICULTY[card.difficulty] ?? DIFFICULTY.medium;
  const flipped = card.flipped;
  const hex = diff.hex;

  return (
    <div className="w-full max-w-[600px] flex flex-col items-center gap-6" style={{ animation: 'fc-in .35s ease-out' }}>
      {/* Progress */}
      <div className="w-full flex items-center justify-between">
        <span className="text-[11px] font-semibold text-white/70">Card {index + 1} of {total}</span>
        <div className="flex items-center gap-1.5">
          {cards.map((c, i) => (
            <span key={c.id} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-6 bg-accent-300' : c.flipped ? 'w-1.5 bg-emerald-400' : 'w-1.5 bg-white/25'}`} />
          ))}
        </div>
      </div>

      {/* 3D card — landscape (wider than tall) */}
      <div className="relative w-full" style={{ perspective: '2200px' }}>
        {burst != null && (
          <div className="absolute left-1/2 top-6 z-20 text-accent-300 font-extrabold text-3xl pointer-events-none drop-shadow-lg" style={{ animation: 'fc-burst 1.1s ease-out forwards' }}>+{burst}</div>
        )}
        <div
          onClick={onFlip}
          className={`relative w-full h-[300px] sm:h-[330px] ${flipped ? '' : 'cursor-pointer'}`}
          style={{ transformStyle: 'preserve-3d', transition: 'transform .75s cubic-bezier(.2,.7,.2,1)', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)', willChange: 'transform' }}
        >
          {/* FRONT */}
          <div
            className="absolute inset-0 rounded-[26px] overflow-hidden bg-white text-foreground-900 flex flex-col"
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', boxShadow: `0 30px 80px -30px ${hex}88, 0 10px 30px -12px rgba(0,0,0,.35)` }}
          >
            <div className="absolute inset-x-0 top-0 h-32" style={{ background: `linear-gradient(180deg, ${hex}22, transparent)` }} />
            <span className="absolute -right-6 -bottom-16 font-black leading-none select-none pointer-events-none" style={{ fontSize: '240px', color: `${hex}12` }}>?</span>

            <div className="relative flex items-center justify-between px-6 pt-5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full" style={{ color: hex, background: `${hex}1f` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: hex }} /> {diff.label}
              </span>
              {card.category && <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">{card.category}</span>}
            </div>

            <div className="relative flex-1 flex flex-col items-center justify-center text-center px-10">
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground-300 mb-3">Question</span>
              <p className="text-[21px] font-semibold leading-snug text-foreground-900">{card.question}</p>
            </div>

            <div className="relative flex items-center justify-center pb-5">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full" style={{ color: hex, background: `${hex}14` }}>
                <i className="ri-refresh-line"></i> Tap to reveal
              </span>
            </div>
          </div>

          {/* BACK */}
          <div
            className="absolute inset-0 rounded-[26px] overflow-hidden flex flex-col text-white"
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)', background: 'linear-gradient(150deg, #1b0b3a 0%, #3a1780 55%, #0f7a5a 100%)', boxShadow: '0 30px 80px -30px rgba(16,185,129,.55), 0 10px 30px -12px rgba(0,0,0,.4)' }}
          >
            <span className="absolute -right-6 -bottom-16 font-black leading-none select-none pointer-events-none text-white/[.06]" style={{ fontSize: '220px' }}>“</span>
            <div className="relative flex items-center justify-between px-6 pt-5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/15"><i className="ri-checkbox-circle-line text-emerald-300"></i> Answer</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-white/15 px-2.5 py-1 rounded-full"><i className="ri-copper-coin-line text-accent-200"></i>+{awardedNow}</span>
            </div>

            <div className="relative flex-1 overflow-y-auto px-8 flex items-center">
              {card.answer == null ? (
                <div className="w-full space-y-2.5 animate-pulse">
                  <div className="h-3 rounded-full bg-white/20" />
                  <div className="h-3 rounded-full bg-white/20 w-11/12" />
                  <div className="h-3 rounded-full bg-white/20 w-3/4" />
                  <p className="text-[11px] text-white/50 pt-1">Revealing…</p>
                </div>
              ) : (
                <p className="text-[16px] font-medium leading-relaxed">{card.answer}</p>
              )}
            </div>

            <p className="relative text-[10px] text-white/60 px-8 pb-4 pt-3 border-t border-white/15 mx-4">{card.question}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      {!flipped ? (
        <button onClick={onFlip} className="w-full max-w-[600px] py-3.5 rounded-2xl bg-accent-500 text-white font-semibold text-[13px] shadow-lg shadow-accent-500/30 hover:bg-accent-400 transition-smooth cursor-pointer flex items-center justify-center gap-2">
          <i className="ri-refresh-line"></i> Flip card
        </button>
      ) : (
        <button onClick={onNext} className="w-full max-w-[600px] py-3.5 rounded-2xl bg-white text-primary-800 font-semibold text-[13px] shadow-lg hover:bg-primary-50 transition-smooth cursor-pointer flex items-center justify-center gap-2">
          {isLast ? <><i className="ri-flag-line"></i> Finish</> : <>Next card <i className="ri-arrow-right-line"></i></>}
          {busy && <i className="ri-loader-4-line animate-spin text-primary-400"></i>}
        </button>
      )}
    </div>
  );
}

// --- Completion celebration --------------------------------------------------
function CompleteStage({ sessionPoints, completedCount, total, preview, onReplay, onClose }: {
  sessionPoints: number; completedCount: number; total: number;
  preview: boolean; onReplay?: () => void; onClose?: () => void;
}) {
  return (
    <div className="relative z-10 w-full flex flex-col items-center text-center" style={{ animation: 'fc-pop-in .5s ease-out' }}>
      <div className="relative mb-5" style={{ animation: 'fc-float 3s ease-in-out infinite' }}>
        <span className="absolute inset-0 rounded-full" style={{ animation: 'fc-ring 1.6s ease-out infinite', boxShadow: '0 0 0 3px rgba(245,158,11,.5)' }} />
        <span className="relative w-20 h-20 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shadow-xl shadow-amber-500/40">
          <i className="ri-trophy-fill text-4xl text-white"></i>
        </span>
      </div>

      <h3 className="text-xl font-heading font-bold mb-1 text-white">Deck complete!</h3>
      <p className="text-[12px] text-white/70 max-w-xs mb-5">
        {preview
          ? "That's the learner experience. In preview nothing is recorded against the learner."
          : 'Nice work — you earned points for every new card you opened.'}
      </p>

      <div className="grid grid-cols-2 gap-3 w-full max-w-xs mb-5">
        <div className="rounded-xl bg-white/10 p-3">
          <p className="text-2xl font-extrabold text-accent-300">+{sessionPoints}</p>
          <p className="text-[10px] text-white/60 mt-0.5">points earned</p>
        </div>
        <div className="rounded-xl bg-white/10 p-3">
          <p className="text-2xl font-extrabold text-white">{completedCount}/{total || completedCount}</p>
          <p className="text-[10px] text-white/60 mt-0.5">cards flipped</p>
        </div>
      </div>

      <div className="flex items-center gap-2 w-full max-w-xs">
        {onReplay && (
          <button onClick={onReplay} className="flex-1 py-2.5 rounded-xl bg-accent-500 hover:bg-accent-400 text-white font-semibold text-[12px] transition-smooth cursor-pointer flex items-center justify-center gap-1.5">
            <i className="ri-play-line"></i> Replay
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-[12px] transition-smooth cursor-pointer">Done</button>
        )}
      </div>
    </div>
  );
}
