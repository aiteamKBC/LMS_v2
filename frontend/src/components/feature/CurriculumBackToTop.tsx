import { useEffect, useState, type RefObject } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { AppIcon } from './AppIcon';
import styles from './CurriculumBackToTop.module.css';

/** Curriculum content scrolls inside the workspace main, rather than window. */
export function CurriculumBackToTop({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const main = scrollRef.current;
    if (!main) return undefined;
    const updateVisibility = () => setVisible(main.scrollTop > 320);
    updateVisibility();
    main.addEventListener('scroll', updateVisibility, { passive: true });
    return () => main.removeEventListener('scroll', updateVisibility);
  }, [scrollRef]);

  if (!visible) return null;
  return (
    <button type="button" className={styles.button} aria-label="Back to top" title="Back to top"
      onClick={() => {
        const main = scrollRef.current;
        if (!main) return;
        main.focus({ preventScroll: true });
        main.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      }}>
      <AppIcon name="ri-arrow-up-line" size={20} />
    </button>
  );
}
