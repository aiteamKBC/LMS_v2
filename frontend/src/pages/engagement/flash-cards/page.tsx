import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { type EngagementLearner } from '@/mocks/engagement-data';
import {
  fetchTrainingPlanOptions, fetchFlashCardDecks, createFlashCardDeck, updateFlashCardDeck,
  deleteFlashCardDeck, fetchDeckCards, saveDeckCards, generateFlashCards,
  type FlashCardDeck, type FlashCardDraft, type FlashCardDifficulty, type DeckStatus,
  type TrainingPlanOptions,
} from '@/api/engagement';
import { LearnerPickerModal } from '@/pages/engagement/LearnerPickerModal';
import { FlashCardGame } from '@/pages/engagement/flash-cards/FlashCardGame';
import { FlashCardDeckSkeletonTable } from '@/pages/engagement/EngagementSkeletons';

const engagementNav = roleNavMap.engagement;
const AUTHOR = 'Tom Harrington';

const DIFFICULTY_META: Record<FlashCardDifficulty, { label: string; chip: string }> = {
  easy: { label: 'Easy', chip: 'bg-emerald-100 text-emerald-700' },
  medium: { label: 'Medium', chip: 'bg-amber-100 text-amber-700' },
  hard: { label: 'Hard', chip: 'bg-rose-100 text-rose-700' },
};

const STATUS_FILTERS: { value: DeckStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

// The core prompt lives in the backend; this editable text is the author's
// instructions, sent as `customInstructions` to augment (not override) it.
const DEFAULT_AI_INSTRUCTIONS = `Create clear, standalone revision flash cards from the lesson content.
- Front = a concise question or term. Back = a short, correct answer (1-3 sentences).
- Cover distinct concepts; avoid repeating the same idea.
- Mix difficulty (easy -> medium -> hard) across the deck.
- Give each card a short topic/category.`;

// Targeting the deck carries (matches the quiz builder's programme -> module -> week).
interface Targeting {
  programme: string;
  module: string;
  programmeId: number | null;
  week: string;
}
const blankTargeting: Targeting = { programme: '', module: '', programmeId: null, week: '' };

function parseWeekNumber(weekId: string): string {
  const m = /-(\d+)$/.exec(weekId || '');
  return m ? m[1] : '';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FlashCardsPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();

  const [decks, setDecks] = useState<FlashCardDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<DeckStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [tpOptions, setTpOptions] = useState<TrainingPlanOptions>({ programmes: [], modulesByProgramme: {} });

  // Create / edit deck (metadata) modal
  const [showDeckForm, setShowDeckForm] = useState(false);
  const [editingDeck, setEditingDeck] = useState<FlashCardDeck | null>(null);
  const [deckTitle, setDeckTitle] = useState('');
  const [deckTargeting, setDeckTargeting] = useState<Targeting>({ ...blankTargeting });
  const [savingDeck, setSavingDeck] = useState(false);

  // Card editor modal
  const [editorDeck, setEditorDeck] = useState<FlashCardDeck | null>(null);
  const [editorCards, setEditorCards] = useState<FlashCardDraft[]>([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  // AI generator modal
  const [showAI, setShowAI] = useState(false);
  const [aiTitle, setAiTitle] = useState('');
  const [aiTargeting, setAiTargeting] = useState<Targeting>({ ...blankTargeting });
  const [aiTopic, setAiTopic] = useState('');
  const [aiLesson, setAiLesson] = useState('');
  const [aiInstructions, setAiInstructions] = useState(DEFAULT_AI_INSTRUCTIONS);
  const [aiCount, setAiCount] = useState(25);
  const [aiFiles, setAiFiles] = useState<File[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedCards, setGeneratedCards] = useState<FlashCardDraft[]>([]);
  const [savingGenerated, setSavingGenerated] = useState(false);

  // Preview
  const [showPicker, setShowPicker] = useState(false);
  const [previewLearner, setPreviewLearner] = useState<EngagementLearner | null>(null);
  const [previewDeck, setPreviewDeck] = useState<FlashCardDeck | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFlashCardDecks()
      .then(data => { if (!cancelled) setDecks(data); })
      .catch(err => { if (!cancelled) warning('Could not load decks', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    fetchTrainingPlanOptions()
      .then(opts => { if (!cancelled) setTpOptions(opts); })
      .catch(() => { /* selectors just stay empty */ });
    return () => { cancelled = true; };
  }, [warning]);

  const publishedCount = decks.filter(d => d.status === 'published').length;
  const totalCards = decks.reduce((s, d) => s + d.cardCount, 0);

  const filtered = useMemo(() => {
    let list = decks;
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(d =>
      d.title.toLowerCase().includes(q) || d.module.toLowerCase().includes(q) || d.programme.toLowerCase().includes(q));
    return list;
  }, [decks, statusFilter, search]);

  // ---- Deck metadata create / edit ----
  function openCreateDeck() {
    setEditingDeck(null);
    setDeckTitle('');
    setDeckTargeting({ ...blankTargeting });
    setShowDeckForm(true);
  }
  function openEditDeck(deck: FlashCardDeck) {
    setEditingDeck(deck);
    setDeckTitle(deck.title);
    setDeckTargeting({ programme: deck.programme, module: deck.module, programmeId: deck.programmeId, week: parseWeekNumber(deck.weekId) });
    setShowDeckForm(true);
  }

  function targetingComplete(t: Targeting) {
    return !!t.programme && !!t.module && !!t.programmeId && !!String(t.week).trim();
  }

  async function saveDeck() {
    if (!deckTitle.trim()) { warning('A deck title is required'); return; }
    if (!targetingComplete(deckTargeting)) { warning('Pick a programme, module and week so the deck reaches the right learners'); return; }
    setSavingDeck(true);
    try {
      const payload = {
        title: deckTitle.trim(),
        programme: deckTargeting.programme,
        module: deckTargeting.module,
        programmeId: deckTargeting.programmeId,
        week: deckTargeting.week,
      };
      if (editingDeck) {
        const updated = await updateFlashCardDeck(editingDeck.id, payload);
        setDecks(prev => prev.map(d => d.id === updated.id ? updated : d));
        success('Deck updated');
      } else {
        const created = await createFlashCardDeck({ ...payload, status: 'draft', author: AUTHOR });
        setDecks(prev => [created, ...prev]);
        success('Deck created', 'Add cards to it next.');
        setShowDeckForm(false);
        openCardEditor(created);
        setSavingDeck(false);
        return;
      }
      setShowDeckForm(false);
    } catch (err: any) {
      warning('Could not save the deck', err.message);
    } finally {
      setSavingDeck(false);
    }
  }

  async function togglePublish(deck: FlashCardDeck) {
    const next: DeckStatus = deck.status === 'published' ? 'draft' : 'published';
    if (next === 'published' && deck.cardCount === 0) { warning('Add cards before publishing this deck'); return; }
    try {
      const updated = await updateFlashCardDeck(deck.id, { status: next });
      setDecks(prev => prev.map(d => d.id === updated.id ? updated : d));
      success(next === 'published' ? 'Deck published' : 'Deck moved to draft');
    } catch (err: any) {
      warning('Could not change status', err.message);
    }
  }

  async function removeDeck(deck: FlashCardDeck) {
    if (!confirm(`Delete "${deck.title}" and all its cards? This can't be undone.`)) return;
    try {
      await deleteFlashCardDeck(deck.id);
      setDecks(prev => prev.filter(d => d.id !== deck.id));
      warning('Deck deleted');
    } catch (err: any) {
      warning('Could not delete the deck', err.message);
    }
  }

  // ---- Card editor ----
  async function openCardEditor(deck: FlashCardDeck) {
    setEditorDeck(deck);
    setEditorCards([]);
    setEditorLoading(true);
    try {
      const res = await fetchDeckCards(deck.id);
      setEditorCards(res.cards.map(c => ({ id: c.id, question: c.question, answer: c.answer, category: c.category, difficulty: c.difficulty })));
    } catch (err: any) {
      warning('Could not load cards', err.message);
    } finally {
      setEditorLoading(false);
    }
  }
  function patchCard(i: number, patch: Partial<FlashCardDraft>) {
    setEditorCards(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }
  function addCard() {
    setEditorCards(prev => [...prev, { question: '', answer: '', category: '', difficulty: 'medium' }]);
  }
  function removeCard(i: number) {
    setEditorCards(prev => prev.filter((_, idx) => idx !== i));
  }
  function moveCard(i: number, dir: -1 | 1) {
    setEditorCards(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  async function saveCards() {
    if (!editorDeck) return;
    const clean = editorCards.filter(c => c.question.trim() && c.answer.trim());
    setEditorSaving(true);
    try {
      const res = await saveDeckCards(editorDeck.id, clean);
      setDecks(prev => prev.map(d => d.id === res.deck.id ? res.deck : d));
      setEditorCards(res.cards.map(c => ({ id: c.id, question: c.question, answer: c.answer, category: c.category, difficulty: c.difficulty })));
      success('Cards saved', `${res.deck.cardCount} card${res.deck.cardCount === 1 ? '' : 's'} in this deck`);
      setEditorDeck(null);
    } catch (err: any) {
      warning('Could not save cards', err.message);
    } finally {
      setEditorSaving(false);
    }
  }

  // ---- AI generation ----
  function openAI() {
    setAiTitle('');
    setAiTargeting({ ...blankTargeting });
    setAiTopic('');
    setAiLesson('');
    setAiInstructions(DEFAULT_AI_INSTRUCTIONS);
    setAiCount(25);
    setAiFiles([]);
    setGeneratedCards([]);
    setShowAI(true);
  }
  async function runGenerate() {
    if (!aiTopic.trim() && !aiLesson.trim() && aiFiles.length === 0) {
      warning('Add a topic, paste lesson text, or upload a file first');
      return;
    }
    setGenerating(true);
    try {
      let result;
      if (aiFiles.length) {
        const fd = new FormData();
        aiFiles.forEach(f => fd.append('files', f));
        fd.append('topic', aiTopic);
        fd.append('lessonContent', aiLesson);
        fd.append('customInstructions', aiInstructions);
        fd.append('programme', aiTargeting.programme);
        fd.append('module', aiTargeting.module);
        fd.append('questionCount', String(aiCount));
        result = await generateFlashCards(fd);
      } else {
        result = await generateFlashCards({
          topic: aiTopic, lessonContent: aiLesson, customInstructions: aiInstructions,
          programme: aiTargeting.programme, module: aiTargeting.module, questionCount: aiCount,
        });
      }
      setGeneratedCards(result.cards);
      success('Cards generated', `${result.cards.length} ready to review`);
      if (result.source.unreadableFiles.length) {
        warning('Some files were unreadable', result.source.unreadableFiles.join(', '));
      }
    } catch (err: any) {
      warning('Generation failed', err.message);
    } finally {
      setGenerating(false);
    }
  }
  function patchGenerated(i: number, patch: Partial<FlashCardDraft>) {
    setGeneratedCards(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }
  function removeGenerated(i: number) {
    setGeneratedCards(prev => prev.filter((_, idx) => idx !== i));
  }
  function moveGenerated(i: number, dir: -1 | 1) {
    setGeneratedCards(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function addGeneratedCard() {
    setGeneratedCards(prev => [...prev, { question: '', answer: '', category: '', difficulty: 'medium' }]);
  }

  async function saveGeneratedDeck() {
    const clean = generatedCards.filter(c => c.question.trim() && c.answer.trim());
    if (!clean.length) { warning('Add at least one card with a question and answer'); return; }
    if (!aiTitle.trim()) { warning('Give the deck a title'); return; }
    if (!targetingComplete(aiTargeting)) { warning('Pick a programme, module and week for the deck'); return; }
    setSavingGenerated(true);
    try {
      const deck = await createFlashCardDeck({
        title: aiTitle.trim(),
        programme: aiTargeting.programme,
        module: aiTargeting.module,
        programmeId: aiTargeting.programmeId,
        week: aiTargeting.week,
        status: 'draft',
        author: AUTHOR,
        aiGenerated: true,
      });
      const res = await saveDeckCards(deck.id, clean);
      setDecks(prev => [res.deck, ...prev]);
      success('Draft deck saved', `${res.deck.cardCount} AI cards — review then publish`);
      setShowAI(false);
    } catch (err: any) {
      warning('Could not save the deck', err.message);
    } finally {
      setSavingGenerated(false);
    }
  }

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Flash Cards" pageSubtitle="Build weekly flash-card decks with AI and publish them to a programme's learners"
      userName={AUTHOR} userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Flash Card Decks"
          description={`${decks.length} decks, ${publishedCount} published. A deck is built for a programme -> module -> week and is a points-only game — opening a card for the first time awards the Flash Card Opened points rule.`}
          icon="ri-flashlight-line"
          imageUrl="https://readdy.ai/api/search-image?query=flashcards%20study%20game%20colourful%20cards%20modern%20playful%20professional&width=400&height=160&seq=flashcards-01&orientation=landscape"
          imageAlt="Flash Cards"
          stats={[{ label: 'Decks', value: String(decks.length) }, { label: 'Published', value: String(publishedCount) }, { label: 'Cards', value: String(totalCards) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-gift-2-line text-sm"></AppIcon> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/recognition')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-thumb-up-line text-sm"></AppIcon> Recognition
          </button>
        </div>

        {/* Status filter + search + actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {STATUS_FILTERS.map(s => (
              <button key={s.value} onClick={() => setStatusFilter(s.value)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer ${statusFilter === s.value ? 'bg-background-50 text-primary-600 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 w-full sm:max-w-xs">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" placeholder="Search title, module, programme..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex-1"></div>
          <button onClick={openAI} className="px-4 py-2 bg-[#0f172a] text-white rounded-lg text-[12px] font-semibold hover:bg-[#111827] transition-smooth cursor-pointer whitespace-nowrap shrink-0">
            <AppIcon className="ri-sparkling-2-line mr-1"></AppIcon> Generate with AI
          </button>
          <button onClick={openCreateDeck} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
            <AppIcon className="ri-add-line mr-1"></AppIcon> New Deck
          </button>
        </div>

        {loading && <FlashCardDeckSkeletonTable />}

        {!loading && filtered.length === 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 flex flex-col items-center justify-center text-center gap-2">
            <AppIcon className="ri-flashlight-line text-2xl text-foreground-300"></AppIcon>
            <p className="text-sm font-semibold text-foreground-700">No decks in this view</p>
            <p className="text-[11px] text-foreground-400">Generate one with AI or build it manually.</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-foreground-300/50 bg-background-100/60">
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Deck</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Programme / Module</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Week</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Cards</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Status</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500">Updated</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="stagger-children">
                  {filtered.map(deck => (
                    <tr key={deck.id} className="border-b border-foreground-200/40 hover:bg-background-100/40 transition-smooth">
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-foreground-900">{deck.title}</p>
                        {deck.aiGenerated && <span className="text-[9px] font-bold uppercase tracking-wide text-accent-600"><AppIcon className="ri-sparkling-2-line mr-0.5"></AppIcon>AI</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[12px] text-foreground-700">{deck.programme || '—'}</p>
                        <p className="text-[10px] text-foreground-400">{deck.module || 'No module'}</p>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-foreground-700">{parseWeekNumber(deck.weekId) ? `Week ${parseWeekNumber(deck.weekId)}` : '—'}</td>
                      <td className="px-4 py-3 text-[12px] text-primary-600 font-semibold">{deck.cardCount}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${deck.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-600'}`}>
                          {deck.status === 'published' ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-foreground-500">{formatDate(deck.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          <button onClick={() => openCardEditor(deck)} title="Edit this deck's cards" className="h-8 px-2.5 rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap">
                            <AppIcon className="ri-stack-line"></AppIcon> Cards
                          </button>
                          <button onClick={() => { setPreviewDeck(deck); setShowPicker(true); }} title="Preview the learner game" className="h-8 px-2.5 rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap">
                            <AppIcon className="ri-gamepad-line"></AppIcon> Preview
                          </button>
                          <button onClick={() => openEditDeck(deck)} title="Edit title and targeting" className="h-8 px-2.5 rounded-lg bg-background-100 text-foreground-600 hover:bg-primary-100 hover:text-primary-600 transition-smooth cursor-pointer flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap">
                            <AppIcon className="ri-settings-3-line"></AppIcon> Edit
                          </button>
                          <button onClick={() => togglePublish(deck)} title={deck.status === 'published' ? 'Move back to draft' : 'Publish to learners'} className={`h-8 px-2.5 rounded-lg transition-smooth cursor-pointer flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap ${deck.status === 'published' ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                            <AppIcon className={deck.status === 'published' ? 'ri-eye-off-line' : 'ri-send-plane-line'}></AppIcon> {deck.status === 'published' ? 'Unpublish' : 'Publish'}
                          </button>
                          <button onClick={() => removeDeck(deck)} title="Delete deck" className="h-8 px-2.5 rounded-lg text-red-500 hover:bg-red-50 transition-smooth cursor-pointer flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap">
                            <AppIcon className="ri-delete-bin-line"></AppIcon> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* CREATE / EDIT DECK MODAL */}
      {showDeckForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowDeckForm(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-flashlight-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">{editingDeck ? 'Edit Deck' : 'New Deck'}</h3>
                  <p className="text-[11px] text-foreground-400">Target a programme, module and week</p>
                </div>
              </div>
              <button onClick={() => setShowDeckForm(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Deck title <span className="text-red-500">*</span></label>
                <input type="text" value={deckTitle} onChange={e => setDeckTitle(e.target.value)} placeholder="e.g. Week 3 — Earned Value revision" className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
              </div>
              <TargetingFields options={tpOptions} value={deckTargeting} onChange={setDeckTargeting} />
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setShowDeckForm(false)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">Cancel</button>
              <button onClick={saveDeck} disabled={savingDeck} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 disabled:cursor-wait">
                <AppIcon className={savingDeck ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon> {editingDeck ? 'Save Changes' : 'Create & Add Cards'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CARD EDITOR MODAL */}
      {editorDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditorDeck(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0"><AppIcon className="ri-stack-line text-lg"></AppIcon></span>
                <div className="min-w-0">
                  <h3 className="text-base font-heading font-semibold text-foreground-900 truncate">{editorDeck.title}</h3>
                  <p className="text-[11px] text-foreground-400">{editorCards.length} card{editorCards.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <button onClick={() => setEditorDeck(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              {editorLoading && <div className="h-24 rounded-xl bg-background-200 animate-pulse" />}
              {!editorLoading && editorCards.map((card, i) => (
                <CardEditorRow
                  key={card.id ?? `new-${i}`}
                  card={card}
                  index={i}
                  total={editorCards.length}
                  onPatch={patch => patchCard(i, patch)}
                  onRemove={() => removeCard(i)}
                  onMoveUp={() => moveCard(i, -1)}
                  onMoveDown={() => moveCard(i, 1)}
                />
              ))}
              {!editorLoading && (
                <button onClick={addCard} className="w-full py-2.5 rounded-xl border border-dashed border-foreground-300 text-foreground-500 text-[12px] font-semibold hover:bg-background-100 hover:text-foreground-700 transition-smooth cursor-pointer">
                  <AppIcon className="ri-add-line mr-1"></AppIcon> Add card
                </button>
              )}
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setEditorDeck(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">Cancel</button>
              <button onClick={saveCards} disabled={editorSaving} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60 disabled:cursor-wait">
                <AppIcon className={editorSaving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon> Save Cards
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI GENERATOR MODAL — form on the left, live editable preview on the right (mirrors the quiz builder's generator layout) */}
      {showAI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAI(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-[#0f172a] text-white flex items-center justify-center"><AppIcon className="ri-sparkling-2-line text-lg"></AppIcon></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Generate Flash Cards</h3>
                  <p className="text-[11px] text-foreground-400">Review and edit the generated cards before saving them as a draft deck</p>
                </div>
              </div>
              <button onClick={() => setShowAI(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5">
              {/* LEFT — generation form */}
              <section className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Deck title <span className="text-red-500">*</span></label>
                  <input type="text" value={aiTitle} onChange={e => setAiTitle(e.target.value)} placeholder="e.g. Week 3 revision" className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>

                <TargetingFields options={tpOptions} value={aiTargeting} onChange={setAiTargeting} />

                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Number of cards</label>
                  <input type="number" min={1} max={60} value={aiCount} onChange={e => setAiCount(Math.max(1, Math.min(60, Number(e.target.value) || 25)))} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Topic <span className="text-foreground-400 font-normal">(optional if pasting/uploading)</span></label>
                  <input type="text" value={aiTopic} onChange={e => setAiTopic(e.target.value)} placeholder="e.g. Earned Value Management" className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Lesson content <span className="text-foreground-400 font-normal">(paste)</span></label>
                  <textarea value={aiLesson} onChange={e => setAiLesson(e.target.value)} rows={4} placeholder="Paste the lecture notes / slide text here." className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Source files <span className="text-foreground-400 font-normal">(PDF, DOCX, PPTX, TXT, XLSX)</span></label>
                  <input type="file" multiple accept=".txt,.md,.csv,.pdf,.docx,.pptx,.pptm,.xlsx,.xlsm" onChange={e => setAiFiles(Array.from(e.target.files ?? []))} className="w-full text-[11px] text-foreground-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary-100 file:text-primary-700 file:text-[11px] file:font-semibold file:cursor-pointer" />
                  {aiFiles.length > 0 && <p className="text-[10px] text-foreground-400 mt-1">{aiFiles.map(f => f.name).join(', ')}</p>}
                </div>
                <div className="rounded-xl border border-[#e4def8] bg-[#fbf9ff] px-3 py-2 text-[11px] leading-5 text-[#4b3f72]">
                  <strong className="text-[#5b2dbb]">AI instructions</strong> guide how the embedded backend prompt writes cards — edit them below when you need extra guidance.
                </div>
                <textarea value={aiInstructions} onChange={e => setAiInstructions(e.target.value)} rows={4} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none font-mono" />

                <button onClick={runGenerate} disabled={generating} className="w-full h-11 rounded-lg bg-[#0f172a] text-white text-sm font-semibold hover:bg-[#111827] disabled:opacity-50 disabled:cursor-wait transition-smooth cursor-pointer flex items-center justify-center gap-2">
                  <AppIcon className={generating ? 'ri-loader-4-line animate-spin' : 'ri-sparkling-2-line'}></AppIcon> {generating ? 'Generating…' : generatedCards.length ? 'Regenerate preview' : 'Generate preview'}
                </button>
              </section>

              {/* RIGHT — live preview, editable before saving */}
              <section className="min-w-0 min-h-[420px] max-h-[calc(92vh-150px)] rounded-2xl border border-[#dbe3ee] bg-[#f8fafc] p-3 sm:p-4 flex flex-col overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 shrink-0 rounded-xl bg-white border border-[#e2e8f0] px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0"><AppIcon className="ri-eye-line"></AppIcon></span>
                    <div className="min-w-0">
                      <h4 className="text-sm font-heading font-bold text-[#0f172a]">Preview & Edit</h4>
                      <p className="text-xs text-[#64748b]">{generatedCards.length ? `${generatedCards.length} cards — edit any card before saving` : 'Generated cards will appear here'}</p>
                    </div>
                  </div>
                  <button onClick={() => void saveGeneratedDeck()} disabled={!generatedCards.length || savingGenerated} className="h-9 px-4 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 w-full sm:w-auto flex items-center justify-center gap-1.5">
                    <AppIcon className={savingGenerated ? 'ri-loader-4-line animate-spin' : 'ri-save-line'}></AppIcon> {savingGenerated ? 'Saving…' : 'Save as Draft Deck'}
                  </button>
                </div>

                {generatedCards.length === 0 ? (
                  <div className="min-h-80 flex flex-col items-center justify-center text-center">
                    <span className="w-12 h-12 rounded-2xl bg-white border border-foreground-200/60 flex items-center justify-center text-foreground-300 mb-3">
                      <AppIcon className="ri-sparkling-2-line text-xl"></AppIcon>
                    </span>
                    <p className="text-sm font-semibold text-foreground-700">No generated cards yet</p>
                    <p className="text-xs text-foreground-400 mt-1 max-w-sm">Add a topic, paste lesson content, or upload source files, then generate a preview.</p>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1">
                    {generatedCards.map((card, i) => (
                      <CardEditorRow
                        key={i}
                        card={card}
                        index={i}
                        total={generatedCards.length}
                        onPatch={patch => patchGenerated(i, patch)}
                        onRemove={() => removeGenerated(i)}
                        onMoveUp={() => moveGenerated(i, -1)}
                        onMoveDown={() => moveGenerated(i, 1)}
                      />
                    ))}
                    <button onClick={addGeneratedCard} className="w-full py-2.5 rounded-xl border border-dashed border-foreground-300 text-foreground-500 text-[12px] font-semibold hover:bg-background-100 hover:text-foreground-700 transition-smooth cursor-pointer">
                      <AppIcon className="ri-add-line mr-1"></AppIcon> Add card
                    </button>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* LEARNER PICKER for the preview (any learner drives the learner-agnostic preview) */}
      <LearnerPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={l => setPreviewLearner(l)}
      />

      {/* GAME PREVIEW MODAL — preview mode, so flipping records nothing */}
      {previewLearner && previewDeck && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 sm:p-6" onClick={() => setPreviewLearner(null)}>
          <div className="absolute inset-0 bg-foreground-950/70 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-2xl h-[86vh] max-h-[680px]" onClick={e => e.stopPropagation()}>
            <FlashCardGame
              preview
              deckId={previewDeck.id}
              deckTitle={previewDeck.title}
              learnerId={previewLearner.id}
              learnerName={previewLearner.name}
              onClose={() => setPreviewLearner(null)}
            />
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

// --- Shared editable card row — used by the manual card editor AND the AI
// generator's preview panel, so editing a card looks and works the same
// whichever screen it happens on. ---------------------------------------
function CardEditorRow({ card, index, total, onPatch, onRemove, onMoveUp, onMoveDown }: {
  card: FlashCardDraft;
  index: number;
  total: number;
  onPatch: (patch: Partial<FlashCardDraft>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const diff = DIFFICULTY_META[card.difficulty ?? 'medium'];
  return (
    <div className="rounded-xl border border-foreground-200/60 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-foreground-400">#{index + 1}</span>
        <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${diff.chip}`}>{diff.label}</span>
        <div className="ml-auto flex items-center gap-1">
          {(onMoveUp || onMoveDown) && (
            <>
              <button onClick={onMoveUp} disabled={!onMoveUp || index === 0} className="w-7 h-7 rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 disabled:opacity-30 transition-smooth cursor-pointer"><AppIcon className="ri-arrow-up-line"></AppIcon></button>
              <button onClick={onMoveDown} disabled={!onMoveDown || index === total - 1} className="w-7 h-7 rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 disabled:opacity-30 transition-smooth cursor-pointer"><AppIcon className="ri-arrow-down-line"></AppIcon></button>
            </>
          )}
          <button onClick={onRemove} className="w-7 h-7 rounded-lg text-red-500 hover:bg-red-50 transition-smooth cursor-pointer"><AppIcon className="ri-delete-bin-line"></AppIcon></button>
        </div>
      </div>
      <textarea value={card.question} onChange={e => onPatch({ question: e.target.value })} rows={2} placeholder="Question (front)" className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none" />
      <textarea value={card.answer} onChange={e => onPatch({ answer: e.target.value })} rows={2} placeholder="Answer (back)" className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none" />
      <div className="grid grid-cols-2 gap-2">
        <input type="text" value={card.category ?? ''} onChange={e => onPatch({ category: e.target.value })} placeholder="Topic / category" className="w-full px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
        <select value={card.difficulty ?? 'medium'} onChange={e => onPatch({ difficulty: e.target.value as FlashCardDifficulty })} className="w-full px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
    </div>
  );
}

// --- Shared programme -> module -> week targeting selectors -----------------
function TargetingFields({ options, value, onChange }: {
  options: TrainingPlanOptions;
  value: Targeting;
  onChange: (t: Targeting) => void;
}) {
  const modules = options.modulesByProgramme[value.programme] ?? [];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Programme <span className="text-red-500">*</span></label>
        <select value={value.programme} onChange={e => onChange({ ...value, programme: e.target.value, module: '', programmeId: null })} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300">
          <option value="">Select programme</option>
          {options.programmes.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Module <span className="text-red-500">*</span></label>
        <select value={value.module} disabled={!value.programme} onChange={e => {
          const opt = modules.find(m => m.value === e.target.value);
          onChange({ ...value, module: e.target.value, programmeId: opt ? opt.programmeId : null });
        }} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:opacity-50">
          <option value="">{value.programme ? 'Select module' : 'Select programme first'}</option>
          {modules.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Week <span className="text-red-500">*</span></label>
        <input type="number" min={1} value={value.week} onChange={e => onChange({ ...value, week: e.target.value })} placeholder="e.g. 3" className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
      </div>
    </div>
  );
}
