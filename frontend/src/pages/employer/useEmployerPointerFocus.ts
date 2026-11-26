import { useEffect } from 'react';
import './employer-pointer-focus.css';

/** Text inputs match :focus-visible even after a click, so track navigation
 * separately. Capture on document also covers dialogs rendered in body portals. */
export function useEmployerPointerFocus() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => root.setAttribute('data-employer-pointer-focus', '');
    const keyboard = (event: KeyboardEvent) => {
      if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(event.key)) {
        root.removeAttribute('data-employer-pointer-focus');
      }
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keyboard, true);
      root.removeAttribute('data-employer-pointer-focus');
    };
  }, []);
}
