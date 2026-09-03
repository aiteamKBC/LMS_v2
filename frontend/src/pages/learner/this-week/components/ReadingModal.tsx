import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReadingContent } from '@/mocks/learner-profile';
import { formatHoursMinutes } from '@/lib/format';

interface ReadingModalProps {
  isOpen: boolean;
  onClose: () => void;
  readingData: ReadingContent;
  title: string;
  duration: string;
  points: number;
  plannedOTJH: number;
  ksbCodes: string[];
  ksbLabels: string;
  onComplete: () => void;
  onSaveProgress: () => void;
}

interface TextHighlight {
  sectionIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  color: 'yellow' | 'green' | 'pink';
  id: string;
}

type NoteEntry = { text: string; timestamp: string };

export function ReadingModal({
  isOpen, onClose, readingData,
  title, duration, points, plannedOTJH, ksbCodes, ksbLabels,
  onComplete, onSaveProgress,
}: ReadingModalProps) {
  const [mounted, setMounted] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [articleComplete, setArticleComplete] = useState(false);
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xl'>('normal');
  const [highContrast, setHighContrast] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [readSpeed, setReadSpeed] = useState(1.0);
  const [speakingSection, setSpeakingSection] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [showTools, setShowTools] = useState(false);
  const [showNav, setShowNav] = useState(true);
  const [lineHeight, setLineHeight] = useState<'normal' | 'relaxed' | 'loose'>('relaxed');
  const [fontFamily, setFontFamily] = useState<'system' | 'serif' | 'dyslexic'>('system');
  const [textAlign, setTextAlign] = useState<'left' | 'justify'>('left');

  // ── New features state ──
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [notes, setNotes] = useState<Record<number, NoteEntry>>({});
  const [showNotes, setShowNotes] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [activeNoteSection, setActiveNoteSection] = useState<number | null>(null);
  const [highlightColor, setHighlightColor] = useState<'yellow' | 'green' | 'pink'>('yellow');
  const [ttsVoice, setTtsVoice] = useState<SpeechSynthesisVoice | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setReadingProgress(0);
      setArticleComplete(false);
      setFontSize('normal');
      setHighContrast(false);
      setReadAloud(false);
      setReadSpeed(1.0);
      setSpeakingSection(null);
      setActiveSection(0);
      setShowTools(false);
      setShowNav(true);
      setLineHeight('relaxed');
      setFontFamily('system');
      setTextAlign('left');
      setHighlights([]);
      setNotes({});
      setShowNotes(false);
      setShowHighlights(false);
      setActiveNoteSection(null);
      stopTTS();
    } else {
      document.body.style.overflow = '';
      stopTTS();
    }
    return () => {
      document.body.style.overflow = '';
      stopTTS();
    };
  }, [isOpen]);

  // ── Real Text-to-Speech ──
  const stopTTS = useCallback(() => {
    if (ttsSupported) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    }
  }, [ttsSupported]);

  const speakSection = useCallback((sectionIndex: number) => {
    if (!ttsSupported) return;
    stopTTS();

    const section = readingData.sections[sectionIndex];
    if (!section) return;

    const textToSpeak = `${section.heading}. ${section.content}`;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = readSpeed;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    if (ttsVoice) utterance.voice = ttsVoice;

    utterance.onstart = () => {
      setSpeakingSection(sectionIndex);
    };

    utterance.onend = () => {
      const nextIdx = sectionIndex + 1;
      if (nextIdx < readingData.sections.length - 1) {
        speakSection(nextIdx);
      } else {
        setSpeakingSection(null);
        setReadAloud(false);
      }
    };

    utterance.onerror = (e) => {
      if (e.error !== 'canceled' && e.error !== 'interrupted') {
        console.warn('TTS error:', e.error);
        setSpeakingSection(null);
        setReadAloud(false);
      }
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [ttsSupported, readingData.sections, readSpeed, ttsVoice, stopTTS]);

  useEffect(() => {
    if (readAloud && speakingSection === null) {
      setSpeakingSection(0);
      setActiveSection(0);
      setTimeout(() => {
        const el = sectionRefs.current[0];
        if (el && scrollRef.current) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);
      setTimeout(() => speakSection(0), 400);
    }
  }, [readAloud]);

  useEffect(() => {
    return () => stopTTS();
  }, [stopTTS]);

  const toggleReadAloud = () => {
    if (readAloud) {
      stopTTS();
      setReadAloud(false);
      setSpeakingSection(null);
    } else {
      setReadAloud(true);
    }
  };

  // ── Scroll tracking ──
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const scrollPct = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100;
    setReadingProgress(Math.min(scrollPct, 100));
    if (scrollPct >= 90) setArticleComplete(true);

    const positions = sectionRefs.current.map((ref, idx) => {
      if (!ref) return { idx, top: Infinity };
      return { idx, top: ref.getBoundingClientRect().top };
    });

    const visibleSection = positions.reduce((closest, curr) =>
      curr.top >= 60 && curr.top < closest.top ? curr : closest,
      { idx: activeSection, top: Infinity }
    );

    if (Math.abs(visibleSection.idx - activeSection) > 0) {
      setActiveSection(visibleSection.idx);
    }
  }, [activeSection]);

  const scrollToSection = (idx: number) => {
    const el = sectionRefs.current[idx];
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(idx);
    }
  };

  // ── Text Highlighting ──
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (selectedText.length < 3) return;

    const contentEl = scrollRef.current;
    if (!contentEl) return;

    let sectionIndex = -1;
    for (let i = 0; i < sectionRefs.current.length; i++) {
      const el = sectionRefs.current[i];
      if (el && el.contains(range.commonAncestorContainer)) {
        sectionIndex = i;
        break;
      }
    }
    if (sectionIndex === -1) return;

    const sectionEl = sectionRefs.current[sectionIndex];
    if (!sectionEl) return;

    const contentNode = sectionEl.querySelector('[data-section-content]');
    if (!contentNode) return;

    const anchorNode = range.startContainer;
    const focusNode = range.endContainer;

    let startOffset = 0;
    let endOffset = 0;

    const walker = document.createTreeWalker(contentNode, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    let foundStart = false;
    let foundEnd = false;
    let charCount = 0;

    while ((node = walker.nextNode() as Text | null)) {
      if (node === anchorNode && !foundStart) {
        startOffset = charCount + range.startOffset;
        foundStart = true;
      }
      if (node === focusNode && !foundEnd) {
        endOffset = charCount + range.endOffset;
        foundEnd = true;
      }
      if (node !== anchorNode && node !== focusNode) {
        if (!foundStart) charCount += node.textContent?.length || 0;
        if (foundStart && !foundEnd) charCount += node.textContent?.length || 0;
      }
      if (foundStart && foundEnd) break;
    }

    if (!foundStart || !foundEnd) {
      startOffset = 0;
      endOffset = selectedText.length;
    }

    const id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setHighlights(prev => [...prev, {
      sectionIndex,
      startOffset,
      endOffset,
      text: selectedText,
      color: highlightColor,
      id,
    }]);

    selection.removeAllRanges();
  };

  const removeHighlight = (id: string) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
  };

  const clearAllHighlights = () => {
    setHighlights([]);
  };

  // ── Note-taking ──
  const updateNote = (sectionIdx: number, text: string) => {
    setNotes(prev => ({
      ...prev,
      [sectionIdx]: { text, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    }));
  };

  const deleteNote = (sectionIdx: number) => {
    setNotes(prev => {
      const next = { ...prev };
      delete next[sectionIdx];
      return next;
    });
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        if (showNotes || showHighlights) {
          setShowNotes(false);
          setShowHighlights(false);
        } else if (showTools) {
          setShowTools(false);
        } else {
          onSaveProgress();
        }
      }
      if (e.key === 'ArrowRight' && !readAloud && !showNotes && !showHighlights) {
        scrollToSection(Math.min(activeSection + 1, readingData.sections.length - 1));
      }
      if (e.key === 'ArrowLeft' && !readAloud && !showNotes && !showHighlights) {
        scrollToSection(Math.max(activeSection - 1, 0));
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, readAloud, showNotes, showHighlights, activeSection, showTools, readingData.sections.length, onSaveProgress]);

  // ── Style helpers ──
  const fontSizeClass = { normal: 'text-[15px]', large: 'text-[17px]', xl: 'text-[20px]' }[fontSize];
  const headingSize = { normal: 'text-[18px] md:text-[20px]', large: 'text-[20px] md:text-[22px]', xl: 'text-[22px] md:text-[24px]' }[fontSize];
  const lineHeightClass = { normal: 'leading-[1.6]', relaxed: 'leading-[1.8]', loose: 'leading-[2.0]' }[lineHeight];
  const fontFamilyClass = { system: 'font-sans', serif: 'font-serif', dyslexic: 'font-sans' }[fontFamily];

  const ksbColor = (code: string) => {
    if (code.startsWith('K')) return 'bg-primary-100 text-primary-700 border-primary-200';
    if (code.startsWith('S')) return 'bg-accent-100 text-accent-700 border-accent-200';
    return 'bg-secondary-100 text-secondary-700 border-secondary-200';
  };

  // ── Dark mode colors ──
  const hc = highContrast;
  const dm = {
    bg: hc ? 'bg-foreground-950' : 'bg-background-50',
    sidebarBg: hc ? 'bg-foreground-900' : 'bg-background-100',
    border: hc ? 'border-foreground-700' : 'border-foreground-200',
    cardBg: hc ? 'bg-foreground-900 border-foreground-700' : 'bg-background-50 border-foreground-200',
    mutedText: hc ? 'text-foreground-300' : 'text-foreground-500',
    secondaryText: hc ? 'text-foreground-200' : 'text-foreground-600',
    headingText: hc ? 'text-foreground-50' : 'text-foreground-900',
    bodyText: hc ? 'text-foreground-100' : 'text-foreground-700',
    subtleText: hc ? 'text-foreground-400' : 'text-foreground-400',
    toolBg: hc ? 'bg-foreground-800' : 'bg-background-100',
    toolHover: hc ? 'hover:bg-foreground-700' : 'hover:bg-background-100',
    dividerBg: hc ? 'bg-foreground-800' : 'bg-background-100',
    btnBorder: hc ? 'border-foreground-700' : 'border-foreground-200',
    btnText: hc ? 'text-foreground-300' : 'text-foreground-500',
    btnHoverBg: hc ? 'hover:bg-foreground-800' : 'hover:bg-background-100',
    speakingGlow: hc ? 'bg-primary-500/10 border-primary-500/30' : 'bg-primary-50/30 border-primary-200/50',
    noteBg: hc ? 'bg-foreground-850' : 'bg-background-50',
    noteBorder: hc ? 'border-foreground-700' : 'border-foreground-200',
    textareaBg: hc ? 'bg-foreground-800' : 'bg-white',
    textareaText: hc ? 'text-foreground-100' : 'text-foreground-700',
    toolBtnActive: hc ? 'bg-primary-500/20 text-primary-300' : 'bg-primary-100 text-primary-700',
    progressBarBg: hc ? 'bg-foreground-800' : 'bg-background-100',
    completeBg: hc ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-200',
    completeTitle: hc ? 'text-emerald-300' : 'text-emerald-800',
    completeText: hc ? 'text-emerald-400' : 'text-emerald-600',
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        onClick={() => { if (!readAloud) onClose(); }}
        className={`fixed inset-0 z-[60] bg-foreground-950/50 backdrop-blur-sm transition-opacity duration-500 ease-out ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      <div className={`fixed inset-0 z-[61] flex flex-col transition-all duration-500 ease-out ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <div className={`flex-1 flex flex-col overflow-hidden ${dm.bg}`}>

          {/* ═══ TOP BAR ═══ */}
          <div className={`shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-b ${dm.border}`}>
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                <AppIcon className="ri-book-open-line text-primary-600 text-sm"></AppIcon>
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold truncate ${dm.headingText}`}>{title}</p>
                <p className={`text-xs ${dm.mutedText}`}>{duration} · {plannedOTJH}h OTJH · {points} pts</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setShowNav(!showNav)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${showNav ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}
                title="Table of Contents">
                <AppIcon className="ri-menu-2-line text-sm"></AppIcon>
              </button>

              <button onClick={() => setShowTools(!showTools)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${showTools ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}
                title="Reading tools">
                <AppIcon className="ri-settings-3-line text-sm"></AppIcon>
              </button>

              <button onClick={() => { setShowNotes(!showNotes); setShowHighlights(false); }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${showNotes ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}
                title="Notes">
                <AppIcon className="ri-sticky-note-line text-sm"></AppIcon>
              </button>

              <button onClick={() => { setShowHighlights(!showHighlights); setShowNotes(false); }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${showHighlights ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}
                title="Highlights">
                <AppIcon className="ri-mark-pen-line text-sm"></AppIcon>
              </button>

              <button onClick={toggleReadAloud}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth cursor-pointer ${readAloud ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}
                title={readAloud ? 'Stop reading' : 'Listen'}>
                <AppIcon className={`${readAloud ? 'ri-stop-line' : 'ri-volume-up-line'} text-sm`}></AppIcon>
                <span className="hidden sm:inline">{readAloud ? 'Stop' : 'Listen'}</span>
              </button>

              <button onClick={() => { onSaveProgress(); }} className={`w-8 h-8 rounded-lg flex items-center justify-center ${dm.mutedText} ${dm.toolHover} transition-smooth cursor-pointer`} title="Save & Close">
                <AppIcon className="ri-close-line text-lg"></AppIcon>
              </button>
            </div>
          </div>

          {/* ═══ READING TOOLS PANEL ═══ */}
          {showTools && (
            <div className={`shrink-0 px-4 md:px-6 py-3 border-b ${dm.border} ${dm.sidebarBg}`}>
              <div className="flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${dm.mutedText}`}>Font</span>
                  <div className={`flex items-center rounded-lg border ${dm.border} overflow-hidden`}>
                    {(['normal', 'large', 'xl'] as const).map((s, i) => (
                      <button key={s} onClick={() => setFontSize(s)}
                        className={`px-2 py-1 text-[${11 + i * 2}px] font-medium transition-smooth cursor-pointer ${i > 0 ? `border-l ${dm.border}` : ''} ${fontSize === s ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}>
                        A
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${dm.mutedText}`}>Line</span>
                  <div className={`flex items-center rounded-lg border ${dm.border} overflow-hidden`}>
                    {(['normal', 'relaxed', 'loose'] as const).map((lh, i, arr) => (
                      <button key={lh} onClick={() => setLineHeight(lh)}
                        className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer ${i > 0 ? `border-l ${dm.border}` : ''} ${lineHeight === lh ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}>
                        {lh === 'normal' ? 'Tight' : lh === 'relaxed' ? 'Normal' : 'Wide'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${dm.mutedText}`}>Style</span>
                  <div className={`flex items-center rounded-lg border ${dm.border} overflow-hidden`}>
                    {(['system', 'serif', 'dyslexic'] as const).map((ff, i) => (
                      <button key={ff} onClick={() => setFontFamily(ff)}
                        className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer ${i > 0 ? `border-l ${dm.border}` : ''} ${fontFamily === ff ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}>
                        {ff === 'system' ? 'Sans' : ff === 'serif' ? 'Serif' : 'Dyslexic'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${dm.mutedText}`}>Align</span>
                  <div className={`flex items-center rounded-lg border ${dm.border} overflow-hidden`}>
                    <button onClick={() => setTextAlign('left')}
                      className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer ${textAlign === 'left' ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}>
                      <AppIcon className="ri-align-left"></AppIcon>
                    </button>
                    <button onClick={() => setTextAlign('justify')}
                      className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer border-l ${dm.border} ${textAlign === 'justify' ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}>
                      <AppIcon className="ri-align-justify"></AppIcon>
                    </button>
                  </div>
                </div>

                <button onClick={() => setHighContrast(!highContrast)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-smooth cursor-pointer ${highContrast ? dm.toolBtnActive : `${dm.mutedText} ${dm.toolHover}`}`}>
                  <AppIcon className="ri-contrast-2-line"></AppIcon>
                  <span className="hidden sm:inline">High Contrast</span>
                </button>

                {readAloud && (
                  <div className="flex items-center gap-2 ml-auto">
                    <span className={`text-[10px] ${dm.mutedText}`}>Speed</span>
                    <input type="range" min="0.5" max="2.0" step="0.25" value={readSpeed}
                      onChange={(e) => { setReadSpeed(parseFloat(e.target.value)); if (speakingSection !== null) { stopTTS(); setTimeout(() => speakSection(speakingSection), 200); } }}
                      className="w-20 accent-primary-500" />
                    <span className={`text-xs ${dm.mutedText} w-8`}>{readSpeed}x</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ PROGRESS BAR ═══ */}
          <div className={`h-1 shrink-0 ${dm.progressBarBg}`}>
            <div className="h-full bg-primary-500 rounded-r-full transition-all duration-300 ease-out" style={{ width: `${readingProgress}%` }} />
          </div>

          {/* ═══ MAIN CONTENT AREA ═══ */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Sidebar — TOC */}
            {showNav && (
              <div className={`hidden lg:flex w-[280px] shrink-0 flex-col border-r ${dm.border} ${dm.sidebarBg}`}>
                <div className="flex-1 overflow-y-auto p-4">
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-3 px-2 ${dm.mutedText}`}>Table of Contents</p>
                  <div className="space-y-1">
                    {readingData.sections.map((section, i) => {
                      const isActive = i === activeSection;
                      const isPast = i < activeSection;
                      return (
                        <button key={i} onClick={() => scrollToSection(i)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-smooth cursor-pointer ${isActive ? 'bg-primary-100 text-primary-700 font-medium' : isPast ? `${dm.mutedText} ${dm.toolHover}` : `${dm.subtleText} ${dm.toolHover} hover:${dm.mutedText}`}`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${isActive ? 'bg-primary-500 text-white' : isPast ? 'bg-emerald-100 text-emerald-600' : 'bg-background-200 text-foreground-400'}`}>
                              {isPast ? <AppIcon className="ri-check-line text-[10px]"></AppIcon> : i + 1}
                            </span>
                            <span className="truncate">{section.heading}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-6 pt-4 border-t border-foreground-200">
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-3 px-2 ${dm.mutedText}`}>Key Terms</p>
                    <div className="space-y-2 px-2">
                      {readingData.keyDefinitions.map((def, i) => (
                        <div key={i} className="group">
                          <button className={`text-xs font-semibold ${dm.bodyText} hover:text-primary-600 transition-smooth cursor-pointer text-left w-full`}>
                            {def.term}
                          </button>
                          <p className={`text-[11px] ${dm.mutedText} leading-relaxed mt-0.5 hidden group-hover:block`}>
                            {def.definition}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Article content */}
            <div ref={scrollRef} onScroll={handleScroll} onMouseUp={handleTextSelection} className="flex-1 overflow-y-auto">
              <div className="max-w-[720px] mx-auto px-6 md:px-10 py-8 md:py-12">
                {/* Article header */}
                <div className="mb-8 md:mb-10">
                  <div className="flex items-center gap-2 mb-3">
                    {readingData.ksbRefs.map(code => (
                      <span key={code} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ksbColor(code)}`}>{code}</span>
                    ))}
                  </div>
                  <h1 className={`${headingSize} font-heading font-bold mb-3 leading-tight ${dm.headingText}`}>{readingData.title}</h1>
                  <div className={`flex items-center gap-3 text-sm ${dm.mutedText}`}>
                    <span className="flex items-center gap-1"><AppIcon className="ri-user-line text-xs"></AppIcon>{readingData.author}</span>
                    <span className="w-1 h-1 rounded-full bg-foreground-300"></span>
                    <span className="flex items-center gap-1"><AppIcon className="ri-time-line text-xs"></AppIcon>{readingData.estimatedRead}</span>
                  </div>
                </div>

                {/* Sections */}
                <div className="space-y-10 md:space-y-12">
                  {readingData.sections.map((section, i) => {
                    const sectionHighlights = highlights.filter(h => h.sectionIndex === i);
                    const sectionNote = notes[i];
                    const sectionContent = renderContentWithHighlights(section.content, section.boldTerms, sectionHighlights);
                    return (
                      <div key={i} ref={(el) => { sectionRefs.current[i] = el; }}
                        className={`scroll-mt-8 ${speakingSection === i ? `${dm.speakingGlow} rounded-xl p-4 md:p-6 -mx-4 md:-mx-6` : ''}`}>
                        <div className="flex items-center justify-between mb-4 md:mb-5">
                          <h2 className={`${headingSize} font-heading font-semibold flex items-center gap-3 ${dm.headingText}`}>
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${speakingSection === i ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-700'}`}>
                              {i + 1}
                            </span>
                            {section.heading}
                          </h2>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => { setActiveNoteSection(i); setShowNotes(true); }}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${sectionNote ? 'text-amber-500' : dm.mutedText} ${dm.toolHover}`}
                              title={sectionNote ? 'Edit note' : 'Add note'}>
                              <AppIcon className={`${sectionNote ? 'ri-sticky-note-fill' : 'ri-sticky-note-line'} text-sm`}></AppIcon>
                            </button>
                          </div>
                        </div>

                        {/* Section note indicator */}
                        {sectionNote && (
                          <div className={`mb-3 p-3 rounded-lg border text-sm ${dm.noteBg} ${dm.noteBorder} ${dm.bodyText}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">Your Note</span>
                              <span className={`text-[10px] ${dm.subtleText}`}>{sectionNote.timestamp}</span>
                            </div>
                            <p className="leading-relaxed">{sectionNote.text}</p>
                          </div>
                        )}

                        <div data-section-content className={`${fontSizeClass} ${fontFamilyClass} ${lineHeightClass} ${textAlign === 'justify' ? 'text-justify' : 'text-left'} ${dm.secondaryText}`}>
                          {sectionContent}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Key Takeaways */}
                <div className={`mt-12 md:mt-16 rounded-xl border p-6 md:p-8 ${dm.cardBg}`}>
                  <h2 className={`${headingSize} font-heading font-semibold mb-5 flex items-center gap-2 ${dm.headingText}`}>
                    <AppIcon className="ri-lightbulb-line text-primary-500"></AppIcon>Key Takeaways
                  </h2>
                  <ul className="space-y-4">
                    {readingData.keyTakeaways.map((t, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 ${hc ? 'bg-foreground-800 text-foreground-300' : 'bg-primary-100 text-primary-700'}`}>{i + 1}</span>
                        <span className={`${fontSizeClass} ${fontFamilyClass} ${lineHeightClass} ${dm.bodyText}`}>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Learning Outcomes */}
                <div className={`mt-8 rounded-xl border p-6 ${dm.cardBg}`}>
                  <h2 className={`${headingSize} font-heading font-semibold mb-4 flex items-center gap-2 ${dm.headingText}`}>
                    <AppIcon className="ri-graduation-cap-line text-accent-500"></AppIcon>Learning Outcomes
                  </h2>
                  <ul className="space-y-3">
                    {readingData.learningOutcomes.map((lo, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5 ${hc ? 'bg-foreground-800 text-foreground-300' : 'bg-accent-100 text-accent-600'}`}>{i + 1}</span>
                        <span className={`${fontSizeClass} ${fontFamilyClass} ${lineHeightClass} ${dm.bodyText}`}>{lo}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Complete notification */}
                {articleComplete && (
                  <div className={`mt-10 p-5 rounded-xl flex items-start gap-3 ${dm.completeBg}`}>
                    <span className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <AppIcon className="ri-check-double-line text-emerald-600 text-lg"></AppIcon>
                    </span>
                    <div>
                      <p className={`text-sm font-semibold ${dm.completeTitle}`}>Reading Complete</p>
                      <p className={`text-xs mt-0.5 ${dm.completeText}`}>You have finished this article. Mark it as complete to earn your {points} points.</p>
                    </div>
                  </div>
                )}

                <div className="h-16"></div>
              </div>
            </div>

            {/* Right Sidebar — Notes / Highlights */}
            {showNotes && (
              <div className={`hidden lg:flex w-[320px] shrink-0 flex-col border-l ${dm.border} ${dm.sidebarBg}`}>
                <div className="flex items-center justify-between p-4 border-b border-foreground-200">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${dm.mutedText}`}>Notes</p>
                  <button onClick={() => setShowNotes(false)}
                    className={`w-6 h-6 rounded flex items-center justify-center ${dm.mutedText} ${dm.toolHover} cursor-pointer`}>
                    <AppIcon className="ri-close-line text-sm"></AppIcon>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {activeNoteSection !== null && (
                    <div>
                      <p className={`text-xs font-semibold mb-2 ${dm.mutedText}`}>
                        Note for: {readingData.sections[activeNoteSection]?.heading}
                      </p>
                      <textarea
                        value={notes[activeNoteSection]?.text || ''}
                        onChange={(e) => updateNote(activeNoteSection, e.target.value)}
                        placeholder="Write your note here..."
                        maxLength={500}
                        className={`w-full h-32 rounded-lg border p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 transition-smooth ${dm.textareaBg} ${dm.textareaText} ${dm.noteBorder}`}
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className={`text-[10px] ${dm.subtleText}`}>{(notes[activeNoteSection]?.text?.length || 0)}/500</span>
                        {notes[activeNoteSection] && (
                          <button onClick={() => { deleteNote(activeNoteSection); setActiveNoteSection(null); }}
                            className={`text-xs ${dm.mutedText} hover:text-red-500 transition-smooth cursor-pointer`}>
                            Delete note
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {Object.keys(notes).length === 0 && activeNoteSection === null && (
                    <div className="text-center py-8">
                      <AppIcon className={`ri-sticky-note-line text-3xl mb-3 block ${dm.subtleText}`}></AppIcon>
                      <p className={`text-sm ${dm.mutedText}`}>No notes yet</p>
                      <p className={`text-xs mt-1 ${dm.subtleText}`}>Click the note icon next to any section to add a note, or select a section from the list below.</p>
                    </div>
                  )}

                  {Object.keys(notes).length > 0 && activeNoteSection === null && (
                    <div>
                      <p className={`text-xs font-semibold mb-2 ${dm.mutedText}`}>All Notes ({Object.keys(notes).length})</p>
                      <div className="space-y-2">
                        {Object.entries(notes).map(([idxStr, note]) => {
                          const idx = parseInt(idxStr);
                          return (
                            <button key={idx} onClick={() => { setActiveNoteSection(idx); }}
                              className={`w-full text-left p-3 rounded-lg border transition-smooth cursor-pointer ${dm.noteBg} ${dm.noteBorder} hover:border-primary-300`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-[10px] font-semibold text-primary-500`}>Section {idx + 1}</span>
                                <span className={`text-[10px] ${dm.subtleText}`}>{note.timestamp}</span>
                              </div>
                              <p className={`text-xs ${dm.bodyText} leading-relaxed line-clamp-3`}>{note.text}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {showHighlights && (
              <div className={`hidden lg:flex w-[320px] shrink-0 flex-col border-l ${dm.border} ${dm.sidebarBg}`}>
                <div className="flex items-center justify-between p-4 border-b border-foreground-200">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${dm.mutedText}`}>Highlights</p>
                  <button onClick={() => setShowHighlights(false)}
                    className={`w-6 h-6 rounded flex items-center justify-center ${dm.mutedText} ${dm.toolHover} cursor-pointer`}>
                    <AppIcon className="ri-close-line text-sm"></AppIcon>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {/* Highlight color picker */}
                  <div className="mb-4">
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${dm.mutedText}`}>Highlight Color</p>
                    <div className="flex gap-2">
                      {(['yellow', 'green', 'pink'] as const).map(c => (
                        <button key={c} onClick={() => setHighlightColor(c)}
                          className={`w-8 h-8 rounded-full border-2 transition-smooth cursor-pointer ${highlightColor === c ? 'border-primary-500 scale-110' : 'border-transparent'} ${
                            c === 'yellow' ? 'bg-yellow-300' : c === 'green' ? 'bg-green-300' : 'bg-pink-300'
                          }`} />
                      ))}
                    </div>
                    <p className={`text-[11px] mt-2 ${dm.subtleText}`}>Select text in the article, then it will be highlighted with this color.</p>
                  </div>

                  {highlights.length === 0 && (
                    <div className="text-center py-8">
                      <AppIcon className={`ri-mark-pen-line text-3xl mb-3 block ${dm.subtleText}`}></AppIcon>
                      <p className={`text-sm ${dm.mutedText}`}>No highlights yet</p>
                      <p className={`text-xs mt-1 ${dm.subtleText}`}>Select text in the article to highlight it.</p>
                    </div>
                  )}

                  {highlights.length > 0 && (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <p className={`text-xs font-semibold ${dm.mutedText}`}>{highlights.length} highlights</p>
                        <button onClick={clearAllHighlights}
                          className={`text-[10px] ${dm.mutedText} hover:text-red-500 transition-smooth cursor-pointer`}>
                          Clear all
                        </button>
                      </div>
                      <div className="space-y-2">
                        {highlights.map(hl => (
                          <div key={hl.id}
                            className={`p-3 rounded-lg border transition-smooth ${dm.noteBg} ${dm.noteBorder}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-[10px] font-semibold uppercase tracking-wider text-primary-500`}>
                                Section {hl.sectionIndex + 1}
                              </span>
                              <button onClick={() => removeHighlight(hl.id)}
                                className={`w-5 h-5 rounded flex items-center justify-center ${dm.mutedText} hover:text-red-500 transition-smooth cursor-pointer`}>
                                <AppIcon className="ri-close-line text-xs"></AppIcon>
                              </button>
                            </div>
                            <p className={`text-xs leading-relaxed ${dm.bodyText}`}
                              style={{ backgroundColor: hl.color === 'yellow' ? 'oklch(0.92 0.18 95 / 0.6)' : hl.color === 'green' ? 'oklch(0.88 0.18 150 / 0.5)' : 'oklch(0.88 0.12 350 / 0.5)' }}>
                              {hl.text.length > 120 ? hl.text.slice(0, 120) + '...' : hl.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Right Sidebar — KSBs (when no notes or highlights) */}
            {!showNotes && !showHighlights && (
              <div className={`hidden xl:flex w-[260px] shrink-0 flex-col border-l ${dm.border} ${dm.sidebarBg}`}>
                <div className="p-4 space-y-6">
                  <div>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-3 ${dm.mutedText}`}>KSBs Covered</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ksbCodes.map(code => (
                        <span key={code} className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${ksbColor(code)}`}>{code}</span>
                      ))}
                    </div>
                    <p className={`text-[11px] mt-2 leading-relaxed ${dm.mutedText}`}>{ksbLabels}</p>
                  </div>

                  <div className="pt-4 border-t border-foreground-200">
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-3 ${dm.mutedText}`}>Article Info</p>
                    <div className="space-y-2">
                      {[
                        ['Duration', duration],
                        ['OTJH', formatHoursMinutes(plannedOTJH)],
                        ['Points', `${points} pts`],
                        ['Sections', `${readingData.sections.length}`],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between text-xs">
                          <span className={dm.subtleText}>{label}</span>
                          <span className={`font-medium ${dm.bodyText}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Highlighted sections summary */}
                  {highlights.length > 0 && (
                    <div className="pt-4 border-t border-foreground-200">
                      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${dm.mutedText}`}>Highlights</p>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700`}>
                        {highlights.length} highlighted passages
                      </span>
                    </div>
                  )}

                  {Object.keys(notes).length > 0 && (
                    <div className="pt-4 border-t border-foreground-200">
                      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${dm.mutedText}`}>Notes</p>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700`}>
                        {Object.keys(notes).length} sections noted
                      </span>
                    </div>
                  )}

                  <div className="pt-4 border-t border-foreground-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${dm.mutedText}`}>Progress</span>
                      <span className="text-xs font-semibold text-primary-600">{Math.round(readingProgress)}%</span>
                    </div>
                    <div className={`h-2 rounded-full ${dm.progressBarBg} overflow-hidden`}>
                      <div className="h-full rounded-full bg-primary-500 transition-all duration-300" style={{ width: `${readingProgress}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ═══ BOTTOM BAR ═══ */}
          <div className={`shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-t ${dm.border}`}>
            <div className={`flex items-center gap-3 text-xs ${dm.mutedText}`}>
              <span className="flex items-center gap-1"><AppIcon className="ri-time-line"></AppIcon>{duration}</span>
              <span className="flex items-center gap-1"><AppIcon className="ri-hourglass-line"></AppIcon>{plannedOTJH}h OTJH</span>
              <span className="flex items-center gap-1 text-amber-500"><AppIcon className="ri-coin-line"></AppIcon>{points} pts</span>
              {articleComplete && (
                <span className="flex items-center gap-1 text-emerald-500"><AppIcon className="ri-check-line"></AppIcon>Fully Read</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onSaveProgress()}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-smooth cursor-pointer whitespace-nowrap border ${dm.btnBorder} ${dm.btnText} ${dm.btnHoverBg}`}>
                Save &amp; Close
              </button>
              <button onClick={() => { onComplete(); onClose(); }}
                disabled={!articleComplete}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                  articleComplete ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                }`}>
                <AppIcon className="ri-check-line"></AppIcon>Mark as Complete
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

/* ── Render content with bold terms AND highlights ── */
function renderContentWithHighlights(
  text: string,
  boldTerms?: string[],
  highlights?: { startOffset: number; endOffset: number; color: string; id: string }[]
) {
  const colorMap: Record<string, string> = {
    yellow: 'bg-yellow-300/60 dark:bg-yellow-400/30',
    green: 'bg-green-300/50 dark:bg-green-400/30',
    pink: 'bg-pink-300/50 dark:bg-pink-400/30',
  };

  // Start with bold term processing
  let result = text;
  const boldMarkers: { start: number; end: number; term: string }[] = [];

  if (boldTerms && boldTerms.length > 0) {
    boldTerms.forEach(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      let match;
      while ((match = regex.exec(result)) !== null) {
        boldMarkers.push({ start: match.index, end: match.index + match[0].length, term: match[0] });
      }
    });
  }

  // Build segments
  const highlightMarkers = (highlights || []).map(h => ({
    start: h.startOffset,
    end: h.endOffset,
    color: colorMap[h.color] || colorMap.yellow,
    id: h.id,
  }));

  // Combine all markers
  const allMarkers = [
    ...boldMarkers.map(m => ({ ...m, type: 'bold' as const })),
    ...highlightMarkers.map(m => ({ ...m, type: 'highlight' as const })),
  ].sort((a, b) => a.start - b.start);

  if (allMarkers.length === 0) return text;

  // Build JSX from markers
  const segments: (string | JSX.Element)[] = [];
  let lastEnd = 0;

  allMarkers.forEach((marker, i) => {
    if (marker.start > lastEnd) {
      segments.push(text.slice(lastEnd, marker.start));
    }
    if (marker.type === 'bold') {
      segments.push(
        <mark key={`b-${i}`} className="bg-primary-100/70 text-primary-900 px-0.5 rounded font-semibold">
          {text.slice(marker.start, marker.end)}
        </mark>
      );
    } else {
      segments.push(
        <mark key={`h-${marker.id}`} className={`${marker.color} rounded-sm px-0.5`}>
          {text.slice(marker.start, marker.end)}
        </mark>
      );
    }
    lastEnd = marker.end;
  });

  if (lastEnd < text.length) {
    segments.push(text.slice(lastEnd));
  }

  return segments;
}
