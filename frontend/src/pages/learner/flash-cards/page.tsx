import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchFlashCardDecks, type FlashCardDeck } from '@/api/engagement';
import { FlashCardGame } from '@/pages/engagement/flash-cards/FlashCardGame';
import { useMyLearner } from '@/hooks/useMyLearner';
import { RowsSkeleton } from '@/components/feature/Skeletons';

const learnerNav = roleNavMap.learner;

// Deck listing is scoped server-side to published decks only for a learner
// session (see engagement_api.views.flash_card_decks) — draft decks and card
// answers never reach this page. Deliberately not further filtered to "this
// learner's exact programme/week" here: that would need the same delivery-key
// matching the quiz builder does, which is its own, larger piece of work: see
// the "single trigger" note in the build plan. Search covers programme/module
// in the meantime.
export default function LearnerFlashCardsPage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [decks, setDecks] = useState<FlashCardDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeDeck, setActiveDeck] = useState<FlashCardDeck | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchLearnerDetail(myLearner.kind, myLearner.id), fetchFlashCardDecks()])
      .then(([detail, deckRows]) => {
        if (cancelled) return;
        setLearner(detail);
        setDecks(deckRows);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load flash cards.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const filteredDecks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter(d =>
      d.title.toLowerCase().includes(q) || d.programme.toLowerCase().includes(q) || d.module.toLowerCase().includes(q),
    );
  }, [decks, query]);

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle="Flash Cards" pageSubtitle="Flip a card, learn something, earn points">
      <div className="p-6 space-y-6">
        <div className="relative">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
          <input
            type="text"
            placeholder="Search decks by title, programme, or module..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full max-w-md pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
          />
        </div>

        {loading && <RowsSkeleton rows={4} />}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-16">
            <AppIcon className="ri-wifi-off-line text-3xl text-foreground-300"></AppIcon>
            <p className="text-sm font-semibold text-foreground-700">Could not load flash cards</p>
            <p className="text-[12px] text-foreground-400">{error}</p>
          </div>
        )}

        {!loading && !error && filteredDecks.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center gap-2 py-16">
            <AppIcon className="ri-flashlight-line text-3xl text-foreground-300"></AppIcon>
            <p className="text-sm font-semibold text-foreground-700">No flash-card decks yet</p>
            <p className="text-[12px] text-foreground-400">Check back once your programme has one published.</p>
          </div>
        )}

        {!loading && !error && filteredDecks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDecks.map(deck => (
              <button
                key={deck.id}
                type="button"
                onClick={() => setActiveDeck(deck)}
                className="group text-left rounded-2xl border border-foreground-200/70 bg-white p-5 shadow-[0_5px_24px_rgba(28,10,55,0.05)] transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_16px_38px_rgba(68,30,115,0.12)] cursor-pointer"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-secondary-100 text-primary-700"><AppIcon className="ri-flashlight-line text-xl"></AppIcon></span>
                <h3 className="mt-3 text-sm font-bold text-foreground-900 truncate">{deck.title}</h3>
                <p className="mt-1 text-[11px] text-foreground-400 truncate">{deck.programme || 'General'} · {deck.module || 'No module'}</p>
                <p className="mt-3 text-[11px] font-semibold text-primary-600 flex items-center gap-1">{deck.cardCount} cards <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5"></AppIcon></p>
              </button>
            ))}
          </div>
        )}
      </div>

      {activeDeck && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 sm:p-6" onClick={() => setActiveDeck(null)}>
          <div className="absolute inset-0 bg-foreground-950/70 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-2xl h-[86vh] max-h-[680px]" onClick={e => e.stopPropagation()}>
            <FlashCardGame
              deckId={activeDeck.id}
              deckTitle={activeDeck.title}
              learnerName={learner?.name || ''}
              onClose={() => setActiveDeck(null)}
            />
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
