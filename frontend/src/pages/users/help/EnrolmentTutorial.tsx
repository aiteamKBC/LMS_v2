import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CirclePlay, Download, X } from 'lucide-react';
import { chapterTime, tutorialAsset, type EnrolmentTutorial as Tutorial } from './tutorials';
import styles from './EnrolmentTutorial.module.css';

export function EnrolmentTutorial({ tutorial, initialChapter, onClose, assetBase, chapterTimes }: {
  tutorial: Tutorial; initialChapter: number; onClose: () => void;
  assetBase?: string; chapterTimes?: readonly number[];
}) {
  const asset = (extension: 'webm' | 'vtt' | 'jpg') => assetBase ? `${assetBase}/${tutorial.id}.${extension}` : tutorialAsset(tutorial.id, extension);
  const timeForChapter = (chapter: number) => chapterTimes?.[chapter] ?? chapterTime(tutorial, chapter);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pendingTime = useRef(timeForChapter(initialChapter));
  const [activeChapter, setActiveChapter] = useState(initialChapter);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [previousFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [previousFocus]);

  const seek = (index: number) => {
    const time = timeForChapter(index);
    pendingTime.current = time;
    setActiveChapter(index);
    if (video.current && video.current.readyState >= 1) video.current.currentTime = time;
    video.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="enrolment-guide-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], video[controls]'))
        .filter(element => element.getClientRects().length > 0);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.surface}>
      <header className={styles.heading}>
        <div><p><CirclePlay size={16} aria-hidden="true" />Page guide</p><h2 id="enrolment-guide-title">{tutorial.title}</h2><span>English · On-screen explanations · No audio</span></div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close page guide"><X size={22} aria-hidden="true" /></button>
      </header>
      <div className={styles.body}>
        <div className={styles.player}>
          <video key={attempt} ref={video} controls playsInline muted autoPlay={!reducedMotion} preload="metadata"
            poster={asset('jpg')} aria-label={`${tutorial.title} screen recording`}
            onLoadedMetadata={() => { if (video.current) video.current.currentTime = pendingTime.current; }}
            onTimeUpdate={() => {
              const time = video.current?.currentTime ?? 0;
              let index = 0;
              tutorial.chapters.forEach((_, chapter) => { if (timeForChapter(chapter) <= time) index = chapter; });
              setActiveChapter(index);
            }}
            onError={() => setFailed(true)}>
            <source src={asset('webm')} type="video/webm" onError={() => setFailed(true)} />
            <track kind="captions" src={asset('vtt')} srcLang="en" label="English" />
            Your browser does not support this video. Read the full explanation below.
          </video>
          {failed && <div className={styles.error} role="alert"><p>The video could not be loaded. You can still read every chapter below.</p><button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try video again</button></div>}
          <p className={styles.note}>Recorded with demonstration data. Available actions depend on your permissions and the current form configuration. On small screens, use full screen or read the chapters below.</p>
          <a className={styles.download} href={asset('webm')} download><Download size={16} aria-hidden="true" />Download video</a>
        </div>
        <section className={styles.chapters} aria-label="Video chapters and full explanation">
          <h3>Explore this page</h3><p>Select a chapter to jump to that part of the video.</p>
          <ol>{tutorial.chapters.map((chapter, index) => <li key={chapter.id}>
            <button type="button" aria-current={activeChapter === index ? 'step' : undefined} onClick={() => seek(index)}>
              <span className={styles.number}>{index + 1}</span><span><strong>{chapter.title}</strong><span>{chapter.text}</span></span>
            </button>
          </li>)}</ol>
        </section>
      </div>
    </div>
  </dialog>, document.body);
}
