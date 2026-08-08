import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ReadingContent, PodcastContent } from '@/mocks/learner-profile';

interface ReadingPodcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'reading' | 'podcast';
  readingData?: ReadingContent;
  podcastData?: PodcastContent;
  title: string;
  duration: string;
  points: number;
  plannedOTJH: number;
  ksbCodes: string[];
  ksbLabels: string;
  onComplete: () => void;
  onSaveProgress: () => void;
}

export function ReadingPodcastModal({
  isOpen, onClose, mode, readingData, podcastData,
  title, duration, points, plannedOTJH, ksbCodes, ksbLabels, onComplete, onSaveProgress,
}: ReadingPodcastModalProps) {
  const [mounted, setMounted] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const [articleComplete, setArticleComplete] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [podcastTime, setPodcastTime] = useState(0);
  const [podcastComplete, setPodcastComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<'chapters' | 'transcript'>('chapters');
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xl'>('normal');
  const [highContrast, setHighContrast] = useState(false);
  const [lineHeight, setLineHeight] = useState<'normal' | 'relaxed' | 'loose'>('relaxed');
  const [showNav, setShowNav] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const contentRef = useRef<HTMLDivElement>(null);
  const podcastInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalDuration = podcastData?.totalDurationSecs || 1200;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setReadingProgress(0);
      setArticleComplete(false);
      setPlaying(false);
      setCurrentChapter(0);
      setPodcastTime(0);
      setPodcastComplete(false);
      setActiveTab('chapters');
      setFontSize('normal');
      setHighContrast(false);
      setLineHeight('relaxed');
      setShowNav(true);
      setShowTools(false);
      setVolume(0.8);
      setPlaybackSpeed(1.0);
    } else {
      document.body.style.overflow = '';
      if (podcastInterval.current) clearInterval(podcastInterval.current);
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        if (showTools) setShowTools(false);
        else onSaveProgress();
      }
      if (e.key === ' ' && isOpen && mode === 'podcast') {
        e.preventDefault();
        togglePodcast();
      }
      if (e.key === 'ArrowRight' && isOpen && mode === 'podcast') {
        e.preventDefault();
        const next = Math.min(podcastTime + 30, totalDuration);
        setPodcastTime(next);
        updateChapterForTime(next);
      }
      if (e.key === 'ArrowLeft' && isOpen && mode === 'podcast') {
        e.preventDefault();
        const prev = Math.max(podcastTime - 15, 0);
        setPodcastTime(prev);
        updateChapterForTime(prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showTools, mode, podcastTime, totalDuration]);

  /* ── Reading scroll tracking ── */
  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;
    const scrollPct = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100;
    setReadingProgress(Math.min(scrollPct, 100));
    if (scrollPct >= 95) setArticleComplete(true);
  }, []);

  /* ── Podcast playback ── */
  const updateChapterForTime = (time: number) => {
    const ch = podcastData?.chapters;
    if (ch) {
      for (let c = ch.length - 1; c >= 0; c--) {
        const startSecs = parseTimeString(ch[c].startTime);
        if (time >= startSecs) {
          setCurrentChapter(c);
          break;
        }
      }
    }
  };

  const togglePodcast = () => {
    if (podcastComplete) {
      setPodcastTime(0);
      setCurrentChapter(0);
      setPodcastComplete(false);
    }
    if (playing) {
      if (podcastInterval.current) clearInterval(podcastInterval.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      podcastInterval.current = setInterval(() => {
        setPodcastTime(prev => {
          const next = prev + 1;
          if (next >= totalDuration) {
            if (podcastInterval.current) clearInterval(podcastInterval.current);
            setPlaying(false);
            setPodcastComplete(true);
            return totalDuration;
          }
          updateChapterForTime(next);
          return next;
        });
      }, 1000);
    }
  };

  const seekTo = (startTime: string) => {
    const newTime = parseTimeString(startTime);
    setPodcastTime(newTime);
    setPodcastComplete(false);
    updateChapterForTime(newTime);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const newTime = Math.floor(pct * totalDuration);
    setPodcastTime(newTime);
    setPodcastComplete(false);
    updateChapterForTime(newTime);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const ksbColor = (code: string) => {
    if (code.startsWith('K')) return 'bg-primary-100 text-primary-700 border-primary-200';
    if (code.startsWith('S')) return 'bg-accent-100 text-accent-700 border-accent-200';
    return 'bg-secondary-100 text-secondary-700 border-secondary-200';
  };

  if (!mounted) return null;

  const isComplete = mode === 'reading' ? articleComplete : podcastComplete;

  const bgColor = highContrast ? 'bg-foreground-950' : 'bg-background-50';
  const textColor = highContrast ? 'text-foreground-50' : 'text-foreground-900';
  const borderColor = highContrast ? 'border-foreground-800' : 'border-foreground-200';
  const sidebarBg = highContrast ? 'bg-foreground-900' : 'bg-background-100';
  const cardBg = highContrast ? 'bg-foreground-900 border-foreground-700' : 'bg-background-50 border-foreground-200';

  const fontSizeClass = {
    normal: 'text-[15px]',
    large: 'text-[17px]',
    xl: 'text-[20px]',
  }[fontSize];

  const lineHeightClass = {
    normal: 'leading-[1.6]',
    relaxed: 'leading-[1.8]',
    loose: 'leading-[2.0]',
  }[lineHeight];

  const panel = (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-foreground-950/60 backdrop-blur-sm transition-opacity duration-500 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-0 z-[61] flex flex-col transition-all duration-500 ease-out ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className={`flex-1 flex flex-col overflow-hidden ${bgColor} ${textColor}`}>
          {/* ── TOP BAR ── */}
          <div className={`shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-b ${borderColor}`}>
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                mode === 'reading' ? 'bg-primary-100 text-primary-600' : 'bg-secondary-100 text-secondary-600'
              }`}>
                <AppIcon className={`${mode === 'reading' ? 'ri-book-open-line' : 'ri-headphone-line'} text-sm`}></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground-900 truncate">{title}</p>
                <p className="text-xs text-foreground-400">
                  {mode === 'reading' ? 'Reading' : 'Podcast'} · {duration} · {points} pts
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {mode === 'reading' && (
                <>
                  <button
                    onClick={() => setShowNav(!showNav)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${
                      showNav ? 'bg-primary-100 text-primary-700' : 'text-foreground-400 hover:bg-background-100'
                    }`}
                    title="Toggle sidebar"
                  >
                    <AppIcon className="ri-menu-2-line text-sm"></AppIcon>
                  </button>
                  <button
                    onClick={() => setShowTools(!showTools)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${
                      showTools ? 'bg-primary-100 text-primary-700' : 'text-foreground-400 hover:bg-background-100'
                    }`}
                    title="Reading tools"
                  >
                    <AppIcon className="ri-settings-3-line text-sm"></AppIcon>
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
              >
                <AppIcon className="ri-close-line text-lg"></AppIcon>
              </button>
            </div>
          </div>

          {/* ── READING TOOLS PANEL ── */}
          {showTools && mode === 'reading' && (
            <div className={`shrink-0 px-4 md:px-6 py-3 border-b ${borderColor} ${sidebarBg}`}>
              <div className="flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Font</span>
                  <div className={`flex items-center rounded-lg border ${borderColor} overflow-hidden`}>
                    <button onClick={() => setFontSize('normal')} className={`px-2 py-1 text-[12px] font-medium transition-smooth cursor-pointer ${fontSize === 'normal' ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>A</button>
                    <button onClick={() => setFontSize('large')} className={`px-2 py-1 text-[14px] font-medium transition-smooth cursor-pointer border-l ${borderColor} ${fontSize === 'large' ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>A</button>
                    <button onClick={() => setFontSize('xl')} className={`px-2 py-1 text-[16px] font-medium transition-smooth cursor-pointer border-l ${borderColor} ${fontSize === 'xl' ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>A</button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Line</span>
                  <div className={`flex items-center rounded-lg border ${borderColor} overflow-hidden`}>
                    <button onClick={() => setLineHeight('normal')} className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer ${lineHeight === 'normal' ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>Tight</button>
                    <button onClick={() => setLineHeight('relaxed')} className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer border-l ${borderColor} ${lineHeight === 'relaxed' ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>Normal</button>
                    <button onClick={() => setLineHeight('loose')} className={`px-2 py-1 text-xs font-medium transition-smooth cursor-pointer border-l ${borderColor} ${lineHeight === 'loose' ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>Wide</button>
                  </div>
                </div>
                <button onClick={() => setHighContrast(!highContrast)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-smooth cursor-pointer ${highContrast ? 'bg-primary-100 text-primary-700' : 'text-foreground-500 hover:bg-background-100'}`}>
                  <AppIcon className="ri-contrast-2-line"></AppIcon>
                  <span className="hidden sm:inline">High Contrast</span>
                </button>
              </div>
            </div>
          )}

          {/* ── PROGRESS BAR ── */}
          {mode === 'reading' && (
            <div className={`h-1 shrink-0 ${highContrast ? 'bg-foreground-800' : 'bg-background-100'}`}>
              <div className="h-full bg-primary-500 rounded-r-full transition-all duration-300 ease-out" style={{ width: `${readingProgress}%` }} />
            </div>
          )}
          {mode === 'podcast' && (
            <div className="h-1 shrink-0 bg-background-100">
              <div className="h-full bg-secondary-500 rounded-r-full transition-all duration-300 ease-out" style={{ width: `${(podcastTime / totalDuration) * 100}%` }} />
            </div>
          )}

          {/* ── MAIN CONTENT AREA ── */}
          <div className="flex-1 flex overflow-hidden">
            {/* Reading mode with left sidebar */}
            {mode === 'reading' && showNav && readingData && (
              <div className={`hidden lg:flex w-[280px] shrink-0 flex-col border-r ${borderColor} ${sidebarBg}`}>
                <div className="flex-1 overflow-y-auto p-4">
                  <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-3 px-2">Table of Contents</p>
                  <div className="space-y-1">
                    {readingData.sections.map((section, i) => {
                      const isActive = i === currentChapter;
                      return (
                        <button key={i} onClick={() => { setCurrentChapter(i); if (contentRef.current) contentRef.current.scrollTop = 0; }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-smooth cursor-pointer ${isActive ? 'bg-primary-100 text-primary-700 font-medium' : 'text-foreground-400 hover:bg-background-100 hover:text-foreground-600'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${isActive ? 'bg-primary-500 text-white' : 'bg-background-200 text-foreground-400'}`}>{i + 1}</span>
                            <span className="truncate">{section.heading}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-6 pt-4 border-t border-foreground-200">
                    <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-3 px-2">Key Terms</p>
                    <div className="space-y-2 px-2">
                      {readingData.keyDefinitions.map((def, i) => (
                        <div key={i} className="group">
                          <button className="text-xs font-semibold text-foreground-700 hover:text-primary-600 transition-smooth cursor-pointer text-left w-full">{def.term}</button>
                          <p className="text-[11px] text-foreground-400 leading-relaxed mt-0.5 hidden group-hover:block">{def.definition}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {mode === 'reading' && readingData && (
                <div ref={contentRef} onScroll={handleScroll} className="h-full overflow-y-auto">
                  <div className="max-w-[720px] mx-auto px-6 md:px-10 py-8 md:py-12">
                    {/* Article header */}
                    <div className="mb-8 md:mb-10">
                      <div className="flex items-center gap-2 mb-3">
                        {readingData.ksbRefs.map(code => (
                          <span key={code} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ksbColor(code)}`}>{code}</span>
                        ))}
                      </div>
                      <h1 className={`text-[18px] md:text-[20px] font-heading font-bold text-foreground-900 mb-3 leading-tight`}>{readingData.title}</h1>
                      <div className="flex items-center gap-3 text-sm text-foreground-400">
                        <span className="flex items-center gap-1"><AppIcon className="ri-user-line text-xs"></AppIcon>{readingData.author}</span>
                        <span className="w-1 h-1 rounded-full bg-foreground-300"></span>
                        <span className="flex items-center gap-1"><AppIcon className="ri-time-line text-xs"></AppIcon>{readingData.estimatedRead}</span>
                      </div>
                    </div>
                    {/* Sections */}
                    <div className="space-y-10 md:space-y-12">
                      {readingData.sections.map((section, i) => (
                        <div key={i}>
                          <h2 className={`text-[16px] md:text-[18px] font-heading font-semibold text-foreground-900 mb-4 md:mb-5 flex items-center gap-3`}>
                            <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 bg-primary-100 text-primary-700">{i + 1}</span>
                            {section.heading}
                          </h2>
                          <div className={`${fontSizeClass} ${lineHeightClass} text-left text-foreground-600`}>{renderContent(section.content, section.boldTerms)}</div>
                        </div>
                      ))}
                    </div>
                    {/* Key Takeaways */}
                    <div className={`mt-12 md:mt-16 rounded-xl border p-6 md:p-8 ${cardBg}`}>
                      <h2 className={`text-[16px] md:text-[18px] font-heading font-semibold text-foreground-900 mb-5 flex items-center gap-2`}>
                        <AppIcon className="ri-lightbulb-line text-primary-500"></AppIcon>Key Takeaways
                      </h2>
                      <ul className="space-y-4">
                        {readingData.keyTakeaways.map((t, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 ${highContrast ? 'bg-foreground-800 text-foreground-300' : 'bg-primary-100 text-primary-700'}`}>{i + 1}</span>
                            <span className={`${fontSizeClass} ${lineHeightClass} text-foreground-700`}>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {/* Learning Outcomes */}
                    <div className={`mt-8 rounded-xl border p-6 ${cardBg}`}>
                      <h2 className={`text-[16px] md:text-[18px] font-heading font-semibold text-foreground-900 mb-4 flex items-center gap-2`}>
                        <AppIcon className="ri-graduation-cap-line text-accent-500"></AppIcon>Learning Outcomes
                      </h2>
                      <ul className="space-y-3">
                        {readingData.learningOutcomes.map((lo, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5 ${highContrast ? 'bg-foreground-800 text-foreground-300' : 'bg-accent-100 text-accent-600'}`}>{i + 1}</span>
                            <span className={`${fontSizeClass} ${lineHeightClass} text-foreground-700`}>{lo}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {articleComplete && (
                      <div className="mt-10 p-5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                        <span className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <AppIcon className="ri-check-double-line text-emerald-600 text-lg"></AppIcon>
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-emerald-800">Reading Complete</p>
                          <p className="text-xs text-emerald-600 mt-0.5">You have finished this article. Mark it as complete to earn your points.</p>
                        </div>
                      </div>
                    )}
                    <div className="h-16"></div>
                  </div>
                </div>
              )}

              {/* Podcast mode */}
              {mode === 'podcast' && podcastData && (
                <div className="h-full overflow-y-auto">
                  <div className="max-w-[720px] mx-auto px-6 md:px-10 py-8">
                    {/* Podcast hero */}
                    <div className="rounded-2xl bg-gradient-to-br from-secondary-900 to-secondary-950 p-6 md:p-8 mb-8">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-16 h-16 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                          <AppIcon className="ri-headphone-line text-white/70 text-2xl"></AppIcon>
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-base font-heading font-bold text-white mb-1">{podcastData.title}</h2>
                          <p className="text-sm text-white/50">{podcastData.host}</p>
                          <p className="text-xs text-white/30">{podcastData.episode} · {podcastData.totalDuration}</p>
                        </div>
                      </div>
                      {/* Audio controls */}
                      <div className="space-y-4">
                        {/* Progress bar */}
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden cursor-pointer" onClick={handleProgressClick}>
                          <div className="h-full rounded-full bg-secondary-400 transition-all duration-300" style={{ width: `${(podcastTime / totalDuration) * 100}%` }} />
                        </div>
                        {/* Controls row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Play/Pause */}
                            <button onClick={togglePodcast}
                              className="w-12 h-12 rounded-full bg-secondary-500 hover:bg-secondary-600 flex items-center justify-center transition-smooth cursor-pointer shadow-lg">
                              <AppIcon className={`text-white text-xl ${playing ? 'ri-pause-fill' : 'ri-play-fill'} ${!playing ? 'ml-0.5' : ''}`}></AppIcon>
                            </button>
                            {/* Time */}
                            <div className="text-white">
                              <span className="text-sm font-semibold tabular-nums">{formatTime(podcastTime)}</span>
                              <span className="text-white/30 mx-1">/</span>
                              <span className="text-xs text-white/30 tabular-nums">{podcastData.totalDuration}</span>
                            </div>
                          </div>
                          {/* Speed & Volume */}
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <AppIcon className="ri-volume-down-line text-white/50 text-sm"></AppIcon>
                              <input type="range" min="0" max="1" step="0.1" value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="w-16 accent-secondary-400" />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-white/40">Speed</span>
                              <div className="flex items-center rounded-md bg-white/10 overflow-hidden">
                                {[0.5, 1.0, 1.5, 2.0].map(s => (
                                  <button key={s} onClick={() => setPlaybackSpeed(s)}
                                    className={`px-2 py-1 text-[10px] font-semibold transition-smooth cursor-pointer ${playbackSpeed === s ? 'bg-secondary-500 text-white' : 'text-white/50 hover:text-white/70'}`}>
                                    {s}x
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Current chapter */}
                        {podcastData.chapters[currentChapter] && (
                          <div className="flex items-center gap-2 text-xs text-white/50">
                            <AppIcon className="ri-bookmark-line"></AppIcon>
                            <span className="truncate">{podcastData.chapters[currentChapter].title}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Tabs */}
                    <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 mb-6">
                      <button onClick={() => setActiveTab('chapters')}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${activeTab === 'chapters' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-400 hover:text-foreground-600'}`}>
                        <AppIcon className="ri-list-check mr-1.5"></AppIcon>Chapters ({podcastData.chapters.length})
                      </button>
                      <button onClick={() => setActiveTab('transcript')}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${activeTab === 'transcript' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-400 hover:text-foreground-600'}`}>
                        <AppIcon className="ri-file-text-line mr-1.5"></AppIcon>Transcript
                      </button>
                    </div>
                    {/* Chapters */}
                    {activeTab === 'chapters' && (
                      <div className="space-y-2">
                        {podcastData.chapters.map((ch, i) => {
                          const chStartSecs = parseTimeString(ch.startTime);
                          const isActive = currentChapter === i;
                          const isPast = podcastTime >= chStartSecs + parseTimeString(ch.duration);
                          return (
                            <button key={i} onClick={() => { seekTo(ch.startTime); if (!playing) togglePodcast(); }}
                              className={`w-full flex items-center gap-3 p-4 rounded-xl text-left transition-smooth cursor-pointer border ${isActive ? 'bg-secondary-50 border-secondary-200' : 'border-transparent hover:bg-background-100'}`}>
                              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold ${isActive ? 'bg-secondary-100 text-secondary-700' : isPast ? 'bg-emerald-100 text-emerald-600' : 'bg-background-200 text-foreground-400'}`}>
                                {isPast ? <AppIcon className="ri-check-line"></AppIcon> : i + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-sm font-medium text-foreground-900 truncate">{ch.title}</p>
                                  <span className="text-xs text-foreground-400 shrink-0 ml-2">{ch.duration}</span>
                                </div>
                                <p className="text-xs text-foreground-400 truncate">{ch.description}</p>
                              </div>
                              {isActive && playing && (
                                <div className="flex items-center gap-0.5">
                                  <span className="w-1 h-3 bg-secondary-500 rounded-full animate-pulse"></span>
                                  <span className="w-1 h-5 bg-secondary-500 rounded-full animate-pulse" style={{ animationDelay: '0.1s' }}></span>
                                  <span className="w-1 h-3 bg-secondary-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {/* Transcript */}
                    {activeTab === 'transcript' && (
                      <div className="p-6 rounded-xl bg-background-100 border border-foreground-200">
                        <p className={`${fontSizeClass} ${lineHeightClass} text-foreground-600`}>{podcastData.transcript}</p>
                        <p className="text-xs text-foreground-400 mt-4 italic">Full transcript available after completing the podcast.</p>
                      </div>
                    )}
                    {podcastComplete && (
                      <div className="mt-6 p-5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                        <span className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <AppIcon className="ri-check-double-line text-emerald-600 text-lg"></AppIcon>
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-emerald-800">Podcast Complete</p>
                          <p className="text-xs text-emerald-600 mt-0.5">You have finished listening. Mark it as complete to earn your points.</p>
                        </div>
                      </div>
                    )}
                    <div className="h-16"></div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Sidebar - KSBs */}
            <div className={`hidden xl:flex w-[260px] shrink-0 flex-col border-l ${borderColor} ${sidebarBg}`}>
              <div className="p-4 space-y-6">
                <div>
                  <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">KSBs Covered</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ksbCodes.map(code => (
                      <span key={code} className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${ksbColor(code)}`}>{code}</span>
                    ))}
                  </div>
                  <p className={`text-[11px] text-foreground-500 mt-2 leading-relaxed`}>{ksbLabels}</p>
                </div>
                <div className="pt-4 border-t border-foreground-200">
                  <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Article Info</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground-400">Duration</span>
                      <span className="font-medium text-foreground-700">{duration}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground-400">OTJH</span>
                      <span className="font-medium text-foreground-700">{plannedOTJH}h</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground-400">Points</span>
                      <span className="font-medium text-amber-600">{points} pts</span>
                    </div>
                    {mode === 'reading' && readingData && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground-400">Sections</span>
                        <span className="font-medium text-foreground-700">{readingData.sections.length}</span>
                      </div>
                    )}
                    {mode === 'podcast' && podcastData && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground-400">Chapters</span>
                        <span className="font-medium text-foreground-700">{podcastData.chapters.length}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="pt-4 border-t border-foreground-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Progress</span>
                    <span className="text-xs font-semibold text-primary-600">
                      {mode === 'reading' ? Math.round(readingProgress) : Math.round((podcastTime / totalDuration) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-background-200 overflow-hidden">
                    <div className={`h-full rounded-full ${mode === 'reading' ? 'bg-primary-500' : 'bg-secondary-500'} transition-all duration-300`}
                      style={{ width: `${mode === 'reading' ? readingProgress : (podcastTime / totalDuration) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── BOTTOM BAR ── */}
          <div className={`shrink-0 flex items-center justify-between px-4 md:px-6 py-3 border-t ${borderColor}`}>
            <div className="flex items-center gap-3 text-xs text-foreground-400">
              <span className="flex items-center gap-1"><AppIcon className="ri-time-line"></AppIcon>{duration}</span>
              <span className="flex items-center gap-1"><AppIcon className="ri-hourglass-line"></AppIcon>{plannedOTJH}h OTJH</span>
              <span className="flex items-center gap-1 text-amber-600"><AppIcon className="ri-coin-line"></AppIcon>{points} pts</span>
              {isComplete && (
                <span className="flex items-center gap-1 text-emerald-600">
                  <AppIcon className="ri-check-line"></AppIcon>
                  {mode === 'reading' ? 'Fully Read' : 'Listened'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onSaveProgress}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-smooth cursor-pointer whitespace-nowrap border ${highContrast ? 'border-foreground-700 text-foreground-300 hover:bg-foreground-800' : 'border-foreground-200 text-foreground-500 hover:bg-background-100'}`}>
                Save &amp; Close
              </button>
              <button onClick={() => { onComplete(); onClose(); }}
                disabled={!isComplete}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                  isComplete
                    ? mode === 'reading' ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-secondary-500 text-white hover:bg-secondary-600'
                    : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                }`}>
                <AppIcon className="ri-check-line"></AppIcon>
                Mark as Complete
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(panel, document.body);
}

/* ── Render content with bold terms ── */
function renderContent(text: string, boldTerms?: string[]) {
  if (!boldTerms || boldTerms.length === 0) return text;
  let parts: (string | JSX.Element)[] = [text];
  boldTerms.forEach(term => {
    const newParts: (string | JSX.Element)[] = [];
    parts.forEach((part, pi) => {
      if (typeof part !== 'string') {
        newParts.push(part);
        return;
      }
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      const segments = part.split(regex);
      const matches = part.match(regex) || [];
      segments.forEach((seg, si) => {
        if (seg) newParts.push(seg);
        if (matches[si]) {
          newParts.push(
            <mark key={`${term}-${pi}-${si}`} className="bg-primary-100/70 text-primary-900 px-0.5 rounded font-semibold">
              {matches[si]}
            </mark>
          );
        }
      });
    });
    parts = newParts;
  });
  return parts;
}

/* ── Helpers ── */
function parseTimeString(ts: string): number {
  const [m, s] = ts.split(':').map(Number);
  return m * 60 + s;
}
