import { useEffect, useState } from 'react';
import { componentAccessWindow, type ComponentAccessWindow } from '@/lib/componentAccessWindow';

/** Re-check at least once a minute so 07:00/19:00 takes effect without refresh. */
export function useComponentAccessWindow(): ComponentAccessWindow {
  const [access, setAccess] = useState(() => componentAccessWindow());

  useEffect(() => {
    const update = () => setAccess(componentAccessWindow());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return access;
}
