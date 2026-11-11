import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TimeTrackingSession } from '@/api/timeTracking';

type Answers = Record<string, string[]>;
type Draft = { key: string; attemptId: string; timing: TimeTrackingSession; elapsedSeconds: number;
  answers: Answers; confirmed: boolean; manualSeconds?: number | null; declaredCompletion?: { day: string; time: string } };

function restore(key: string): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as Draft | null;
    return value?.key === key && typeof value.attemptId === 'string' && value.timing?.trackingToken
      && typeof value.timing.startedAt === 'string' && Number.isFinite(value.elapsedSeconds) && value.elapsedSeconds >= 0
      && value.answers && typeof value.answers === 'object' ? value : null;
  } catch { return null; }
}

/** One draft per learner/course/type/activity; audible audio can continue in another tab. */
export function useLegacyStudySession(key: string, enabled: boolean, suspended: boolean, element?: RefObject<HTMLElement | null>, playbackOnly = false) {
  const [draft, setDraft] = useState<Draft | null>(() => restore(key));
  const [paused, setPausedState] = useState(false);
  const [playing, setPlayingState] = useState(false);
  const [storageError, setStorageError] = useState('');
  const current = draft?.key === key ? draft : null;
  const hasDraft = !!current;
  const currentRef = useRef(current);
  currentRef.current = current;
  const visibleRef = useRef(document.visibilityState === 'visible');
  const measureRef = useRef<((settle?: boolean) => void) | null>(null);
  useEffect(() => { setDraft(restore(key)); setPausedState(false); setPlayingState(false); setStorageError(''); }, [key]);
  const setPaused = useCallback((value: boolean) => { measureRef.current?.(true); setPausedState(value); }, []);
  const setPlaying = useCallback((value: boolean) => { measureRef.current?.(true); setPlayingState(value); }, []);
  const persist = useCallback((value: Draft | null) => {
    try {
      if (value) localStorage.setItem(value.key, JSON.stringify(value));
      else localStorage.removeItem(key);
      setStorageError('');
    } catch { setStorageError('Your timing draft could not be saved on this device. Keep this page open until you submit.'); }
  }, [key]);
  useEffect(() => { if (current) persist(current); }, [current, persist]);
  const running = !!current && enabled && !suspended && !paused
    && (!(playbackOnly || current.timing.countingMode === 'active_playback') || playing);
  useEffect(() => {
    let last = performance.now();
    const isDisplayed = () => {
      // Workspaces keep previously opened activities mounted behind hidden
      // panels. Only the currently displayed activity can accrue time.
      for (let node = element?.current; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const canCount = () => {
      const audibleAudio = !playbackOnly && currentRef.current?.timing.countingMode === 'active_playback'
        && Array.from(element?.current?.querySelectorAll('audio') || []).some(audio =>
          !audio.paused && !audio.ended && !audio.seeking && !audio.muted && audio.volume > 0);
      return running && isDisplayed() && (visibleRef.current || audibleAudio);
    };
    let eligible = canCount();
    const measure = (settle = false) => {
      const now = performance.now();
      // Background audio timers can be throttled. Measure real elapsed time
      // rather than limiting every delayed callback to one second.
      const delta = Math.max(0, (now - last) / 1000);
      last = now;
      const nextEligible = canCount();
      // Player events settle the interval before pause/mute/seeking takes
      // effect, including when the background timer has not fired recently.
      if ((settle ? eligible && isDisplayed() : nextEligible) && delta > 0) setDraft(value => value?.key === key
        ? { ...value, elapsedSeconds: value.elapsedSeconds + delta } : value);
      eligible = nextEligible;
    };
    measureRef.current = measure;
    const visibility = () => {
      // Retain the last visible fraction before switching eligibility. Returning
      // to a reading/video tab must not add its hidden interval.
      measure();
      visibleRef.current = document.visibilityState === 'visible';
      eligible = canCount();
    };
    document.addEventListener('visibilitychange', visibility);
    if (!running) return () => { measureRef.current = null; document.removeEventListener('visibilitychange', visibility); };
    const timer = window.setInterval(measure, 1000);
    return () => { measureRef.current = null; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [key, running, element, playbackOnly]);
  useEffect(() => {
    if (!hasDraft || !enabled) return;
    const save = () => { if (currentRef.current) persist(currentRef.current); };
    const warn = (event: BeforeUnloadEvent) => { save(); event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('pagehide', save); window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('pagehide', save); window.removeEventListener('beforeunload', warn); };
  }, [hasDraft, enabled, persist]);
  const begin = (attemptId: string, timing: TimeTrackingSession) => {
    if (!timing?.trackingToken || !timing.startedAt) throw new Error('The server did not start study timing. Please retry.');
    const next = { key, attemptId, timing, elapsedSeconds: 0, answers: {}, confirmed: false };
    setDraft(next); persist(next); setPausedState(false);
  };
  const clear = () => { setDraft(null); persist(null); setPlayingState(false); };
  const setAnswers = (update: (previous: Answers) => Answers) => setDraft(value => value?.key === key
    ? { ...value, answers: update(value.answers) } : value);
  const setConfirmed = (confirmed: boolean) => setDraft(value => value?.key === key ? { ...value, confirmed } : value);
  const setManualSeconds = (manualSeconds: number | null) => setDraft(value => value?.key === key
    ? { ...value, manualSeconds } : value);
  const setDeclaredCompletion = (declaredCompletion?: Draft['declaredCompletion']) => setDraft(value => value?.key === key
    ? { ...value, declaredCompletion } : value);
  return { draft: current, begin, clear, setAnswers, setConfirmed, setManualSeconds, setDeclaredCompletion, paused, setPaused, setPlaying, running, storageError };
}
