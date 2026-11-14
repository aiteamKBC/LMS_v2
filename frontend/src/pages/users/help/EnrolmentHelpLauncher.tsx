import { useState } from 'react';
import { CirclePlay, X } from 'lucide-react';
import styles from './EnrolmentTutorial.module.css';

const HINT_KEY = 'enrolment-help-hint-hidden';
const hintHidden = (key: string) => { try { return sessionStorage.getItem(key) === '1'; } catch { return false; } };

/** Floating bottom-right entry point to the current page's video guide.
 *  `rounded-full` opts out of the dashboard theme's square button corners. */
export function EnrolmentHelpLauncher({ title, onOpen, hintStorageKey = HINT_KEY }: { title: string; onOpen: () => void; hintStorageKey?: string }) {
  // Hiding the message lasts for this browser tab; the button itself always stays.
  const [hidden, setHidden] = useState(() => hintHidden(hintStorageKey));
  const hide = () => {
    setHidden(true);
    try { sessionStorage.setItem(hintStorageKey, '1'); } catch { /* storage unavailable: hidden until reload */ }
  };
  return <div className={styles.launcher}>
    {!hidden && <div className={styles.hint}>
      <button type="button" className={styles.hintText} onClick={onOpen}>Need help on this page? Click here</button>
      <button type="button" className={`${styles.hintClose} rounded-full`} onClick={hide} aria-label="Hide help message" title="Hide help message"><X size={14} aria-hidden="true" /></button>
    </div>}
    <button type="button" className={`${styles.fab} rounded-full`} onClick={onOpen} aria-haspopup="dialog"
      aria-label={`Watch ${title} page guide`} title="Watch this page's guide (English)">
      <span className={styles.pulse} aria-hidden="true" />
      <CirclePlay size={26} aria-hidden="true" />
    </button>
  </div>;
}
