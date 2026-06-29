import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface VideoChapter {
  id: string;
  title: string;
  startTime: number;
  duration: number;
  thumbnail: string;
}

interface VideoSegment {
  text: string;
  startTime: number;
  speaker: string;
}

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onSaveProgress?: () => void;
  title: string;
  type: string;
  typeIcon: string;
  duration: string;
  ksbCodes: string[];
  ksbLabels: string;
  plannedOTJH: number;
  points: number;
}

function generateChaptersFromTitle(title: string, totalDuration: number): VideoChapter[] {
  const chapters = [
    { title: 'Introduction & Overview', durationRatio: 0.15, seq: 'video-ch-0' },
    { title: 'Key Concepts & Framework', durationRatio: 0.25, seq: 'video-ch-1' },
    { title: 'Practical Application', durationRatio: 0.3, seq: 'video-ch-2' },
    { title: 'Workplace Case Study', durationRatio: 0.2, seq: 'video-ch-3' },
    { title: 'Summary & Key Takeaways', durationRatio: 0.1, seq: 'video-ch-4' },
  ];
  const thumbnails = [
    'https://readdy.ai/api/search-image?query=Professional%20marketing%20education%20video%20frame%20introduction%2C%20modern%20corporate%20presentation%20style%2C%20dark%20background%20with%20title%20overlay%2C%20clean%20minimalist%20design%2C%20high%20quality%20lecture%20capture%2C%20subtle%20warm%20lighting&width=320&height=180&seq=video-ch-0&orientation=landscape',
    'https://readdy.ai/api/search-image?query=Professional%20marketing%20education%20video%20frame%20concepts%2C%20modern%20corporate%20presentation%20style%2C%20dark%20background%20with%20data%20visualizations%20and%20text%20overlays%2C%20clean%20minimalist%20design%2C%20high%20quality%20lecture%20capture%2C%20subtle%20warm%20lighting&width=320&height=180&seq=video-ch-1&orientation=landscape',
    'https://readdy.ai/api/search-image?query=Professional%20marketing%20education%20video%20frame%20application%2C%20modern%20corporate%20presentation%20style%2C%20dark%20background%20with%20charts%20and%20diagrams%2C%20clean%20minimalist%20design%2C%20high%20quality%20lecture%20capture%2C%20subtle%20warm%20lighting&width=320&height=180&seq=video-ch-2&orientation=landscape',
    'https://readdy.ai/api/search-image?query=Professional%20marketing%20education%20video%20frame%20case%20study%2C%20modern%20corporate%20presentation%20style%2C%20dark%20background%20with%20workplace%20scenario%20graphics%2C%20clean%20minimalist%20design%2C%20high%20quality%20lecture%20capture%2C%20subtle%20warm%20lighting&width=320&height=180&seq=video-ch-3&orientation=landscape',
    'https://readdy.ai/api/search-image?query=Professional%20marketing%20education%20video%20frame%20summary%2C%20modern%20corporate%20presentation%20style%2C%20dark%20background%20with%20bullet%20points%20and%20key%20takeaways%2C%20clean%20minimalist%20design%2C%20high%20quality%20lecture%20capture%2C%20subtle%20warm%20lighting&width=320&height=180&seq=video-ch-4&orientation=landscape',
  ];
  let currentTime = 0;
  return chapters.map((ch, i) => {
    const duration = Math.floor(totalDuration * ch.durationRatio);
    const chapter = {
      id: `ch-${i}`,
      title: ch.title,
      startTime: currentTime,
      duration,
      thumbnail: thumbnails[i],
    };
    currentTime += duration;
    return chapter;
  });
}

function generateTranscriptFromTitle(title: string, totalDuration: number): VideoSegment[] {
  const segments = [
    { text: 'Welcome to this learning session. Today we will explore the core concepts that will directly support your KSB development and workplace application.', speaker: 'Crispin Jones', startRatio: 0 },
    { text: 'Understanding the strategic framework is essential before you can apply it effectively in your marketing campaigns. Let us begin with the foundational principles.', speaker: 'Crispin Jones', startRatio: 0.15 },
    { text: 'The STP model — Segmentation, Targeting, and Positioning — provides a systematic approach to moving from broad market analysis to focused campaign planning.', speaker: 'Crispin Jones', startRatio: 0.25 },
    { text: 'When we apply these concepts to the Tim Hortons customer base, we see how segmentation variables interact in real-world decision-making.', speaker: 'Crispin Jones', startRatio: 0.4 },
    { text: 'Consider the morning commuter segment: their needs, behaviours, and purchase drivers differ significantly from the family lunch segment. This insight shapes every campaign decision.', speaker: 'Crispin Jones', startRatio: 0.5 },
    { text: 'Your workplace evidence should demonstrate this connection between segmentation insight and campaign planning. Link your persona work directly to KSBs S8 and S7.', speaker: 'Crispin Jones', startRatio: 0.65 },
    { text: 'Let us walk through a practical exercise. Take your customer data and identify the three most actionable segments using both demographic and behavioural variables.', speaker: 'Crispin Jones', startRatio: 0.75 },
    { text: 'Remember: the goal is not just understanding these concepts, but applying them to generate real marketing recommendations at Tim Hortons. Your coach will review this in your next session.', speaker: 'Crispin Jones', startRatio: 0.85 },
    { text: 'To summarise: segmentation divides the market, targeting selects your focus, and positioning creates your distinct value. Master these three steps and your campaign planning will always have strategic direction.', speaker: 'Crispin Jones', startRatio: 0.92 },
  ];
  return segments.map(s => ({
    text: s.text,
    speaker: s.speaker,
    startTime: Math.floor(totalDuration * s.startRatio),
  }));
}

function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/(\d+)\s*mins?/);
  if (match) return parseInt(match[1], 10) * 60;
  const match2 = duration.match(/(\d+)\s*hours?/);
  if (match2) return parseInt(match2[1], 10) * 3600;
  return 300;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ksbColor(code: string) {
  if (code.startsWith('K')) return 'bg-primary-100 text-primary-700 border-primary-200';
  if (code.startsWith('S')) return 'bg-accent-100 text-accent-700 border-accent-200';
  return 'bg-secondary-100 text-secondary-700 border-secondary-200';
}

export function VideoPlayerModal({
  isOpen,
  onClose,
  onComplete,
  onSaveProgress,
  title,
  type,
  typeIcon,
  duration,
  ksbCodes,
  ksbLabels,
  plannedOTJH,
  points,
}: VideoPlayerModalProps) {
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [activeTab, setActiveTab] = useState<'chapters' | 'transcript' | 'notes'>('chapters');
  const [notes, setNotes] = useState<string[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [activeChapter, setActiveChapter] = useState<string>('ch-0');
  const [seekHover, setSeekHover] = useState(false);
  const [seekHoverPercent, setSeekHoverPercent] = useState(0);
  const [hoverTime, setHoverTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [completedManually, setCompletedManually] = useState(false);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalSeconds = parseDurationToSeconds(duration);
  const chapters = useRef<VideoChapter[]>([]);
  const transcript = useRef<VideoSegment[]>([]);

  useEffect(() => {
    chapters.current = generateChaptersFromTitle(title, totalSeconds);
    transcript.current = generateTranscriptFromTitle(title, totalSeconds);
    setTotalDuration(totalSeconds);
  }, [title, totalSeconds]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setPlaying(false);
      setWatched(false);
      setProgress(0);
      setCurrentTime(0);
      setHasStarted(false);
      setShowCompletion(false);
      setCompletedManually(false);
      setNotes([]);
      setActiveTab('chapters');
      setActiveChapter('ch-0');
      setPlaybackSpeed(1);
      setIsMuted(false);
      setShowControls(true);
    } else {
      document.body.style.overflow = '';
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekTo(Math.min(currentTime + 10, totalDuration));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekTo(Math.max(currentTime - 10, 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(v => Math.min(v + 10, 100));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(v - 10, 0));
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          setIsMuted(m => !m);
          break;
        case 'Escape':
          if (isFullscreen) {
            e.preventDefault();
            setIsFullscreen(false);
          } else {
            e.preventDefault();
            handleSaveAndClose();
          }
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts(s => !s);
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentTime, totalDuration, isFullscreen]);

  const togglePlay = useCallback(() => {
    if (completedManually) return;
    if (showCompletion) return;
    setPlaying(p => {
      if (!p) {
        setHasStarted(true);
        setBuffering(true);
        setTimeout(() => setBuffering(false), 800);
        progressInterval.current = setInterval(() => {
          setCurrentTime(prev => {
            const next = prev + playbackSpeed;
            const pct = Math.min((next / totalDuration) * 100, 100);
            setProgress(pct);
            if (pct >= 80) setWatched(true);
            if (pct >= 100) {
              setPlaying(false);
              if (progressInterval.current) clearInterval(progressInterval.current);
              setShowCompletion(true);
              return totalDuration;
            }
            // Update active chapter
            const currentCh = chapters.current.find(ch => next >= ch.startTime && next < ch.startTime + ch.duration);
            if (currentCh) setActiveChapter(currentCh.id);
            return next;
          });
        }, 1000);
      } else {
        if (progressInterval.current) clearInterval(progressInterval.current);
      }
      return !p;
    });
  }, [playbackSpeed, totalDuration, completedManually, showCompletion]);

  const seekTo = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, totalDuration));
    setCurrentTime(clamped);
    setProgress((clamped / totalDuration) * 100);
    const currentCh = chapters.current.find(ch => clamped >= ch.startTime && clamped < ch.startTime + ch.duration);
    if (currentCh) setActiveChapter(currentCh.id);
    if (clamped >= 80) setWatched(true);
  }, [totalDuration]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    seekTo(pct * totalDuration);
  }, [totalDuration, seekTo]);

  const handleSeekHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    setSeekHoverPercent(pct * 100);
    setHoverTime(pct * totalDuration);
  }, [totalDuration]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(f => !f);
  }, []);

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (playing && progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + speed;
          const pct = Math.min((next / totalDuration) * 100, 100);
          setProgress(pct);
          if (pct >= 80) setWatched(true);
          if (pct >= 100) {
            setPlaying(false);
            if (progressInterval.current) clearInterval(progressInterval.current);
            setShowCompletion(true);
            return totalDuration;
          }
          const currentCh = chapters.current.find(ch => next >= ch.startTime && next < ch.startTime + ch.duration);
          if (currentCh) setActiveChapter(currentCh.id);
          return next;
        });
      }, 1000);
    }
  }, [playing, totalDuration]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    if (playing) {
      controlsTimeout.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [playing]);

  const handleAddNote = useCallback(() => {
    if (!noteInput.trim()) return;
    const timestamp = formatTime(currentTime);
    const note = `[${timestamp}] ${noteInput.trim()}`;
    setNotes(prev => [...prev, note]);
    setNoteInput('');
  }, [noteInput, currentTime]);

  const handleChapterClick = useCallback((chapter: VideoChapter) => {
    seekTo(chapter.startTime);
    setActiveChapter(chapter.id);
    if (!playing) {
      setHasStarted(true);
      setPlaying(true);
      setBuffering(true);
      setTimeout(() => setBuffering(false), 800);
      progressInterval.current = setInterval(() => {
        setCurrentTime(prev => {
          const next = prev + playbackSpeed;
          const pct = Math.min((next / totalDuration) * 100, 100);
          setProgress(pct);
          if (pct >= 80) setWatched(true);
          if (pct >= 100) {
            setPlaying(false);
            if (progressInterval.current) clearInterval(progressInterval.current);
            setShowCompletion(true);
            return totalDuration;
          }
          const currentCh = chapters.current.find(ch => next >= ch.startTime && next < ch.startTime + ch.duration);
          if (currentCh) setActiveChapter(currentCh.id);
          return next;
        });
      }, 1000);
    }
  }, [seekTo, playing, playbackSpeed, totalDuration]);

  const handleMarkComplete = useCallback(() => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setCompletedManually(true);
    setPlaying(false);
    setShowCompletion(false);
    setProgress(100);
    setCurrentTime(totalDuration);
    setWatched(true);
    onComplete();
  }, [onComplete, totalDuration]);

  const handleSaveAndClose = useCallback(() => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (hasStarted) {
      onSaveProgress?.();
    } else {
      onClose();
    }
  }, [hasStarted, onSaveProgress, onClose]);

  const handleCompletionClose = useCallback(() => {
    setShowCompletion(false);
  }, []);

  const handleCompletionContinue = useCallback(() => {
    setShowCompletion(false);
    handleMarkComplete();
  }, [handleMarkComplete]);

  if (!mounted) return null;

  const currentTranscript = transcript.current.filter(s => Math.abs(s.startTime - currentTime) < 15);
  const currentChapter = chapters.current.find(ch => ch.id === activeChapter);
  const chapterProgress = currentChapter ? Math.min(((currentTime - currentChapter.startTime) / currentChapter.duration) * 100, 100) : 0;

  const panel = (
    <>
      {/* Backdrop */}
      <div
        onClick={handleSaveAndClose}
        className={`fixed inset-0 z-[60] bg-foreground-950/70 backdrop-blur-md transition-opacity duration-500 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Modal */}
      <div
        className={`fixed inset-0 z-[61] flex items-center justify-center p-2 md:p-4 transition-all duration-500 ease-out ${
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div
          className={`bg-background-50 rounded-2xl overflow-hidden flex flex-col shadow-2xl shadow-foreground-950/25 ${
            isFullscreen ? 'fixed inset-0 w-full h-full rounded-none' : 'w-full max-w-[1200px] max-h-[92vh]'
          }`}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-foreground-200/70 shrink-0 bg-background-50">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
                <i className={`${typeIcon} text-accent-600 text-sm`}></i>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground-900 truncate">{title}</p>
                <p className="text-xs text-foreground-400">{type} · {duration} · {points} pts</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowShortcuts(true)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                title="Keyboard shortcuts"
              >
                <i className="ri-keyboard-line text-sm"></i>
              </button>
              <button
                onClick={handleSaveAndClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>
          </div>

          {/* Main content area */}
          <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
            {/* Video area */}
            <div
              className="flex-1 flex flex-col min-h-0 bg-foreground-950 relative"
              ref={containerRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => playing && setShowControls(false)}
            >
              {/* Video stage */}
              <div className="flex-1 relative flex items-center justify-center min-h-0">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary-950/60 via-foreground-950 to-accent-950/60" />

                {/* Chapter title overlay */}
                {hasStarted && currentChapter && (
                  <div className={`absolute top-4 left-4 z-20 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="bg-foreground-950/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
                      <p className="text-xs text-white/50 uppercase tracking-wider font-semibold">Chapter {chapters.current.indexOf(currentChapter) + 1} of {chapters.current.length}</p>
                      <p className="text-sm text-white font-semibold">{currentChapter.title}</p>
                    </div>
                  </div>
                )}

                {/* KSB overlay */}
                {hasStarted && showControls && (
                  <div className="absolute top-4 right-4 z-20 transition-all duration-300">
                    <div className="bg-foreground-950/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
                      <p className="text-xs text-white/50 uppercase tracking-wider font-semibold mb-1">KSBs</p>
                      <div className="flex gap-1">
                        {ksbCodes.map(code => (
                          <span key={code} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${ksbColor(code)}`}>
                            {code}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Center content */}
                {!hasStarted ? (
                  <div className="relative z-10 flex flex-col items-center gap-5 text-center px-6">
                    {/* Video thumbnail */}
                    <div className="relative w-48 h-28 md:w-72 md:h-40 rounded-xl overflow-hidden border border-white/10 shadow-2xl shadow-accent-500/20">
                      <img
                        src="https://readdy.ai/api/search-image?query=Professional%20marketing%20presentation%20video%20thumbnail%2C%20dark%20modern%20background%20with%20abstract%20data%20visualization%2C%20customer%20segmentation%20concept%20art%2C%20corporate%20learning%20platform%20style%2C%20clean%20minimal%20design%2C%20teal%20and%20orange%20accent%20colors&width=720&height=400&seq=video-thumb-main&orientation=landscape"
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-foreground-950/40 flex items-center justify-center">
                        <div className="w-14 h-14 rounded-full bg-accent-500/90 flex items-center justify-center shadow-lg shadow-accent-500/40 cursor-pointer hover:bg-accent-500 hover:scale-110 transition-all duration-300"
                          onClick={togglePlay}
                        >
                          <i className="ri-play-fill text-foreground-950 text-2xl ml-0.5"></i>
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-white/90 text-lg font-semibold mb-1">{title}</p>
                      <p className="text-white/40 text-sm">{duration} · {points} points</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-white/30">
                      <span className="flex items-center gap-1"><i className="ri-keyboard-line"></i> Space to play</span>
                      <span className="flex items-center gap-1"><i className="ri-arrow-right-line"></i> Seek with arrows</span>
                      <span className="flex items-center gap-1"><i className="ri-question-line"></i> ? for help</span>
                    </div>
                  </div>
                ) : showCompletion ? (
                  <div className="relative z-10 flex flex-col items-center gap-5 text-center px-6">
                    <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                      <i className="ri-check-double-line text-emerald-400 text-4xl"></i>
                    </div>
                    <div>
                      <p className="text-white text-xl font-semibold mb-2">You completed this video</p>
                      <p className="text-white/40 text-sm">Great work watching through to the end. Mark as complete to earn your points.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleCompletionContinue}
                        className="px-6 py-3 rounded-xl bg-accent-500 text-foreground-950 font-semibold hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
                      >
                        <i className="ri-check-line"></i> Mark as Complete
                      </button>
                      <button
                        onClick={handleCompletionClose}
                        className="px-6 py-3 rounded-xl border border-white/20 text-white/70 hover:bg-white/10 hover:text-white transition-smooth cursor-pointer whitespace-nowrap"
                      >
                        Continue Watching
                      </button>
                    </div>
                  </div>
                ) : completedManually ? (
                  <div className="relative z-10 flex flex-col items-center gap-4 text-center px-6">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                      <i className="ri-check-line text-emerald-400 text-3xl"></i>
                    </div>
                    <p className="text-white text-lg font-semibold">Completed</p>
                    <p className="text-white/40 text-sm">You have earned {points} points and {plannedOTJH}h OTJH</p>
                  </div>
                ) : (
                  <div className="relative z-10 flex flex-col items-center justify-center text-center px-6">
                    {/* Playing indicator */}
                    {buffering && (
                      <div className="absolute inset-0 flex items-center justify-center bg-foreground-950/50 z-20">
                        <div className="w-10 h-10 border-3 border-white/20 border-t-accent-500 rounded-full animate-spin" />
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-4 max-w-lg">
                      {chapters.current.map((ch, i) => {
                        const isActive = ch.id === activeChapter;
                        const isPast = currentTime > ch.startTime + ch.duration;
                        return (
                          <div
                            key={ch.id}
                            className={`bg-white/5 rounded-lg px-4 py-3 text-center border transition-all duration-300 cursor-pointer hover:bg-white/10 ${
                              isActive ? 'border-accent-500/40 bg-white/10' : isPast ? 'border-white/5 opacity-50' : 'border-white/5'
                            }`}
                            onClick={() => handleChapterClick(ch)}
                          >
                            <i className={`${i === 0 ? 'ri-pie-chart-line' : i === 1 ? 'ri-crosshair-line' : i === 2 ? 'ri-rocket-line' : i === 3 ? 'ri-briefcase-line' : 'ri-star-line'} ${isActive ? 'text-accent-400' : 'text-white/30'} text-lg block mb-1`}></i>
                            <span className={`text-xs ${isActive ? 'text-white/70' : 'text-white/30'}`}>{ch.title}</span>
                            {isActive && (
                              <div className="mt-1.5 h-0.5 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-accent-500 rounded-full transition-all duration-300" style={{ width: `${chapterProgress}%` }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-white/30 text-xs mt-6">Video content simulation — learning content playing</p>
                  </div>
                )}

                {/* Center play button when paused */}
                {hasStarted && !playing && !showCompletion && !completedManually && (
                  <div className="absolute inset-0 flex items-center justify-center z-30 bg-foreground-950/30 cursor-pointer" onClick={togglePlay}>
                    <div className="w-16 h-16 rounded-full bg-accent-500/90 flex items-center justify-center shadow-lg shadow-accent-500/40 hover:bg-accent-500 hover:scale-110 transition-all duration-300">
                      <i className="ri-play-fill text-foreground-950 text-3xl ml-0.5"></i>
                    </div>
                  </div>
                )}

                {/* Controls overlay */}
                {hasStarted && !showCompletion && !completedManually && (
                  <div className={`absolute inset-x-0 bottom-0 z-40 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="bg-gradient-to-t from-foreground-950/90 via-foreground-950/50 to-transparent px-4 pb-4 pt-12">
                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-white/50 w-10 text-right tabular-nums">{formatTime(currentTime)}</span>
                          <div
                            ref={seekBarRef}
                            className="flex-1 h-1.5 bg-white/20 rounded-full cursor-pointer relative group"
                            onClick={handleSeek}
                            onMouseMove={handleSeekHover}
                            onMouseEnter={() => setSeekHover(true)}
                            onMouseLeave={() => setSeekHover(false)}
                          >
                            {/* Chapter markers */}
                            {chapters.current.map((ch, i) => {
                              if (i === 0) return null;
                              const left = (ch.startTime / totalDuration) * 100;
                              return (
                                <div
                                  key={ch.id}
                                  className="absolute top-0 w-0.5 h-full bg-white/30 hover:bg-white/60 transition-colors"
                                  style={{ left: `${left}%` }}
                                  title={ch.title}
                                />
                              );
                            })}
                            {/* Progress fill */}
                            <div className="h-full bg-accent-500 rounded-full relative" style={{ width: `${progress}%` }}>
                              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            {/* Hover preview */}
                            {seekHover && (
                              <div
                                className="absolute top-0 h-full bg-white/10 rounded-full"
                                style={{ left: 0, width: `${seekHoverPercent}%` }}
                              />
                            )}
                            {/* Hover tooltip */}
                            {seekHover && (
                              <div
                                className="absolute -top-8 bg-foreground-950/90 text-white text-xs px-2 py-1 rounded border border-white/10 whitespace-nowrap"
                                style={{ left: `${seekHoverPercent}%`, transform: 'translateX(-50%)' }}
                              >
                                {formatTime(hoverTime)}
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-white/50 w-10 tabular-nums">{formatTime(totalDuration)}</span>
                        </div>
                      </div>

                      {/* Control buttons */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {/* Play/Pause */}
                          <button
                            onClick={togglePlay}
                            className="w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-smooth cursor-pointer"
                          >
                            <i className={`${playing ? 'ri-pause-fill' : 'ri-play-fill'} text-lg`}></i>
                          </button>
                          {/* Skip back */}
                          <button
                            onClick={() => seekTo(Math.max(currentTime - 10, 0))}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 transition-smooth cursor-pointer"
                          >
                            <i className="ri-skip-back-line text-sm"></i>
                          </button>
                          {/* Skip forward */}
                          <button
                            onClick={() => seekTo(Math.min(currentTime + 10, totalDuration))}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 transition-smooth cursor-pointer"
                          >
                            <i className="ri-skip-forward-line text-sm"></i>
                          </button>
                          {/* Volume */}
                          <div className="flex items-center gap-1.5 group">
                            <button
                              onClick={() => setIsMuted(m => !m)}
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 transition-smooth cursor-pointer"
                            >
                              <i className={`${isMuted || volume === 0 ? 'ri-volume-mute-line' : volume < 50 ? 'ri-volume-down-line' : 'ri-volume-up-line'} text-sm`}></i>
                            </button>
                            <div className="w-0 group-hover:w-16 transition-all duration-300 overflow-hidden">
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={volume}
                                onChange={(e) => setVolume(parseInt(e.target.value))}
                                className="w-16 h-1 accent-accent-500"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          {/* Speed */}
                          <div className="relative group">
                            <button className="px-2 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/10 transition-smooth cursor-pointer font-semibold">
                              {playbackSpeed}x
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-foreground-950/95 border border-white/10 rounded-lg overflow-hidden hidden group-hover:flex flex-col">
                              {[0.5, 1, 1.25, 1.5, 2].map(speed => (
                                <button
                                  key={speed}
                                  onClick={() => handleSpeedChange(speed)}
                                  className={`px-3 py-1.5 text-xs transition-smooth cursor-pointer whitespace-nowrap ${
                                    playbackSpeed === speed ? 'text-accent-400 bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  {speed}x
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Next chapter */}
                          <button
                            onClick={() => {
                              const currentIndex = chapters.current.findIndex(ch => ch.id === activeChapter);
                              if (currentIndex < chapters.current.length - 1) {
                                const nextCh = chapters.current[currentIndex + 1];
                                handleChapterClick(nextCh);
                              }
                            }}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 transition-smooth cursor-pointer"
                          >
                            <i className="ri-skip-forward-mini-fill text-sm"></i>
                          </button>
                          {/* Fullscreen */}
                          <button
                            onClick={toggleFullscreen}
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white/80 hover:bg-white/10 transition-smooth cursor-pointer"
                          >
                            <i className={`${isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} text-sm`}></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom action bar */}
              <div className="shrink-0 px-4 py-3 bg-background-50 border-t border-foreground-200/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-foreground-400">
                    <i className="ri-time-line"></i>
                    <span>{duration}</span>
                  </div>
                  <div className="w-px h-3 bg-foreground-200" />
                  <div className="flex items-center gap-1.5 text-xs text-foreground-400">
                    <i className="ri-hourglass-line"></i>
                    <span>{plannedOTJH}h OTJH</span>
                  </div>
                  <div className="w-px h-3 bg-foreground-200" />
                  <div className="flex items-center gap-1.5 text-xs text-foreground-400">
                    <i className="ri-coin-line text-amber-500"></i>
                    <span>{points} pts</span>
                  </div>
                  {hasStarted && (
                    <div className="w-px h-3 bg-foreground-200" />
                  )}
                  {hasStarted && (
                    <div className="flex items-center gap-1.5 text-xs text-foreground-400">
                      <i className="ri-eye-line text-primary-500"></i>
                      <span>{Math.round(progress)}% watched</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleSaveAndClose}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap border border-foreground-200"
                  >
                    {hasStarted ? 'Save & Continue' : 'Close'}
                  </button>
                  <button
                    onClick={handleMarkComplete}
                    disabled={!watched && !completedManually}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                      watched || completedManually
                        ? 'bg-accent-500 text-foreground-950 hover:bg-accent-600'
                        : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                    }`}
                  >
                    <i className="ri-check-line"></i>
                    {completedManually ? 'Completed' : 'Mark as Watched'}
                  </button>
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div className="w-full lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-foreground-200/50 bg-background-50 flex flex-col min-h-0">
              {/* Tab switcher */}
              <div className="flex items-center border-b border-foreground-200/50 shrink-0">
                {(['chapters', 'transcript', 'notes'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 text-xs font-semibold transition-smooth cursor-pointer relative ${
                      activeTab === tab
                        ? 'text-foreground-900'
                        : 'text-foreground-400 hover:text-foreground-600'
                    }`}
                  >
                    {tab === 'chapters' && <i className="ri-list-check mr-1.5"></i>}
                    {tab === 'transcript' && <i className="ri-chat-quote-line mr-1.5"></i>}
                    {tab === 'notes' && <i className="ri-sticky-note-line mr-1.5"></i>}
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === 'notes' && notes.length > 0 && (
                      <span className="ml-1 text-[10px] bg-accent-500 text-foreground-950 px-1.5 py-0.5 rounded-full">{notes.length}</span>
                    )}
                    {activeTab === tab && (
                      <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-accent-500 rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {activeTab === 'chapters' && (
                  <div className="p-3 space-y-2">
                    {chapters.current.map((ch, i) => {
                      const isActive = ch.id === activeChapter;
                      const isCompleted = currentTime > ch.startTime + ch.duration;
                      return (
                        <button
                          key={ch.id}
                          onClick={() => handleChapterClick(ch)}
                          className={`w-full text-left rounded-lg p-2.5 transition-smooth cursor-pointer flex items-start gap-3 border ${
                            isActive
                              ? 'bg-accent-50 border-accent-200/50'
                              : isCompleted
                              ? 'bg-background-50 border-foreground-100/50 opacity-60'
                              : 'bg-background-50 border-foreground-100/50 hover:bg-background-100'
                          }`}
                        >
                          <div className="relative w-16 h-10 rounded-md overflow-hidden shrink-0 bg-foreground-100">
                            <img src={ch.thumbnail} alt={ch.title} className="w-full h-full object-cover" />
                            {isCompleted && (
                              <div className="absolute inset-0 bg-foreground-950/50 flex items-center justify-center">
                                <i className="ri-check-line text-white text-sm"></i>
                              </div>
                            )}
                            <span className="absolute bottom-0.5 right-0.5 bg-foreground-950/70 text-white text-[9px] px-1 rounded tabular-nums">
                              {formatTime(ch.duration)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-semibold truncate ${isActive ? 'text-accent-800' : 'text-foreground-700'}`}>
                              {i + 1}. {ch.title}
                            </p>
                            <p className="text-[10px] text-foreground-400 mt-0.5">{formatTime(ch.startTime)}</p>
                            {isActive && (
                              <div className="mt-1 h-0.5 bg-foreground-100 rounded-full overflow-hidden">
                                <div className="h-full bg-accent-500 rounded-full transition-all duration-300" style={{ width: `${chapterProgress}%` }} />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}

                    {/* KSBs section */}
                    <div className="pt-3 border-t border-foreground-200/50">
                      <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-semibold mb-2 px-1">KSBs Developed</p>
                      <div className="flex flex-wrap gap-1 px-1">
                        {ksbCodes.map(code => (
                          <span key={code} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ksbColor(code)}`}>
                            {code}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-foreground-500 mt-2 leading-relaxed px-1">{ksbLabels}</p>
                    </div>
                  </div>
                )}

                {activeTab === 'transcript' && (
                  <div className="p-3 space-y-3">
                    {transcript.current.map((seg, i) => {
                      const isNear = Math.abs(seg.startTime - currentTime) < 8;
                      return (
                        <div
                          key={i}
                          className={`p-2.5 rounded-lg transition-all duration-300 ${isNear ? 'bg-accent-50/50 border border-accent-200/30' : 'bg-background-50 border border-transparent'}`}
                          onClick={() => seekTo(seg.startTime)}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-foreground-400 tabular-nums font-mono">{formatTime(seg.startTime)}</span>
                            <span className="text-[10px] font-semibold text-foreground-600">{seg.speaker}</span>
                          </div>
                          <p className={`text-xs leading-relaxed cursor-pointer ${isNear ? 'text-foreground-800' : 'text-foreground-500'}`}>
                            {seg.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeTab === 'notes' && (
                  <div className="p-3 flex flex-col h-full min-h-0">
                    {/* Note input */}
                    <div className="mb-3 shrink-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] text-foreground-400 uppercase tracking-wider font-semibold">Add Note</span>
                        <span className="text-[10px] text-foreground-300">at {formatTime(currentTime)}</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={noteInput}
                          onChange={(e) => setNoteInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                          placeholder="Type a note and press Enter..."
                          maxLength={200}
                          className="flex-1 px-3 py-2 rounded-lg border border-foreground-200 text-xs text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-accent-400/30 focus:border-accent-300 bg-background-50"
                        />
                        <button
                          onClick={handleAddNote}
                          disabled={!noteInput.trim()}
                          className="px-3 py-2 rounded-lg bg-accent-500 text-foreground-950 hover:bg-accent-600 transition-smooth cursor-pointer text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <i className="ri-add-line"></i>
                        </button>
                      </div>
                    </div>

                    {/* Notes list */}
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
                      {notes.length === 0 ? (
                        <div className="text-center py-8">
                          <i className="ri-sticky-note-line text-foreground-200 text-3xl mb-2"></i>
                          <p className="text-xs text-foreground-400">No notes yet. Add notes while watching to capture key insights.</p>
                        </div>
                      ) : (
                        notes.map((note, i) => (
                          <div key={i} className="bg-background-100 rounded-lg p-2.5 border border-foreground-100/50">
                            <p className="text-xs text-foreground-700 leading-relaxed">{note}</p>
                            <button
                              onClick={() => setNotes(prev => prev.filter((_, idx) => idx !== i))}
                              className="mt-1 text-[10px] text-foreground-400 hover:text-red-500 transition-smooth cursor-pointer"
                            >
                              <i className="ri-delete-bin-line mr-0.5"></i> Delete
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-foreground-950/60 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} />
          <div className="relative bg-background-50 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-foreground-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground-900">Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer">
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>
            <div className="space-y-2">
              {[
                { key: 'Space', action: 'Play / Pause' },
                { key: '← →', action: 'Seek backward / forward 10s' },
                { key: '↑ ↓', action: 'Increase / decrease volume' },
                { key: 'F', action: 'Toggle fullscreen' },
                { key: 'M', action: 'Mute / unmute' },
                { key: 'Escape', action: 'Save & close player' },
                { key: '?', action: 'Show / hide shortcuts' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between py-2 border-b border-foreground-100/50 last:border-0">
                  <span className="text-xs text-foreground-500">{item.action}</span>
                  <kbd className="px-2 py-0.5 rounded bg-background-100 border border-foreground-200 text-xs text-foreground-700 font-mono">{item.key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );

  return createPortal(panel, document.body);
}